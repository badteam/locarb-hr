import { useEffect, useState, useCallback } from 'react'
import { supabase, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'
import SignaturePad, { uploadSignature, SignatureImage } from '../components/SignaturePad.jsx'

const STATUS = { pending: ['amber', 'بانتظار الموافقة'], approved: ['ok', 'مقبولة'], rejected: ['red', 'مرفوضة'], cancelled: ['gray', 'ملغية'] }

function RequestForm({ types, balance, empId, onClose, onSaved }) {
  const [type, setType] = useState(types[0]?.id || '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [signed, setSigned] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const days = start && end ? Math.round((new Date(end) - new Date(start)) / 86400000) + 1 : 0
  const t = types.find((x) => x.id === type)

  const save = async (e) => {
    e.preventDefault()
    if (!signed) { setErr('لازم توقّع على الطلب'); return }
    setBusy(true); setErr('')
    try {
      const sig = await uploadSignature(empId)
      const { error } = await supabase.rpc('request_leave', { p_type: type, p_start: start, p_end: end, p_reason: reason || null, p_signature_path: sig })
      if (error) throw error
      onSaved(); onClose()
    } catch (e2) { setErr(e2.message?.includes('insufficient') ? 'رصيدك ما يكفي' : errMsg(e2)) }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>طلب إجازة</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="notice">رصيدك الحالي: <strong>{balance}</strong> يوم</div>
        <div className="field"><span className="lbl">نوع الإجازة</span>
          <div className="chips">{types.map((x) => <button type="button" key={x.id} className={'chip' + (type === x.id ? ' on' : '')} onClick={() => setType(x.id)}>{x.name}</button>)}</div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="ls">من</label><input id="ls" type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (!end || e.target.value > end) setEnd(e.target.value) }} required /></div>
          <div className="field"><label htmlFor="le">إلى</label><input id="le" type="date" className="input" min={start} value={end} onChange={(e) => setEnd(e.target.value)} required /></div>
        </div>
        {days > 0 && <div className="sub">{days} يوم {t?.deducts_balance ? '· تنخصم من الرصيد' : '· ما تنخصم من الرصيد'}</div>}
        <div className="field"><label htmlFor="lr">السبب</label><textarea id="lr" className="input" style={{ height: 80, paddingTop: 10 }} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <SignaturePad onChange={(empty) => setSigned(!empty)} />
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'جاري الإرسال…' : 'إرسال الطلب'}</button>
      </form>
    </div>
  )
}

export default function Leaves() {
  const { access, can, reload } = useAccess()
  const emp = access.employee
  const [types, setTypes] = useState([])
  const [mine, setMine] = useState([])
  const [pending, setPending] = useState([])
  const [names, setNames] = useState({})
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState({})
  const [msg, setMsg] = useState('')
  const isApprover = can('approve_leaves')

  const load = useCallback(() => {
    supabase.from('leave_requests').select('*').eq('employee_id', emp.id).order('created_at', { ascending: false }).then(({ data }) => setMine(data || []))
    if (isApprover) {
      supabase.from('leave_requests').select('*').neq('employee_id', emp.id).order('created_at', { ascending: false }).limit(100).then(({ data }) => setPending(data || []))
      supabase.from('employees').select('id,full_name,job_title,leave_balance').then(({ data }) => setNames(Object.fromEntries((data || []).map((e) => [e.id, e]))))
    }
  }, [emp.id, isApprover])
  useEffect(() => { load(); supabase.from('leave_types').select('*').order('sort_order').then(({ data }) => setTypes((data || []).filter((t) => t.name !== 'أوف'))) }, [load])
  const tName = Object.fromEntries(types.map((t) => [t.id, t.name]))

  const decide = async (id, ok) => {
    setMsg('')
    const { error } = await supabase.rpc('decide_leave', { p_request: id, p_approve: ok, p_note: note[id] || null })
    if (error) setMsg(error.message.includes('insufficient') ? 'رصيد الموظف ما يكفي' : errMsg(error)); else load()
  }
  const cancel = async (id) => { await supabase.rpc('cancel_leave', { p_request: id }); load() }

  const Row = ({ r, manager }) => {
    const [cls, txt] = STATUS[r.status]
    return (
      <div className="list-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>{manager ? `${names[r.employee_id]?.full_name || ''} · ` : ''}{tName[r.leave_type_id] || 'إجازة'} · {r.days} يوم</div>
          <div className="sub">{fmtDate(r.start_date)} ← {fmtDate(r.end_date)}</div>
          {r.reason && <div className="sub">السبب: {r.reason}</div>}
          {manager && <div className="sub">رصيده: {names[r.employee_id]?.leave_balance} يوم</div>}
          {r.decision_note && <div className="sub">ملاحظة الإدارة: {r.decision_note}</div>}
          {manager && r.signature_path && <div style={{ marginTop: 6 }}><SignatureImage path={r.signature_path} /></div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={'pill ' + cls}>{txt}</span>
          {manager && r.status === 'pending' && (
            <>
              <input className="input" style={{ height: 38, width: 200 }} placeholder="ملاحظة (اختياري)" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
              <div className="row" style={{ gap: 6 }}>
                <button className="btn primary" style={{ minHeight: 38 }} onClick={() => decide(r.id, true)}>موافقة</button>
                <button className="btn danger" style={{ minHeight: 38 }} onClick={() => decide(r.id, false)}>رفض</button>
              </div>
            </>
          )}
          {!manager && r.status === 'pending' && <button className="btn" style={{ minHeight: 36 }} onClick={() => cancel(r.id)}>إلغاء</button>}
        </div>
      </div>
    )
  }

  const waiting = pending.filter((r) => r.status === 'pending')
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>الإجازات</h1><div className="sub">رصيدك: {emp.leave_balance} يوم</div></div>
        <button className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" /> طلب إجازة</button>
      </div>
      {msg && <div className="error">{msg}</div>}
      {isApprover && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>طلبات تنتظر موافقتك {waiting.length > 0 && <span className="badge">{waiting.length}</span>}</h2>
          <div className="card list" style={{ padding: '4px 14px' }}>
            {waiting.length === 0 ? <div className="empty">ما فيه طلبات</div> : waiting.map((r) => <Row key={r.id} r={r} manager />)}
          </div>
        </section>
      )}
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>طلباتي</h2>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {mine.length === 0 ? <div className="empty">ما عندك طلبات</div> : mine.map((r) => <Row key={r.id} r={r} />)}
        </div>
      </section>
      {isApprover && pending.some((r) => r.status !== 'pending') && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>سجل الإجازات</h2>
          <div className="card list" style={{ padding: '4px 14px' }}>{pending.filter((r) => r.status !== 'pending').slice(0, 30).map((r) => <Row key={r.id} r={r} manager />)}</div>
        </section>
      )}
      {open && <RequestForm types={types} balance={emp.leave_balance} empId={emp.id} onClose={() => setOpen(false)} onSaved={() => { load(); reload() }} />}
    </div>
  )
}
