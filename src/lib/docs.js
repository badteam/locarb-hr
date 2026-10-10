import { supabase } from './supabase'

// AI reading of an uploaded document (same Anthropic key as invoices). Never throws.
export async function readDocument(kind, id) {
  const { data, error } = await supabase.functions.invoke('read-document', { body: { kind, id } })
  if (error) return { ok: false, error: 'network' }
  return data || { ok: false }
}

export const AI_MSG = {
  not_configured: 'القراءة التلقائية مو مفعّلة لين الحين. المالك يحط المفتاح من صفحة الإعدادات. دخّل البيانات يدوي.',
  no_key: 'القراءة التلقائية مو مفعّلة لين الحين. المالك يحط المفتاح من صفحة الإعدادات. دخّل البيانات يدوي.',
  invalid_key: 'مفتاح القراءة غلط. المالك يغيّره من الإعدادات. دخّل البيانات يدوي.',
  no_credit: 'رصيد حساب القراءة خلص. اشحن الرصيد ثم اضغط "اقرا من جديد".',
  unreadable: 'ما قدر يقرا المستند (الصورة مو واضحة؟). صوّره من جديد أو دخّل البيانات يدوي.',
  no_file: 'ما فيه صورة أو ملف للمستند.',
  network: 'صار خطأ في الاتصال. اضغط "اقرا من جديد".',
}
export const aiMessage = (code) => (code ? AI_MSG[code] || 'ما قدر يقرا المستند. دخّل البيانات يدوي أو اضغط "اقرا من جديد".' : null)

export const FIELD_LABEL = {
  document_type: 'نوع المستند', document_number: 'رقم المستند', holder_name: 'الاسم في المستند',
  issue_date: 'تاريخ الإصدار', expiry_date: 'تاريخ الانتهاء', branch: 'الفرع / الجهة',
}

// Arabic pill for admin screens
export const statusPill = (status, daysLeft) => {
  if (status === 'review') return { cls: 'amber', text: 'بانتظار المراجعة' }
  if (status === 'rejected') return { cls: 'red', text: 'مرفوض' }
  if (status === 'overdue') return { cls: 'red', text: `متأخرة ${Math.abs(daysLeft)} يوم` }
  if (status === 'due') return { cls: 'amber', text: daysLeft === 0 ? 'اليوم' : `بعد ${daysLeft} يوم` }
  if (status === 'unknown') return { cls: 'gray', text: 'حدد آخر مرة' }
  if (status === 'expired') return { cls: 'red', text: daysLeft === 0 ? 'منتهي اليوم' : `منتهي من ${Math.abs(daysLeft)} يوم` }
  if (status === 'expiring') return { cls: 'amber', text: daysLeft === 0 ? 'ينتهي اليوم' : `بعد ${daysLeft} يوم` }
  if (status === 'ok') return { cls: 'ok', text: 'تمام' }
  return { cls: 'ok', text: 'ساري' }
}

export const ext = (f) => (f.type === 'application/pdf' ? 'pdf' : (f.name.split('.').pop() || 'jpg').toLowerCase())

// lower-case Arabic/English-insensitive search across all text fields of a row
const fold = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
export const matches = (row, q, keys) => {
  const n = fold(q.trim())
  if (!n) return true
  return keys.some((k) => fold(row[k]).includes(n))
}
