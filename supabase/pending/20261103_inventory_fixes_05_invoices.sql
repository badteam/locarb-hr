-- 8 + 9. Invoices: duplicate check at create/edit/review time, supplier required to receive, total gap needs a reason.
alter table public.purchase_invoices add column if not exists duplicate_of uuid references public.purchase_invoices(id) on delete set null;
alter table public.purchase_invoices add column if not exists gap_reason text;

-- the copy is the later one: an invoice is a duplicate when another non-rejected invoice with the same supplier and number
-- was approved, received, or entered before it. The first one stays approvable.
create or replace function private.invoice_duplicate(p_invoice uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select o.invoice_no || ' (' || coalesce(to_char(o.invoice_date,'YYYY-MM-DD'),'') || ')'
  from purchase_invoices i join purchase_invoices o
    on o.id <> i.id and o.supplier_id = i.supplier_id
   and lower(trim(o.invoice_no)) = lower(trim(i.invoice_no))
   and o.status not in ('rejected')
   and (o.status = 'approved' or o.received_at is not null or o.created_at < i.created_at
        or (o.created_at = i.created_at and o.id < i.id))
  where i.id = p_invoice and i.supplier_id is not null and coalesce(trim(i.invoice_no),'') <> ''
  order by o.created_at
  limit 1
$function$;

-- finds the earlier invoice this one copies (reads across RLS)
create or replace function private.invoice_dup_of(p_id uuid, p_supplier uuid, p_no text, p_created timestamptz)
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select o.id from purchase_invoices o
   where p_supplier is not null and coalesce(trim(p_no),'') <> ''
     and o.id <> p_id and o.supplier_id = p_supplier
     and lower(trim(o.invoice_no)) = lower(trim(p_no)) and o.status <> 'rejected'
     and (o.status = 'approved' or o.received_at is not null or o.created_at < p_created
          or (o.created_at = p_created and o.id < p_id))
   order by o.created_at limit 1
$function$;

-- not security definer on purpose: current_user tells a person's direct edit (authenticated) from a system function
create or replace function private.invoice_dup_check()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_o uuid; v_txt text;
begin
  if new.status = 'rejected' then new.duplicate_of := null; return new; end if;
  v_o := private.invoice_dup_of(new.id, new.supplier_id, new.invoice_no, new.created_at);
  new.duplicate_of := v_o;
  -- a person entering a supplier + number that already exists is stopped right away
  -- (the invoice reader finishing a read is not stopped; that invoice is marked and cannot be received or approved)
  if v_o is not null and current_user in ('anon','authenticated')
     and (tg_op = 'INSERT' or (old.status <> 'reading'
          and (new.invoice_no is distinct from old.invoice_no or new.supplier_id is distinct from old.supplier_id))) then
    v_txt := private.invoice_duplicate_text(v_o);
    raise exception 'duplicate invoice %', v_txt;
  end if;
  return new;
end $function$;

create or replace function private.invoice_duplicate_text(p_id uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select invoice_no || ' (' || coalesce(to_char(invoice_date,'YYYY-MM-DD'),'') || ')' from purchase_invoices where id = p_id
$function$;

drop trigger if exists t_invoice_dup_check on public.purchase_invoices;
create trigger t_invoice_dup_check before insert or update of supplier_id, invoice_no, status on public.purchase_invoices
  for each row execute function private.invoice_dup_check();

-- mark the existing ones (the later copy gets duplicate_of)
update public.purchase_invoices i set duplicate_of = (
  select o.id from purchase_invoices o
   where o.id <> i.id and o.supplier_id = i.supplier_id and lower(trim(o.invoice_no)) = lower(trim(i.invoice_no)) and o.status <> 'rejected'
     and (o.status = 'approved' or o.received_at is not null or o.created_at < i.created_at or (o.created_at = i.created_at and o.id < i.id))
   order by o.created_at limit 1)
where i.supplier_id is not null and coalesce(trim(i.invoice_no),'') <> '' and i.status not in ('rejected','approved');

create or replace function public.receive_purchase_invoice(p_invoice uuid, p_note text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare inv purchase_invoices; l record; v_sup text; v_dup text; v_posted int := 0; v_pending int := 0; v_issues int := 0;
begin
  if not (private.has_perm('receive_goods') or private.has_perm('approve_purchases')) then raise exception 'not allowed to receive goods'; end if;
  select * into inv from purchase_invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.status not in ('review','draft','failed') then raise exception 'invoice is not open'; end if;
  if inv.received_at is not null then raise exception 'already received'; end if;
  if inv.supplier_id is null then raise exception 'invoice needs a supplier'; end if;
  if inv.branch_id is null then raise exception 'choose where the goods were received'; end if;
  if not exists (select 1 from purchase_invoice_lines where invoice_id = p_invoice) then raise exception 'invoice has no lines'; end if;
  v_dup := private.invoice_duplicate(p_invoice);
  if v_dup is not null then raise exception 'duplicate invoice %', v_dup; end if;

  update purchase_invoice_lines set received_qty = coalesce(received_qty, qty),
     charge_price = case when issue = 'free' then 0 else coalesce(charge_price, unit_price) end
   where invoice_id = p_invoice;

  v_sup := coalesce((select name from suppliers where id = inv.supplier_id), inv.supplier_name_read, '');
  for l in select id, item_id, issue from purchase_invoice_lines where invoice_id = p_invoice order by line_no loop
    if l.item_id is null then v_pending := v_pending + 1;
    else perform private.post_invoice_line(l.id, inv.branch_id, 'استلام فاتورة ' || coalesce(inv.invoice_no,'') || ' - ' || v_sup);
         v_posted := v_posted + 1; end if;
    if l.issue <> 'none' then v_issues := v_issues + 1; end if;
  end loop;

  update purchase_invoices set status = 'review', received_at = now(), received_by = private.current_employee_id(),
     receive_note = p_note, total_due = private.invoice_total_due(p_invoice) where id = p_invoice;

  perform private.notify_perm('approve_purchases', 'فاتورة تنتظر المراجعة - ' || v_sup,
     'تم استلام البضاعة' || case when v_issues > 0 then ' (فيها ' || v_issues || ' ملاحظة: مرتجع/مجاني/خصم/نقص)' else '' end,
     '/inventory/invoices/' || p_invoice);
  return json_build_object('posted', v_posted, 'pending', v_pending, 'issues', v_issues);
end $function$;

create or replace function public.review_purchase_invoice(p_invoice uuid, p_note text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare inv purchase_invoices; l record; v_me uuid := private.current_employee_id(); v_sup text; v_dup text;
        v_prev numeric; v_cur numeric; v_rises text[] := '{}'; v_credit int; v_due numeric; v_lines int := 0; v_snap jsonb;
begin
  if not private.has_perm('approve_purchases') then raise exception 'not allowed to approve invoices'; end if;
  select * into inv from purchase_invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.status not in ('review','draft','failed') then raise exception 'invoice is not open'; end if;
  if inv.supplier_id is null then raise exception 'invoice needs a supplier'; end if;
  if inv.branch_id is null then raise exception 'choose where the goods were received'; end if;
  if not exists (select 1 from purchase_invoice_lines where invoice_id = p_invoice) then raise exception 'invoice has no lines'; end if;
  if exists (select 1 from purchase_invoice_lines where invoice_id = p_invoice and (item_id is null or coalesce(qty,0) <= 0)) then
    raise exception 'every line needs an item and a quantity';
  end if;
  v_dup := private.invoice_duplicate(p_invoice);
  if v_dup is not null then raise exception 'duplicate invoice %', v_dup; end if;

  select name, credit_days into v_sup, v_credit from suppliers where id = inv.supplier_id;
  update purchase_invoice_lines set received_qty = coalesce(received_qty, qty),
     charge_price = case when issue = 'free' then 0 else coalesce(charge_price, unit_price) end
   where invoice_id = p_invoice;

  -- the amount we will owe must match the total printed on the invoice (within 1 KD), or the reviewer writes why
  v_due := private.invoice_total_due(p_invoice);
  if inv.total_read is not null and abs(v_due - inv.total_read) > 1 and coalesce(btrim(p_note), '') = '' then
    raise exception 'المستحق المحسوب % د.ك يختلف عن إجمالي الفاتورة المكتوب % د.ك بفرق % د.ك. صحّح الأسطر، أو اكتب سبب الفرق في الملاحظة قبل الاعتماد',
      round(v_due, 3), round(inv.total_read, 3), round(abs(v_due - inv.total_read), 3);
  end if;

  select jsonb_object_agg(x.item_id::text, x.prev) into v_snap from (
    select distinct pl.item_id, coalesce((select last_price / nullif(pack_factor,0) from supplier_items si where si.supplier_id = inv.supplier_id and si.item_id = pl.item_id),
                       (select last_price from inv_items where id = pl.item_id)) prev
    from purchase_invoice_lines pl where pl.invoice_id = p_invoice) x;
  for l in select * from purchase_invoice_lines where invoice_id = p_invoice order by line_no loop
    perform private.post_invoice_line(l.id, inv.branch_id, 'فاتورة ' || coalesce(inv.invoice_no,'') || ' - ' || v_sup);

    -- price learning uses the supplier's listed price per stock unit
    v_cur := l.unit_price / l.pack_factor;
    v_prev := (v_snap ->> l.item_id::text)::numeric;
    if coalesce(l.unit_price,0) > 0 then
      update inv_items set last_price = round(v_cur,4) where id = l.item_id;
      insert into supplier_items(supplier_id,item_id,last_price,last_date,pack_factor,pack_unit)
      values (inv.supplier_id, l.item_id, l.unit_price, coalesce(inv.invoice_date, current_date), l.pack_factor, l.unit_text)
      on conflict (supplier_id,item_id) do update set last_price = excluded.last_price, last_date = excluded.last_date,
         pack_factor = excluded.pack_factor, pack_unit = coalesce(excluded.pack_unit, supplier_items.pack_unit);
    end if;
    if coalesce(l.raw_name,'') <> '' then
      insert into item_aliases(supplier_id, alias, item_id) values (inv.supplier_id, trim(l.raw_name), l.item_id)
      on conflict (coalesce(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(alias)) do update set item_id = excluded.item_id;
    end if;
    update purchase_invoice_lines set prev_price = round(v_prev * l.pack_factor, 4),
       line_total = coalesce(line_total, round(l.qty * l.unit_price,3)) where id = l.id;
    if v_prev is not null and v_prev > 0 and v_cur > v_prev * 1.05 then
      v_rises := v_rises || ((select name_ar from inv_items where id = l.item_id) || ' +' || round((v_cur / v_prev - 1) * 100) || '%');
    end if;
    v_lines := v_lines + 1;
  end loop;

  v_due := private.invoice_total_due(p_invoice);
  update purchase_invoices set status = 'approved', approved_by = v_me, approved_at = now(), review_note = p_note,
     gap_reason = case when inv.total_read is not null and abs(v_due - inv.total_read) > 1 then btrim(p_note) end,
     received_at = coalesce(received_at, now()), received_by = coalesce(received_by, v_me),
     total_due = v_due, due_date = coalesce(invoice_date, current_date) + coalesce(v_credit,0)
   where id = p_invoice;
  perform private.refresh_payment_status(p_invoice);

  if array_length(v_rises,1) > 0 then
    perform private.notify_perm('approve_purchases', 'زيادة أسعار عند ' || v_sup,
      array_to_string(v_rises, '، '), '/inventory/invoices/' || p_invoice);
  end if;
  return json_build_object('lines', v_lines, 'total', v_due, 'price_rises', v_rises);
end $function$;

-- 11. no anonymous execution
revoke execute on function public.review_purchase_invoice(uuid, text) from public, anon;
revoke execute on function public.receive_purchase_invoice(uuid, text) from public, anon;
revoke execute on function public.check_invoice_duplicate(uuid) from public, anon;
revoke execute on function public.post_order_import(uuid, date, text, text, text, jsonb, boolean) from public, anon;
revoke execute on function public.set_item_prices(jsonb, text) from public, anon;
revoke execute on function public.supplier_directory() from public, anon;
revoke execute on function public.supplier_profile(uuid, date, date) from public, anon;
revoke execute on function public.supplier_statement(uuid) from public, anon;
grant execute on function public.review_purchase_invoice(uuid, text), public.receive_purchase_invoice(uuid, text),
  public.check_invoice_duplicate(uuid), public.post_order_import(uuid, date, text, text, text, jsonb, boolean),
  public.set_item_prices(jsonb, text), public.supplier_directory(), public.supplier_profile(uuid, date, date),
  public.supplier_statement(uuid) to authenticated, service_role;
