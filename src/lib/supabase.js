import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY)

// employees log in with their phone number; mapped to an internal email
export const loginEmail = (phone) => `${String(phone).replace(/\D/g, '')}@staff.locarb.local`

export const todayKuwait = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date())

export const fmtDate = (d) =>
  d ? new Intl.DateTimeFormat('ar-KW', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—'

export const fmtTime = (d) =>
  d ? new Intl.DateTimeFormat('ar-KW', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' }).format(new Date(d)) : '—'

export const docStatusPill = (status, daysLeft) => {
  if (status === 'expired') return { cls: 'red', text: daysLeft === 0 ? 'منتهي' : `منتهي من ${Math.abs(daysLeft)} يوم` }
  if (status === 'expiring') return { cls: 'amber', text: daysLeft === 0 ? 'ينتهي اليوم' : `بعد ${daysLeft} يوم` }
  return { cls: 'ok', text: 'ساري' }
}

export const errMsg = (e) => {
  const m = e?.message || String(e)
  if (m.includes('already checked in')) return 'أنت مسجل حضور من قبل'
  if (m.includes('no open check-in')) return 'ما فيه حضور مفتوح'
  if (m.includes('Invalid login')) return 'رقم الهاتف أو كلمة السر غلط'
  if (m.includes('only the owner')) return 'هذا التعديل للمالك فقط'
  if (m.includes('row-level security')) return 'ما عندك صلاحية لهذا الإجراء'
  return m
}
