-- GPS & dashcam for the delivery cars (Howen Hero-MC30-02 AI dashcams).
-- A gateway server that speaks the dashcam's protocol posts JSON to the fleet-ingest edge function,
-- which calls public.fleet_ingest(). Everything else here is read by the portal pages under /fleet.

create table public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,            -- the dashcam's terminal number / IMEI
  name text,                                 -- e.g. "سيارة 7"
  plate text,
  driver_id uuid references public.employees(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  approved boolean not null default false,   -- a dashcam that connects for the first time waits for approval
  speed_limit int not null default 100 check (speed_limit between 20 and 200),
  notes text,
  last_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_speed numeric,
  last_heading numeric,
  ignition boolean,
  ignition_at timestamptz,
  last_overspeed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.fleet_positions (
  id bigserial primary key,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  speed numeric,
  heading numeric,
  ignition boolean,
  unique (vehicle_id, at)
);
create index on public.fleet_positions (vehicle_id, at desc);

create table public.fleet_events (
  id bigserial primary key,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  driver_id uuid references public.employees(id) on delete set null,
  at timestamptz not null,
  kind text not null,       -- ignition_on, ignition_off, overspeed, smoking, phone, fatigue, yawn, distraction, seatbelt,
                            -- camera_cover, driver_absent, fcw, hmw, pcw, ldw, panic, collision, rollover, power_cut
  lat double precision,
  lng double precision,
  speed numeric,
  media_url text,           -- photo / clip of the moment, when the dashcam sends one
  media_kind text,          -- image / video
  details jsonb,
  seen_at timestamptz,
  seen_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  unique (vehicle_id, kind, at)
);
create index on public.fleet_events (at desc);
create index on public.fleet_events (vehicle_id, at desc);
create index on public.fleet_events (kind, at desc);
create index on public.fleet_events (at) where seen_at is null;

-- which alerts also go to the portal notifications (bell)
create table public.fleet_settings (
  id int primary key default 1 check (id = 1),
  notify_kinds text[] not null default array['smoking','phone','fatigue','overspeed','panic','collision','rollover','camera_cover','power_cut'],
  keep_days int not null default 60 check (keep_days between 7 and 365),
  updated_at timestamptz not null default now()
);
insert into public.fleet_settings default values;

insert into public.permission_catalog(key, label, sort_order, app) values
  ('fleet_view', 'GPS السيارات: الخريطة والتنبيهات', 500, 'fleet'),
  ('fleet_manage', 'GPS السيارات: إضافة السيارات والأجهزة والإعدادات', 501, 'fleet')
on conflict (key) do nothing;

insert into public.portal_apps(key, name, url, icon, sort_order, active)
values ('fleet', 'GPS وداش كام السيارات', 'https://badteam.github.io/locarb-hr/fleet', 'camera', 15, true)
on conflict (key) do update set name = excluded.name, url = excluded.url, active = true;

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_positions enable row level security;
alter table public.fleet_events enable row level security;
alter table public.fleet_settings enable row level security;

create policy "fleet read vehicles" on public.fleet_vehicles for select using (private.has_perm('fleet_view') or private.has_perm('fleet_manage'));
create policy "fleet manage vehicles" on public.fleet_vehicles for update using (private.has_perm('fleet_manage')) with check (private.has_perm('fleet_manage'));
create policy "fleet add vehicles" on public.fleet_vehicles for insert with check (private.has_perm('fleet_manage'));
create policy "fleet delete vehicles" on public.fleet_vehicles for delete using (private.has_perm('fleet_manage'));
create policy "fleet read positions" on public.fleet_positions for select using (private.has_perm('fleet_view') or private.has_perm('fleet_manage'));
create policy "fleet read events" on public.fleet_events for select using (private.has_perm('fleet_view') or private.has_perm('fleet_manage'));
create policy "fleet read settings" on public.fleet_settings for select using (private.has_perm('fleet_view') or private.has_perm('fleet_manage'));
create policy "fleet edit settings" on public.fleet_settings for update using (private.has_perm('fleet_manage')) with check (private.has_perm('fleet_manage'));

-- mark alerts as seen (only the seen columns change)
create or replace function public.fleet_mark_seen(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path to 'public','private' as $$
declare n int;
begin
  if not (private.has_perm('fleet_view') or private.has_perm('fleet_manage')) then raise exception 'row-level security: not allowed'; end if;
  update fleet_events set seen_at = now(), seen_by = private.current_employee_id()
   where seen_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.fleet_mark_seen(bigint[]) to authenticated;

create or replace function private.fleet_kind_label(k text) returns text language sql immutable as $$
  select case k
    when 'ignition_on' then 'السيارة اشتغلت' when 'ignition_off' then 'السيارة وقفت'
    when 'overspeed' then 'سرعة زايدة' when 'smoking' then 'السواق يدخن' when 'phone' then 'السواق يستخدم الجوال'
    when 'fatigue' then 'السواق نعسان (عيونه مسكرة)' when 'yawn' then 'السواق يتثاوب' when 'distraction' then 'السواق مو منتبه للطريق'
    when 'seatbelt' then 'السواق مو لابس الحزام' when 'camera_cover' then 'كاميرا السواق مغطاة' when 'driver_absent' then 'السواق مو في الكرسي'
    when 'fcw' then 'خطر اصطدام أمامي' when 'hmw' then 'مسافة قريبة من السيارة اللي قدام' when 'pcw' then 'خطر صدم مشاة'
    when 'ldw' then 'خروج عن المسار' when 'panic' then 'زر الطوارئ' when 'collision' then 'اصطدام' when 'rollover' then 'انقلاب'
    when 'power_cut' then 'انقطاع كهرباء الجهاز' else k end
$$;

-- portal bell notification for the important kinds
create or replace function private.fleet_event_notify() returns trigger
language plpgsql security definer set search_path to 'public','private' as $$
declare v fleet_vehicles; s fleet_settings; who text;
begin
  select * into s from fleet_settings where id = 1;
  if s.id is null or not (new.kind = any(s.notify_kinds)) then return new; end if;
  -- old messages that arrive late (device was offline) don't ring the bell
  if new.at < now() - interval '2 hours' then return new; end if;
  select * into v from fleet_vehicles where id = new.vehicle_id;
  select full_name into who from employees where id = new.driver_id;
  insert into notifications(title, body, link, audience_perm, params)
  values (private.fleet_kind_label(new.kind),
          coalesce(v.name, v.plate, 'سيارة') || coalesce(' · ' || who, '') ||
            case when new.kind = 'overspeed' and new.speed is not null then ' · ' || round(new.speed) || ' كم/س' else '' end,
          '/fleet/alerts', 'fleet_view',
          jsonb_build_object('fleet_event', new.id, 'vehicle', new.vehicle_id));
  return new;
end $$;
create trigger fleet_event_notify after insert on public.fleet_events for each row execute function private.fleet_event_notify();

-- The only way data comes in. Called by the fleet-ingest edge function (service role).
-- p = { "device_id": "...", "positions": [{at,lat,lng,speed,heading,ignition}], "events": [{at,kind,lat,lng,speed,media_url,media_kind,details}] }
-- or an array of such objects. Ignition on/off and overspeed alerts are worked out here from the positions.
create or replace function public.fleet_ingest(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public','private' as $$
declare
  item jsonb; pos jsonb; ev jsonb; v fleet_vehicles;
  n_pos int := 0; n_ev int := 0; t timestamptz; ign boolean; spd numeric;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
  for item in select * from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) loop
    if coalesce(item->>'device_id', '') = '' then continue; end if;
    insert into fleet_vehicles(device_id) values (left(item->>'device_id', 40)) on conflict (device_id) do nothing;
    select * into v from fleet_vehicles where device_id = left(item->>'device_id', 40) for update;

    for pos in select * from jsonb_array_elements(coalesce(item->'positions', '[]')) order by (value->>'at')::timestamptz loop
      t := (pos->>'at')::timestamptz;
      if t is null or t > now() + interval '10 minutes' or (pos->>'lat') is null or (pos->>'lng') is null then continue; end if;
      if abs((pos->>'lat')::float) < 0.1 and abs((pos->>'lng')::float) < 0.1 then continue; end if; -- no GPS fix
      ign := (pos->>'ignition')::boolean;
      spd := (pos->>'speed')::numeric;
      insert into fleet_positions(vehicle_id, at, lat, lng, speed, heading, ignition)
      values (v.id, t, (pos->>'lat')::float, (pos->>'lng')::float, spd, (pos->>'heading')::numeric, ign)
      on conflict do nothing;
      n_pos := n_pos + 1;
      if v.last_at is null or t >= v.last_at then
        -- engine on / off, only for an approved car and only on a real change
        if v.approved and ign is not null and v.ignition is not null and ign <> v.ignition then
          insert into fleet_events(vehicle_id, driver_id, at, kind, lat, lng, speed)
          values (v.id, v.driver_id, t, case when ign then 'ignition_on' else 'ignition_off' end, (pos->>'lat')::float, (pos->>'lng')::float, spd)
          on conflict do nothing;
          n_ev := n_ev + 1;
        end if;
        if ign is not null and (v.ignition is distinct from ign) then v.ignition_at := t; end if;
        -- over the car's limit: at most one alert every 10 minutes
        if v.approved and spd is not null and spd > v.speed_limit and (v.last_overspeed_at is null or t > v.last_overspeed_at + interval '10 minutes') then
          insert into fleet_events(vehicle_id, driver_id, at, kind, lat, lng, speed, details)
          values (v.id, v.driver_id, t, 'overspeed', (pos->>'lat')::float, (pos->>'lng')::float, spd, jsonb_build_object('limit', v.speed_limit))
          on conflict do nothing;
          v.last_overspeed_at := t; n_ev := n_ev + 1;
        end if;
        v.last_at := t; v.last_lat := (pos->>'lat')::float; v.last_lng := (pos->>'lng')::float;
        v.last_speed := spd; v.last_heading := (pos->>'heading')::numeric;
        if ign is not null then v.ignition := ign; end if;
      end if;
    end loop;

    for ev in select * from jsonb_array_elements(coalesce(item->'events', '[]')) loop
      t := coalesce((ev->>'at')::timestamptz, now());
      if coalesce(ev->>'kind', '') = '' or not v.approved then continue; end if;
      insert into fleet_events(vehicle_id, driver_id, at, kind, lat, lng, speed, media_url, media_kind, details)
      values (v.id, v.driver_id, t, left(ev->>'kind', 40),
              coalesce((ev->>'lat')::float, v.last_lat), coalesce((ev->>'lng')::float, v.last_lng),
              coalesce((ev->>'speed')::numeric, v.last_speed), ev->>'media_url', ev->>'media_kind', ev->'details')
      on conflict (vehicle_id, kind, at) do update
        set media_url = coalesce(excluded.media_url, fleet_events.media_url),
            media_kind = coalesce(excluded.media_kind, fleet_events.media_kind);
      n_ev := n_ev + 1;
    end loop;

    update fleet_vehicles set last_at = v.last_at, last_lat = v.last_lat, last_lng = v.last_lng, last_speed = v.last_speed,
      last_heading = v.last_heading, ignition = v.ignition, ignition_at = v.ignition_at, last_overspeed_at = v.last_overspeed_at
    where id = v.id;
  end loop;
  return jsonb_build_object('positions', n_pos, 'events', n_ev);
end $$;
revoke execute on function public.fleet_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.fleet_ingest(jsonb) to service_role;

-- old track points are deleted nightly (alerts are kept)
select cron.schedule('fleet-cleanup', '30 0 * * *',
  $$delete from public.fleet_positions where at < now() - make_interval(days => (select keep_days from public.fleet_settings where id = 1))$$);

-- token the gateway sends in x-fleet-token
insert into private.app_secrets(key, value) values ('fleet_ingest_token', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- my_badges() also got a 'fleet' entry: unseen car/driver alerts from the last 7 days (engine on/off not counted).

-- names for the fleet pages (who drives which car), without opening the whole employees table
create or replace function public.fleet_people() returns table(id uuid, full_name text, phone text, is_driver boolean)
language sql stable security definer set search_path to 'public','private' as $$
  select e.id, e.full_name, e.phone, coalesce(e.is_driver, false)
  from employees e
  where e.active and (private.has_perm('fleet_view') or private.has_perm('fleet_manage'))
  order by coalesce(e.is_driver, false) desc, e.full_name
$$;
grant execute on function public.fleet_people() to authenticated;

-- devices & doors got their own tile in the portal too (each section is a separate app now, no tabs between them)
insert into public.portal_apps(key, name, url, icon, sort_order, active)
values ('devices', 'الأجهزة والأبواب', 'https://badteam.github.io/locarb-hr/devices', 'hr', 16, true)
on conflict (key) do update set name = excluded.name, url = excluded.url, active = true;
