-- HR fix 8: short-hours decisions (confirmed / corrected) record who decided and when, server-side,
-- whatever the client sends. Applied as migration hr_fixes_short_hours_decided_by.
CREATE OR REPLACE FUNCTION private.short_hours_decided()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from old.status then
    if new.status in ('confirmed','corrected') then
      new.decided_by := private.current_employee_id();
      new.decided_at := now();
    elsif new.status = 'pending' then
      new.decided_by := null; new.decided_at := null;
    end if;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $function$;

create or replace trigger trg_short_hours_decided before update on short_hours
  for each row execute function private.short_hours_decided();
