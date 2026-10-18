import { useEffect, useState } from 'react'

// Stock units that are already a weight/volume: the system knows the grams without asking.
export const MEASURE_UNITS = { 'كغ': [1000, 'g'], 'كيلو': [1000, 'g'], 'غرام': [1, 'g'], 'جرام': [1, 'g'], 'لتر': [1000, 'ml'], 'مل': [1, 'ml'] }
export const isMeasureUnit = (u) => !!MEASURE_UNITS[u || '']
export const NONFOOD_CATS = ['تغليف', 'تنظيف', 'قرطاسية', 'أدوات ومستلزمات العمل']

// "10 X 1KG", "24X340G", "4x3.78L", "6 × 2 كجم", "40X250G" -> { n, each, total, measure }
export function parsePack(text) {
  const s = String(text || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '.')
  const m = s.match(/(\d+)\s*(?:[^\d\s×xX*()]{1,8}\s*)?(?:x|X|×|\*)\s*(\d+(?:\.\d+)?)\s*(kgs?|كجم|كغ|كيلو|grams?|gms?|grm?s?|g|جم|غ|غرام|جرام|ltrs?|lt|l|لتر|ml|مل)(?![a-z])/i)
  if (!m) return null
  const n = Number(m[1]), v = Number(m[2]), u = m[3].toLowerCase()
  const kilo = /^(kg|kgs|كجم|كغ|كيلو)$/.test(u), litre = /^(ltr|ltrs|lt|l|لتر)$/.test(u), ml = /^(ml|مل)$/.test(u)
  const each = kilo || litre ? v * 1000 : v
  if (!n || !each) return null
  return { n, each, total: n * each, measure: litre || ml ? 'ml' : 'g' }
}

export const fmtContent = (grams, measure = 'g') => {
  const g = Number(grams)
  if (!g) return ''
  const big = measure === 'ml' ? 'لتر' : 'كيلو', small = measure === 'ml' ? 'مل' : 'جرام'
  return g >= 1000 ? `${+(g / 1000).toFixed(3)} ${big}` : `${+g.toFixed(1)} ${small}`
}

// "How much is in one carton/bag/…": weight or volume, plus how many pieces.
export default function UnitContent({ unit, grams, pieces, measure, onChange, required, compact }) {
  const toState = (g, ms) => {
    const n = Number(g)
    if (!n) return { amt: '', mu: ms === 'ml' ? 'l' : 'kg' }
    const big = n >= 1000 && n % 10 === 0
    return { amt: String(+(big ? n / 1000 : n).toFixed(3)), mu: ms === 'ml' ? (big ? 'l' : 'ml') : big ? 'kg' : 'g' }
  }
  const [st, setSt] = useState(() => toState(grams, measure))
  useEffect(() => { setSt((s) => (Number(grams) === toGrams(s) ? s : toState(grams, measure))) }, [grams, measure])
  const emit = (next, pcs = pieces) => {
    setSt(next)
    onChange({ grams: toGrams(next) || null, measure: next.mu === 'l' || next.mu === 'ml' ? 'ml' : 'g', pieces: pcs })
  }
  const u = unit || 'الوحدة'
  return (
    <div className="form" style={{ gap: 6, background: required && !toGrams(st) ? '#FFFBEB' : '#F7F9F5', borderRadius: 10, padding: compact ? 8 : 10 }}>
      <span className="lbl" style={{ fontSize: compact ? 13 : undefined }}>الـ{u} الواحد فيه كام؟{required ? ' (مهم لحساب الكوست)' : ''}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input num" style={{ width: 110 }} type="number" step="any" min="0" value={st.amt} placeholder="مثلاً 10"
          onChange={(e) => emit({ ...st, amt: e.target.value })} aria-label={`الـ${u} فيه كام`} />
        <select className="input" style={{ width: 'auto' }} value={st.mu} onChange={(e) => emit({ ...st, mu: e.target.value })} aria-label="كيلو أو جرام أو لتر">
          <option value="kg">كيلو</option><option value="g">جرام</option><option value="l">لتر</option><option value="ml">مل</option>
        </select>
        <span className="sub">وفيه</span>
        <input className="input num" style={{ width: 80 }} type="number" step="1" min="0" value={pieces ?? ''} placeholder="1"
          onChange={(e) => emit(st, e.target.value === '' ? null : Number(e.target.value))} aria-label="عدد الحبات" />
        <span className="sub">حبة / كيس</span>
      </div>
      {!compact && <div className="sub">مثلاً كرتونة جمبري 10 أكياس × 1 كيلو: اكتب 10 كيلو و10 حبة. كده السيستم يعرف سعر الكيلو والـ100 جرام في كوست الوجبة.</div>}
    </div>
  )
}

function toGrams(s) {
  const a = Number(s.amt)
  if (!a) return 0
  return Math.round((s.mu === 'kg' || s.mu === 'l' ? a * 1000 : a) * 1000) / 1000
}
