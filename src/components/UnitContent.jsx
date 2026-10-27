import { useEffect, useState } from 'react'

// Stock units that are already a weight/volume: the system knows the grams without asking.
export const MEASURE_UNITS = { 'كغ': [1000, 'g'], 'كيلو': [1000, 'g'], 'غرام': [1, 'g'], 'جرام': [1, 'g'], 'لتر': [1000, 'ml'], 'مل': [1, 'ml'] }
export const isMeasureUnit = (u) => !!MEASURE_UNITS[u || '']
export const NONFOOD_CATS = ['تغليف', 'تنظيف', 'قرطاسية', 'أدوات ومستلزمات العمل']

const U = '(kgs?|كجم|كغم?|كيلو|grams?|gms?|grms?|gr|g|جم|جرام|غرام|غ|ltrs?|lt|l|لتر|ملي|ml|مل)'
const norm = (t) => String(t || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '.')
const toG = (v, u) => {
  u = u.toLowerCase()
  const big = /^(kgs?|كجم|كغم?|كيلو|ltrs?|lt|l|لتر)$/.test(u)
  return { each: big ? v * 1000 : v, measure: /^(ltrs?|lt|l|لتر|ملي|ml|مل)$/.test(u) ? 'ml' : 'g' }
}

// "10 X 1KG", "24X340G", "4x3.78L", "6 عبوات × 2 كجم", "250 ملي × 30 حبة" -> { n, each, total, measure }
export function parsePack(text) {
  const s = norm(text)
  let m = s.match(new RegExp(`(\\d+)\\s*(?:[^\\d\\s×xX*()]{1,8}\\s*)?(?:x|×|\\*)\\s*(\\d+(?:\\.\\d+)?)\\s*${U}(?![\\p{L}])`, 'iu'))
  let n, w
  if (m) { n = Number(m[1]); w = toG(Number(m[2]), m[3]) }
  else {
    m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${U}\\s*(?:x|×|\\*)\\s*(\\d+)(?!\\s*${U}(?![\\p{L}]))`, 'iu'))
    if (!m) return null
    n = Number(m[3]); w = toG(Number(m[1]), m[2])
  }
  if (!n || !w.each) return null
  return { n, each: w.each, total: n * w.each, measure: w.measure }
}

// a single size in the text: "زبدة 25 كيلو", "كرتون 20 كيلو", "15 كيلو" -> { each, measure } (the last one found)
export function parseWeight(text) {
  const all = [...norm(text).matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${U}(?![\\p{L}])`, 'giu'))]
  if (!all.length) return null
  const m = all[all.length - 1]
  const w = toG(Number(m[1]), m[2])
  return w.each ? w : null
}

export const fmtContent = (grams, measure = 'g') => {
  const g = Number(grams)
  if (!g) return ''
  const big = measure === 'ml' ? 'لتر' : 'كيلو', small = measure === 'ml' ? 'مل' : 'جرام'
  return g >= 1000 ? `${+(g / 1000).toFixed(3)} ${big}` : `${+g.toFixed(1)} ${small}`
}

// "How much is in one carton/bag/…": weight or volume, plus how many pieces.
// "How much is in one carton/bag/…": how many pieces, and/or the weight (of the whole unit or of one piece).
// Either one is enough to save: pieces let the meal cost price a piece, weight lets it price a kilo / 100 g.
export default function UnitContent({ unit, grams, pieces, measure, onChange, required, compact }) {
  const toState = (g, ms, per = 'all') => {
    let n = Number(g)
    if (n && per === 'one' && Number(pieces) > 1) n = n / Number(pieces)
    if (!n) return { amt: '', mu: ms === 'ml' ? 'l' : 'kg', per }
    const big = n >= 1000 && n % 10 === 0
    return { amt: String(+(big ? n / 1000 : n).toFixed(3)), mu: ms === 'ml' ? (big ? 'l' : 'ml') : big ? 'kg' : 'g', per }
  }
  const [st, setSt] = useState(() => toState(grams, measure))
  const total = (s, pcs) => { const g = toGrams(s); return s.per === 'one' && Number(pcs) > 1 ? g * Number(pcs) : g }
  useEffect(() => { setSt((s) => (Number(grams || 0) === total(s, pieces) ? s : toState(grams, measure, s.per))) }, [grams, measure]) // eslint-disable-line react-hooks/exhaustive-deps
  const emit = (next, pcs = pieces) => {
    setSt(next)
    onChange({ grams: Math.round(total(next, pcs) * 1000) / 1000 || null, measure: next.mu === 'l' || next.mu === 'ml' ? 'ml' : 'g', pieces: pcs })
  }
  const u = unit || 'الوحدة'
  const ok = toGrams(st) > 0 || Number(pieces) > 1
  const g = total(st, pieces), pcs = Number(pieces) || 0
  return (
    <div className="form" style={{ gap: 8, background: required && !ok ? '#FFFBEB' : '#F7F9F5', borderRadius: 10, padding: compact ? 8 : 10 }}>
      <span className="lbl" style={{ fontSize: compact ? 13 : undefined }}>الـ{u} الواحد فيه كام؟{required ? ' (مهم لحساب الكوست)' : ''}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="sub" style={{ minWidth: 70 }}>عدد الحبات</span>
        <input className="input num" style={{ width: 90 }} type="number" step="1" min="0" value={pieces ?? ''} placeholder="مثلاً 6"
          onChange={(e) => emit(st, e.target.value === '' ? null : Number(e.target.value))} aria-label="عدد الحبات" />
        <span className="sub">حبة</span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="sub" style={{ minWidth: 70 }}>الوزن</span>
        <input className="input num" style={{ width: 90 }} type="number" step="any" min="0" value={st.amt} placeholder={pcs > 1 ? 'اختياري' : 'مثلاً 10'}
          onChange={(e) => emit({ ...st, amt: e.target.value })} aria-label={`وزن الـ${u}`} />
        <select className="input" style={{ width: 'auto' }} value={st.mu} onChange={(e) => emit({ ...st, mu: e.target.value })} aria-label="كيلو أو جرام أو لتر">
          <option value="kg">كيلو</option><option value="g">جرام</option><option value="l">لتر</option><option value="ml">مل</option>
        </select>
        {pcs > 1 && <select className="input" style={{ width: 'auto' }} value={st.per} onChange={(e) => emit({ ...st, per: e.target.value })} aria-label="وزن مين">
          <option value="all">للـ{u} كله</option><option value="one">للحبة الواحدة</option>
        </select>}
      </div>
      {(g > 0 || pcs > 1) && <div className="sub" style={{ fontSize: 12 }}>
        = الـ{u} فيه {pcs > 1 ? `${pcs} حبة` : ''}{pcs > 1 && g > 0 ? ' · ' : ''}{g > 0 ? fmtContent(g, st.mu === 'l' || st.mu === 'ml' ? 'ml' : 'g') : ''}{pcs > 1 && g > 0 ? ` (الحبة ${fmtContent(g / pcs, st.mu === 'l' || st.mu === 'ml' ? 'ml' : 'g')})` : ''}</div>}
      {!compact && <div className="sub">اكتب عدد الحبات لو بتستخدمه بالحبة (كيس خبز فيه 6 حبات)، والوزن لو بتستخدمه بالجرام (كرتونة جمبري 10 كيلو). لو تعرف الاتنين اكتبهم، عشان السعرات تتحسب صح.</div>}
    </div>
  )
}

function toGrams(s) {
  const a = Number(s.amt)
  if (!a) return 0
  return Math.round((s.mu === 'kg' || s.mu === 'l' ? a * 1000 : a) * 1000) / 1000
}
