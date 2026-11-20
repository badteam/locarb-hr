// Catches the most common stock-entry mistake: grams typed into a kilo (or bag / gallon) box.
// "Half a kilo" gets written as 500, so the system books 500 kg.
// The same rule runs on the server (private.qty_suspect); the app warns on a superset of what the server refuses.
import Icon from './Icon.jsx'
import { qtyFmt } from '../lib/inv'

const WEIGHT_UNITS = /^(كغ|كيلو|كجم|kg|لتر|ltr|l)$/i

// grams per one stock unit, when we know it (kilo = 1000, a 20 kg bag = 20000)
export const gramsPerUnit = (item) => {
  const g = Number(item?.unit_grams)
  if (g > 0) return g
  return WEIGHT_UNITS.test(String(item?.unit || item?.inv_units?.name || '').trim()) ? 1000 : 0
}

// a number of 50+ that is more than 10x what is normal here (book stock, what was ordered, what was sent)
export const qtySuspect = (v, ref) => {
  const n = Number(v)
  if (!(n >= 50)) return false
  return n > 10 * Math.max(Number(ref) || 0, 1)
}

// the quantity they probably meant, if they typed grams
export const gramsFix = (v, item) => {
  const g = gramsPerUnit(item)
  if (!g) return null
  const fixed = Math.round((Number(v) / g) * 1000) / 1000
  return fixed > 0 ? fixed : null
}

// warning under a box: "you wrote 650 kg, did you mean 0.65 kg (650 g)?" with one tap to fix, or tick that it is right
export function QtyWarn({ value, item, unit, expected, confirmed, onFix, onConfirm, tr }) {
  const fix = gramsFix(value, item)
  return (
    <div className="warn" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 6 }}>
      <span><Icon name="warn" /> {tr('كتبت {got} {u}! هذا أكبر وايد من العادي ({exp}).', { got: qtyFmt(value), u: unit, exp: qtyFmt(expected || 0) })}
        {' '}{fix != null ? tr('إذا كاتبه بالجرام، الصح {f} {u}.', { f: qtyFmt(fix), u: unit }) : tr('تأكد إنك كاتبه بالـ{u}.', { u: unit })}</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {fix != null && <button type="button" className="btn primary" style={{ height: 40 }} onClick={() => onFix(String(fix))}>
          {tr('صلّحه لـ {f} {u}', { f: qtyFmt(fix), u: unit })}</button>}
        <label className="check" style={{ fontWeight: 600 }}><input type="checkbox" checked={!!confirmed} onChange={(e) => onConfirm(e.target.checked)} /> {tr('لا، الرقم {got} {u} صحيح', { got: qtyFmt(value), u: unit })}</label>
      </div>
    </div>
  )
}

// small reminder next to kilo boxes
export const KgHint = ({ item, tr }) => gramsPerUnit(item) === 1000
  ? <span className="cell-sub" style={{ marginTop: 2, color: 'var(--amber)', fontWeight: 600 }}>{tr('بالكيلو: نص كيلو = 0.5')}</span> : null
