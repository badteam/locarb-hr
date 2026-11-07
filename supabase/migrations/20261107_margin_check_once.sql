-- Approving / receiving an invoice timed out ("canceling statement due to statement timeout"):
-- every line updates inv_items.last_price, and the per-statement trigger ran check_margins (~2.8 s) once per line.
-- Now the old statement trigger is a no-op and a deferred row trigger runs the check once, at commit.
create or replace function private.after_price_change()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_level = 'STATEMENT' then return null; end if;
  if coalesce(current_setting('app.skip_margin', true), '') = '1' then return null; end if;
  if coalesce(current_setting('app.margin_done', true), '') = '1' then return null; end if;
  perform set_config('app.margin_done', '1', true);
  begin perform private.check_margins(); exception when others then null; end;
  return null;
end $function$;

create constraint trigger t_items_margin_check_once after update of last_price on public.inv_items
  deferrable initially deferred for each row
  when (old.last_price is distinct from new.last_price)
  execute function private.after_price_change();

-- An invoice read twice at the same time got every line twice (INV-0305). One line per number per invoice;
-- checked at the end of each save so renumbering lines in one save still works. The reader skips when another read already wrote.
alter table public.purchase_invoice_lines add constraint purchase_invoice_lines_one_per_no unique (invoice_id, line_no) deferrable initially deferred;
