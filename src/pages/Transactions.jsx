import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { matches } from '../lib/docs'
import Icon from '../components/Icon.jsx'

const ST = {
  new: ['gray', 'جديدة'], submitted: ['amber', 'مقدّمة'], waiting: ['amber', 'بانتظار الجهة'], done: ['ok', 'خلصت'], cancelled: ['red', 'ملغية'],
}
const FLOW = ['new', 'submitted', 'waiting', 'done']
const AUTH = ['الهيئة العامة للقوى العاملة', 'وزارة الداخلية (الإقامات)', 'الهيئة العامة للمعلومات المدنية', 'البلدية', 'وزارة التجارة', 'الإطفاء العامة', 'الهيئة العامة للغذاء والتغذية', 'وزارة الصحة']
const daysSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 86400000))

function TxSheet({ tx, emps, branches, onClose, onSaved }) {
  const [f, setF] = useState({ title: tx?.title || '', authority: tx?.authority || '', employee_id: tx?.employee_id || '', branch_id: tx?.branch_id || '',
    due_date: tx?.due_date || '', fees: tx?.fees ?? 0, notes: tx?.notes || '', assigned_to: tx?.assigned_to || '' })
  const [events, setEvents] = useState([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  useEffect(() => { if (tx) supabase.from('gov_transaction_events').select('*,employees:by_employee(full_name)').eq('tx_id', tx.id).order('at').then(({ data }) => setEvents(data || [])) }, [tx])

  const row = () => ({ ...f, employee_id: f.employee_id || null, branch_id: f.branch_id || null, due_date: f.due_date || null, fees: Number(f.fees) || 0, notes: f.notes || null, authority: f.authority || null, assigned_to: f.assigned_to || null })
  const save = async (status) => {
    setErr('')
    if (!f.title.trim()) { setErr('اكتب عنوان المعاملة'); return }
    const patch = { ...row(), ...(status ? { status } : {}) }
    const q = tx ? supabase.from('gov_transactions').update(patch).eq('id', tx.id) : supabase.from('gov_transactions').insert(patch)
    const { error } = await q
    if (error) { setErr(errMsg(error)); return }
    if (tx && note.trim()) await supabase.from('gov_transaction_events').insert({ tx_id: tx.id, note: note.trim() })
    onSaved(); onClose()
  }
  const next = tx && FLOW[FLOW.indexOf(tx.status) + 1]

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{tx ? 'معاملة' : 'معاملة جديدة'}</h2>
          {tx && <span className={'pill ' + ST[tx.status][0]}>{ST[tx.status][1]}</span>}
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="tt">المعاملة</label><input id="tt" className="input" value={f.title} onChange={set('title')} placeholder="مثل: تجديد إقامة / تجديد رخصة البلدية" /></div>
        <div className="field"><label htmlFor="ta">الجهة</label><input id="ta" className="input" list="auths" value={f.authority} onChange={set('authority')} />
          <datalist id="auths">{AUTH.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="te">تخص موظف</label>
            <select id="te" className="input" value={f.employee_id} onChange={set('employee_id')}><option value="">—</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
          <div className="field"><label htmlFor="tb">أو تخص فرع</label>
            <select id="tb" className="input" value={f.branch_id} onChange={set('branch_id')}><option value="">—</option>{branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="field"><label htmlFor="td">لازم تخلص قبل</label><input id="td" type="date" className="input" value={f.due_date} onChange={set('due_date')} /></div>
          <div className="field"><label htmlFor="tf">الرسوم (د.ك)</label><input id="tf" type="number" step="0.001" min="0" className="input" value={f.fees} onChange={set('fees')} /></div>
        </div>
        <div className="field"><label htmlFor="tw">المسؤول</label>
          <select id="tw" className="input" value={f.assigned_to} onChange={set('assigned_to')}><option value="">—</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
        <div className="field"><label htmlFor="tn">ملاحظات</label><input id="tn" className="input" value={f.notes} onChange={set('notes')} /></div>
        {tx && <div className="field"><label htmlFor="tu">إضافة تحديث</label><input id="tu" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثل: قدّمنا الأوراق، ينتظرون الفحص الطبي" /></div>}
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {next && <button className="btn primary" onClick={() => save(next)}>{next === 'done' ? <><Icon name="check" /> خلصت</> : `نقلها لـ: ${ST[next][1]}`}</button>}
          <button className={'btn' + (next ? '' : ' primary')} onClick={() => save(null)}>حفظ</button>
          {tx && !['done', 'cancelled'].includes(tx.status) && <button className="btn danger" onClick={() => window.confirm('تلغي المعاملة؟') && save('cancelled')}>إلغاء المعاملة</button>}
          {tx && ['done', 'cancelled'].includes(tx.status) && <button className="btn" onClick={() => save('submitted')}>إعادة فتح</button>}
        </div>
        {next === 'done' && <div className="sub">بعد ما تخلص، ارفع المستند الجديد من صفحة {f.branch_id ? 'تراخيص الفروع' : 'مستندات الموظفين'} (زر تجديد) عشان التاريخ يتحدّث.</div>}
        {events.length > 0 && (
          <div><div className="sub" style={{ marginBottom: 4 }}>السجل</div>
            {events.map((e) => <div key={e.id} className="sub">• {fmtDate(e.at)} — {e.status ? ST[e.status]?.[1] : ''}{e.note ? `${e.status ? ' · ' : ''}${e.note}` : ''}{e.employees?.full_name ? ` (${e.employees.full_name})` : ''}</div>)}</div>)}
      </div>
    </div>
  )
}

export default function Transactions() {
  const [rows, setRows] = useState([])
  const [emps, setEmps] = useState([])
  const [branches, setBranches] = useState([])
  const [tab, setTab] = useState('open')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(undefined)

  const load = useCallback(() => {
    supabase.from('gov_transactions').select('*,employee:employee_id(full_name),branch:branch_id(name),owner:assigned_to(full_name)').order('created_at', { ascending: false }).then(({ data }) => setRows(data || []))
  }, [])
  useEffect(() => {
    load()
    supabase.from('employees').select('id,full_name').eq('active', true).order('full_name').then(({ data }) => setEmps(data || []))
    supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
  }, [load])

  const isOpen = (r) => !['done', 'cancelled'].includes(r.status)
  const flat = rows.map((r) => ({ ...r, who: r.employee?.full_name || r.branch?.name || '' }))
  const shown = flat.filter((r) => (tab === 'all' || (tab === 'open' ? isOpen(r) : !isOpen(r))) && matches(r, q, ['title', 'authority', 'who', 'notes']))
  const openCount = flat.filter(isOpen).length
  const fees = flat.filter((r) => r.status === 'done' && new Date(r.closed_at).getFullYear() === new Date().getFullYear()).reduce((s, r) => s + Number(r.fees || 0), 0)

  return (
    <div>
      <div className="page-head">
        <div><h1>المعاملات الحكومية</h1><div className="sub">متابعة شغل مندوب المعاملات: إقامات، رخص، تجديدات</div></div>
        <button className="btn primary" onClick={() => setOpen(null)}><Icon name="plus" /> معاملة جديدة</button>
      </div>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat primary"><div className="label">مفتوحة</div><div className="value">{openCount}</div></div>
        <div className="card stat"><div className="label">متأخرة عن موعدها</div><div className="value" style={{ color: 'var(--red)' }}>{flat.filter((r) => isOpen(r) && r.due_date && r.due_date < new Date().toISOString().slice(0, 10)).length}</div></div>
        <div className="card stat"><div className="label">رسوم المعاملات هالسنة</div><div className="value">{fees.toFixed(3)} <span style={{ fontSize: 14 }}>د.ك</span></div></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="chips">{[['open', 'المفتوحة'], ['closed', 'المنتهية'], ['all', 'الكل']].map(([k, t]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}</button>)}</div>
        <input className="input" style={{ maxWidth: 280, height: 42 }} placeholder="بحث…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {shown.length === 0 && <div className="empty">ما فيه معاملات</div>}
        {shown.map((r) => (
          <button key={r.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => setOpen(r)}>
            <span className="grow">
              <div style={{ fontWeight: 600 }}>{r.title}{r.who ? <span className="sub"> · {r.who}</span> : null}</div>
              <div className="sub">{[r.authority, `فتحت ${fmtDate(r.opened_at)}`, isOpen(r) ? `صار لها ${daysSince(r.opened_at)} يوم` : null, r.due_date ? `قبل ${fmtDate(r.due_date)}` : null, r.owner?.full_name].filter(Boolean).join(' · ')}</div>
            </span>
            <span className={'pill ' + ST[r.status][0]}>{ST[r.status][1]}</span>
          </button>
        ))}
      </div>
      {open !== undefined && <TxSheet tx={open} emps={emps} branches={branches} onClose={() => setOpen(undefined)} onSaved={load} />}
    </div>
  )
}
