import { supabase } from './supabase'
import { registerNames } from './i18n.jsx'

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
  review: ['amber', 'تنتظر المراجعة'],
  approved: ['ok', 'تمت المراجعة'],
  rejected: ['red', 'مرفوضة'],
  failed: ['red', 'ما انقرت'],
}

// where an invoice is in the receive -> review -> pay flow
export const invoiceStage = (v) => {
  if (v.status === 'approved') return 'approved'
  if (v.status === 'rejected') return 'rejected'
  if (v.status === 'reading') return 'reading'
  return v.received_at ? 'review' : 'receive'
}
export const STAGE = {
  receive: ['amber', 'تنتظر الاستلام'],
  reading: ['amber', 'جاري القراءة'],
  review: ['blue', 'تنتظر مراجعة المحاسب'],
  approved: ['ok', 'تمت المراجعة'],
  rejected: ['red', 'مرفوضة'],
}
export const PAY_STATUS = { unpaid: ['red', 'غير مدفوعة'], partial: ['amber', 'مدفوعة جزئياً'], paid: ['ok', 'مدفوعة'] }
export const PAY_METHOD = { cash: 'كاش', transfer: 'تحويل بنكي', cheque: 'شيك', knet: 'كي نت', other: 'أخرى' }
export const ISSUES = {
  none: ['تمام', ''],
  short: ['ناقص', 'وصل أقل من المكتوب، وندفع بس على اللي وصل'],
  return: ['مرتجع', 'رجعناه للمورد. اكتب كم خلّيت عندك (غالباً صفر)'],
  free: ['مجاني', 'فيه مشكلة بس المورد قال خلّوه. يدخل المخزون بتكلفة صفر'],
  discount: ['خصم', 'فيه مشكلة والمورد نزّل السعر. اكتب السعر الجديد'],
}
// what we owe for one line, and the qty that goes to stock
export const lineRecv = (l) => (l.received_qty === '' || l.received_qty == null ? Number(l.qty) || 0 : Number(l.received_qty) || 0)
export const lineCharge = (l) => (l.issue === 'free' ? 0 : l.charge_price === '' || l.charge_price == null ? Number(l.unit_price) || 0 : Number(l.charge_price) || 0)
export const linePayable = (l) => lineRecv(l) * lineCharge(l)

export const ORDER_STATUS = {
  submitted: ['amber', 'تنتظر المطبخ'],
  dispatched: ['ok', 'في الطريق'],
  received: ['gray', 'انستلمت'],
  rejected: ['red', 'مرفوضة'],
  cancelled: ['gray', 'ملغية'],
}

export const pctChange = (now, prev) => (prev && Number(prev) > 0 ? ((Number(now) - Number(prev)) / Number(prev)) * 100 : null)

let lookupsCache = null
export async function loadLookups(force = false) {
  if (lookupsCache && !force) return lookupsCache
  const [c, u, b, s] = await Promise.all([
    supabase.from('inv_categories').select('id,name,name_en,sort_order').order('sort_order').order('name'),
    supabase.from('inv_units').select('id,name,name_en').order('name'),
    supabase.from('branches').select('*').order('is_central_kitchen', { ascending: false }).order('name'),
    supabase.from('suppliers').select('id,name,phone,active').order('name'),
  ])
  lookupsCache = { categories: c.data || [], units: u.data || [], branches: (b.data || []).filter((x) => x.active !== false), suppliers: s.data || [] }
  registerNames([...lookupsCache.categories, ...lookupsCache.units, ...lookupsCache.branches])
  lookupsCache.kitchen = lookupsCache.branches.find((x) => x.is_central_kitchen) || lookupsCache.branches[0]
  // places that actually keep stock (the main office does not)
  lookupsCache.stockBranches = lookupsCache.branches.filter((x) => x.holds_stock !== false)
  return lookupsCache
}
export const clearLookups = () => { lookupsCache = null }

export const invErr = (e) => {
  const m = e?.message || String(e)
  if (m.includes('not allowed to approve branch')) return 'ما عندك صلاحية الموافقة على طلبات الفروع'
  if (m.includes('request is not open')) return 'الطلب هذا انقفل من قبل'
  if (m.includes('every line needs')) return 'كل سطر لازم يكون مربوط بصنف وفيه كمية'
  if (m.includes('needs a supplier')) return 'اختار المورد أول'
  if (m.includes('not allowed to approve')) return 'ما عندك صلاحية الموافقة على الفواتير'
  if (m.includes('is not open')) return 'الفاتورة هذي انقفلت من قبل'
  if (m.includes('no lines')) return 'الفاتورة ما فيها أصناف'
  if (m.includes('row-level security')) return 'ما عندك صلاحية لهذا الإجراء'
  if (m.includes('order has no quantities')) return 'اكتب كمية لصنف واحد على الأقل'
  if (m.includes('cannot order from itself')) return 'المطبخ المركزي ما يطلب من نفسه. اختار الفرع'
  if (m.includes('not allowed to order')) return 'ما عندك صلاحية تطلب لهالفرع'
  if (m.includes('nothing to send')) return 'كل الكميات صفر. لو ما فيه شي ينرسل، ارفض الطلب'
  if (m.includes('not on the way')) return 'الطلب ما انرسل للحين'
  if (m.includes('duplicate invoice')) return 'الفاتورة هذي مدخلة من قبل لنفس المورد بنفس الرقم: ' + (m.split('duplicate invoice')[1] || '').trim()
  if (m.includes('already received')) return 'البضاعة هذي انستلمت من قبل'
  if (m.includes('not allowed to receive')) return 'ما عندك صلاحية استلام البضاعة'
  if (m.includes('choose where the goods')) return 'اختار وين استلمت البضاعة'
  if (m.includes('received invoice cannot be deleted')) return 'الفاتورة انستلمت ودخلت المخزون، ما تنمسح. ارفضها بدال الحذف عشان تطلع كمياتها'
  if (m.includes('line already in stock')) return 'السطر هذا دخل المخزون. خلّ الكمية المستلمة صفر بدال ما تمسحه'
  if (m.includes('duplicate key')) return 'موجود من قبل'
  return m
}

// item name in the reader's language: Arabic readers see Arabic first, everyone else English first
export const itemNames = (i, lang) => {
  const ar = i?.name_ar || i?.inv_items?.name_ar || ''
  const en = i?.name_en || i?.inv_items?.name_en || ''
  return lang === 'ar' || !en ? [ar, en] : [en, ar]
}
