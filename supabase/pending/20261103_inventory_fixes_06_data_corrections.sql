-- NOT APPLIED YET. Data corrections, one correcting movement each (history untouched). Run after 01-05.
-- created_by = Badr (admin). Movements go through the normal trigger so stock_levels update.

-- a) Oats, invoice 2271: line posted 1 bag (25 kg) at 21 KD; movement was +2 @10.5 (pack factor edited after posting).
insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
select l.posted_branch_id, l.posted_item_id, -1, 'manual', 21, 'purchase_invoice', l.invoice_id,
       'تصحيح: فاتورة عدّلت بعد الترحيل (2271: كيس واحد 25 كغ، دخل المخزون 2)', '647fed4b-0b60-4513-85ed-248632e6ffbf'
from purchase_invoice_lines l where l.invoice_id = 'b6cecb25-349b-4906-979e-447a0c3f733a' and l.posted_item_id = 'ea209875-d4d5-4f7b-93d8-f0e329b5a554';
update inv_items set avg_cost = 21 where id = 'ea209875-d4d5-4f7b-93d8-f0e329b5a554';  -- avg 10.5 came from the wrong +2

-- b) Halloumi, invoice "27246, 27248": NEEDS A DECISION (see report). 5 cartons x 48 pcs = 240 pcs is what the supplier line says;
--    stock got +192, the line now says 48 (pack 9.6 = kg, wrong for a piece item). Proposed: +48 pcs to reach 240 @0.354.
-- insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
-- values ((select id from branches where is_central_kitchen limit 1), '56690c25-0744-4043-b84e-97b2bf36e41e', 48, 'manual', 0.3542,
--         'purchase_invoice', '2bdfb903-907c-44f9-942f-21aae4a6b02a', 'تصحيح: فاتورة عدّلت بعد الترحيل (5 كرتون × 48 حبة = 240)', '647fed4b-0b60-4513-85ed-248632e6ffbf');

-- c) Eggs (carton 12 trays x 30 = 360): unit -> كرتون, unit_pieces 360. Photo count 1,775 pieces was stored as 1,775 units.
update inv_items set unit_id = (select id from inv_units where name = 'كرتون'), unit_pieces = 360
 where id = '4144421c-8873-4776-a6ad-3de24206bfad';
insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
values ((select id from branches where is_central_kitchen limit 1), '4144421c-8873-4776-a6ad-3de24206bfad', -(1775 - round(1775/360.0, 3)), 'count_adjust', 16,
        'unit_fix', 'a9fe1856-cdb5-4aac-951b-261aca5f909e',
        'تصحيح: جرد الصورة 1775 بيضة انحفظ 1775 كرتون. 1775 حبة = 4.931 كرتون (360 حبة بالكرتون)', '647fed4b-0b60-4513-85ed-248632e6ffbf');

-- d) Chicken breast IQF (10 kg carton): manual +3,400 on 2026-10-13 (no note/cost) = 3,400 kg = 340 cartons.
insert into stock_movements(branch_id,item_id,qty,kind,unit_cost,ref_type,ref_id,note,created_by)
values ((select id from branches where is_central_kitchen limit 1), '3f9b40fa-5cc9-4844-be2c-b1d5a1800e12', -3060, 'count_adjust', 13.051,
        'unit_fix', 'd7b0c912-1173-44fc-b8d4-f66765099085',
        'تصحيح: تعديل يدوي 3400 بتاريخ 13/10 كان بالكيلو مو بالكرتون. 3400 كغ = 340 كرتون (10 كغ)', '647fed4b-0b60-4513-85ed-248632e6ffbf');
