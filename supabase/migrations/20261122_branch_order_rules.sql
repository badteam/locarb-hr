-- Branch supply orders:
-- 1) the branch can change its order until the kitchen sends it; the kitchen is told what changed (old -> new)
-- 2) an item can be paused (branches see it but cannot order it for now)
-- 3) an item can be hidden from branches completely (kitchen-only items)

alter table public.inv_items add column if not exists branch_order text not null default 'open'
  check (branch_order in ('open','paused','hidden'));
alter table public.inv_items add column if not exists branch_order_note text;

create table if not exists public.branch_request_changes (
  id bigserial primary key,
  request_id uuid not null references public.branch_requests(id) on delete cascade,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  changes jsonb not null   -- [{item_id, name, old, new}]  old null = added, new 0 = removed
);
alter table public.branch_request_changes enable row level security;
create policy "read changes of visible requests" on public.branch_request_changes for select to authenticated
  using (exists (select 1 from branch_requests r where r.id = request_id));
create index if not exists branch_request_changes_req on public.branch_request_changes(request_id, changed_at);

-- items the branch may order: not hidden, not paused
create or replace function private.branch_can_order_item(p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select branch_order = 'open' from inv_items where id = p_item), false)
$$;

-- submit: refuse quantities for paused / hidden items (a count of what is on hand is still fine for paused items)
create or replace function public.submit_branch_request(p_branch uuid, p_lines jsonb, p_note text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id uuid; v_me uuid := private.current_employee_id(); l jsonb; v_cur numeric; v_kitchen uuid; v_bname text; n int := 0;
        v_item uuid; v_on numeric; v_cost numeric; v_conf boolean; v_big text[] := '{}'; v_blocked text[] := '{}'; v_mode text;
begin
  if not private.can_order_for(p_branch) then raise exception 'not allowed to order for this branch'; end if;
  select id into v_kitchen from branches where is_central_kitchen limit 1;
  if p_branch = v_kitchen then raise exception 'the central kitchen cannot order from itself'; end if;
  insert into branch_requests(branch_id, source_branch_id, note, created_by) values (p_branch, v_kitchen, nullif(trim(p_note),''), v_me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'qty')::numeric,0) <= 0 and (l->>'on_hand') is null then continue; end if;
    v_item := (l->>'item_id')::uuid; v_on := (l->>'on_hand')::numeric;
    select branch_order into v_mode from inv_items where id = v_item;
    if v_mode = 'hidden' then continue; end if;
    if v_mode = 'paused' and coalesce((l->>'qty')::numeric,0) > 0 then
      v_blocked := v_blocked || (select name_ar from inv_items where id = v_item); continue;
    end if;
    v_conf := coalesce(nullif(l->>'confirmed_large','')::boolean, false);
    select coalesce(qty,0) into v_cur from stock_levels where branch_id = p_branch and item_id = v_item;
    v_cur := coalesce(v_cur, 0);
    select avg_cost into v_cost from inv_items where id = v_item;
    if v_on is not null and not v_conf and private.qty_suspect(v_on, v_cur, v_cost) then
      v_big := v_big || private.qty_suspect_msg(v_item, v_on, v_cur); continue;
    end if;
    insert into branch_request_lines(request_id, item_id, on_hand, requested_qty, note, confirmed_large)
    values (v_id, v_item, v_on, greatest(coalesce((l->>'qty')::numeric,0),0), nullif(l->>'note',''), v_conf);
    if v_on is not null and v_cur <> v_on then
      insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
      values (p_branch, v_item, v_on - v_cur, 'count_adjust', v_cost, 'branch_request', v_id,
              case when v_conf then 'جرد مع طلب التوريد (رقم كبير، اتأكد)' else 'جرد مع طلب التوريد' end, v_me);
    end if;
    if coalesce((l->>'qty')::numeric,0) > 0 then n := n + 1; end if;
  end loop;
  if array_length(v_blocked, 1) > 0 then
    raise exception 'الأصناف دي موقوفة مؤقتاً من المطبخ وما ينفع تنطلب الحين: %. شيلها من الطلب', array_to_string(v_blocked, '، ');
  end if;
  if array_length(v_big, 1) > 0 then
    raise exception 'الموجود عندكم أكبر بكثير من الرصيد: %. غالباً مكتوب بالجرام بدل الكيلو. صلّحه أو أكّد إنه صحيح', array_to_string(v_big, '، ');
  end if;
  if n = 0 then raise exception 'order has no quantities'; end if;
  select name into v_bname from branches where id = p_branch;
  perform private.notify_perm('approve_branch_requests', 'طلب توريد جديد من ' || v_bname, n || ' صنف', '/inventory/orders/' || v_id);
  delete from branch_order_drafts where branch_id = p_branch; return v_id;
end $function$;

-- the branch changes its order before the kitchen sends it. p_lines = the whole new list [{item_id, qty}].
-- Lines left out (or qty 0) are removed. The kitchen gets a notification with every change.
create or replace function public.edit_branch_request(p_id uuid, p_lines jsonb, p_note text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare r branch_requests; v_me uuid := private.current_employee_id(); x jsonb; v_item uuid; v_qty numeric; v_old numeric;
        v_changes jsonb := '[]'::jsonb; v_txt text[] := '{}'; v_name text; v_unit text; v_blocked text[] := '{}'; v_bname text; l record; v_left int;
begin
  select * into r from branch_requests where id = p_id for update;
  if r.id is null or not private.can_order_for(r.branch_id) then raise exception 'not allowed'; end if;
  if r.status <> 'submitted' then raise exception 'المطبخ أرسل الطلب خلاص، ما ينفع يتعدل'; end if;

  -- changed and added items
  for x in select * from jsonb_array_elements(p_lines) loop
    v_item := (x->>'item_id')::uuid; v_qty := greatest(coalesce((x->>'qty')::numeric, 0), 0);
    v_old := null;
    select requested_qty into v_old from branch_request_lines where request_id = p_id and item_id = v_item;
    if v_old is not null and v_old = v_qty then continue; end if;
    select i.name_ar, u.name into v_name, v_unit from inv_items i left join inv_units u on u.id = i.unit_id where i.id = v_item;
    if v_qty > 0 and not private.branch_can_order_item(v_item) and (v_old is null or v_qty > v_old) then
      v_blocked := v_blocked || v_name; continue;
    end if;
    if v_old is null then
      if v_qty = 0 then continue; end if;
      insert into branch_request_lines(request_id, item_id, requested_qty) values (p_id, v_item, v_qty);
      v_txt := v_txt || ('أضاف ' || v_name || ' ' || trim(to_char(v_qty, 'FM999999990.###')) || coalesce(' ' || v_unit, ''));
    elsif v_qty = 0 then
      delete from branch_request_lines where request_id = p_id and item_id = v_item;
      v_txt := v_txt || ('شال ' || v_name || ' (كان ' || trim(to_char(v_old, 'FM999999990.###')) || ')');
    else
      update branch_request_lines set requested_qty = v_qty where request_id = p_id and item_id = v_item;
      v_txt := v_txt || (v_name || ': ' || trim(to_char(v_old, 'FM999999990.###')) || ' ← ' || trim(to_char(v_qty, 'FM999999990.###')) || coalesce(' ' || v_unit, ''));
    end if;
    v_changes := v_changes || jsonb_build_object('item_id', v_item, 'name', v_name, 'unit', v_unit, 'old', v_old, 'new', v_qty);
  end loop;
  -- items left out of the new list are removed
  for l in select bl.item_id, bl.requested_qty, i.name_ar from branch_request_lines bl join inv_items i on i.id = bl.item_id
            where bl.request_id = p_id
              and not exists (select 1 from jsonb_array_elements(p_lines) e where (e->>'item_id')::uuid = bl.item_id) loop
    delete from branch_request_lines where request_id = p_id and item_id = l.item_id;
    v_txt := v_txt || ('شال ' || l.name_ar || ' (كان ' || trim(to_char(l.requested_qty, 'FM999999990.###')) || ')');
    v_changes := v_changes || jsonb_build_object('item_id', l.item_id, 'name', l.name_ar, 'old', l.requested_qty, 'new', 0);
  end loop;

  if array_length(v_blocked, 1) > 0 then
    raise exception 'الأصناف دي موقوفة مؤقتاً من المطبخ وما ينفع تنزاد: %', array_to_string(v_blocked, '، ');
  end if;
  select count(*) into v_left from branch_request_lines where request_id = p_id and requested_qty > 0;
  if v_left = 0 then raise exception 'الطلب صار فاضي. لو ما تبونه الغوه بدال ما تمسحون كل الأصناف'; end if;

  if p_note is not null and coalesce(trim(p_note),'') is distinct from coalesce(r.note,'') then
    update branch_requests set note = nullif(trim(p_note),'') where id = p_id;
    v_txt := v_txt || ('الملاحظة: ' || coalesce(nullif(trim(p_note),''), '(انمسحت)'));
    v_changes := v_changes || jsonb_build_object('note', nullif(trim(p_note),''), 'old_note', r.note);
  end if;
  if jsonb_array_length(v_changes) = 0 then return json_build_object('changes', 0); end if;

  update branch_requests set updated_at = now() where id = p_id;
  insert into branch_request_changes(request_id, changed_by, changes) values (p_id, v_me, v_changes);
  select name into v_bname from branches where id = r.branch_id;
  perform private.notify_perm('approve_branch_requests', 'فرع ' || v_bname || ' عدّل طلب التوريد',
    left(array_to_string(v_txt, '، '), 400), '/inventory/orders/' || p_id);
  return json_build_object('changes', jsonb_array_length(v_changes));
end $$;
revoke all on function public.edit_branch_request(uuid, jsonb, text) from public, anon;
grant execute on function public.edit_branch_request(uuid, jsonb, text) to authenticated;
