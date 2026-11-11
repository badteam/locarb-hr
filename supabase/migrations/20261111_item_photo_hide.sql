-- Remove a photo from an item's gallery (with undo). The file itself is kept: stock-take photos are evidence
-- and the same photo can belong to a count batch. Hidden photos simply stop showing for that item.
create table if not exists public.inv_item_hidden_photos (
  item_id uuid not null references public.inv_items(id) on delete cascade,
  path text not null,
  hidden_by uuid,
  hidden_at timestamptz not null default now(),
  primary key (item_id, path)
);
alter table public.inv_item_hidden_photos enable row level security;
create policy "staff read hidden photos" on public.inv_item_hidden_photos for select to authenticated using (private.current_employee_id() is not null);

-- hide (p_hide = true) or bring back (false). Hiding the main photo moves "main" to the next photo.
create or replace function public.item_photo_hide(p_item uuid, p_path text, p_hide boolean default true)
returns json language plpgsql security definer set search_path = public, private as $$
declare v_main text; v_next text;
begin
  if not private.has_perm('manage_inventory') then raise exception 'not allowed'; end if;
  if p_hide then
    insert into inv_item_hidden_photos(item_id, path, hidden_by) values (p_item, p_path, private.current_employee_id())
    on conflict do nothing;
    select image_path into v_main from inv_items where id = p_item;
    if v_main = p_path then
      v_next := (public.item_photo_paths(p_item))[1];
      update inv_items set image_path = v_next where id = p_item;
    end if;
  else
    delete from inv_item_hidden_photos where item_id = p_item and path = p_path;
  end if;
  return json_build_object('main', (select image_path from inv_items where id = p_item));
end $$;
revoke all on function public.item_photo_hide(uuid, text, boolean) from public, anon;
grant execute on function public.item_photo_hide(uuid, text, boolean) to authenticated;

create or replace function public.item_photo_paths(p_item uuid)
returns text[] language sql stable security definer set search_path = public, storage, private
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
    select p, min(ord) as ord, max(ts) as ts from src
     where p is not null and p <> ''
       and not exists (select 1 from inv_item_hidden_photos h where h.item_id = p_item and h.path = src.p)
     group by p
  )
  select case when private.current_employee_id() is null then array[]::text[]
              else coalesce(array_agg(p order by ord, ts desc), array[]::text[]) end
    from dedup;
$$;

create or replace function public.item_photo_counts()
returns table(item_id uuid, n int) language sql stable security definer set search_path = public, storage, private
as $$
  with src as (
    select i.id as item_id, i.image_path as p from inv_items i where i.image_path is not null
    union select i.id, i.nutrition_label_path from inv_items i where i.nutrition_label_path is not null
    union select pi.item_id, x.p from photo_items pi, unnest(pi.photo_paths) x(p) where pi.item_id is not null
    union select (split_part(o.name,'/',2))::uuid, o.name from storage.objects o
      where o.bucket_id = 'product-photos' and o.name ~ '^labels/[0-9a-f-]{36}/'
  )
  select s.item_id, count(distinct s.p)::int from src s
   where private.current_employee_id() is not null and s.p is not null and s.p <> ''
     and not exists (select 1 from inv_item_hidden_photos h where h.item_id = s.item_id and h.path = s.p)
   group by s.item_id;
$$;
