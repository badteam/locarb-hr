-- Grams typed into kilo boxes (500 for half a kilo, 650 for 650 g).
-- 2026-10-22 .. 11-20: ~300 lines like this went through the stock count, the "on hand" box of the supply request,
-- the kitchen's "sending" box and the branch's "received" box. Only the count screen warned, and only in the app.
-- Now the server refuses such a number unless the line carries confirmed_large = true (the app asks and offers a one-tap fix).
-- Rule (same as src/components/QtyCheck.jsx, which warns on a superset): 50 or more, over 10x the reference
-- (book stock / ordered / sent, at least 1), and worth more than 15 KWD extra at cost.

create or replace function private.qty_suspect(p_qty numeric, p_ref numeric, p_cost numeric)
returns boolean language sql immutable as $$
  select coalesce(p_qty, 0) >= 50
     and p_qty > 10 * greatest(coalesce(p_ref, 0), 1)
     and (p_qty - coalesce(p_ref, 0)) * coalesce(p_cost, 0) > 15
$$;

create or replace function private.qty_suspect_msg(p_item uuid, p_qty numeric, p_ref numeric)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(i.name_ar, p_item::text) || ' (' || trim(to_char(p_qty, 'FM9999990.###')) || ' ' || coalesce(u.name, '')
         || ' والعادي ' || trim(to_char(coalesce(p_ref, 0), 'FM9999990.###')) || ')'
  from inv_items i left join inv_units u on u.id = i.unit_id where i.id = p_item
$$;

alter table public.stock_count_lines add column if not exists confirmed_large boolean not null default false;
alter table public.branch_request_lines add column if not exists confirmed_large boolean not null default false;

-- 1. stock count
create or replace function public.finish_stock_count(p_branch uuid, p_lines jsonb, p_scope text default 'all'::text, p_note text default null::text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_me uuid := private.current_employee_id(); l jsonb; v_exp numeric; v_cnt numeric; v_cost numeric;
        v_short numeric := 0; v_over numeric := 0; n int := 0; nd int := 0; v_bname text; v_conf boolean; v_item uuid; v_big text[] := '{}';
begin
  if not private.can_count(p_branch) then raise exception 'not allowed to count this branch'; end if;
  insert into stock_counts(branch_id, scope, note, created_by) values (p_branch, coalesce(p_scope,'all'), nullif(trim(p_note),''), v_me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'counted') is null then continue; end if;
    v_item := (l->>'item_id')::uuid;
    v_cnt := greatest((l->>'counted')::numeric, 0);
    v_conf := coalesce(nullif(l->>'confirmed_large','')::boolean, false);
    select qty into v_exp from stock_levels where branch_id = p_branch and item_id = v_item;
    v_exp := coalesce(v_exp, 0);
    select avg_cost into v_cost from inv_items where id = v_item;
    if not v_conf and private.qty_suspect(v_cnt, v_exp, v_cost) then
      v_big := v_big || private.qty_suspect_msg(v_item, v_cnt, v_exp); continue;
    end if;
    insert into stock_count_lines(count_id, item_id, expected, counted, unit_cost, confirmed_large) values (v_id, v_item, v_exp, v_cnt, v_cost, v_conf)
    on conflict (count_id, item_id) do nothing;
    if not found then continue; end if;
    n := n + 1;
    if v_cnt <> v_exp then
      nd := nd + 1;
      insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
      values (p_branch, v_item, v_cnt - v_exp, 'count_adjust', v_cost, 'stock_count', v_id, case when v_conf then 'جرد (رقم كبير، اتأكد)' else 'جرد' end, v_me);
      if v_cnt < v_exp then v_short := v_short + (v_exp - v_cnt) * coalesce(v_cost,0);
      else v_over := v_over + (v_cnt - v_exp) * coalesce(v_cost,0); end if;
    end if;
  end loop;
  if array_length(v_big, 1) > 0 then
    raise exception 'الكمية أكبر بكثير من الرصيد: %. غالباً مكتوبة بالجرام بدل الكيلو. صلّحها أو أكّد إنها صحيحة', array_to_string(v_big, '، ');
  end if;
  if n = 0 then raise exception 'count has no lines'; end if;
  update stock_counts set lines_count = n, short_value = round(v_short,3), over_value = round(v_over,3) where id = v_id;
  if v_short > 5 then
    select name into v_bname from branches where id = p_branch;
    perform private.notify_perm('view_reports', 'نقص في جرد ' || v_bname, nd || ' صنف فيه فرق، قيمة النقص ' || round(v_short,3) || ' د.ك', '/inventory/reports');
  end if;
  return json_build_object('id', v_id, 'lines', n, 'differences', nd, 'short_value', round(v_short,3), 'over_value', round(v_over,3));
end $function$;

-- 2. supply request: the "on hand" box becomes a count
create or replace function public.submit_branch_request(p_branch uuid, p_lines jsonb, p_note text default null::text)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_me uuid := private.current_employee_id(); l jsonb; v_cur numeric; v_kitchen uuid; v_bname text; n int := 0;
        v_item uuid; v_on numeric; v_cost numeric; v_conf boolean; v_big text[] := '{}';
begin
  if not private.can_order_for(p_branch) then raise exception 'not allowed to order for this branch'; end if;
  select id into v_kitchen from branches where is_central_kitchen limit 1;
  if p_branch = v_kitchen then raise exception 'the central kitchen cannot order from itself'; end if;
  insert into branch_requests(branch_id, source_branch_id, note, created_by) values (p_branch, v_kitchen, nullif(trim(p_note),''), v_me) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'qty')::numeric,0) <= 0 and (l->>'on_hand') is null then continue; end if;
    v_item := (l->>'item_id')::uuid; v_on := (l->>'on_hand')::numeric;
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
  if array_length(v_big, 1) > 0 then
    raise exception 'الموجود عندكم أكبر بكثير من الرصيد: %. غالباً مكتوب بالجرام بدل الكيلو. صلّحه أو أكّد إنه صحيح', array_to_string(v_big, '، ');
  end if;
  if n = 0 then raise exception 'order has no quantities'; end if;
  select name into v_bname from branches where id = p_branch;
  perform private.notify_perm('approve_branch_requests', 'طلب توريد جديد من ' || v_bname, n || ' صنف', '/inventory/orders/' || v_id);
  delete from branch_order_drafts where branch_id = p_branch; return v_id;
end $function$;

-- 3. central kitchen sends
create or replace function public.dispatch_branch_request(p_id uuid, p_lines jsonb, p_note text default null::text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare r branch_requests; l record; x jsonb; v_sent numeric; v_me uuid := private.current_employee_id(); n int := 0; v_total numeric := 0; v_cost numeric;
        v_conf boolean; v_big text[] := '{}';
begin
  if not private.has_perm('approve_branch_requests') then raise exception 'not allowed to approve branch requests'; end if;
  select * into r from branch_requests where id = p_id for update;
  if r.id is null then raise exception 'not found'; end if;
  if r.status <> 'submitted' then raise exception 'request is not open'; end if;
  for l in select * from branch_request_lines where request_id = p_id loop
    x := null;
    select e into x from jsonb_array_elements(p_lines) e where (e->>'id')::uuid = l.id;
    v_sent := greatest(coalesce((x->>'sent_qty')::numeric, l.requested_qty), 0);
    v_conf := coalesce(nullif(x->>'confirmed_large','')::boolean, false);
    select avg_cost into v_cost from inv_items where id = l.item_id;
    if not v_conf and private.qty_suspect(v_sent, l.requested_qty, v_cost) then
      v_big := v_big || private.qty_suspect_msg(l.item_id, v_sent, l.requested_qty); continue;
    end if;
    update branch_request_lines set sent_qty = v_sent, unit_cost = v_cost where id = l.id;
    if v_sent > 0 then
      insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
      values (r.source_branch_id, l.item_id, -v_sent, 'transfer_out', v_cost, 'branch_request', p_id,
              'صرف لفرع ' || (select name from branches where id = r.branch_id) || case when v_conf then ' (رقم كبير، اتأكد)' else '' end, v_me);
      n := n + 1; v_total := v_total + v_sent * coalesce(v_cost,0);
    end if;
  end loop;
  if array_length(v_big, 1) > 0 then
    raise exception 'المرسل أكبر بكثير من المطلوب: %. غالباً مكتوب بالجرام بدل الكيلو. صلّحه أو أكّد إنه صحيح', array_to_string(v_big, '، ');
  end if;
  if n = 0 then raise exception 'nothing to send'; end if;
  update branch_requests set status = 'dispatched', dispatched_by = v_me, dispatched_at = now(), decision_note = nullif(trim(p_note),'') where id = p_id;
  insert into notifications(employee_id, title, body, link, for_hr)
  select e.id, 'طلب التوريد في الطريق', n || ' صنف. أكد الاستلام لما يوصل.', '/inventory/orders/' || p_id, false
  from employees e left join roles ro on ro.id = e.role_id
  where e.active and e.user_id is not null and e.branch_id = r.branch_id and 'branch_orders' = any(coalesce(ro.permissions,'{}'));
  return json_build_object('lines', n, 'value', round(v_total,3));
end $function$;

-- 4. branch receives
create or replace function public.receive_branch_request(p_id uuid, p_lines jsonb, p_note text default null::text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare r branch_requests; l record; x jsonb; v_got numeric; v_me uuid := private.current_employee_id(); v_short text[] := '{}';
        v_conf boolean; v_big text[] := '{}';
begin
  select * into r from branch_requests where id = p_id for update;
  if r.id is null or not private.can_order_for(r.branch_id) then raise exception 'not allowed'; end if;
  if r.status <> 'dispatched' then raise exception 'request is not on the way'; end if;
  for l in select brl.*, i.name_ar from branch_request_lines brl join inv_items i on i.id = brl.item_id where request_id = p_id loop
    x := null;
    select e into x from jsonb_array_elements(p_lines) e where (e->>'id')::uuid = l.id;
    v_got := greatest(coalesce((x->>'received_qty')::numeric, l.sent_qty, 0), 0);
    v_conf := coalesce(nullif(x->>'confirmed_large','')::boolean, false);
    if not v_conf and private.qty_suspect(v_got, l.sent_qty, l.unit_cost) then
      v_big := v_big || private.qty_suspect_msg(l.item_id, v_got, l.sent_qty); continue;
    end if;
    update branch_request_lines set received_qty = v_got where id = l.id;
    if v_got > 0 then
      insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
      values (r.branch_id, l.item_id, v_got, 'transfer_in', l.unit_cost, 'branch_request', p_id, 'استلام من المطبخ المركزي', v_me);
    end if;
    if v_got <> coalesce(l.sent_qty,0) then
      v_short := v_short || (l.name_ar || ': انرسل ' || trim(to_char(coalesce(l.sent_qty,0),'FM999990.###')) || ' ووصل ' || trim(to_char(v_got,'FM999990.###')));
    end if;
  end loop;
  if array_length(v_big, 1) > 0 then
    raise exception 'الواصل أكبر بكثير من المرسل: %. غالباً مكتوب بالجرام بدل الكيلو. صلّحه أو أكّد إنه صحيح', array_to_string(v_big, '، ');
  end if;
  update branch_requests set status = 'received', received_by = v_me, received_at = now(), receive_note = nullif(trim(p_note),'') where id = p_id;
  if array_length(v_short,1) > 0 then
    perform private.notify_perm('approve_branch_requests', 'فرق في استلام ' || (select name from branches where id = r.branch_id),
      array_to_string(v_short, '، '), '/inventory/orders/' || p_id);
  end if;
  return json_build_object('differences', v_short);
end $function$;
