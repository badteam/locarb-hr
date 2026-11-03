-- HR fix 6: nobody approves/decides their own leave, punch correction or overtime (and nobody adds manual OT for
-- themselves) unless they are the owner (app_role 'admin'). The guard is inserted right after each function's existing
-- permission check; everything else in the functions is unchanged. Applied as migration hr_fixes_no_self_approval.
do $mig$
declare f record; def text; anchor text;
  guard constant text := E'\n  if emp.id = private.current_employee_id() and not private.is_owner() then raise exception ''ما تقدر توافق على طلبك بنفسك''; end if;';
begin
  for f in select * from (values
      ('public.decide_leave(uuid,boolean,text)', 'approve_leaves'),
      ('public.decide_punch_correction(uuid,boolean,text)', 'manage_attendance'),
      ('public.decide_overtime(uuid,boolean,integer,text)', 'approve_overtime'),
      ('public.add_overtime(uuid,date,integer,boolean,text)', 'approve_overtime')) v(sig, perm)
  loop
    def := pg_get_functiondef(f.sig::regprocedure);
    if position('طلبك بنفسك' in def) > 0 then continue; end if;   -- already patched
    anchor := 'if not private.perm_on_branch(''' || f.perm || ''', emp.branch_id) then raise exception ''not allowed''; end if;';
    if position(anchor in def) = 0 then raise exception 'anchor not found in %', f.sig; end if;
    execute replace(def, anchor, anchor || guard);
  end loop;
end $mig$;
