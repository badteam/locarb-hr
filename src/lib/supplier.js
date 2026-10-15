export const CONTACT_ROLE = { sales: 'المندوب', accounts: 'المحاسب', delivery: 'التوصيل', management: 'الإدارة', other: 'أخرى' }
export const SUP_STATUS = { active: ['ok', 'شغّال'], paused: ['gray', 'موقوف'], blocked: ['red', 'لا تتعامل معه'] }
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const PAY_PREF = { cash: 'كاش', transfer: 'تحويل بنكي', cheque: 'شيك', knet: 'كي نت', credit: 'آجل' }
// Kuwait numbers: 8 digits -> +965
export const phoneDigits = (p) => {
  let d = String(p || '').replace(/[^\d]/g, '').replace(/^00/, '')
  if (d.length === 8) d = '965' + d
  return d
}
export const telLink = (p) => `tel:+${phoneDigits(p)}`
export const waLink = (p, text) => `https://wa.me/${phoneDigits(p)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
export const mainContact = (s, contacts = []) => contacts.find((c) => c.role === 'sales' && c.phone) || contacts.find((c) => c.phone) || (s?.phone ? { name: s.contact_name, phone: s.phone, whatsapp: true, role: 'sales' } : null)
