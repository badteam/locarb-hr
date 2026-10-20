-- Branch orders entered later from Excel sheets (orders taken from the kitchen while the stock count was running).
-- Each sheet becomes a normal, already-received branch request dated on the order day; the kitchen loses the
-- quantities and the branch gains them, except where the item was counted after that day (the count already holds it).

create table if not exists public.order_aliases (
  alias text not null,                 -- normalized name as written in the sheet
  unit text not null default '',       -- normalized unit as written in the sheet ('' when none)
  item_id uuid not null references public.inv_items(id),
  factor numeric not null default 1,   -- 1 sheet unit = factor x item stock unit
  updated_by uuid references public.employees(id),
  updated_at timestamptz not null default now(),
  primary key (alias, unit)
);
alter table public.order_aliases enable row level security;
drop policy if exists "read order aliases" on public.order_aliases;
create policy "read order aliases" on public.order_aliases for select using (private.inv_reader());
drop policy if exists "manage order aliases" on public.order_aliases;
create policy "manage order aliases" on public.order_aliases for delete using (private.has_perm('manage_inventory') or private.has_perm('approve_branch_requests'));

create table if not exists public.order_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  file_hash text,
  sheet_name text,
  branch_id uuid not null references public.branches(id),
  order_date date not null,
  request_id uuid references public.branch_requests(id),
  lines_count int not null default 0,
  kitchen_lines int not null default 0,
  branch_lines int not null default 0,
  value numeric not null default 0,
  status text not null default 'posted' check (status in ('posted', 'undone')),
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  undone_by uuid references public.employees(id),
  undone_at timestamptz
);
create index if not exists order_imports_hash on public.order_imports(file_hash, sheet_name) where status = 'posted';
alter table public.order_imports enable row level security;
drop policy if exists "read order imports" on public.order_imports;
create policy "read order imports" on public.order_imports for select using (private.inv_reader());

-- When each item was last counted in a place (photo count, count screen, count with an order, opening, reset).
create or replace function public.last_counted(p_branch uuid, p_items uuid[])
returns table(item_id uuid, counted_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select x.item_id, max(x.t) from (
    select pi.item_id, pi.created_at t from photo_items pi join photo_batches pb on pb.id = pi.batch_id
      where pb.branch_id = p_branch and pi.status = 'approved' and pi.item_id = any(p_items)
    union all
    select l.item_id, c.created_at from stock_count_lines l join stock_counts c on c.id = l.count_id
      where c.branch_id = p_branch and l.item_id = any(p_items)
    union all
    select l.item_id, r.created_at from branch_request_lines l join branch_requests r on r.id = l.request_id
      where r.branch_id = p_branch and l.on_hand is not null and l.item_id = any(p_items)
    union all
    select m.item_id, m.created_at from stock_movements m
      where m.branch_id = p_branch and m.item_id = any(p_items)
        and (m.kind in ('count_adjust', 'opening') or (m.kind = 'manual' and m.ref_type = 'stock_reset'))
  ) x where private.inv_reader() group by x.item_id
$$;
grant execute on function public.last_counted(uuid, uuid[]) to authenticated;

-- p_lines: [{ item_id, qty (stock unit), kitchen: bool, branch: bool, note, alias, unit, factor }]
create or replace function public.post_order_import(p_branch uuid, p_date date, p_file_name text, p_file_hash text,
  p_sheet text, p_lines jsonb, p_force boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := private.current_employee_id(); v_k uuid; v_req uuid; v_imp uuid; l jsonb; v_qty numeric; v_cost numeric;
        v_ts timestamptz := (p_date + time '12:00') at time zone 'Asia/Kuwait';
        n int := 0; nk int := 0; nb int := 0; v_val numeric := 0; v_bname text;
begin
  if not (private.has_perm('manage_inventory') or private.has_perm('approve_branch_requests')) then raise exception 'not allowed to import orders'; end if;
  select id into v_k from branches where is_central_kitchen limit 1;
  if p_branch = v_k then raise exception 'the central kitchen cannot order from itself'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kuwait')::date then raise exception 'order date is in the future'; end if;
  if not coalesce(p_force, false) and exists (select 1 from order_imports where status = 'posted' and file_hash = p_file_hash and sheet_name = p_sheet) then
    raise exception 'sheet already imported';
  end if;
  select name into v_bname from branches where id = p_branch;

  insert into branch_requests(branch_id, source_branch_id, status, note, created_by, created_at, dispatched_by, dispatched_at, received_by, received_at)
  values (p_branch, v_k, 'received', 'من ملف إكسل: ' || coalesce(p_file_name, '') || ' / ' || coalesce(p_sheet, ''), v_me, v_ts, v_me, v_ts, v_me, v_ts)
  returning id into v_req;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := nullif(l->>'qty', '')::numeric;
    if coalesce(v_qty, 0) <= 0 or nullif(l->>'item_id', '') is null then continue; end if;
    select avg_cost into v_cost from inv_items where id = (l->>'item_id')::uuid;
    insert into branch_request_lines(request_id, item_id, requested_qty, sent_qty, received_qty, unit_cost, note)
    values (v_req, (l->>'item_id')::uuid, v_qty, v_qty, v_qty, v_cost, nullif(trim(l->>'note'), ''));
    n := n + 1; v_val := v_val + v_qty * coalesce(v_cost, 0);
    if coalesce((l->>'kitchen')::boolean, true) then
      insert into stock_movements(branch_id, item_id, qty, kind, unit_cost, ref_type, ref_id, note, created_by, created_at)
      values (v_k, (l->>'item_id')::uuid, -v_qty, 'transfer_out', v_cost, 'branch_request', v_req, 'صرف لفرع ' || v_bname || ' (من إكسل)', v_me, v_ts);
      nk := nk + 1;
    end if;
    if coalesce((l->>'branch')::boolean, true) then
      insert into stock_movements(branch_id, item_id, qty, kind, unit_cost, ref_type, ref_id, note, created_by, created_at)
      values (p_branch, (l->>'item_id')::uuid, v_qty, 'transfer_in', v_cost, 'branch_request', v_req, 'استلام من المطبخ المركزي (من إكسل)', v_me, v_ts);
      nb := nb + 1;
    end if;
    if nullif(trim(l->>'alias'), '') is not null then
      insert into order_aliases(alias, unit, item_id, factor, content_qty, content_unit, updated_by, updated_at)
      values (trim(l->>'alias'), coalesce(trim(l->>'unit'), ''), (l->>'item_id')::uuid, coalesce(nullif(l->>'factor', '')::numeric, 1),
              nullif(l->>'content_qty', '')::numeric, nullif(l->>'content_unit', ''), v_me, now())
      on conflict (alias, unit) do update set item_id = excluded.item_id, factor = excluded.factor, content_qty = excluded.content_qty,
        content_unit = excluded.content_unit, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;
  if n = 0 then raise exception 'order has no quantities'; end if;

  insert into order_imports(file_name, file_hash, sheet_name, branch_id, order_date, request_id, lines_count, kitchen_lines, branch_lines, value, created_by)
  values (p_file_name, p_file_hash, p_sheet, p_branch, p_date, v_req, n, nk, nb, round(v_val, 3), v_me) returning id into v_imp;
  return json_build_object('id', v_imp, 'request_id', v_req, 'lines', n, 'kitchen', nk, 'branch', nb, 'value', round(v_val, 3));
end $$;
grant execute on function public.post_order_import(uuid, date, text, text, text, jsonb, boolean) to authenticated;

-- Take an imported sheet back out: every movement is reversed on the same day and the request is cancelled.
create or replace function public.undo_order_import(p_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := private.current_employee_id(); r order_imports; m record; n int := 0;
begin
  if not (private.has_perm('manage_inventory') or private.has_perm('approve_branch_requests')) then raise exception 'not allowed to import orders'; end if;
  select * into r from order_imports where id = p_id for update;
  if r.id is null then raise exception 'not found'; end if;
  if r.status <> 'posted' then raise exception 'already undone'; end if;
  for m in select * from stock_movements where ref_type = 'branch_request' and ref_id = r.request_id loop
    insert into stock_movements(branch_id, item_id, qty, kind, unit_cost, ref_type, ref_id, note, created_by, created_at)
    values (m.branch_id, m.item_id, -m.qty, m.kind, m.unit_cost, 'order_import_undo', r.request_id, 'تراجع عن استيراد الإكسل', v_me, m.created_at);
    n := n + 1;
  end loop;
  update branch_requests set status = 'cancelled', decision_note = 'تراجع عن استيراد الإكسل' where id = r.request_id;
  update order_imports set status = 'undone', undone_by = v_me, undone_at = now() where id = p_id;
  return json_build_object('movements', n);
end $$;
grant execute on function public.undo_order_import(uuid) to authenticated;

-- saving links as they are made (page can close before the sheet is posted)
alter table public.order_aliases alter column factor drop not null, alter column factor drop default;
alter table public.order_aliases add column if not exists content_qty numeric, add column if not exists content_unit text;
create or replace function public.save_order_alias(p_alias text, p_unit text, p_item uuid, p_factor numeric, p_content_qty numeric default null, p_content_unit text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not (private.has_perm('manage_inventory') or private.has_perm('approve_branch_requests')) then raise exception 'not allowed to import orders'; end if;
  if nullif(trim(p_alias), '') is null or p_item is null then return; end if;
  insert into order_aliases(alias, unit, item_id, factor, content_qty, content_unit, updated_by, updated_at)
  values (trim(p_alias), coalesce(trim(p_unit), ''), p_item, p_factor, p_content_qty, nullif(p_content_unit, ''), private.current_employee_id(), now())
  on conflict (alias, unit) do update set item_id = excluded.item_id, factor = excluded.factor, content_qty = excluded.content_qty,
    content_unit = excluded.content_unit, updated_by = excluded.updated_by, updated_at = now();
end $$;
grant execute on function public.save_order_alias(text, text, uuid, numeric, numeric, text) to authenticated;
