import { useMemo, useState } from 'react'
import { qtyFmt, itemNames } from '../lib/inv'
import { normName, bestMatches, similarity } from '../lib/orderSheet'
import ProductImage from './ProductImage.jsx'
import Icon from './Icon.jsx'
import { useLang } from '../lib/i18n.jsx'

// Search sheet to link a written name (from an Excel sheet or an invoice) to an inventory item.
// items: [{ id, name_ar, name_en, unit, category }]; the closest names are listed first.
export default function ItemSearchSheet({ items, line, current, onPick, onClose, hint = 'الربط بيتحفظ للمرات الجاية' }) {
  const { tr, tn, lang } = useLang()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = normName(q)
    if (!s) return bestMatches(line?.name || '', items, 15).map(([i]) => i)
    return items.filter((i) => normName(`${i.name_ar} ${i.name_en || ''}`).includes(s)).sort((a, b) => similarity(q, b) - similarity(q, a)).slice(0, 60)
  }, [q, items, line])
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><div><h2 style={{ fontSize: 18 }}>{tr('اربط "{name}"', { name: line?.name })}</h2><div className="sub">{[line?.qty != null ? `${qtyFmt(line.qty)} ${tn(line?.unit) || ''}` : '', tr(hint)].filter(Boolean).join(' · ')}</div></div>
          <button type="button" className="icon-btn" aria-label={tr('إغلاق')} onClick={onClose}><Icon name="x" /></button></div>
        <div className="search" style={{ marginBottom: 10 }}><Icon name="search" size={18} /><input className="input" autoFocus placeholder={tr('دوّر بالعربي أو الإنجليزي')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!q && <div className="sub" style={{ marginBottom: 6 }}>{tr('أقرب الأصناف للاسم')}:</div>}
        <div className="card list" style={{ padding: '2px 10px' }}>
          {list.map((i) => (
            <button key={i.id} type="button" className={'list-item pick-row' + (i.id === current ? ' on' : '')} onClick={() => onPick(i.id)}>
              <ProductImage itemId={i.id} size={40} />
              <span className="grow" style={{ textAlign: 'start' }}><div style={{ fontWeight: 600 }}>{itemNames(i, lang)[0]}</div><div className="cell-sub">{itemNames(i, lang)[1]}{i.unit ? ` · ${tn(i.unit)}` : ''}{i.category ? ` · ${tn(i.category)}` : ''}</div></span>
              {i.id === current && <Icon name="check" size={18} />}
            </button>
          ))}
          {list.length === 0 && <div className="empty">{tr('ما لقيت حاجة')}</div>}
        </div>
      </div>
    </div>
  )
}
