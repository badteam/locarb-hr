-- HR fix 1: absence in private.compute_payslip.
--  * counting starts at greatest(month start, hire_date, the employee's first-ever attendance date);
--    expected days = working_days_per_month x (counted calendar days / days in month)
--  * an employee with no attendance at all gets 0 absence and payslips.no_attendance = true (flag, no deduction)
--  * attendance rows shorter than 30 minutes (double taps) do not count as worked days (open rows still count)
--  * leave days are clipped to the month (pro rata by calendar overlap) instead of counting the full request in both months
-- Everything else (late, OT, allowances, adjustments, approved-slip lock) unchanged. Applied as migration hr_fixes_compute_payslip.

alter table payslips add column if not exists no_attendance boolean not null default false;

CREATE OR REPLACE FUNCTION private.compute_payslip(p_emp uuid, p_month date, p_create boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  s payroll_settings; e employees; m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  last_day date; basic numeric; daily numeric; per_min numeric; late int; worked int; unpaid numeric; paid_leave numeric;
  expected int; absent int; allow jsonb; extras jsonb; ot numeric; ot_min int;
  first_punch date; cnt_start date; leave_in_window numeric; no_att boolean;
begin
  select * into e from employees where id = p_emp;
  if e.id is null or not e.active then return; end if;
  if exists (select 1 from payslips where employee_id = e.id and period = m_start and status = 'approved') then return; end if;
  if not p_create and not exists (select 1 from payslips where employee_id = e.id and period = m_start) then return; end if;
  select * into s from payroll_settings where id = 1;
  last_day := least(m_end, (now() at time zone 'Asia/Kuwait')::date);
  select coalesce((select basic_salary from employee_salaries where employee_id = e.id), 0) into basic;
  daily := basic / nullif(s.working_days_per_month, 0);
  per_min := daily / nullif(private.daily_hours(e, s) * 60, 0);

  select min(work_date) into first_punch from attendance where employee_id = e.id;
  no_att := first_punch is null;
  cnt_start := greatest(m_start, coalesce(e.hire_date, m_start), coalesce(first_punch, m_start));

  select coalesce(sum(late_minutes),0) into late
    from attendance where employee_id = e.id and work_date between m_start and last_day;
  select count(distinct work_date) into worked
    from attendance where employee_id = e.id and work_date between cnt_start and last_day
      and (check_out_at is null or check_out_at - check_in_at >= interval '30 minutes');

  -- leave days inside the month (pro rata by calendar overlap; a request spanning two months is split)
  select coalesce(sum(case when not lt.paid then x.d else 0 end),0), coalesce(sum(case when lt.paid then x.d else 0 end),0),
         coalesce(sum(x.dw),0)
    into unpaid, paid_leave, leave_in_window
    from leave_requests lr join leave_types lt on lt.id = lr.leave_type_id
    cross join lateral (select
        lr.days * (least(lr.end_date, last_day) - greatest(lr.start_date, m_start) + 1)::numeric / nullif(lr.end_date - lr.start_date + 1, 0) as d,
        lr.days * greatest(0, least(lr.end_date, last_day) - greatest(lr.start_date, cnt_start) + 1)::numeric / nullif(lr.end_date - lr.start_date + 1, 0) as dw) x
    where lr.employee_id = e.id and lr.status = 'approved' and lr.start_date <= last_day and lr.end_date >= m_start;
  unpaid := round(unpaid, 2); paid_leave := round(paid_leave, 2);

  if no_att or cnt_start > last_day then
    expected := 0;
  else
    expected := round(s.working_days_per_month * ((last_day - cnt_start + 1)::numeric / (m_end - m_start + 1)));
  end if;
  absent := greatest(0, expected - worked - ceil(leave_in_window)::int);

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount)), '[]') into allow
    from employee_allowances where employee_id = e.id and active;
  select coalesce(jsonb_agg(jsonb_build_object('name', case kind when 'bonus' then 'مكافأة' else 'خصم' end || coalesce(': ' || reason, ''),
                                               'amount', case kind when 'deduction' then -amount else amount end)), '[]')
    into extras from salary_adjustments where employee_id = e.id and period = m_start and kind in ('bonus','deduction');
  select coalesce(sum(private.overtime_amount(e.id, approved_minutes, is_offday)),0), coalesce(sum(approved_minutes),0)
    into ot, ot_min from overtime_entries where employee_id = e.id and status = 'approved' and work_date between m_start and m_end;
  insert into payslips(employee_id, period, basic_salary, allowances, overtime_total, overtime_minutes, late_minutes, late_deduction, absence_days, absence_deduction, unpaid_leave_days, unpaid_leave_deduction, extra_items, no_attendance)
  values (e.id, m_start, basic, allow, ot, ot_min, late,
          case when s.late_deduction_enabled then round(coalesce(late * per_min,0), 3) else 0 end,
          absent,
          case when s.absence_deduction_enabled then round(coalesce(absent * daily,0), 3) else 0 end,
          unpaid, round(coalesce(unpaid * daily,0), 3), extras, no_att)
  on conflict (employee_id, period) do update set
    basic_salary = excluded.basic_salary, allowances = excluded.allowances, overtime_total = excluded.overtime_total, overtime_minutes = excluded.overtime_minutes,
    late_minutes = excluded.late_minutes, late_deduction = excluded.late_deduction,
    absence_days = excluded.absence_days, absence_deduction = excluded.absence_deduction,
    unpaid_leave_days = excluded.unpaid_leave_days, unpaid_leave_deduction = excluded.unpaid_leave_deduction,
    extra_items = excluded.extra_items, no_attendance = excluded.no_attendance
  where payslips.status <> 'approved';
end $function$;
