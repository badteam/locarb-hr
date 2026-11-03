-- 7. Photo count: approvals of the same item at the same stock place on the same Kuwait day add up across batches
--    (before: each batch set the stock to that batch's total, so a second batch replaced the first).
create or replace function private.photo_item_to_stock()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_branch uuid; v_day date; v_total numeric; v_cur numeric;
begin
  if new.status <> 'approved' or new.item_id is null or new.qty is null then return new; end if;
  if old.status = 'approved' and old.item_id is not distinct from new.item_id and old.qty is not distinct from new.qty
     and old.count_unit is not distinct from new.count_unit then return new; end if;
  select private.stock_branch(branch_id), (created_at at time zone 'Asia/Kuwait')::date into v_branch, v_day
    from photo_batches where id = new.batch_id;
  select coalesce(sum(p.qty / case when p.count_unit = 'piece' and u.name <> 'حبة' and coalesce(i.unit_pieces,1) > 1 then i.unit_pieces else 1 end), 0)
    into v_total
    from photo_items p join photo_batches pb on pb.id = p.batch_id
    join inv_items i on i.id = p.item_id left join inv_units u on u.id = i.unit_id
   where p.item_id = new.item_id and p.status = 'approved'
     and private.stock_branch(pb.branch_id) = v_branch
     and (pb.created_at at time zone 'Asia/Kuwait')::date = v_day;
  v_total := round(v_total, 3);
  select coalesce(qty,0) into v_cur from stock_levels where branch_id = v_branch and item_id = new.item_id;
  v_cur := coalesce(v_cur,0);
  if v_total <> v_cur then
    insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
    values (v_branch, new.item_id, v_total - v_cur, 'count_adjust', (select avg_cost from inv_items where id = new.item_id),
            'photo_count', new.batch_id, 'جرد بالصورة', coalesce(new.reviewed_by, private.current_employee_id()));
  end if;
  return new;
end $function$;
