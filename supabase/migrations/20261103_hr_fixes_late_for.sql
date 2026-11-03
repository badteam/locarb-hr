-- HR fix 2: late minutes. A check-in more than 3 hours away from the official/shift start is a wrong-shift
-- or data issue, not lateness (the old 12h wrap gave night staff hours of "late"). One day is capped at 180 min.
-- Applied as migration hr_fixes_late_for.
CREATE OR REPLACE FUNCTION private.late_for(p_emp uuid, p_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e employees; sh shifts; s payroll_settings; t time := (p_at at time zone 'Asia/Kuwait')::time; start_t time; grace int; d int;
begin
  select * into e from employees where id = p_emp;
  if e.work_mode = 'shift' then
    select * into sh from shifts where id = e.shift_id;
    start_t := sh.start_time; grace := sh.grace_minutes;
  elsif e.work_mode = 'official' then
    select * into s from payroll_settings where id = 1;
    start_t := e.official_start; grace := coalesce(s.official_grace_minutes, 10);
  end if;
  if start_t is null then return 0; end if;
  d := floor(extract(epoch from (t - start_t)) / 60)::int;
  d := ((d % 1440) + 1440) % 1440;          -- 0..1439 minutes after the start, around the clock
  if d >= 720 then d := d - 1440; end if;   -- -720..719: negative = came early
  if abs(d) > 180 then return 0; end if;    -- more than 3h away from the start: other shift / bad data, not lateness
  return least(180, greatest(0, d - coalesce(grace, 0)));
end $function$;

-- Re-apply to punches whose late was computed by the trigger (never to manual rows HR typed),
-- only where the new rule gives fewer minutes.
update attendance a set late_minutes = private.late_for(a.employee_id, a.check_in_at)
where a.method in ('app','kiosk','device','correction','biometric') and a.check_in_at is not null
  and private.late_for(a.employee_id, a.check_in_at) < a.late_minutes;
