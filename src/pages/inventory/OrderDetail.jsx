import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { qtyFmt, kwd, ORDER_STATUS, invErr, itemNames } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import ProductImage from '../../components/ProductImage.jsx'

export default function OrderDetail() {
  const { id } = useParams()
  const { can, access } = useAccess()
  const { tr, tn, lang, fmtDate, fmtTime } = useLang()
  const [r, setR] = useState(null)
  const [lines, setLines] = useState([])
  const [kitchenQty, setKitchenQty] = useState({})
  const [edit, setEdit] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('branch_requests')
      .select('*, branches:branch_id(name), creator:created_by(full_name), sender:dispatched_by(full_name), receiver:received_by(full_name), branch_request_lines(*, inv_items(name_ar,name_en,inv_units(name)))')
      .eq('id', id).maybeSingle()
    if (!data) { setR(false); return }
    setR(data)
    const ls = (data.branch_request_lines || []).sort((a, b) => a.inv_items.name_ar.localeCompare(b.inv_items.name_ar))
    setLines(ls)
    setEdit(Object.fromEntries(ls.map((l) => [l.id, String(data.status === 'dispatched' ? (l.sent_qty ?? 0) : l.requested_qty)])))
    if (data.status === 'submitted') {
      const ids = ls.map((l) => l.item_id)
      supabase.from('inv_stock').select('id,kitchen_qty').in('id', ids).then(({ data: s }) => setKitchenQty(Object.fromEntries((s || []).map((x) => [x.id, x.kitchen_qty]))))
    }
  }, [id])
  useEffect(() => { load() }, [load])

  if (r === false) return <div className="card empty">{tr('الطلب مو موجود')}</div>
  if (!r) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  const kitchen = can('approve_branch_requests')
  const branchSide = can('manage_inventory') || access.is_owner || (can('branch_orders') && (access.branch_scope === 'all' || access.employee.branch_id === r.branch_id))
  const canDispatch = kitchen && r.status === 'submitted'
  const canReceive = branchSide && r.status === 'dispatched'
  const st = ORDER_STATUS[r.status]
  const value = lines.reduce((a, l) => a + (Number(l.sent_qty) || 0) * (Number(l.unit_cost) || 0), 0)

  const act = async (what, fn) => {
    setBusy(what); setErr(''); setMsg('')
    const { data, error } = await fn()
    setBusy('')
    if (error) { setErr(tr(invErr(error))); return }
    await load()
    return data
  }
  const payload = (key) => lines.map((l) => ({ id: l.id, [key]: Number(edit[l.id]) || 0 }))
  const dispatch = async () => {
    const d = await act('dispatch', () => supabase.rpc('dispatch_branch_request', { p_id: id, p_lines: payload('sent_qty'), p_note: note || null }))
    if (d) setMsg(tr('انرسل {n} صنف بقيمة {v} د.ك وانخصم من مخزون المطبخ', { n: d.lines, v: kwd(d.value) }))
  }
  const receive = async () => {
    const d = await act('receive', () => supabase.rpc('receive_branch_request', { p_id: id, p_lines: payload('received_qty'), p_note: note || null }))
    if (d) setMsg(d.differences?.length ? tr('انستلم، والفروقات انرسلت للمطبخ') : tr('انستلم كامل وانضاف لمخزون الفرع'))
  }
  const reject = () => act('reject', () => supabase.rpc('reject_branch_request', { p_id: id, p_note: note || null })).then(() => setRejecting(false))
  const cancel = () => window.confirm(tr('تلغي الطلب؟')) && act('cancel', () => supabase.rpc('cancel_branch_request', { p_id: id }))

  const editable = canDispatch || canReceive
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div><Link to="/inventory/orders" className="sub" style={{ textDecoration: 'none' }}>{tr('→ طلبات الفروع')}</Link>
          <h1 style={{ marginTop: 4 }}>{tr('طلب {b}', { b: tn(r.branches?.name) })}</h1>
          <div className="sub">{r.creator?.full_name ? `${r.creator.full_name} · ` : ''}{fmtDate(r.created_at)} {fmtTime(r.created_at)}</div></div>
        <span className={'pill ' + st[0]} style={{ fontSize: 14, padding: '6px 14px' }}>{tr(st[1])}</span>
      </div>

      {r.note && <div className="card" style={{ marginBottom: 12 }}><span className="sub">{tr('ملاحظة الفرع:')} </span>{r.note}</div>}
      {r.status === 'dispatched' && <div className="notice" style={{ marginBottom: 12 }}>{tr('أرسلها {n}', { n: r.sender?.full_name || tr('المطبخ') })} · {fmtDate(r.dispatched_at)} {fmtTime(r.dispatched_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}</div>}
      {r.status === 'received' && <div className="notice" style={{ marginBottom: 12 }}>{tr('استلمها {n}', { n: r.receiver?.full_name || tr('الفرع') })} · {fmtDate(r.received_at)}{r.receive_note ? ` · ${r.receive_note}` : ''}</div>}
      {r.status === 'rejected' && <div className="error" style={{ marginBottom: 12 }}>{tr('انرفض')}{r.decision_note ? `: ${r.decision_note}` : ''}</div>}
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {canDispatch && <div className="sub" style={{ marginBottom: 8 }}>{tr('عدّل الكمية اللي بترسلها لو تختلف عن المطلوب، وبعدين اضغط "موافقة وإرسال".')}</div>}
      {canReceive && <div className="sub" style={{ marginBottom: 8 }}>{tr('عدّ اللي وصل فعلاً. لو فيه نقص اكتب الكمية الصحيحة.')}</div>}

      <div className="order-list">
        {lines.map((l) => {
          const unit = tr(l.inv_items?.inv_units?.name || '')
          const kq = kitchenQty[l.item_id]
          const short = canDispatch && kq != null && Number(kq) < Number(edit[l.id] || 0)
          const diff = r.status === 'received' && l.received_qty != null && Number(l.received_qty) !== Number(l.sent_qty)
          const [n1, n2] = itemNames(l.inv_items, lang)
          return (
            <div key={l.id} className="order-row" style={diff ? { borderColor: '#F3DDA8' } : undefined}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <ProductImage itemId={l.item_id} size={48} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{n1}</div>{n2 && <div className="cell-sub">{n2}</div>}
                  <div className="cell-sub">
                    {l.on_hand != null ? `${tr('عندهم {n}', { n: qtyFmt(l.on_hand) })} · ` : ''}{tr('طلبوا {n}', { n: qtyFmt(l.requested_qty) })} {unit}
                    {l.sent_qty != null ? ` · ${tr('انرسل {n}', { n: qtyFmt(l.sent_qty) })}` : ''}{l.received_qty != null ? ` · ${tr('وصل {n}', { n: qtyFmt(l.received_qty) })}` : ''}
                    {canDispatch && kq != null ? ` · ${tr('في المطبخ {n}', { n: qtyFmt(kq) })}` : ''}</div>
                </div>
                {short && <span className="pill amber">{tr('المطبخ ما يكفي')}</span>}
                {diff && <span className="pill amber">{tr('فرق')}</span>}
              </div>
              {editable && (
                <div className="row" style={{ gap: 10 }}>
                  <label className="sub grow" htmlFor={`q-${l.id}`}>{canDispatch ? tr('بترسل') : tr('وصل فعلاً')} ({unit})</label>
                  <input id={`q-${l.id}`} className="input num" style={{ width: 120, height: 44 }} inputMode="decimal" value={edit[l.id] ?? ''}
                    onChange={(e) => setEdit({ ...edit, [l.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(r.status === 'dispatched' || r.status === 'received') && kitchen && value > 0 && <div className="sub" style={{ marginTop: 10 }}>{tr('قيمة المرسل بالتكلفة:')} <span className="num">{kwd(value)}</span> {tr('د.ك')}</div>}

      {editable && (
        <div className="card form" style={{ marginTop: 14, gap: 10 }}>
          <div className="field"><label htmlFor="n">{tr('ملاحظة (اختياري)')}</label><input id="n" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {canDispatch && <>
            <button className="btn primary block" disabled={!!busy} onClick={dispatch}>{busy === 'dispatch' ? <span className="spinner" /> : <Icon name="truck" />} {tr('موافقة وإرسال')}</button>
            <button className="btn danger" disabled={!!busy} onClick={() => setRejecting(true)}>{tr('رفض الطلب')}</button>
          </>}
          {canReceive && <button className="btn primary block" disabled={!!busy} onClick={receive}>{busy === 'receive' ? <span className="spinner" /> : <Icon name="check" />} {tr('تأكيد الاستلام')}</button>}
        </div>
      )}
      {r.status === 'submitted' && branchSide && !kitchen && <button className="btn danger" style={{ marginTop: 14 }} disabled={!!busy} onClick={cancel}>{tr('إلغاء الطلب')}</button>}

      {rejecting && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRejecting(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{tr('رفض الطلب')}</h2>
              <button type="button" className="icon-btn" aria-label={tr('إغلاق')} onClick={() => setRejecting(false)}><Icon name="x" /></button></div>
            <div className="field"><label htmlFor="rn">{tr('السبب')}</label><input id="rn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <button className="btn primary block" disabled={!!busy} onClick={reject}>{tr('رفض')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
