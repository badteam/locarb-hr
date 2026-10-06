import { useEffect, useState, useCallback } from 'react'
import { supabase, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const KINDS = [
  { k: 'attended', t: 'حضرت ونسيت أبصم' },
  { k: 'missed_checkout', t: 'بصمت حضور ونسيت الانصراف' },
  { k: 'leave', t: 'كنت إجازة' },
  { k: 'sick', t: 'كنت مرضي' },
  { k: 'day_off', t: 'كان يوم أوف' },
]
const kindText = Object.fromEntries(KINDS.map((x) => [x.k, x.t]))
const STATUS = { pending: ['amber', 'بانتظار الموافقة'], approved: ['ok', 'مقبول'], rejected: ['red', 'مرفوض'] }

function RequestForm({ date, defaultKind, onClose, onSaved }) {
  const [d, setD] = useState(date || '')
  const [kind, setKind] = useState(defaultKind || 'attended')
  const [tin, setTin] = useState('')
  const [tout, setTout] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.rpc('request_punch_correction', {
      p_date: d, p_kind: kind, p_in: kind === 'attended' ? tin : null, p_out: ['attended', 'missed_checkout'].includes(kind) ? tout : null, p_reason: reason || null,
    })
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>طلب نسيان بصمة</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="cd">التاريخ</label><input id="cd" type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} required /></div>
        <div className="field"><span className="lbl">وش صار؟</span>
          <div className="chips">{KINDS.map((x) => <button type="button" key={x.k} className={'chip' + (kind === x.k ? ' on' : '')} onClick={() => setKind(x.k)}>{x.t}</button>)}</div>
        </div>
        {['attended', 'missed_checkout'].includes(kind) && (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {kind === 'attended' && <div className="field"><label htmlFor="ti">وقت الحضور</label><input id="ti" type="time" className="input" value={tin} onChange={(e) => setTin(e.target.value)} required /></div>}
            <div className="field"><label htmlFor="to">وقت الانصراف</label><input id="to" type="time" className="input" value={tout} onChange={(e) => setTout(e.target.value)} required /></div>
          </div>
        )}
        {kind === 'leave' && <div className="sub">يوم واحد ينخصم من رصيد إجازاتك لو انقبل الطلب.</div>}
        <div className="field"><label htmlFor="cr">السبب</label><textarea id="cr" className="input" style={{ height: 80, paddingTop: 10 }} value={reason} onChange={(e) => setReason(e.target.value)} required /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>إرسال الطلب</button>
      </form>
    </div>
  )
}

export default function Corrections() {
  const { access, can } = useAccess()
  const emp = access.employee
  const isHr = can('manage_attendance')
  const [mine, setMine] = useState([])
  const [myMissed, setMyMissed] = useState([])
  const [all, setAll] = useState([])
  const [missed, setMissed] = useState([])
  const [names, setNames] = useState({})
  const [form, setForm] = useState(null)
  const [note, setNote] = useState({})
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    supabase.from('punch_corrections').select('*').eq('employee_id', emp.id).order('created_at', { ascending: false }).then(({ data }) => setMine(data || []))
    supabase.from('missed_punches').select('*').eq('employee_id', emp.id).eq('resolved', false).order('work_date', { ascending: false }).then(({ data }) => setMyMissed(data || []))
    if (isHr) {
      supabase.from('punch_corrections').select('*').neq('employee_id', emp.id).order('created_at', { ascending: false }).limit(100).then(({ data }) => setAll(data || []))
      supabase.from('missed_punches').select('*').eq('resolved', false).neq('employee_id', emp.id).order('work_date', { ascending: false }).limit(100).then(({ data }) => setMissed(data || []))
      supabase.from('employees').select('id,full_name,job_title').then(({ data }) => setNames(Object.fromEntries((data || []).map((e) => [e.id, e]))))
    }
  }, [emp.id, isHr])
  useEffect(() => { load() }, [load])

  const decide = async (id, ok) => {
    setMsg('')
    const { error } = await supabase.rpc('decide_punch_correction', { p_id: id, p_approve: ok, p_note: note[id] || null })
    if (error) setMsg(error.message.includes('insufficient') ? 'رصيد الموظف ما يكفي لإجازة' : errMsg(error)); else load()
  }
  const resolve = async (id) => { await supabase.from('missed_punches').update({ resolved: true }).eq('id', id); load() }

  const Row = ({ r, manager }) => {
    const [cls, txt] = STATUS[r.status]
    return (
      <div className="list-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>{manager ? `${names[r.employee_id]?.full_name || ''} · ` : ''}{fmtDate(r.work_date)}</div>
          <div className="sub">{kindText[r.kind]}{r.check_in_time ? ` · حضور ${r.check_in_time.slice(0, 5)}` : ''}{r.check_out_time ? ` · انصراف ${r.check_out_time.slice(0, 5)}` : ''}</div>
          {r.reason && <div className="sub">السبب: {r.reason}</div>}
          {r.decision_note && <div className="sub">ملاحظة الإدارة: {r.decision_note}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={'pill ' + cls}>{txt}</span>
          {manager && r.status === 'pending' && (
            <>
              <input className="input" style={{ height: 38, width: 200 }} placeholder="ملاحظة (اختياري)" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
              <div className="row" style={{ gap: 6 }}>
                <button className="btn primary" style={{ minHeight: 38 }} onClick={() => decide(r.id, true)}>قبول</button>
                <button className="btn danger" style={{ minHeight: 38 }} onClick={() => decide(r.id, false)}>رفض</button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const waiting = all.filter((r) => r.status === 'pending')
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>نسيان البصمة</h1><div className="sub">لو نسيت تبصم حضور أو انصراف، أرسل طلب للإدارة</div></div>
        <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" /> طلب جديد</button>
      </div>
      {msg && <div className="error">{msg}</div>}

      {myMissed.length > 0 && (
        <section className="card" style={{ background: 'var(--amber-bg)', borderColor: '#F3DDA8' }}>
          <strong style={{ color: '#78350F' }}>بصمات ناقصة عندك</strong>
          <div className="list" style={{ marginTop: 6 }}>
            {myMissed.map((m) => (
              <div key={m.id} className="list-item">
                <div className="grow">{fmtDate(m.work_date)} · {m.kind === 'no_punch' ? 'ما فيه بصمة' : 'ما فيه انصراف'}</div>
                <button className="btn" style={{ minHeight: 38 }} onClick={() => setForm({ date: m.work_date, kind: m.kind === 'no_checkout' ? 'missed_checkout' : 'attended' })}>أرسل طلب</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {isHr && (
        <>
          <section>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>طلبات تنتظر موافقتك {waiting.length > 0 && <span className="badge">{waiting.length}</span>}</h2>
            <div className="card list" style={{ padding: '4px 14px' }}>{waiting.length === 0 ? <div className="empty">ما فيه طلبات</div> : waiting.map((r) => <Row key={r.id} r={r} manager />)}</div>
          </section>
          <section>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>بصمات ناقصة بدون طلب</h2>
            <div className="card list" style={{ padding: '4px 14px' }}>
              {missed.length === 0 ? <div className="empty">ما فيه بصمات ناقصة ✓</div> : missed.map((m) => (
                <div key={m.id} className="list-item">
                  <div className="grow"><div style={{ fontWeight: 600 }}>{names[m.employee_id]?.full_name}</div>
                    <div className="sub">{fmtDate(m.work_date)} · {m.kind === 'no_punch' ? 'ما بصم أبد' : 'بصم حضور بدون انصراف'}</div></div>
                  <a className="btn" style={{ minHeight: 38 }} href={`${import.meta.env.BASE_URL}attendance`}>تعديل البصمة</a>
                  <button className="btn" style={{ minHeight: 38 }} onClick={() => resolve(m.id)}>تم</button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>طلباتي</h2>
        <div className="card list" style={{ padding: '4px 14px' }}>{mine.length === 0 ? <div className="empty">ما عندك طلبات</div> : mine.map((r) => <Row key={r.id} r={r} />)}</div>
      </section>
      {form && <RequestForm date={form.date} defaultKind={form.kind} onClose={() => setForm(null)} onSaved={load} />}
    </div>
  )
}
