import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { qtyFmt, kwd, loadLookups, invErr, MOVE_KIND, itemNames } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import ProductImage from '../../components/ProductImage.jsx'

// which branches this person may count / see
export function useBranchChoice() {
  const { access, can } = useAccess()
  const [lookups, setLookups] = useState(null)
  const [branch, setBranch] = useState('')
  const any = access.is_owner || can('manage_inventory') || (can('branch_count') && access.branch_scope === 'all')
  useEffect(() => {
    loadLookups().then((l) => {
      setLookups(l)
      // owner / stock managers start on the central kitchen; branch staff on their own branch
      const own = l.stockBranches.find((b) => b.id === access.employee.branch_id)
      setBranch((any ? l.kitchen?.id : own?.id) || own?.id || '')
    })
  }, [access.employee.branch_id, any])
  const options = lookups ? (any ? lookups.stockBranches : lookups.stockBranches.filter((b) => b.id === access.employee.branch_id)) : []
  return { lookups, branch, setBranch, any, options }
}

export function BranchPicker({ branch, setBranch, any, options }) {
  const { tr, tn } = useLang()
  if (any) return (
    <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={tr('المكان')}>
      {options.map((b) => <option key={b.id} value={b.id}>{tn(b.name)}</option>)}
    </select>)
  return <span className="pill gray" style={{ fontSize: 14, padding: '6px 12px' }}>{tn(options[0]?.name) || tr('ما لك فرع')}</span>
}

const REASONS = ['خربان', 'انتهت الصلاحية', 'طاح أو انكسر', 'رجّعه زبون']

export function WasteSheet({ branch, items, onClose, onSaved }) {
  const { tr, lang } = useLang()
  const [q, setQ] = useState('')
  const [item, setItem] = useState(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [other, setOther] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s.length < 2 ? [] : items.filter((i) => i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s)).slice(0, 8)
  }, [q, items])
  const save = async () => {
    setErr('')
    if (!item) { setErr(tr('اختار الصنف')); return }
    if (!(Number(qty) > 0)) { setErr(tr('اكتب الكمية')); return }
    setBusy(true)
    const { error } = await supabase.rpc('record_waste', { p_branch: branch, p_item: item.id, p_qty: Number(qty), p_note: reason === 'غيره' ? other : reason })
    setBusy(false)
    if (error) setErr(tr(invErr(error))); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{tr('تسجيل تالف')}</h2>
          <button type="button" className="icon-btn" aria-label={tr('إغلاق')} onClick={onClose}><Icon name="x" /></button></div>
        {item ? (
          <div className="card row"><span className="grow" style={{ fontWeight: 600 }}>{itemNames(item, lang)[0]}<div className="cell-sub">{tr(item.unit || '')}</div></span>
            <button className="btn" style={{ minHeight: 36 }} onClick={() => setItem(null)}>{tr('غيّر')}</button></div>
        ) : (
          <div className="field"><label htmlFor="ws">{tr('الصنف')}</label>
            <input id="ws" className="input" placeholder={tr('دوّر على الصنف')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {found.length > 0 && <div className="card list" style={{ padding: '0 10px' }}>{found.map((i) =>
              <button key={i.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => setItem(i)}>
                <span className="grow">{itemNames(i, lang)[0]}<div className="cell-sub">{itemNames(i, lang)[1]}{i.unit ? ` · ${tr(i.unit)}` : ''}</div></span></button>)}</div>}
          </div>
        )}
        <div className="field"><label htmlFor="wq">{tr('الكمية')} {item?.unit ? `(${tr(item.unit)})` : ''}</label>
          <input id="wq" className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></div>
        <div className="field"><span className="lbl">{tr('السبب')}</span>
          <div className="chips">{[...REASONS, 'غيره'].map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{tr(r)}</button>)}</div>
          {reason === 'غيره' && <input className="input" placeholder={tr('اكتب السبب')} value={other} onChange={(e) => setOther(e.target.value)} />}</div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy} onClick={save}>{tr('حفظ')}</button>
      </div>
    </div>
  )
}

export default function BranchStock() {
  const { can } = useAccess()
  const { tr, lang, fmtDate, fmtTime } = useLang()
  const bc = useBranchChoice()
  const { branch } = bc
  const [items, setItems] = useState([])
  const [levels, setLevels] = useState({})
  const [moves, setMoves] = useState([])
  const [counts, setCounts] = useState([])
  const [q, setQ] = useState('')
  const [onlyStock, setOnlyStock] = useState(true)
  const [waste, setWaste] = useState(false)
  const canCount = can('branch_count') || can('manage_inventory')

  useEffect(() => { supabase.from('inv_stock').select('id,name_ar,name_en,unit,category,avg_cost').eq('active', true).order('name_ar').then(({ data }) => setItems(data || [])) }, [])
  const load = useCallback(() => {
    if (!branch) return
    supabase.from('stock_levels').select('item_id,qty,updated_at').eq('branch_id', branch).then(({ data }) => setLevels(Object.fromEntries((data || []).map((x) => [x.item_id, x]))))
    supabase.from('stock_movements').select('id,qty,kind,note,created_at,inv_items(name_ar,name_en,inv_units(name)),employees:created_by(full_name)').eq('branch_id', branch).order('created_at', { ascending: false }).limit(15).then(({ data }) => setMoves(data || []))
    supabase.from('stock_counts').select('id,created_at,lines_count,short_value,over_value,employees:created_by(full_name)').eq('branch_id', branch).order('created_at', { ascending: false }).limit(5).then(({ data }) => setCounts(data || []))
  }, [branch])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) => (!onlyStock || levels[i.id]) && (!s || i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s)))
  }, [items, levels, q, onlyStock])
  const value = Object.entries(levels).reduce((a, [id, l]) => a + Math.max(Number(l.qty), 0) * Number(items.find((i) => i.id === id)?.avg_cost || 0), 0)
  const lastCount = counts[0]

  return (
    <div>
      <div className="page-head">
        <div><h1>{tr('رصيد الفرع والجرد')}</h1><div className="sub">{tr('الكميات المتوقعة حسب الطلبات والجرد والتالف')}</div></div>
        <BranchPicker {...bc} />
      </div>
      {canCount && <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Link className="btn primary" to={`/inventory/count?branch=${branch}`}><Icon name="list" /> {tr('ابدأ جرد')}</Link>
        <button className="btn" onClick={() => setWaste(true)}><Icon name="trash" /> {tr('تسجيل تالف')}</button>
      </div>}

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">{tr('أصناف عندها رصيد')}</div><div className="value num">{Object.values(levels).filter((l) => Number(l.qty) > 0).length}</div></div>
        <div className="card stat"><div className="label">{tr('القيمة التقريبية')}</div><div className="value num" style={{ fontSize: 24 }}>{kwd(value)}</div><div className="sub">{tr('د.ك')}</div></div>
        <div className="card stat"><div className="label">{tr('آخر جرد')}</div>
          <div className="value" style={{ fontSize: 18 }}>{lastCount ? fmtDate(lastCount.created_at) : tr('ما فيه')}</div>
          {lastCount && <div className="sub">{lastCount.employees?.full_name} · {tr('نقص')} <span className="num">{kwd(lastCount.short_value)}</span></div>}</div>
      </div>

      <div className="toolbar">
        <div className="search"><Icon name="search" size={18} /><input className="input" placeholder={tr('دوّر على صنف')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> {tr('الأصناف اللي لها رصيد بس')}</label>
      </div>
      <div className="card table-wrap" style={{ padding: '4px 10px', marginBottom: 20 }}>
        <table style={{ minWidth: 0 }}>
          <thead><tr><th style={{ textAlign: 'start' }}>{tr('الصنف')}</th><th style={{ textAlign: 'start' }}>{tr('الكمية')}</th><th style={{ textAlign: 'start' }}>{tr('آخر تحديث')}</th></tr></thead>
          <tbody>{shown.slice(0, 200).map((i) => {
            const l = levels[i.id]
            return <tr key={i.id}><td><div className="row" style={{ gap: 10 }}><ProductImage itemId={i.id} size={38} /><div>{itemNames(i, lang)[0]}<div className="cell-sub">{tr(i.category || '')}</div></div></div></td>
              <td><span className="num" style={{ fontWeight: 600, color: l && Number(l.qty) < 0 ? 'var(--red)' : undefined }}>{l ? qtyFmt(l.qty) : '—'}</span> <span className="sub">{tr(i.unit || '')}</span></td>
              <td className="sub">{l ? fmtDate(l.updated_at) : ''}</td></tr>
          })}</tbody>
        </table>
        {shown.length === 0 && <div className="empty">{onlyStock ? tr('ما فيه رصيد للحين. بيتسجل أول ما يوصل طلب أو تسوون جرد.') : tr('ما لقينا شي')}</div>}
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 10 }}>{tr('آخر الحركات')}</h2>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {moves.length === 0 && <div className="empty">{tr('ما فيه حركات')}</div>}
        {moves.map((m) => <div key={m.id} className="list-item">
          <span className={'pill ' + (MOVE_KIND[m.kind]?.[0] || 'gray')}>{tr(MOVE_KIND[m.kind]?.[1] || m.kind)}</span>
          <span className="grow">{itemNames(m.inv_items, lang)[0]}<div className="cell-sub">{fmtDate(m.created_at)} {fmtTime(m.created_at)}{m.employees?.full_name ? ` · ${m.employees.full_name}` : ''}{m.note ? ` · ${tr(m.note)}` : ''}</div></span>
          <span className="num" style={{ fontWeight: 600, color: m.qty < 0 ? 'var(--red)' : 'var(--ok)' }}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</span></div>)}
      </div>
      {waste && <WasteSheet branch={branch} items={items} onClose={() => setWaste(false)} onSaved={load} />}
    </div>
  )
}
