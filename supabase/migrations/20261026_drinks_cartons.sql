-- Applied live 2026-10-26.
-- Soft drinks are stocked by the carton (30 cans): unit_pieces = 30; "هيلثي كولا زيرو سكر" moved from piece to carton.
-- Branch stock of soft drinks had been counted in cans: one count_adjust movement per branch (ref_type 'unit_fix') divides it by 30
-- (kitchen untouched; Mahboula's Kinza Diet stays, it was recounted in cartons). Backup: private.bak_20261026_drinks_levels.
-- private.photo_item_to_stock(): a photo-count line with count_unit = 'piece' on a carton/pack item (unit_pieces > 1)
-- is divided by unit_pieces before it becomes the stock figure.

-- Branches see and count chosen items in pieces while stock, kitchen and orders stay in cartons:
alter table public.inv_items add column if not exists branch_by_piece boolean not null default false;
-- set true for the 9 soft drinks and the 2 waters; public.inv_stock re-created with branch_by_piece at the end (security_invoker = true kept)
