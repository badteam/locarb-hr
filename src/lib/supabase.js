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
  if (m.includes('employees_bio_pin_key')) return 'هذا الرقم على جهاز البصمة مسجّل لموظف ثاني'
  if (m.includes('employees_bio_pin_check')) return 'رقم جهاز البصمة لازم يكون أرقام بس'
  if (m.includes('punch mode device')) return 'هذا الموظف يبصم من جهاز البصمة في الفرع'
  if (m.includes('punch mode kiosk')) return 'هذا الموظف يبصم من آيباد الفرع'
  if (m.includes('future time')) return 'ما تقدر تختار وقت بعد الوقت الحالي'
  if (m.includes('future date')) return 'ما تقدر تختار تاريخ بعد اليوم'
  if (m.includes('out before in')) return 'وقت الانصراف لازم يكون بعد الحضور'
  if (m.includes('too long shift')) return 'المدة بين الحضور والانصراف أطول من ٢٠ ساعة، تأكد من الأوقات'
  if (m.includes('row-level security')) return 'ما عندك صلاحية لهذا الإجراء'
  if (/fetch|network|Failed to fetch|Load failed/i.test(m)) return 'صار خطأ، جرّب مرة ثانية'
  return m
}
