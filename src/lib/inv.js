import { supabase } from './supabase'

export const kwd = (n) => (n == null || n === '' ? '—' : Number(n).toFixed(3))
export const qtyFmt = (n) => {
  if (n == null) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export const MOVE_KIND = {
  purchase: ['ok', 'فاتورة مورد'],
  transfer_out: ['amber', 'صرف لفرع'],
  transfer_in: ['ok', 'استلام من المطبخ'],
  waste: ['red', 'تالف'],
  count_adjust: ['gray', 'تعديل جرد'],
  opening: ['gray', 'رصيد افتتاحي'],
  manual: ['gray', 'تعديل يدوي'],
}

export const INVOICE_STATUS = {
  draft: ['gray', 'مسودة'],
  reading: ['amber', 'جاري القراءة'],
  review: ['amber', 'تنتظر الموافقة'],
  approved: ['ok', 'معتمدة'],
  rejected: ['red', 'مرفوضة'],
  failed: ['red', 'ما انقرت'],
}

export const pctChange = (now, prev) => (prev && Number(prev) > 0 ? ((Number(now) - Number(prev)) / Number(prev)) * 100 : null)

let lookupsCache = null
export async function loadLookups(force = false) {
  if (lookupsCache && !force) return lookupsCache
  const [c, u, b, s] = await Promise.all([
    supabase.from('inv_categories').select('id,name,sort_order').order('sort_order').order('name'),
    supabase.from('inv_units').select('id,name').order('name'),
    supabase.from('branches').select('id,name,is_central_kitchen,active').order('is_central_kitchen', { ascending: false }).order('name'),
    supabase.from('suppliers').select('id,name,phone,active').order('name'),
  ])
  lookupsCache = { categories: c.data || [], units: u.data || [], branches: (b.data || []).filter((x) => x.active !== false), suppliers: s.data || [] }
  lookupsCache.kitchen = lookupsCache.branches.find((x) => x.is_central_kitchen) || lookupsCache.branches[0]
  return lookupsCache
}
export const clearLookups = () => { lookupsCache = null }

export const invErr = (e) => {
  const m = e?.message || String(e)
  if (m.includes('every line needs')) return 'كل سطر لازم يكون مربوط بصنف وفيه كمية'
  if (m.includes('needs a supplier')) return 'اختار المورد أول'
  if (m.includes('not allowed to approve')) return 'ما عندك صلاحية الموافقة على الفواتير'
  if (m.includes('is not open')) return 'الفاتورة هذي انقفلت من قبل'
  if (m.includes('no lines')) return 'الفاتورة ما فيها أصناف'
  if (m.includes('row-level security')) return 'ما عندك صلاحية لهذا الإجراء'
  if (m.includes('duplicate key')) return 'موجود من قبل'
  return m
}
