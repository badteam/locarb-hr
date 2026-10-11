-- ZKTeco devices pushing over ADMS (via the relay on the Hostinger server)
create table public.bio_devices (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  name text,
  branch_id uuid references public.branches(id),
  approved boolean not null default false,
  approved_at timestamptz,
  process_from timestamptz,          -- punches before this are kept but not turned into attendance
  has_door boolean not null default true,
  door_seconds int not null default 5 check (door_seconds between 1 and 60),
  last_seen_at timestamptz,
  last_ip text,
  info jsonb,
  created_at timestamptz not null default now()
);

create table public.bio_punches (
  id bigserial primary key,
  device_id uuid not null references public.bio_devices(id) on delete cascade,
  pin text not null,
  punched_at timestamptz not null,
  status int,
  verify int,
  employee_id uuid references public.employees(id),
  attendance_id uuid references public.attendance(id) on delete set null,
  result text,                        -- in / out / duplicate / unknown_pin / before_start / pending
  raw text,
  created_at timestamptz not null default now(),
  unique (device_id, pin, punched_at)
);
create index on public.bio_punches (punched_at desc);
create index on public.bio_punches (employee_id, punched_at desc);
create index on public.bio_punches (pin) where result = 'unknown_pin';

create table public.bio_device_users (
  device_id uuid not null references public.bio_devices(id) on delete cascade,
  pin text not null,
  name text,
  privilege int,
  card text,
  fp_count int not null default 0,
  removed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (device_id, pin)
);

create table public.bio_commands (
  id bigserial primary key,
  device_id uuid not null references public.bio_devices(id) on delete cascade,
  kind text not null,                 -- open_door / set_user / delete_user / query_users / reupload
  command text not null,
  pin text,
  status text not null default 'pending' check (status in ('pending','sent','ok','failed','expired')),
  return_code int,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  done_at timestamptz
);
create index on public.bio_commands (device_id, status);

-- how each employee punches: any / mobile (own phone) / kiosk (branch iPad) / device (ZKTeco)
alter table public.employees add column bio_pin text unique check (bio_pin ~ '^[0-9]{1,9}$');
alter table public.employees add column punch_mode text not null default 'any' check (punch_mode in ('any','mobile','kiosk','device'));

insert into public.permission_catalog(key,label,sort_order,app) values
 ('view_devices','عرض أجهزة البصمة وحالتها',18,'devices'),
 ('open_doors','فتح الأبواب عن بعد',19,'devices'),
 ('manage_devices','إدارة أجهزة البصمة ومزامنة الأسماء',20,'devices')
on conflict (key) do nothing;

alter table public.bio_devices enable row level security;
alter table public.bio_punches enable row level security;
alter table public.bio_device_users enable row level security;
alter table public.bio_commands enable row level security;

-- permission on the device's branch; a device not yet in a branch needs an all-branches role
create or replace function private.dev_perm(p text, d uuid) returns boolean
language sql stable security definer set search_path to 'public','private' as $$
  select coalesce((select private.perm_on_branch(p, x.branch_id) from bio_devices x where x.id = d), false)
$$;

create policy "read devices" on public.bio_devices for select using (
  private.perm_on_branch('view_devices', branch_id) or private.perm_on_branch('open_doors', branch_id) or private.perm_on_branch('manage_devices', branch_id));
create policy "manage devices" on public.bio_devices for update
  using (private.perm_on_branch('manage_devices', branch_id))
  with check (private.perm_on_branch('manage_devices', branch_id));
create policy "read punches" on public.bio_punches for select using (
  private.dev_perm('view_devices', device_id) or private.dev_perm('manage_devices', device_id) or employee_id = private.current_employee_id());
create policy "read device users" on public.bio_device_users for select using (private.dev_perm('manage_devices', device_id));
create policy "read commands" on public.bio_commands for select using (
  private.dev_perm('view_devices', device_id) or private.dev_perm('open_doors', device_id) or private.dev_perm('manage_devices', device_id));

create or replace function private.queue_bio_command(p_device uuid, p_kind text, p_command text, p_pin text default null)
returns bio_commands language plpgsql security definer set search_path to 'public','private' as $$
declare c bio_commands;
begin
  insert into bio_commands(device_id, kind, command, pin, created_by)
  values (p_device, p_kind, p_command, p_pin, private.current_employee_id()) returning * into c;
  return c;
end $$;

create or replace function public.open_door(p_device uuid) returns bio_commands
language plpgsql security definer set search_path to 'public','private' as $$
declare d bio_devices;
begin
  select * into d from bio_devices where id = p_device;
  if d.id is null or not d.approved then raise exception 'device not found'; end if;
  if not private.perm_on_branch('open_doors', d.branch_id) then raise exception 'row-level security: not allowed'; end if;
  if not d.has_door then raise exception 'device has no door'; end if;
  update bio_commands set status = 'expired' where device_id = d.id and kind = 'open_door' and status = 'pending';
  -- lock 01, door 01, open, for N seconds
  return private.queue_bio_command(d.id, 'open_door', 'CONTROL DEVICE 010101' || lpad(d.door_seconds::text, 2, '0'));
end $$;

create or replace function private.bio_clean_name(t text) returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(t,''), '[^\x20-\x7E]', '', 'g'), '\s+', ' ', 'g')), 24)
$$;

create or replace function public.device_command(p_device uuid, p_kind text, p_pin text default null, p_name text default null)
returns bio_commands language plpgsql security definer set search_path to 'public','private' as $$
declare d bio_devices; cmd text;
begin
  select * into d from bio_devices where id = p_device;
  if d.id is null or not d.approved then raise exception 'device not found'; end if;
  if not private.perm_on_branch('manage_devices', d.branch_id) then raise exception 'row-level security: not allowed'; end if;
  if p_kind = 'query_users' then cmd := 'DATA QUERY USERINFO';
  elsif p_kind = 'reupload' then cmd := 'CHECK';
  elsif p_kind in ('set_user','delete_user') then
    if coalesce(p_pin,'') !~ '^[0-9]{1,9}$' then raise exception 'bad device id'; end if;
    cmd := case p_kind when 'set_user' then format(E'DATA UPDATE USERINFO PIN=%s\tName=%s\tPri=0', p_pin, private.bio_clean_name(p_name))
                       else format('DATA DELETE USERINFO PIN=%s', p_pin) end;
  else raise exception 'unknown command'; end if;
  return private.queue_bio_command(d.id, p_kind, cmd, p_pin);
end $$;

-- turn one raw punch into attendance
create or replace function private.process_bio_punch(p_id bigint) returns text
language plpgsql security definer set search_path to 'public','private' as $$
declare
  p bio_punches; d bio_devices; emp employees; sh shifts; rec attendance;
  loc timestamp; late int := 0; res text;
begin
  select * into p from bio_punches where id = p_id for update;
  if p.id is null then return null; end if;
  if p.result is not null and p.result not in ('pending','unknown_pin') then return p.result; end if;
  select * into d from bio_devices where id = p.device_id;
  if not d.approved then update bio_punches set result = 'pending' where id = p.id; return 'pending'; end if;
  if p.punched_at < d.process_from then update bio_punches set result = 'before_start' where id = p.id; return 'before_start'; end if;
  select * into emp from employees where bio_pin = p.pin and active;
  if emp.id is null then update bio_punches set result = 'unknown_pin' where id = p.id; return 'unknown_pin'; end if;

  -- same person punching twice within 2 minutes
  if exists (select 1 from attendance a where a.employee_id = emp.id
      and (abs(extract(epoch from a.check_in_at - p.punched_at)) < 120
           or (a.check_out_at is not null and abs(extract(epoch from a.check_out_at - p.punched_at)) < 120))) then
    update bio_punches set employee_id = emp.id, result = 'duplicate' where id = p.id; return 'duplicate';
  end if;

  select * into rec from attendance a where a.employee_id = emp.id and a.check_out_at is null
    and a.check_in_at < p.punched_at and a.check_in_at > p.punched_at - interval '16 hours'
    order by a.check_in_at desc limit 1;
  if rec.id is not null then
    update attendance set check_out_at = p.punched_at where id = rec.id;
    res := 'out';
  else
    loc := p.punched_at at time zone 'Asia/Kuwait';
    select * into sh from shifts where id = emp.shift_id;
    if sh.id is not null then
      late := greatest(0, floor(extract(epoch from (loc::time - sh.start_time)) / 60)::int - sh.grace_minutes);
      if late > 600 then late := 0; end if;
    end if;
    insert into attendance(employee_id, branch_id, work_date, check_in_at, inside_geofence, late_minutes, method, note)
    values (emp.id, coalesce(d.branch_id, emp.branch_id), loc::date, p.punched_at, true, late, 'device', coalesce(d.name, d.serial))
    returning * into rec;
    res := 'in';
  end if;
  update bio_punches set employee_id = emp.id, attendance_id = rec.id, result = res where id = p.id;
  return res;
end $$;

create or replace function private.process_bio_punches(p_device uuid default null) returns int
language plpgsql security definer set search_path to 'public','private' as $$
declare r record; n int := 0;
begin
  for r in select id from bio_punches where (result is null or result in ('pending','unknown_pin'))
             and (p_device is null or device_id = p_device) order by punched_at loop
    perform private.process_bio_punch(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- approve a new device and put it in a branch; only punches from now on become attendance
create or replace function public.approve_device(p_device uuid, p_branch uuid, p_name text) returns bio_devices
language plpgsql security definer set search_path to 'public','private' as $$
declare d bio_devices;
begin
  if p_branch is null or not private.perm_on_branch('manage_devices', p_branch) then raise exception 'row-level security: not allowed'; end if;
  update bio_devices set branch_id = p_branch, name = nullif(btrim(p_name),''), approved = true,
    approved_at = coalesce(approved_at, now()), process_from = coalesce(process_from, now())
  where id = p_device returning * into d;
  if d.id is null then raise exception 'device not found'; end if;
  perform private.process_bio_punches(d.id);
  return d;
end $$;

-- after setting an employee's device id, pick up punches that were waiting for it
create or replace function private.bio_pin_changed() returns trigger
language plpgsql security definer set search_path to 'public','private' as $$
declare r record;
begin
  if new.bio_pin is not null and new.bio_pin is distinct from old.bio_pin then
    for r in select id from bio_punches where pin = new.bio_pin and result = 'unknown_pin' order by punched_at loop
      perform private.process_bio_punch(r.id);
    end loop;
  end if;
  return new;
end $$;
create trigger trg_bio_pin_changed after update of bio_pin on public.employees for each row execute function private.bio_pin_changed();

-- called only by the receiver function (service role)
create or replace function public.bio_ingest(p_serial text, p_ip text, p_kind text, p_rows jsonb default '[]', p_info jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $$
declare d bio_devices; r jsonb; n int := 0; cmds jsonb; pid bigint;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json->>'role','') <> 'service_role' then raise exception 'not allowed'; end if;
  if coalesce(p_serial,'') !~ '^[A-Za-z0-9_-]{4,40}$' then raise exception 'bad serial'; end if;
  insert into bio_devices(serial, last_seen_at, last_ip, info) values (p_serial, now(), p_ip, p_info)
  on conflict (serial) do update set last_seen_at = now(), last_ip = excluded.last_ip,
    info = case when excluded.info is null then bio_devices.info else coalesce(bio_devices.info,'{}') || excluded.info end
  returning * into d;

  if p_kind = 'attlog' then
    for r in select * from jsonb_array_elements(p_rows) loop
      pid := null;
      insert into bio_punches(device_id, pin, punched_at, status, verify, raw)
      values (d.id, r->>'pin', ((r->>'time') || '+03:00')::timestamptz, nullif(r->>'status','')::int, nullif(r->>'verify','')::int, r->>'raw')
      on conflict do nothing returning id into pid;
      if pid is not null then perform private.process_bio_punch(pid); n := n + 1; end if;
    end loop;
    return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_rows), 'new', n);

  elsif p_kind = 'users' then
    for r in select * from jsonb_array_elements(p_rows) loop
      if r ? 'fp' then
        insert into bio_device_users(device_id, pin, fp_count) values (d.id, r->>'pin', 1)
        on conflict (device_id, pin) do update set fp_count = least(10, bio_device_users.fp_count + 1), removed = false, updated_at = now();
      else
        insert into bio_device_users(device_id, pin, name, privilege, card)
        values (d.id, r->>'pin', r->>'name', nullif(r->>'pri','')::int, nullif(r->>'card',''))
        on conflict (device_id, pin) do update set name = excluded.name, privilege = excluded.privilege, card = excluded.card, removed = false, updated_at = now();
      end if;
      n := n + 1;
    end loop;
    return jsonb_build_object('ok', true, 'count', n);

  elsif p_kind = 'getrequest' then
    if not d.approved then return jsonb_build_object('commands', '[]'::jsonb); end if;
    update bio_commands set status = 'expired' where device_id = d.id and status = 'pending' and kind = 'open_door' and created_at < now() - interval '2 minutes';
    with picked as (
      update bio_commands set status = 'sent', sent_at = now()
      where id in (select id from bio_commands where device_id = d.id and status = 'pending' order by id limit 10)
      returning id, command)
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'command', command) order by id), '[]') into cmds from picked;
    return jsonb_build_object('commands', cmds);

  elsif p_kind = 'cmdresult' then
    for r in select * from jsonb_array_elements(p_rows) loop
      update bio_commands set status = case when (r->>'ret')::int >= 0 then 'ok' else 'failed' end,
        return_code = (r->>'ret')::int, done_at = now()
      where id = (r->>'id')::bigint and device_id = d.id;
      update bio_device_users u set removed = true, updated_at = now() from bio_commands c
        where c.id = (r->>'id')::bigint and c.kind = 'delete_user' and (r->>'ret')::int >= 0 and u.device_id = d.id and u.pin = c.pin;
      update bio_device_users u set name = private.bio_clean_name(e.full_name), removed = false, updated_at = now()
        from bio_commands c join employees e on e.bio_pin = c.pin
        where c.id = (r->>'id')::bigint and c.kind = 'set_user' and (r->>'ret')::int >= 0 and u.device_id = d.id and u.pin = c.pin;
    end loop;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', true, 'approved', d.approved);
end $$;


-- employees set to the ZKTeco device or the branch iPad can't punch from their own phone
create or replace function public.check_in(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_method text DEFAULT 'biometric'::text)
 RETURNS attendance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare
  emp employees; br branches; sh shifts;
  today date := (now() at time zone 'Asia/Kuwait')::date;
  rec attendance; inside boolean; late int := 0;
begin
  select * into emp from employees where user_id = auth.uid() and active;
  if emp.id is null then raise exception 'not an active employee'; end if;
  if emp.punch_mode in ('device','kiosk') then raise exception 'punch mode %', emp.punch_mode; end if;

  select * into rec from attendance where employee_id = emp.id and work_date = today and check_out_at is null limit 1;
  if rec.id is not null then raise exception 'already checked in'; end if;

  select * into br from branches where id = emp.branch_id;
  if br.latitude is not null and p_lat is not null then
    inside := private.distance_m(p_lat, p_lng, br.latitude, br.longitude) <= br.geofence_radius_m;
  end if;

  select * into sh from shifts where id = emp.shift_id;
  if sh.id is not null then
    late := greatest(0, floor(extract(epoch from ((now() at time zone 'Asia/Kuwait')::time - sh.start_time)) / 60)::int - sh.grace_minutes);
    if late > 600 then late := 0; end if;
  end if;

  insert into attendance(employee_id, branch_id, work_date, check_in_at, check_in_lat, check_in_lng, inside_geofence, late_minutes, method)
  values (emp.id, emp.branch_id, today, now(), p_lat, p_lng, inside, late, p_method)
  returning * into rec;
  return rec;
end $function$;

create or replace function public.check_out() RETURNS attendance LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare rec attendance; mode text;
begin
  select punch_mode into mode from employees where user_id = auth.uid() and active;
  if mode in ('device','kiosk') then raise exception 'punch mode %', mode; end if;
  update attendance set check_out_at = now()
  where id = (select a.id from attendance a join employees e on e.id = a.employee_id
              where e.user_id = auth.uid() and a.check_out_at is null
              order by a.check_in_at desc limit 1)
  returning * into rec;
  if rec.id is null then raise exception 'no open check-in'; end if;
  return rec;
end $function$;
