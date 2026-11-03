-- 2 + 10. finish_stock_count: large-count guard (needs confirmed_large per line) and expected-as-of-start.
alter table public.stock_count_lines add column if not exists confirmed_large boolean not null default false;
alter table public.stock_counts add column if not exists started_at timestamptz;

drop function if exists public.finish_stock_count(uuid, jsonb, text, text);
create or replace function public.finish_stock_count(p_branch uuid, p_lines jsonb, p_scope text default 'all', p_note text default null,
                                                     p_started_at timestamptz default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_me uuid := private.current_employee_id(); l jsonb; v_exp numeric; v_cnt numeric; v_cost numeric; v_since numeric;
        v_short numeric := 0; v_over numeric := 0; n int := 0; nd int := 0; v_bname text; v_conf boolean; v_item uuid;
        v_start timestamptz; v_big text[] := '{}';
begin
  if not private.can_count(p_branch) then raise exception 'not allowed to count this branch'; end if;
  -- the moment the count began (from the app). Ignored if in the future or older than 36 hours.
  v_start := case when p_started_at is not null and p_started_at <= now() and p_started_at > now() - interval '36 hours' then p_started_at end;
  insert into stock_counts(branch_id, scope, note, created_by, started_at)
  values (p_branch, coalesce(p_scope,'all'), nullif(trim(p_note),''), v_me, v_start) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'counted') is null then continue; end if;
    v_item := (l->>'item_id')::uuid;
    v_cnt := greatest((l->>'counted')::numeric, 0);
    v_conf := coalesce(nullif(l->>'confirmed_large','')::boolean, false);
    select qty into v_exp from stock_levels where branch_id = p_branch and item_id = v_item;
    v_exp := coalesce(v_exp, 0);
    -- expected as of the start of the count: take out what moved since (goods received, transfers) so they are not wiped
    if v_start is not null then
      select coalesce(sum(qty), 0) into v_since from stock_movements
       where branch_id = p_branch and item_id = v_item and created_at >= v_start;
      v_exp := v_exp - v_since;
    end if;
    select avg_cost into v_cost from inv_items where id = v_item;
    -- sanity: a count far above the book needs an explicit confirmation on that line
    if not v_conf and v_cnt > v_exp and (
         (v_cnt > 5 * v_exp and (v_cnt - v_exp) * coalesce(v_cost, 0) > 50)
         or (v_cnt >= 100 and v_exp <= 5)) then
      v_big := v_big || (coalesce((select name_ar from inv_items where id = v_item), v_item::text)
                         || ' (' || round(v_cnt, 3) || ' بدل ' || round(v_exp, 3) || ')');
      continue;
    end if;
    insert into stock_count_lines(count_id, item_id, expected, counted, unit_cost, confirmed_large) values (v_id, v_item, v_exp, v_cnt, v_cost, v_conf)
    on conflict (count_id, item_id) do nothing;
    if not found then continue; end if;
    n := n + 1;
    if v_cnt <> v_exp then
      nd := nd + 1;
      insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
      values (p_branch, v_item, v_cnt - v_exp, 'count_adjust', v_cost, 'stock_count', v_id, 'جرد', v_me);
      if v_cnt < v_exp then v_short := v_short + (v_exp - v_cnt) * coalesce(v_cost,0);
      else v_over := v_over + (v_cnt - v_exp) * coalesce(v_cost,0); end if;
    end if;
  end loop;
  if array_length(v_big, 1) > 0 then
    raise exception 'الكمية المعدودة أكبر بكثير من الرصيد في هذي الأصناف: %. تأكد من الوحدة (حبة / كرتون / كيلو) وأكّد كل صنف قبل الحفظ',
      array_to_string(v_big, '، ');
  end if;
  if n = 0 then raise exception 'count has no lines'; end if;
  update stock_counts set lines_count = n, short_value = round(v_short,3), over_value = round(v_over,3) where id = v_id;
  if v_short > 5 then
    select name into v_bname from branches where id = p_branch;
    perform private.notify_perm('view_reports', 'نقص في جرد ' || v_bname, nd || ' صنف فيه فرق، قيمة النقص ' || round(v_short,3) || ' د.ك', '/inventory/reports');
  end if;
  return json_build_object('id', v_id, 'lines', n, 'differences', nd, 'short_value', round(v_short,3), 'over_value', round(v_over,3));
end $function$;
revoke all on function public.finish_stock_count(uuid, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.finish_stock_count(uuid, jsonb, text, text, timestamptz) to authenticated, service_role;

-- 3. count lines worth a second look (last 30 days). Rows only for manage_inventory.
create or replace view public.count_review with (security_invoker = true) as
select l.count_id, c.created_at, c.branch_id, b.name as branch, l.item_id, i.name_ar as item, u.name as unit,
       l.expected, l.counted, coalesce(l.unit_cost, i.avg_cost) as unit_cost,
       round((l.counted - l.expected) * coalesce(l.unit_cost, i.avg_cost, 0), 3) as value_impact,
       case when l.counted in (200, 300, 500, 1000) then 'round' else 'far_above' end as reason
from stock_count_lines l
join stock_counts c on c.id = l.count_id
join branches b on b.id = c.branch_id
join inv_items i on i.id = l.item_id
left join inv_units u on u.id = i.unit_id
where c.created_at >= now() - interval '30 days'
  and (l.counted in (200, 300, 500, 1000)
       or (l.counted > 5 * l.expected and (l.counted - l.expected) * coalesce(l.unit_cost, i.avg_cost, 0) > 50))
  and private.has_perm('manage_inventory');
revoke all on public.count_review from anon, public;
grant select on public.count_review to authenticated, service_role;
