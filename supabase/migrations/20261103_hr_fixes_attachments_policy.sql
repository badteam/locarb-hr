-- HR fix 7: bucket 'attachments' (all files live at u/<uploader employee id>/<file>).
-- Medical reports (files linked from leave_requests / punch_corrections.attachment_path) are readable only by:
--   the employee who owns the folder, HR (manage_employees / admin), and approvers for that employee's branch
--   (approve_leaves for leaves, manage_attendance for punch corrections, branch-scoped through perm_on_branch).
-- Every other file (supplier papers, smart-upload / transaction staging, ID scans) keeps the roles it had,
-- minus approve_leaves / manage_attendance, which were only there for the medical reports.
-- Applied as migration hr_fixes_attachments_policy.
CREATE OR REPLACE FUNCTION private.can_read_attachment(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := private.current_employee_id();
begin
  if me is null then return false; end if;
  if split_part(p_name, '/', 2) = me::text then return true; end if;          -- own folder
  if private.is_hr() then return true; end if;                                 -- manage_employees / admin
  if exists (select 1 from leave_requests where attachment_path = p_name)
     or exists (select 1 from punch_corrections where attachment_path = p_name) then
    return exists (select 1 from leave_requests lr join employees e on e.id = lr.employee_id
                   where lr.attachment_path = p_name and private.perm_on_branch('approve_leaves', e.branch_id))
        or exists (select 1 from punch_corrections pc join employees e on e.id = pc.employee_id
                   where pc.attachment_path = p_name and private.perm_on_branch('manage_attendance', e.branch_id));
  end if;
  return private.has_perm('manage_documents') or private.has_perm('manage_branch_docs') or private.has_perm('manage_suppliers');
end $function$;
revoke all on function private.can_read_attachment(text) from public, anon;
grant execute on function private.can_read_attachment(text) to authenticated;

alter policy "attachments read" on storage.objects
  using (bucket_id = 'attachments' and private.can_read_attachment(name));
