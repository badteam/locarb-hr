-- HR fix 3 + 5: overtime and short hours per employee per Kuwait day (all segments summed), not per attendance row.
-- A day over 13h or with a check-out outside the geofence still gets an OT entry, but flagged needs_review with a note.
-- Days that total under 10 minutes (double taps) never produce short hours.
-- Employees with no working_hours fall back to the company default of 9h (setting + function fallback), drivers keep driver_hours_per_day.
-- Applied as migration hr_fixes_overtime_per_day.

alter table overtime_entries add column if not exists needs_review boolean not null default false;

update payroll_settings set hours_per_day = 9 where id = 1 and hours_per_day = 8;

CREATE OR REPLACE FUNCTION private.daily_hours(e employees, s payroll_settings)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(e.working_hours, case when e.is_driver then s.driver_hours_per_day else s.hours_per_day end, 9) $function$;

-- Recompute OT + short hours for one employee-day from all of that day's segments.
CREATE OR REPLACE FUNCTION private.recompute_day_hours(p_emp uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare e employees; s payroll_settings; worked int; expected int; ot int; off boolean; dow text;
        n int; open_n int; outside boolean; last_id uuid; review text;
begin
  if p_emp is null or p_date is null then return; end if;
  select * into e from employees where id = p_emp;
  if e.id is null then return; end if;
  select * into s from payroll_settings where id = 1;
  select count(*), count(*) filter (where check_out_at is null),
         coalesce(sum(floor(extract(epoch from (check_out_at - check_in_at)) / 60)) filter (where check_out_at is not null), 0),
         coalesce(bool_or(check_out_inside is false), false)
    into n, open_n, worked, outside
    from attendance where employee_id = e.id and work_date = p_date and check_in_at is not null;
  if n = 0 or open_n > 0 then return; end if;   -- nothing, or the day is still open: decide when it closes
  select id into last_id from attendance where employee_id = e.id and work_date = p_date order by check_out_at desc nulls last limit 1;
  dow := lower(trim(to_char(p_date, 'FMDay')));
  off := dow = any(e.weekly_holidays) or exists (
    select 1 from leave_requests lr join leave_types lt on lt.id = lr.leave_type_id
    where lr.employee_id = e.id and lr.status = 'approved' and lt.name = 'أوف' and p_date between lr.start_date and lr.end_date);
  expected := round(private.daily_hours(e, s) * 60);
  ot := case when off then worked else worked - expected end;
  review := nullif(concat_ws(' · ',
    case when worked > 780 then 'يحتاج مراجعة: مجموع اليوم أكثر من 13 ساعة (يمكن نسي يبصم انصراف)' end,
    case when outside then 'يحتاج مراجعة: الانصراف كان برا الفرع' end), '');

  if ot >= s.ot_min_minutes then
    insert into overtime_entries(employee_id, work_date, attendance_id, minutes, is_offday, source, status, needs_review, note)
    values (e.id, p_date, last_id, ot, off, 'auto', 'pending', review is not null, review)
    on conflict (employee_id, work_date) where source = 'auto'
    do update set minutes = excluded.minutes, is_offday = excluded.is_offday, attendance_id = excluded.attendance_id,
                  needs_review = excluded.needs_review, note = excluded.note, status = 'pending'
    where overtime_entries.status not in ('approved','rejected');
  else
    update overtime_entries set status = 'void' where employee_id = e.id and work_date = p_date and source = 'auto' and status = 'pending';
  end if;

  if not off and worked >= 10 and worked < expected - coalesce(s.short_hours_tolerance, 15) then
    insert into short_hours(employee_id, work_date, attendance_id, worked_minutes, required_minutes)
    values (e.id, p_date, last_id, worked, expected)
    on conflict (employee_id, work_date) do update set worked_minutes = excluded.worked_minutes, required_minutes = excluded.required_minutes,
      attendance_id = excluded.attendance_id, status = case when short_hours.status = 'void' then 'pending' else short_hours.status end;
  else
    update short_hours set status = 'void' where employee_id = e.id and work_date = p_date and status = 'pending';
  end if;
end $function$;
revoke all on function private.recompute_day_hours(uuid, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.detect_overtime()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform private.recompute_day_hours(new.employee_id, new.work_date);
  if tg_op = 'UPDATE' and (old.employee_id, old.work_date) is distinct from (new.employee_id, new.work_date) then
    perform private.recompute_day_hours(old.employee_id, old.work_date);
  end if;
  return new;
end $function$;

create or replace trigger trg_detect_overtime after insert or update of check_in_at, check_out_at, work_date, employee_id on attendance
  for each row execute function private.detect_overtime();

-- Fix 5: debounce. No new phone check-in within 5 min of the last check-out; no phone check-out within 2 min of the check-in
-- (the kiosk already had the 2-minute check-out rule).
CREATE OR REPLACE FUNCTION public.check_in(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_method text DEFAULT 'biometric'::text)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare emp employees; home branches; hit uuid; rec attendance; inside boolean; at_branch uuid; title text; msg text; hit_name text;
        loc_today date := (now() at time zone 'Asia/Kuwait')::date; hhmm text := to_char(now() at time zone 'Asia/Kuwait', 'HH24:MI');
begin
  select * into emp from employees where user_id = auth.uid() and active;
  if emp.id is null then raise exception 'not an active employee'; end if;
  if emp.punch_mode in ('device','kiosk') then raise exception 'punch mode %', emp.punch_mode; end if;
  if p_lat is null or p_lng is null then raise exception 'location required'; end if;
  select * into rec from attendance where employee_id = emp.id and check_out_at is null and check_in_at > now() - interval '16 hours'
    order by check_in_at desc limit 1;
  if rec.id is not null then raise exception 'already checked in'; end if;
  if exists (select 1 from attendance where employee_id = emp.id and check_out_at > now() - interval '5 minutes') then
    raise exception 'just checked out';
  end if;

  select * into home from branches where id = emp.branch_id;
  hit := private.branch_at(p_lat, p_lng, emp.branch_id);
  select name into hit_name from branches where id = hit;
  if hit is not null then
    inside := true; at_branch := hit;
    if hit is distinct from emp.branch_id and emp.location_mode <> 'flex' then
      title := 'بصمة في فرع ثاني';
      msg := emp.full_name || ' بصم حضور من جواله في فرع ' || hit_name || ' (فرعه ' || coalesce(home.name, '—') || ') الساعة ' || hhmm;
    end if;
  else
    at_branch := emp.branch_id;
    if home.latitude is not null or emp.location_mode = 'flex' then
      inside := false; title := 'بصمة برا الفرع';
      msg := emp.full_name || case when emp.location_mode = 'flex' then ' (مرن) بصم حضور من جواله وهو برا كل الفروع'
                                   else ' بصم حضور من جواله وهو برا الفرع (' || coalesce(home.name, '—') || ')' end || ' الساعة ' || hhmm;
    end if;
  end if;

  insert into attendance(employee_id, branch_id, work_date, check_in_at, check_in_lat, check_in_lng, inside_geofence, method, note)
  values (emp.id, at_branch, loc_today, now(), p_lat, p_lng, inside, p_method,
          case when hit is not null and hit is distinct from emp.branch_id then 'فرع ' || hit_name end)
  returning * into rec;

  if msg is not null then perform private.punch_alert(emp, title, msg); end if;
  return rec;
end $function$;

CREATE OR REPLACE FUNCTION public.check_out(p_lat double precision, p_lng double precision)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare emp employees; home branches; rec attendance; hit uuid; inside boolean; hit_name text; msg text; title text;
        hhmm text := to_char(now() at time zone 'Asia/Kuwait', 'HH24:MI');
begin
  select * into emp from employees where user_id = auth.uid() and active;
  if emp.id is null then raise exception 'not an active employee'; end if;
  if emp.punch_mode in ('device','kiosk') then raise exception 'punch mode %', emp.punch_mode; end if;
  if p_lat is null or p_lng is null then raise exception 'location required'; end if;
  select * into rec from attendance a where a.employee_id = emp.id and a.check_out_at is null and a.check_in_at > now() - interval '16 hours'
    order by a.check_in_at desc limit 1;
  if rec.id is null then raise exception 'no open check-in'; end if;
  if rec.check_in_at > now() - interval '2 minutes' then raise exception 'just checked in'; end if;

  select * into home from branches where id = emp.branch_id;
  hit := private.branch_at(p_lat, p_lng, rec.branch_id);
  select name into hit_name from branches where id = hit;
  inside := hit is not null;
  if hit is null then
    title := 'انصراف برا الفرع';
    msg := emp.full_name || case when emp.location_mode = 'flex' then ' (مرن) بصم انصراف وهو برا كل الفروع'
                                 else ' بصم انصراف من جواله وهو برا الفرع (' || coalesce(home.name, '—') || ')' end || ' الساعة ' || hhmm;
  elsif emp.location_mode <> 'flex' and hit is distinct from rec.branch_id and hit is distinct from emp.branch_id then
    title := 'انصراف من فرع ثاني';
    msg := emp.full_name || ' بصم انصراف من فرع ' || hit_name || ' الساعة ' || hhmm;
  end if;

  update attendance set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng, check_out_branch_id = hit, check_out_inside = inside
  where id = rec.id returning * into rec;
  if msg is not null then perform private.punch_alert(emp, title, msg); end if;
  return rec;
end $function$;

CREATE OR REPLACE FUNCTION public.kiosk_punch(p_token text, p_phone text, p_code text, p_action text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare r json; emp employees; sh shifts; a attendance; br uuid; bname text; home text; other_branch boolean := false; other_shift boolean := false; diff numeric;
begin
  r := private.kiosk_check(p_token, p_phone, p_code);
  if not (r->>'ok')::boolean then return r; end if;
  select * into emp from employees where id = (r->>'employee_id')::uuid;
  br := (r->>'branch_id')::uuid;
  select name into bname from branches where id = br;
  select name into home from branches where id = emp.branch_id;
  select * into a from attendance where employee_id = emp.id and check_out_at is null
    and check_in_at > now() - interval '16 hours' order by check_in_at desc limit 1;
  if p_action = 'in' then
    if a.id is not null then return json_build_object('ok', false, 'error', 'already_in'); end if;
    if exists (select 1 from attendance where employee_id = emp.id and check_out_at > now() - interval '5 minutes') then
      return json_build_object('ok', false, 'error', 'just_out');
    end if;
    insert into attendance(employee_id, branch_id, work_date, check_in_at, inside_geofence, method, note)
    values (emp.id, br, (now() at time zone 'Asia/Kuwait')::date, now(), true, 'kiosk',
            coalesce((select name from kiosk_devices where id = (r->>'kiosk_id')::uuid), 'صفحة البصمة'))
    returning * into a;
    other_branch := emp.branch_id is distinct from br;
    if emp.work_mode = 'shift' then
      select * into sh from shifts where id = emp.shift_id;
      if sh.id is not null then
        diff := abs(extract(epoch from ((now() at time zone 'Asia/Kuwait')::time - sh.start_time)) / 60);
        other_shift := least(diff, 1440 - diff) > 120;
      end if;
    end if;
    if other_branch then
      insert into notifications(audience_perm, title, body, link)
      values ('manage_attendance', 'بصمة في فرع ثاني', emp.full_name || ' بصم حضور في فرع ' || coalesce(bname,'') || ' (فرعه ' || coalesce(home,'—') || ') الساعة ' || to_char(now() at time zone 'Asia/Kuwait', 'HH24:MI'), '/attendance');
    end if;
    return json_build_object('ok', true, 'action', 'in', 'at', a.check_in_at, 'late', a.late_minutes,
      'branch', bname, 'ask_branch', other_branch, 'ask_shift', other_shift);
  elsif p_action = 'out' then
    if a.id is null then return json_build_object('ok', false, 'error', 'not_in'); end if;
    if a.check_in_at > now() - interval '2 minutes' then return json_build_object('ok', false, 'error', 'too_soon'); end if;
    update attendance set check_out_at = now() where id = a.id returning * into a;
    return json_build_object('ok', true, 'action', 'out', 'at', a.check_out_at, 'in', a.check_in_at, 'branch', bname);
  end if;
  return json_build_object('ok', false, 'error', 'bad_action');
end $function$;
