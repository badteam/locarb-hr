import { useEffect, useState, useCallback } from 'react'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { qtyFmt, invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const fmtT = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' }) : '')

// The branch-orders driver: today's orders ready at the central kitchen. Open one, tick each line taken,
// write the real number when something is short, then "I picked it up". The kitchen hears about any shortage.
export default function Delivery() {
  const { can } = useAccess()
  const { tr, tn, lang } = useLang()
  const driver = can('deliver_orders')
  const [orders, setOrders] = useState(null)
  const [open, setOpen] = useState(null)
  const [got, setGot] = useState({})   // line id -> { ok: bool, qty: string }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('driver_orders')
    if (error) { setMsg({ ok: false, t: tr(invErr(error)) }); setOrders([]); return }
    setOrders(data || [])
  }, [tr])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

  const name = (l) => (lang !== 'ar' && l.name_en ? l.name_en : l.name_ar)
  const openOrder = (o) => {
    setOpen(o.id); setNote(o.pickup_note || ''); setMsg(null)
    setGot(Object.fromEntries((o.lines || []).map((l) => [l.id, l.picked_qty != null ? { ok: Number(l.picked_qty) === Number(l.sent_qty), qty: String(l.picked_qty) } : { ok: false, qty: '' }])))
  }
  const o = (orders || []).find((x) => x.id === open)

  const pickup = async () => {
    const lines = o.lines.map((l) => {
      const g = got[l.id] || {}
      return { id: l.id, picked_qty: g.ok ? Number(l.sent_qty) : g.qty === '' ? 0 : Number(g.qty) }
    })
    const short = lines.filter((x, i) => x.picked_qty !== Number(o.lines[i].sent_qty)).length
    if (short && !window.confirm(tr('فيه {n} صنف ناقص. يوصل تنبيه للمطبخ. تكمل؟', { n: short }))) return
    setBusy(true)
    const { data, error } = await supabase.rpc('driver_pickup', { p_id: o.id, p_lines: lines, p_note: note || null })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: tr(invErr(error)) }); return }
    setMsg({ ok: true, t: data?.short?.length ? tr('انحفظ. وصل للمطبخ تنبيه بالنقص.') : tr('انحفظ. الطلبية معك، وصّلها للفرع.') })
    setOpen(null); load()
  }

  if (!orders) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1>{tr('طلبيات اليوم')}</h1><div className="sub">{tr('الطلبيات اللي جهزها المطبخ المركزي للفروع. افتح الطلبية واستلم صنف صنف.')}</div></div>
        <button className="btn" onClick={load}><Icon name="refresh" /> {tr('تحديث')}</button></div>
      {msg && <div className={msg.ok ? 'notice' : 'error'} style={{ marginBottom: 12 }}>{msg.t}</div>}

      {!o ? (
        orders.length === 0 ? <div className="card empty">{tr('ما فيه طلبيات جاهزة الحين')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.map((x) => (
              <button key={x.id} type="button" className="card" style={{ textAlign: 'start', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', border: x.picked_up_at ? undefined : '2px solid var(--green)' }} onClick={() => openOrder(x)}>
                <span className="thumb"><Icon name="truck" /></span>
                <span className="grow">
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{tn(x.branch)}</div>
                  <div className="sub">{tr('{n} صنف', { n: (x.lines || []).length })} · {tr('جهزها المطبخ')} {fmtDate(x.dispatched_at)} {fmtT(x.dispatched_at)}</div>
                </span>
                {x.picked_up_at ? <span className="pill ok">{tr('معك')} · {fmtT(x.picked_up_at)}</span> : <span className="pill amber">{tr('استلمها من المطبخ')}</span>}
              </button>))}
          </div>)
      ) : (
        <div className="card form" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 19 }}>{tn(o.branch)}</h2>
            <button className="btn" onClick={() => setOpen(null)}>{tr('رجوع')}</button></div>
          {o.note && <div className="sub">{tr('ملاحظة الفرع')}: {o.note}</div>}
          {o.picked_up_at && <div className="notice">{tr('استلمتها')} {fmtT(o.picked_up_at)}{o.picked_by ? ` · ${o.picked_by}` : ''}</div>}
          {driver && <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="chip" onClick={() => setGot(Object.fromEntries(o.lines.map((l) => [l.id, { ok: true, qty: String(l.sent_qty) }])))}>✓ {tr('استلمت الكل')}</button></div>}
          <div className="list">
            {(o.lines || []).map((l) => {
              const g = got[l.id] || { ok: false, qty: '' }
              const short = !g.ok && g.qty !== '' && Number(g.qty) !== Number(l.sent_qty)
              return (
                <div key={l.id} className="list-item" style={{ gap: 10, background: g.ok ? '#F0F7EE' : short ? '#FFFBEB' : undefined, borderRadius: 10, padding: '10px 8px' }}>
                  <button type="button" disabled={!driver} onClick={() => setGot({ ...got, [l.id]: { ok: !g.ok, qty: g.ok ? '' : String(l.sent_qty) } })} aria-pressed={g.ok} aria-label={tr('استلمت')}
                    style={{ width: 44, height: 44, borderRadius: 12, border: '2px solid ' + (g.ok ? 'var(--green)' : 'var(--line)'), background: g.ok ? 'var(--green)' : '#fff', color: '#fff', fontSize: 22, cursor: 'pointer', flexShrink: 0 }}>{g.ok ? '✓' : ''}</button>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{name(l)}</div>
                    <div className="sub">{tr('المطبخ كتب')}: <b className="num">{qtyFmt(l.sent_qty)}</b> {tn(l.unit || '')}</div>
                  </div>
                  {!g.ok && driver && <div style={{ width: 96 }}>
                    <input className="input num" style={{ height: 42 }} inputMode="decimal" placeholder={tr('كم استلمت؟')} value={g.qty}
                      onChange={(e) => setGot({ ...got, [l.id]: { ok: false, qty: e.target.value.replace(/[^\d.]/g, '') } })} aria-label={tr('كم استلمت؟') + ' ' + name(l)} />
                    {short && <div className="cell-sub" style={{ color: '#B45309' }}>{tr('ناقص {n}', { n: qtyFmt(Number(l.sent_qty) - Number(g.qty)) })}</div>}
                  </div>}
                </div>)
            })}
          </div>
          {driver && <>
            <div className="field"><label htmlFor="pn">{tr('ملاحظة (اختياري)')}</label><input id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {(() => { const left = o.lines.filter((l) => !(got[l.id]?.ok) && (got[l.id]?.qty ?? '') === '').length
              return <>
                {left > 0 && <div className="sub">{tr('باقي {n} صنف ما أكدته. اضغط ✓ أو اكتب الكمية (0 إذا ما استلمته).', { n: left })}</div>}
                <button className="btn primary block" style={{ minHeight: 54, fontSize: 17 }} disabled={busy || left > 0} onClick={pickup}>{busy ? <span className="spinner" /> : <Icon name="truck" />} {tr('استلمت الطلبية')}</button>
              </> })()}
          </>}
        </div>)}
    </div>
  )
}
