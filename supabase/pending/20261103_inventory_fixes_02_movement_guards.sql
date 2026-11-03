-- 5 + 6. Guards on stock movements written directly by app users (anon/authenticated).
-- Security-definer functions (counts, invoices, transfers, reset) run as the owner and are not affected.
create or replace function private.has_movements(p_branch uuid, p_item uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from stock_movements where branch_id = p_branch and item_id = p_item)
$$;

create or replace function private.guard_client_movement()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_val numeric;
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if new.kind in ('manual','opening','count_adjust') then
    if coalesce(btrim(new.note), '') = '' then
      raise exception 'اكتب ملاحظة تشرح سبب التعديل اليدوي';
    end if;
    v_val := private.mv_value(new);
    if v_val > 1000 and not private.is_owner() then
      raise exception 'قيمة التعديل % د.ك أكبر من ١٠٠٠ د.ك. هذا التعديل يحتاج المالك (admin)', round(v_val, 3);
    end if;
  end if;
  if new.kind = 'opening' and private.has_movements(new.branch_id, new.item_id) then
    raise exception 'رصيد أول المدة ينحط بس لصنف ما له أي حركة في هذا المكان. الصنف هذا له حركات من قبل، استخدم الجرد بدال رصيد أول المدة';
  end if;
  return new;
end $$;

drop trigger if exists t_guard_client_movement on public.stock_movements;
create trigger t_guard_client_movement before insert on public.stock_movements
  for each row execute function private.guard_client_movement();

-- 6. set_opening_balance: only for item/place pairs with no previous movements (price-only lines and unchanged qty still allowed)
create or replace function public.set_opening_balance(p_branch uuid, p_lines jsonb)
 returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '120s'
as $function$
declare l jsonb; v_item uuid; v_qty numeric; v_price numeric; v_cur numeric; n int := 0; v_total numeric := 0; v_me uuid := private.current_employee_id();
        v_bad text[] := '{}';
begin
  if not private.has_perm('manage_inventory') then raise exception 'not allowed to set opening balance'; end if;
  if not exists (select 1 from branches where id = p_branch) then raise exception 'unknown place'; end if;
  perform set_config('app.skip_margin', '1', true);
  for l in select * from jsonb_array_elements(p_lines) loop
    v_item := (l->>'item_id')::uuid;
    v_qty := case when l->>'qty' ~ '^(\d+\.?\d*|\.\d+)$' then (l->>'qty')::numeric end;
    v_price := case when l->>'price' ~ '^(\d+\.?\d*|\.\d+)$' then (l->>'price')::numeric end;
    if v_item is null or (v_qty is null and v_price is null) then continue; end if;
    if v_price is not null and v_price >= 0 then
      update inv_items set avg_cost = v_price, last_price = v_price where id = v_item;
    end if;
    if v_qty is not null and v_qty >= 0 then
      select qty into v_cur from stock_levels where branch_id = p_branch and item_id = v_item;
      v_cur := coalesce(v_cur, 0);
      if v_qty <> v_cur then
        if private.has_movements(p_branch, v_item) then
          v_bad := v_bad || coalesce((select name_ar from inv_items where id = v_item), v_item::text);
          continue;
        end if;
        insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,note,created_by)
        values (p_branch, v_item, v_qty - v_cur, 'opening', coalesce(v_price, (select avg_cost from inv_items where id = v_item)), 'opening_balance', 'رصيد أول المدة', v_me);
      end if;
      v_total := v_total + v_qty * coalesce(v_price, (select avg_cost from inv_items where id = v_item), 0);
    end if;
    n := n + 1;
  end loop;
  if array_length(v_bad, 1) > 0 then
    raise exception 'رصيد أول المدة ينحط مرة وحدة بس لصنف ما له حركات. هذي الأصناف لها حركات من قبل (%): %. لتعديل الكميات استخدم الجرد',
      array_length(v_bad, 1), array_to_string(v_bad[1:15], '، ') || case when array_length(v_bad, 1) > 15 then ' …' else '' end;
  end if;
  perform set_config('app.skip_margin', '', true);
  begin perform private.check_margins(); exception when others then null; end;
  return json_build_object('lines', n, 'value', round(v_total, 3));
end $function$;
