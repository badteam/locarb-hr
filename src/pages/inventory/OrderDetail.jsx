import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, selectAll } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { qtyFmt, kwd, ORDER_STATUS, invErr, itemNames, loadLookups, branchPieces, toPieces } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import ProductImage from '../../components/ProductImage.jsx'
import { qtySuspect, QtyWarn, KgHint } from '../../components/QtyCheck.jsx'

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
  const [okBig, setOkBig] = useState({})   // line id -> confirmed a very large number
  const [cats, setCats] = useState({})     // category id -> { order, name }
  const [changes, setChanges] = useState([])  // what the branch changed after sending
  const [ed, setEd] = useState(null)       // branch editing: { lines: {item_id: qty}, add: {item_id: item}, note, q }
  const [pick, setPick] = useState(null)   // items the branch may add while editing

  const load = useCallback(async () => {
    const { data } = await supabase.from('branch_requests')
      .select('*, branches:branch_id(name,name_en), creator:created_by(full_name), sender:dispatched_by(full_name), receiver:received_by(full_name), branch_request_lines(*, inv_items(name_ar,name_en,category_id,unit_pieces,unit_grams,branch_by_piece,inv_units(name,name_en)))')
      .eq('id', id).maybeSingle()
    if (!data) { setR(false); return }
    setR(data)
    const l0 = await loadLookups().catch(() => null)
    const cm = Object.fromEntries((l0?.categories || []).map((c, n) => [c.id, { order: c.sort_order ?? 1000 + n, name: c.name }]))
    setCats(cm)
    // kitchen shelf order: meat together, vegetables together … then by name
    const co = (l) => cm[l.inv_items?.category_id]?.order ?? 9999
    const ls = (data.branch_request_lines || []).sort((a, b) => co(a) - co(b) || a.inv_items.name_ar.localeCompare(b.inv_items.name_ar))
    setLines(ls)
    supabase.from('branch_request_changes').select('id,changed_at,changes,employees:changed_by(full_name)').eq('request_id', id).order('changed_at')
      .then(({ data: c }) => setChanges(c || []))
    setEdit(Object.fromEntries(ls.map((l) => [l.id, String(data.status === 'dispatched' ? (l.sent_qty ?? 0) : l.requested_qty)])))
    if (data.status === 'submitted') {
      const ids = ls.map((l) => l.item_id)
      supabase.from('inv_stock').select('id,kitchen_qty').in('id', ids).then(({ data: s }) => setKitchenQty(Object.fromEntries((s || []).map((x) => [x.id, x.kitchen_qty]))))
    }
  }, [id])
  useEffect(() => { loadLookups().catch(() => {}).finally(load) }, [load])
  // last change per item, to mark the lines the branch changed
  const changedItem = useMemo(() => {
    const m = {}
    for (const c of changes) for (const x of c.changes || []) if (x.item_id) m[x.item_id] = { old: x.old, new: x.new, at: c.changed_at }
    return m
  }, [changes])

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
  // grams typed into a kilo box: what is sent is checked against what was ordered, what arrived against what was sent
  const refOf = (l) => (canDispatch ? Number(l.requested_qty) : Number(l.sent_qty)) || 0
  const bigOf = (l) => qtySuspect(edit[l.id], refOf(l))
  const unconfirmed = () => lines.filter((l) => bigOf(l) && !okBig[l.id]).length
  const payload = (key) => lines.map((l) => ({ id: l.id, [key]: Number(edit[l.id]) || 0, ...(bigOf(l) ? { confirmed_large: true } : {}) }))
  const guard = () => { const n = unconfirmed(); if (n) setErr(tr('فيه {n} رقم كبير وايد. صلّحه أو أكّد إنه صحيح.', { n })); return !n }
  const dispatch = async () => {
    if (!guard()) return
    // the branch may have changed the order since this page was opened
    const { data: fresh } = await supabase.from('branch_requests').select('updated_at,status').eq('id', id).maybeSingle()
    if (fresh && (fresh.updated_at !== r.updated_at || fresh.status !== r.status)) {
      await load(); setErr(tr('الفرع عدّل الطلب الحين. راجع الكميات الجديدة وبعدين اضغط "موافقة وإرسال" مرة ثانية.')); return
    }
    const d = await act('dispatch', () => supabase.rpc('dispatch_branch_request', { p_id: id, p_lines: payload('sent_qty'), p_note: note || null }))
    if (d) setMsg(tr('انرسل {n} صنف بقيمة {v} د.ك وانخصم من مخزون المطبخ', { n: d.lines, v: kwd(d.value) }))
  }
  const receive = async () => {
    if (!guard()) return
    const d = await act('receive', () => supabase.rpc('receive_branch_request', { p_id: id, p_lines: payload('received_qty'), p_note: note || null }))
    if (d) setMsg(d.differences?.length ? tr('انستلم، والفروقات انرسلت للمطبخ') : tr('انستلم كامل وانضاف لمخزون الفرع'))
  }
  const reject = () => act('reject', () => supabase.rpc('reject_branch_request', { p_id: id, p_note: note || null })).then(() => setRejecting(false))
  const cancel = () => window.confirm(tr('تلغي الطلب؟')) && act('cancel', () => supabase.rpc('cancel_branch_request', { p_id: id }))

  const canChange = r.status === 'submitted' && branchSide && !kitchen
  const startEdit = () => {
    setErr(''); setMsg('')
    setEd({ lines: Object.fromEntries(lines.map((l) => [l.item_id, String(l.requested_qty)])), add: {}, note: r.note || '', q: '' })
    if (!pick) {
      Promise.all([
        selectAll(() => supabase.from('inv_stock').select('id,name_ar,name_en,unit,category_id').eq('active', true).order('name_ar').order('id')),
        selectAll(() => supabase.from('inv_items').select('id,branch_order').neq('branch_order', 'open').order('id')).catch(() => []),
      ]).then(([it, rules]) => { const no = new Set((rules || []).map((x) => x.id)); setPick((it || []).filter((i) => !no.has(i.id))) })
    }
  }
  const saveEdit = async () => {
    const all = [...lines.map((l) => ({ item_id: l.item_id, qty: Number(ed.lines[l.item_id]) || 0 })),
      ...Object.keys(ed.add).map((iid) => ({ item_id: iid, qty: Number(ed.lines[iid]) || 0 }))]
    if (!all.some((x) => x.qty > 0)) { setErr(tr('الطلب صار فاضي. لو ما تبونه الغوه بدال ما تمسحون كل الأصناف')); return }
    const d = await act('edit', () => supabase.rpc('edit_branch_request', { p_id: id, p_lines: all, p_note: ed.note }))
    if (d) { setEd(null); setMsg(d.changes ? tr('انحفظ التعديل وانرسل تنبيه للمطبخ بالتغييرات') : tr('ما فيه تغيير')) }
  }
  const pickList = ed && pick && ed.q.trim() ? pick.filter((i) => !lines.some((l) => l.item_id === i.id) && !ed.add[i.id] &&
    (i.name_ar.toLowerCase().includes(ed.q.trim().toLowerCase()) || (i.name_en || '').toLowerCase().includes(ed.q.trim().toLowerCase()))).slice(0, 12) : []
  const fmtQ = (v) => (v == null ? '—' : qtyFmt(v))

  const editable = (canDispatch || canReceive) && !ed
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
      {r.status === 'dispatched' && r.picked_up_at && <div className="notice" style={{ marginBottom: 12 }}>🚚 {tr('السواق استلمها من المطبخ')} · {fmtDate(r.picked_up_at)}{r.pickup_note ? ` · ${r.pickup_note}` : ''}</div>}
      {r.status === 'received' && <div className="notice" style={{ marginBottom: 12 }}>{tr('استلمها {n}', { n: r.receiver?.full_name || tr('الفرع') })} · {fmtDate(r.received_at)}{r.receive_note ? ` · ${r.receive_note}` : ''}</div>}
      {r.status === 'rejected' && <div className="error" style={{ marginBottom: 12 }}>{tr('انرفض')}{r.decision_note ? `: ${r.decision_note}` : ''}</div>}
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {canDispatch && <div className="sub" style={{ marginBottom: 8 }}>{tr('عدّل الكمية اللي بترسلها لو تختلف عن المطلوب، وبعدين اضغط "موافقة وإرسال".')}</div>}
      {canReceive && <div className="sub" style={{ marginBottom: 8 }}>{tr('عدّ اللي وصل فعلاً. لو فيه نقص اكتب الكمية الصحيحة.')}</div>}

      <div className="order-list">
        {lines.map((l, k) => {
          const unit = tr(l.inv_items?.inv_units?.name || '')
          const kq = kitchenQty[l.item_id]
          const short = canDispatch && kq != null && Number(kq) < Number(edit[l.id] || 0)
          const diff = r.status === 'received' && l.received_qty != null && Number(l.received_qty) !== Number(l.sent_qty)
          const [n1, n2] = itemNames(l.inv_items, lang)
          const ch = changedItem[l.item_id]
          const head = (k === 0 || lines[k - 1].inv_items?.category_id !== l.inv_items?.category_id) &&
            <div className="sub" style={{ fontWeight: 700, padding: '6px 2px 0' }}>{tn(cats[l.inv_items?.category_id]?.name) || tr('بدون تصنيف')}</div>
          return (<div key={l.id} style={{ display: 'contents' }}>{head}
            <div className="order-row" style={diff ? { borderColor: '#F3DDA8' } : ch && r.status === 'submitted' ? { borderColor: '#9CC3E6' } : undefined}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <ProductImage itemId={l.item_id} size={48} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{n1}</div>{n2 && <div className="cell-sub">{n2}</div>}
                  <div className="cell-sub">
                    {l.on_hand != null ? `${tr('عندهم {n}', { n: branchPieces({ ...l.inv_items, unit: l.inv_items?.inv_units?.name }, false) ? `${qtyFmt(toPieces(l.on_hand, branchPieces({ ...l.inv_items, unit: l.inv_items?.inv_units?.name }, false)))} ${tr('حبة')}` : qtyFmt(l.on_hand) })} · ` : ''}{tr('طلبوا {n}', { n: qtyFmt(l.requested_qty) })} {unit}
                    {l.sent_qty != null ? ` · ${tr('انرسل {n}', { n: qtyFmt(l.sent_qty) })}` : ''}{l.picked_qty != null && Number(l.picked_qty) !== Number(l.sent_qty) ? ` · ${tr('السواق استلم {n}', { n: qtyFmt(l.picked_qty) })}` : ''}{l.received_qty != null ? ` · ${tr('وصل {n}', { n: qtyFmt(l.received_qty) })}` : ''}
                    {canDispatch && kq != null ? ` · ${tr('في المطبخ {n}', { n: qtyFmt(kq) })}` : ''}</div>
                </div>
                {ch && r.status === 'submitted' && <span className="pill blue" title={tr('تعديل الفرع')}>{ch.old == null ? tr('انضاف') : tr('كان {n}', { n: fmtQ(ch.old) })}</span>}
                {short && <span className="pill amber">{tr('المطبخ ما يكفي')}</span>}
                {diff && <span className="pill amber">{tr('فرق')}</span>}
              </div>
              {editable && (
                <div className="row" style={{ gap: 10 }}>
                  <label className="sub grow" htmlFor={`q-${l.id}`}>{canDispatch ? tr('بترسل') : tr('وصل فعلاً')} ({unit})</label>
                  <input id={`q-${l.id}`} className="input num" style={{ width: 120, height: 44 }} inputMode="decimal" value={edit[l.id] ?? ''}
                    onChange={(e) => { setEdit({ ...edit, [l.id]: e.target.value.replace(/[^\d.]/g, '') }); setOkBig({ ...okBig, [l.id]: false }) }} />
                </div>
              )}
              {editable && <KgHint item={{ ...l.inv_items, unit: l.inv_items?.inv_units?.name }} tr={tr} />}
              {editable && bigOf(l) && <QtyWarn tr={tr} item={{ ...l.inv_items, unit: l.inv_items?.inv_units?.name }} unit={unit} value={edit[l.id]} expected={refOf(l)}
                confirmed={okBig[l.id]} onFix={(v) => { setEdit({ ...edit, [l.id]: v }); setOkBig({ ...okBig, [l.id]: false }) }} onConfirm={(ok) => setOkBig({ ...okBig, [l.id]: ok })} />}
              {ed && (
                <div className="row" style={{ gap: 10 }}>
                  <label className="sub grow" htmlFor={`e-${l.id}`}>{tr('الكمية المطلوبة')} ({unit})</label>
                  <input id={`e-${l.id}`} className="input num" style={{ width: 110, height: 44 }} inputMode="decimal" value={ed.lines[l.item_id] ?? ''}
                    onChange={(e) => setEd({ ...ed, lines: { ...ed.lines, [l.item_id]: e.target.value.replace(/[^\d.]/g, '') } })} />
                  <button type="button" className="btn" style={{ minHeight: 44 }} aria-label={tr('شيله من الطلب')} onClick={() => setEd({ ...ed, lines: { ...ed.lines, [l.item_id]: '0' } })}><Icon name="x" /></button>
                </div>)}
            </div></div>
          )
        })}
      </div>

      {ed && (
        <div className="card form" style={{ marginTop: 14, gap: 10 }}>
          {Object.values(ed.add).map((i) => (
            <div key={i.id} className="row" style={{ gap: 10 }}>
              <span className="grow">{itemNames(i, lang)[0]} <span className="pill blue">{tr('جديد')}</span></span>
              <input className="input num" style={{ width: 110, height: 44 }} inputMode="decimal" value={ed.lines[i.id] ?? ''} placeholder="0" aria-label={itemNames(i, lang)[0]}
                onChange={(e) => setEd({ ...ed, lines: { ...ed.lines, [i.id]: e.target.value.replace(/[^\d.]/g, '') } })} />
              <span className="sub">{tn(i.unit || '')}</span>
              <button type="button" className="btn" style={{ minHeight: 44 }} aria-label={tr('شيله من الطلب')} onClick={() => { const a = { ...ed.add }; delete a[i.id]; setEd({ ...ed, add: a }) }}><Icon name="x" /></button>
            </div>))}
          <div className="search"><Icon name="search" size={18} /><input className="input" placeholder={tr('أضف صنف للطلب')} value={ed.q} onChange={(e) => setEd({ ...ed, q: e.target.value })} /></div>
          {pickList.map((i) => (
            <button key={i.id} type="button" className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => setEd({ ...ed, q: '', add: { ...ed.add, [i.id]: i } })}>
              + {itemNames(i, lang)[0]} <span className="sub">{tn(i.unit || '')}</span></button>))}
          <div className="field"><label htmlFor="en">{tr('ملاحظة للمطبخ (اختياري)')}</label><input id="en" className="input" value={ed.note} onChange={(e) => setEd({ ...ed, note: e.target.value })} /></div>
          <button className="btn primary block" disabled={!!busy} onClick={saveEdit}>{busy === 'edit' ? <span className="spinner" /> : <Icon name="check" />} {tr('احفظ التعديل وبلّغ المطبخ')}</button>
          <button className="btn" disabled={!!busy} onClick={() => setEd(null)}>{tr('إلغاء التعديل')}</button>
        </div>)}

      {changes.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <strong style={{ fontSize: 14 }}>{tr('تعديلات الفرع بعد الإرسال')}</strong>
          {changes.map((c) => (
            <div key={c.id} style={{ marginTop: 8 }}>
              <div className="sub">{c.employees?.full_name ? `${c.employees.full_name} · ` : ''}{fmtDate(c.changed_at)} {fmtTime(c.changed_at)}</div>
              <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                {(c.changes || []).map((x, j) => <li key={j}>{x.item_id
                  ? (x.old == null ? tr('أضاف {n}: {q}', { n: x.name, q: fmtQ(x.new) }) : Number(x.new) === 0 ? tr('شال {n} (كان {q})', { n: x.name, q: fmtQ(x.old) }) : tr('{n}: {a} ← {b}', { n: x.name, a: fmtQ(x.old), b: fmtQ(x.new) }))
                  : tr('غيّر الملاحظة: {t}', { t: x.note || tr('(انمسحت)') })}{x.unit && x.item_id && Number(x.new) !== 0 ? ` ${tn(x.unit)}` : ''}</li>)}
              </ul>
            </div>))}
        </div>)}

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
      {canChange && !ed && <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={!!busy} onClick={startEdit}><Icon name="list" /> {tr('عدّل الطلب')}</button>
        <button className="btn danger" disabled={!!busy} onClick={cancel}>{tr('إلغاء الطلب')}</button>
        <span className="sub" style={{ alignSelf: 'center' }}>{tr('تقدرون تعدلون لين ما المطبخ يرسل الطلب')}</span></div>}

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
