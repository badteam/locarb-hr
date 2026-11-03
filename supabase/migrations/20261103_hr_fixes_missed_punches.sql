-- HR fix 4: missed-punch detection skips days before the employee's first-ever punch and before hire_date,
-- and employees who never punched at all (they are not on the system yet).
-- Cleanup (run once, counted first: 1636 rows = 832 never-punched + 804 before first punch): unresolved rows with no
-- punch-correction request for that day were deleted. Applied as migration hr_fixes_missed_punches.
CREATE OR REPLACE FUNCTION private.detect_missed_punches(p_date date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d date := coalesce(p_date, (now() at time zone 'Asia/Kuwait')::date);
        dow text := lower(trim(to_char(d, 'FMDay'))); r record; n int := 0;
begin
  for r in
    select e.id, e.full_name,
      case when exists (select 1 from attendance a where a.employee_id = e.id and a.work_date = d and a.check_out_at is null) then 'no_checkout' else 'no_punch' end as kind
    from employees e
    where e.active and not (dow = any(e.weekly_holidays))
      and (e.hire_date is null or d >= e.hire_date)
      and d >= (select min(a.work_date) from attendance a where a.employee_id = e.id)   -- null (never punched) -> skipped
      and not exists (select 1 from leave_requests lr where lr.employee_id = e.id and lr.status = 'approved' and d between lr.start_date and lr.end_date)
      and (not exists (select 1 from attendance a where a.employee_id = e.id and a.work_date = d)
           or exists (select 1 from attendance a where a.employee_id = e.id and a.work_date = d and a.check_out_at is null))
  loop
    insert into missed_punches(employee_id, work_date, kind) values (r.id, d, r.kind) on conflict do nothing;
    if found then
      insert into notifications(employee_id, title, body, link, kind, params) values
        (r.id, case when r.kind = 'no_punch' then 'نسيت تبصم اليوم؟' else 'نسيت تبصم انصراف؟' end,
         'ما فيه ' || case when r.kind = 'no_punch' then 'بصمة حضور' else 'بصمة انصراف' end || ' بتاريخ ' || to_char(d,'DD/MM/YYYY') || '. أرسل طلب نسيان بصمة.',
         '/corrections', 'missed_' || r.kind, jsonb_build_object('date', to_char(d,'DD/MM/YYYY')));
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    insert into notifications(for_hr, title, body, link)
    values (true, 'بصمات ناقصة', n || ' موظف ما كملوا بصمتهم بتاريخ ' || to_char(d,'DD/MM/YYYY'), '/corrections');
  end if;
  return n;
end $function$;

-- one-off cleanup (executed separately after counting)
-- with f as (select employee_id, min(work_date) fd from attendance group by 1)
-- delete from missed_punches mp using employees e
-- where e.id = mp.employee_id and not mp.resolved
--   and (not exists (select 1 from attendance a where a.employee_id = mp.employee_id)
--        or mp.work_date < (select fd from f where f.employee_id = mp.employee_id)
--        or (e.hire_date is not null and mp.work_date < e.hire_date))
--   and not exists (select 1 from punch_corrections pc where pc.employee_id = mp.employee_id and pc.work_date = mp.work_date);
