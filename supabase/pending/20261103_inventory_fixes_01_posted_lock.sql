-- 1. posted_* columns on invoice lines can only be written by the posting functions (security definer, run as owner).
--    Direct client writes (roles anon / authenticated through the API) to posted_qty/posted_cost/posted_item_id/posted_branch_id
--    are rejected. The security-definer functions (post_invoice_line, reject/receive/review) run as the owner, so they pass.
--    (No session-flag bypass on purpose: a client could set a flag itself.)
create or replace function private.guard_posted_cols()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('anon','authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.posted_qty,0) <> 0 or new.posted_cost is not null or new.posted_item_id is not null or new.posted_branch_id is not null then
      raise exception 'posted columns are set by the system only';
    end if;
  elsif new.posted_qty is distinct from old.posted_qty or new.posted_cost is distinct from old.posted_cost
     or new.posted_item_id is distinct from old.posted_item_id or new.posted_branch_id is distinct from old.posted_branch_id then
    raise exception 'posted columns are set by the system only';
  end if;
  return new;
end $$;

drop trigger if exists t_guard_posted_cols on public.purchase_invoice_lines;
create trigger t_guard_posted_cols before insert or update on public.purchase_invoice_lines
  for each row execute function private.guard_posted_cols();
