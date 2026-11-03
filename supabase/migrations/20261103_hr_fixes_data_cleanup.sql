-- One-off data steps run on 2026-11-03 with execute_sql after each was counted (kept here for the record; do not re-run blindly).
-- 1) short hours from double taps (pending only, source row under 10 minutes): 106 rows deleted
delete from short_hours sh using attendance a
 where a.id = sh.attendance_id and sh.status = 'pending' and a.check_out_at is not null and a.check_out_at - a.check_in_at < interval '10 minutes';
-- 2) re-evaluate every employee-day with the per-day rule (approved / rejected OT untouched by the function's where clause)
do $$ declare r record; begin
  for r in select distinct employee_id, work_date from attendance loop perform private.recompute_day_hours(r.employee_id, r.work_date); end loop;
end $$;
-- 3) missed punches before first punch / hire date or for never-punched employees, unresolved and with no correction request: 1636 deleted
with f as (select employee_id, min(work_date) fd from attendance group by 1)
delete from missed_punches mp using employees e
 where e.id = mp.employee_id and not mp.resolved
  and ((select fd from f where f.employee_id = mp.employee_id) is null
       or mp.work_date < (select fd from f where f.employee_id = mp.employee_id)
       or (e.hire_date is not null and mp.work_date < e.hire_date))
  and not exists (select 1 from punch_corrections pc where pc.employee_id = mp.employee_id and pc.work_date = mp.work_date);
-- 4) October 2026 payslips regenerated as drafts for all active employees (same loop as public.generate_payslips)
do $$ declare e record; begin
  for e in select id from employees where active loop perform private.compute_payslip(e.id, date '2026-10-01', true); end loop;
end $$;
