-- HR fix 3 (UI): expose overtime_entries.needs_review through overtime_view (appended column; view stays security_invoker).
-- Applied as migration hr_fixes_overtime_view.
create or replace view public.overtime_view with (security_invoker = true) as
 SELECT o.id, o.employee_id, o.work_date, o.attendance_id, o.minutes, o.approved_minutes, o.is_offday, o.source, o.status, o.note,
    o.decided_by, o.decided_at, o.created_at, e.full_name, e.branch_id,
    private.overtime_amount(o.employee_id, COALESCE(o.approved_minutes, o.minutes), o.is_offday) AS amount,
    o.needs_review
   FROM overtime_entries o JOIN employees e ON e.id = o.employee_id;
