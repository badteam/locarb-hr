-- All photos of an inventory item, for the gallery in the item sheet:
-- main photo, nutrition label, every photo from the photo stock-take (all batches),
-- and label/product photos uploaded from the item sheet (labels/<item id>/...).
-- SECURITY DEFINER so people who can see the item also see its stock-take photos
-- (photo_items itself stays limited to reviewers and the batch creator).
create or replace function public.item_photo_paths(p_item uuid)
returns text[]
language sql
stable
security definer
set search_path = public, storage, private
as $$
  with src as (
    select i.image_path as p, 0 as ord, now() as ts from inv_items i where i.id = p_item and i.image_path is not null
    union all
    select i.nutrition_label_path, 1, now() from inv_items i where i.id = p_item and i.nutrition_label_path is not null
    union all
    select u.p, 2, o.created_at
      from storage.objects o, lateral (select o.name as p) u
     where o.bucket_id = 'product-photos' and o.name like 'labels/' || p_item::text || '/%'
    union all
    select x.p, 3, pi.created_at
      from photo_items pi, unnest(pi.photo_paths) with ordinality as x(p, n)
     where pi.item_id = p_item
  ), dedup as (
    select p, min(ord) as ord, max(ts) as ts from src where p is not null and p <> '' group by p
  )
  select case when private.current_employee_id() is null then array[]::text[]
              else coalesce(array_agg(p order by ord, ts desc), array[]::text[]) end
    from dedup;
$$;

revoke all on function public.item_photo_paths(uuid) from public, anon;
grant execute on function public.item_photo_paths(uuid) to authenticated;

-- photo count per item (badge on the thumbnail in the inventory list)
create or replace function public.item_photo_counts()
returns table(item_id uuid, n int)
language sql stable security definer
set search_path = public, storage, private
as $$
  with src as (
    select i.id as item_id, i.image_path as p from inv_items i where i.image_path is not null
    union select i.id, i.nutrition_label_path from inv_items i where i.nutrition_label_path is not null
    union select pi.item_id, x.p from photo_items pi, unnest(pi.photo_paths) x(p) where pi.item_id is not null
    union select (split_part(o.name,'/',2))::uuid, o.name from storage.objects o
      where o.bucket_id = 'product-photos' and o.name ~ '^labels/[0-9a-f-]{36}/'
  )
  select item_id, count(distinct p)::int from src
   where private.current_employee_id() is not null and p is not null and p <> ''
   group by item_id;
$$;
revoke all on function public.item_photo_counts() from public, anon;
grant execute on function public.item_photo_counts() to authenticated;
