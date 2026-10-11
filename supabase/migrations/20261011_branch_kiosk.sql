-- branch iPad/iPhone used as a shared punch screen (phone number + personal 4-digit code)
create table public.kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text,
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.kiosk_devices enable row level security;
create policy "read kiosks" on public.kiosk_devices for select using (
  private.perm_on_branch('manage_devices', branch_id) or private.perm_on_branch('view_devices', branch_id));
create policy "manage kiosks" on public.kiosk_devices for update
  using (private.perm_on_branch('manage_devices', branch_id)) with check (private.perm_on_branch('manage_devices', branch_id));

-- kept apart from employees so branch roles that can read employees can't read codes
create table public.kiosk_codes (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  failed int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.kiosk_codes enable row level security;
create policy "read kiosk codes" on public.kiosk_codes for select using (
  private.perm_on_branch('manage_employees', (select e.branch_id from employees e where e.id = employee_id)));

create or replace function private.phone_key(t text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(t,''), '\D', '', 'g'), 8)
$$;

-- run on the iPad by a manager while logged in; returns the secret the iPad keeps (only its hash is stored)
create or replace function public.enable_kiosk(p_branch uuid, p_name text default null) returns text
language plpgsql security definer set search_path to 'public','private','extensions' as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_branch is null or not private.perm_on_branch('manage_devices', p_branch) then raise exception 'row-level security: not allowed'; end if;
  insert into kiosk_devices(branch_id, name, token_hash, created_by)
  values (p_branch, nullif(btrim(p_name),''), encode(extensions.digest(tok, 'sha256'), 'hex'), private.current_employee_id());
  return tok;
end $$;

create or replace function private.kiosk_by_token(p_token text) returns kiosk_devices
language plpgsql security definer set search_path to 'public','private','extensions' as $$
declare k kiosk_devices;
begin
  select * into k from kiosk_devices where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex') and active;
  if k.id is not null then update kiosk_devices set last_seen_at = now() where id = k.id; end if;
  return k;
end $$;

-- kiosk calls answer {ok:false, error:...} instead of raising, so failed-code counts are kept
create or replace function public.kiosk_info(p_token text) returns json
language plpgsql security definer set search_path to 'public','private' as $$
declare k kiosk_devices;
begin
  k := private.kiosk_by_token(p_token);
  if k.id is null then return json_build_object('ok', false, 'error', 'inactive'); end if;
  return json_build_object('ok', true, 'branch', (select name from branches where id = k.branch_id), 'name', k.name);
end $$;

-- 5 wrong codes lock the employee for 10 minutes
create or replace function private.kiosk_check(p_token text, p_phone text, p_code text) returns json
language plpgsql security definer set search_path to 'public','private' as $$
declare k kiosk_devices; emp employees; c kiosk_codes;
begin
  k := private.kiosk_by_token(p_token);
  if k.id is null then return json_build_object('ok', false, 'error', 'inactive'); end if;
  if length(private.phone_key(p_phone)) < 8 then return json_build_object('ok', false, 'error', 'wrong'); end if;
  select * into emp from employees where active and private.phone_key(phone) = private.phone_key(p_phone) limit 1;
  if emp.id is null then return json_build_object('ok', false, 'error', 'wrong'); end if;
  select * into c from kiosk_codes where employee_id = emp.id for update;
  if c.employee_id is null then return json_build_object('ok', false, 'error', 'no_code'); end if;
  if c.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'minutes', ceil(extract(epoch from c.locked_until - now()) / 60));
  end if;
  if c.code <> coalesce(p_code,'') then
    update kiosk_codes set failed = failed + 1,
      locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' end
    where employee_id = emp.id;
    return json_build_object('ok', false, 'error', case when c.failed + 1 >= 5 then 'locked' else 'wrong' end, 'minutes', 10);
  end if;
  update kiosk_codes set failed = 0, locked_until = null where employee_id = emp.id;
  if emp.punch_mode not in ('any','kiosk') then return json_build_object('ok', false, 'error', 'mode', 'mode', emp.punch_mode); end if;
  return json_build_object('ok', true, 'employee_id', emp.id, 'kiosk_id', k.id, 'branch_id', k.branch_id);
end $$;

create or replace function public.kiosk_login(p_token text, p_phone text, p_code text) returns json
language plpgsql security definer set search_path to 'public','private' as $$
declare r json; emp employees; a attendance;
begin
  r := private.kiosk_check(p_token, p_phone, p_code);
  if not (r->>'ok')::boolean then return r; end if;
  select * into emp from employees where id = (r->>'employee_id')::uuid;
  select * into a from attendance where employee_id = emp.id and check_out_at is null
    and check_in_at > now() - interval '16 hours' order by check_in_at desc limit 1;
  return json_build_object('ok', true, 'name', emp.full_name, 'job', emp.job_title, 'lang', emp.language,
    'open_since', a.check_in_at,
    'today', (select json_agg(json_build_object('in', x.check_in_at, 'out', x.check_out_at) order by x.check_in_at)
              from attendance x where x.employee_id = emp.id and x.work_date = (now() at time zone 'Asia/Kuwait')::date));
end $$;

create or replace function public.kiosk_punch(p_token text, p_phone text, p_code text, p_action text) returns json
language plpgsql security definer set search_path to 'public','private' as $$
declare r json; emp employees; sh shifts; a attendance; late int := 0; br uuid;
begin
  r := private.kiosk_check(p_token, p_phone, p_code);
  if not (r->>'ok')::boolean then return r; end if;
  select * into emp from employees where id = (r->>'employee_id')::uuid;
  br := (r->>'branch_id')::uuid;
  select * into a from attendance where employee_id = emp.id and check_out_at is null
    and check_in_at > now() - interval '16 hours' order by check_in_at desc limit 1;
  if p_action = 'in' then
    if a.id is not null then return json_build_object('ok', false, 'error', 'already_in'); end if;
    select * into sh from shifts where id = emp.shift_id;
    if sh.id is not null then
      late := greatest(0, floor(extract(epoch from ((now() at time zone 'Asia/Kuwait')::time - sh.start_time)) / 60)::int - sh.grace_minutes);
      if late > 600 then late := 0; end if;
    end if;
    insert into attendance(employee_id, branch_id, work_date, check_in_at, inside_geofence, late_minutes, method, note)
    values (emp.id, br, (now() at time zone 'Asia/Kuwait')::date, now(), true, late, 'kiosk',
            coalesce((select name from kiosk_devices where id = (r->>'kiosk_id')::uuid), 'آيباد الفرع'))
    returning * into a;
    return json_build_object('ok', true, 'action', 'in', 'at', a.check_in_at, 'late', late);
  elsif p_action = 'out' then
    if a.id is null then return json_build_object('ok', false, 'error', 'not_in'); end if;
    if a.check_in_at > now() - interval '2 minutes' then return json_build_object('ok', false, 'error', 'too_soon'); end if;
    update attendance set check_out_at = now() where id = a.id returning * into a;
    return json_build_object('ok', true, 'action', 'out', 'at', a.check_out_at, 'in', a.check_in_at);
  end if;
  return json_build_object('ok', false, 'error', 'bad_action');
end $$;

create or replace function public.set_kiosk_code(p_employee uuid, p_code text default null) returns text
language plpgsql security definer set search_path to 'public','private' as $$
declare c text := p_code; b uuid;
begin
  select branch_id into b from employees where id = p_employee;
  if not private.perm_on_branch('manage_employees', b) then raise exception 'row-level security: not allowed'; end if;
  if c is null or c = '' then c := lpad((floor(random() * 10000))::int::text, 4, '0'); end if;
  if c !~ '^[0-9]{4}$' then raise exception 'code must be 4 digits'; end if;
  insert into kiosk_codes(employee_id, code) values (p_employee, c)
  on conflict (employee_id) do update set code = excluded.code, failed = 0, locked_until = null, updated_at = now();
  return c;
end $$;

create or replace function public.fill_kiosk_codes() returns int
language plpgsql security definer set search_path to 'public','private' as $$
declare n int;
begin
  if not private.perm_on_branch('manage_employees', null) then raise exception 'row-level security: not allowed'; end if;
  insert into kiosk_codes(employee_id, code)
  select e.id, lpad((floor(random() * 10000))::int::text, 4, '0') from employees e
  where e.active and not exists (select 1 from kiosk_codes k where k.employee_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;
