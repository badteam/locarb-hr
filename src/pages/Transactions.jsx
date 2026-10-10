import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { matches, ext } from '../lib/docs'
import { uploadAttachment, readFile, readError, copyFile, openFile, ACCEPT } from '../lib/ai'
import ReviewSheet from '../components/ReviewSheet.jsx'
import Icon from '../components/Icon.jsx'

const ST = {
  new: ['gray', 'جديدة'], submitted: ['amber', 'مقدّمة'], waiting: ['amber', 'بانتظار الجهة'], done: ['ok', 'خلصت'], cancelled: ['red', 'ملغية'],
}
const FLOW = ['new', 'submitted', 'waiting', 'done']
const AUTH = ['الهيئة العامة للقوى العاملة', 'وزارة الداخلية (الإقامات)', 'الهيئة العامة للمعلومات المدنية', 'البلدية', 'وزارة التجارة', 'الإطفاء العامة', 'الهيئة العامة للغذاء والتغذية', 'وزارة الصحة']
const KIND = { receipt: 'إيصال', application: 'طلب مقدّم', appointment: 'موعد', new_document: 'المستند الجديد', letter: 'كتاب / رسالة', other: 'ورقة' }
const daysSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 86400000))
const fold = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()

// register a paper that is itself the renewed document as a new (pending) employee or branch document
async function registerDocument(file) {
  const a = file.ai_data || {}, m = a.match || {}
  const isBranch = !!m.branch_document || (!!m.branch && !m.employee)
  const scope = isBranch ? 'branch' : 'employee'
  const { data: types } = await supabase.from('document_types').select('id,name,default_remind_days').eq('scope', scope)
  let typeId = null, replaces = null
  const old = isBranch ? m.branch_document : m.employee_document
  if (old) {
    const { data } = await supabase.from(isBranch ? 'branch_documents' : 'employee_documents').select('id,document_type_id').eq('id', old.id).maybeSingle()
    if (data) { replaces = data.id; typeId = data.document_type_id }
  }
  if (!typeId && a.document_type) typeId = (types || []).find((t) => fold(t.name).includes(fold(a.document_type)) || fold(a.document_type).includes(fold(t.name)))?.id || null
  const type = (types || []).find((t) => t.id === typeId)
  const base = {
    document_type_id: typeId, document_number: a.document_number || null, issue_date: a.issue_date || null, expiry_date: a.expiry_date || null,
    replaces_id: replaces, review_status: 'pending', ai_status: 'done', ai_data: a,
    review_fields: [!a.expiry_date && 'expiry_date', !typeId && 'document_type'].filter(Boolean),
    remind_days_before: type?.default_remind_days || (isBranch ? 60 : 30),
  }
  const e = ext({ type: file.path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', name: file.path })
  if (isBranch) {
    const path = await copyFile('attachments', file.path, 'branch-docs', `${m.branch.id}/${crypto.randomUUID()}.${e}`)
    const { data, error } = await supabase.from('branch_documents').insert({ ...base, branch_id: m.branch.id, file_paths: [path] }).select('id').single()
    if (error) throw error
    return { kind: 'branch', id: data.id }
  }
  const path = await copyFile('attachments', file.path, 'employee-docs', `${m.employee.id}/${crypto.randomUUID()}-front.${e}`)
  const { data, error } = await supabase.from('employee_documents').insert({ ...base, employee_id: m.employee.id, front_image_path: path }).select('id').single()
  if (error) throw error
  return { kind: 'employee', id: data.id }
}

function FileRow({ file, onRegister }) {
  const a = file.ai_data || {}, m = a.match || {}
  const canRegister = a.doc_kind === 'new_document' && (m.employee || m.branch)
  return (
    <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="pill gray">{KIND[a.doc_kind] || 'ورقة'}</span>
        <span className="grow" style={{ fontWeight: 500 }}>{a.summary_ar || file.file_name || 'مرفق'}</span>
        <button type="button" className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', file.path)}>فتح</button>
      </div>
      <div className="sub">{[a.reference_no && `رقم: ${a.reference_no}`, a.fees ? `رسوم: ${Number(a.fees).toFixed(3)} د.ك` : null, a.date && fmtDate(a.date),
        a.appointment_date && `موعد: ${fmtDate(a.appointment_date)}`, a.expiry_date && `ينتهي: ${fmtDate(a.expiry_date)}`,
        m.employee && `الموظف: ${m.employee.name}`, m.branch && `الفرع: ${m.branch.name}`].filter(Boolean).join(' · ')}</div>
      {a.error && <div className="sub" style={{ color: 'var(--red)' }}>{a.error}</div>}
      {canRegister && onRegister && (
        <button type="button" className="btn primary" style={{ minHeight: 36, alignSelf: 'flex-start' }} onClick={() => onRegister(file)}>
          <Icon name="check" /> هذا {a.document_type || 'المستند'} الجديد لـ {m.employee?.name || m.branch?.name}: سجّله {(m.employee_document || m.branch_document) ? 'تجديد للقديم' : 'كمستند'}
        </button>)}
    </div>
  )
}

function TxSheet({ tx, emps, branches, autoPick, onClose, onSaved }) {
  const { access } = useAccess()
  const [f, setF] = useState({ title: tx?.title || '', authority: tx?.authority || '', employee_id: tx?.employee_id || '', branch_id: tx?.branch_id || '',
    due_date: tx?.due_date || '', fees: tx?.fees ?? 0, notes: tx?.notes || '', assigned_to: tx?.assigned_to || '' })
  const [events, setEvents] = useState([])
  const [files, setFiles] = useState([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [reading, setReading] = useState(0)
  const [review, setReview] = useState(null)
  const pick = useRef(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const loadFiles = useCallback(() => { if (tx) supabase.from('gov_transaction_files').select('*').eq('tx_id', tx.id).order('created_at').then(({ data }) => setFiles(data || [])) }, [tx])
  useEffect(() => {
    if (tx) supabase.from('gov_transaction_events').select('*,employees:by_employee(full_name)').eq('tx_id', tx.id).order('at').then(({ data }) => setEvents(data || []))
    loadFiles()
  }, [tx, loadFiles])
  useEffect(() => { if (autoPick) setTimeout(() => pick.current?.click(), 50) }, [autoPick])

  const onPick = async (list) => {
    setErr(''); setInfo('')
    for (const file of list) {
      setReading((n) => n + 1)
      try {
        const path = await uploadAttachment(file, access.employee.id)
        const r = await readFile('transaction', [path])
        const ai = r.ok ? { ...r.data, match: r.match } : { error: readError(r) }
        const row = { path, file_name: file.name, ai_data: ai }
        if (tx) await supabase.from('gov_transaction_files').insert({ tx_id: tx.id, ...row })
        setFiles((x) => [...x, { ...row, id: path }])
        if (r.ok) {
          const d = r.data, m = r.match || {}
          setF((cur) => ({
            ...cur,
            title: cur.title || d.title_ar || '',
            authority: cur.authority || d.authority || '',
            employee_id: cur.employee_id || (!cur.branch_id && m.employee?.id) || '',
            branch_id: cur.branch_id || (!cur.employee_id && !m.employee && m.branch?.id) || '',
            due_date: cur.due_date || d.appointment_date || '',
            fees: d.doc_kind === 'receipt' && Number(d.fees) > 0 ? Math.round((Number(cur.fees || 0) + Number(d.fees)) * 1000) / 1000 : cur.fees,
          }))
          if (d.doc_kind === 'receipt' && Number(d.fees) > 0) setInfo(`انضاف ${Number(d.fees).toFixed(3)} د.ك للرسوم من الإيصال`)
        }
      } catch (e) { setErr(errMsg(e)) }
      setReading((n) => n - 1)
    }
  }

  const row = () => ({ ...f, employee_id: f.employee_id || null, branch_id: f.branch_id || null, due_date: f.due_date || null, fees: Number(f.fees) || 0, notes: f.notes || null, authority: f.authority || null, assigned_to: f.assigned_to || null })
  const save = async (status, extra = {}) => {
    setErr('')
    if (!f.title.trim()) { setErr('اكتب عنوان المعاملة'); return null }
    const patch = { ...row(), ...(status ? { status } : {}), ...extra }
    const { data, error } = tx ? await supabase.from('gov_transactions').update(patch).eq('id', tx.id).select().single()
      : await supabase.from('gov_transactions').insert(patch).select().single()
    if (error) { setErr(errMsg(error)); return null }
    if (!tx && files.length) await supabase.from('gov_transaction_files').insert(files.map(({ path, file_name, ai_data }) => ({ tx_id: data.id, path, file_name, ai_data })))
    if (tx && note.trim()) await supabase.from('gov_transaction_events').insert({ tx_id: tx.id, note: note.trim() })
    onSaved()
    return data
  }
  const saveClose = async (status) => { if (await save(status)) onClose() }

  const register = async (file) => {
    setErr('')
    try {
      const doc = await registerDocument(file)
      const saved = await save('done', doc.kind === 'branch' ? { branch_document_id: doc.id } : { employee_document_id: doc.id })
      if (saved) { await supabase.from('gov_transaction_events').insert({ tx_id: saved.id, note: 'انرفع المستند الجديد — راجعه واعتمده' }); setReview(doc) }
    } catch (e) { setErr(errMsg(e)) }
  }
  const next = tx && FLOW[FLOW.indexOf(tx.status) + 1]

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !reading && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{tx ? 'معاملة' : 'معاملة جديدة'}</h2>
          {tx && <span className={'pill ' + ST[tx.status][0]}>{ST[tx.status][1]}</span>}
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>

        <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: '#F7F9F5' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <strong className="grow">الأوراق والصور</strong>
            <label className="btn" style={{ minHeight: 38 }}>
              {reading ? <><span className="spinner" /> جاري القراءة…</> : <><Icon name="camera" /> رفع صورة أو مستند</>}
              <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { onPick([...e.target.files]); e.target.value = '' }} />
            </label>
          </div>
          <div className="sub">إيصال، طلب، موعد، أو المستند الجديد نفسه. الذكاء الاصطناعي يقراه ويعبّي المعاملة.</div>
          {files.map((x) => <FileRow key={x.id} file={x} onRegister={register} />)}
          {info && <div className="notice">{info}</div>}
        </div>

        <div className="field"><label htmlFor="tt">المعاملة</label><input id="tt" className="input" value={f.title} onChange={set('title')} placeholder="مثل: تجديد إقامة / تجديد رخصة البلدية" /></div>
        <div className="field"><label htmlFor="ta">الجهة</label><input id="ta" className="input" list="auths" value={f.authority} onChange={set('authority')} />
          <datalist id="auths">{AUTH.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="te">تخص موظف</label>
            <select id="te" className="input" value={f.employee_id} onChange={set('employee_id')}><option value="">—</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
          <div className="field"><label htmlFor="tb">أو تخص فرع</label>
            <select id="tb" className="input" value={f.branch_id} onChange={set('branch_id')}><option value="">—</option>{branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="field"><label htmlFor="td">لازم تخلص قبل / الموعد</label><input id="td" type="date" className="input" value={f.due_date} onChange={set('due_date')} /></div>
          <div className="field"><label htmlFor="tf">الرسوم (د.ك)</label><input id="tf" type="number" step="0.001" min="0" className="input" value={f.fees} onChange={set('fees')} /></div>
        </div>
        <div className="field"><label htmlFor="tw">المسؤول</label>
          <select id="tw" className="input" value={f.assigned_to} onChange={set('assigned_to')}><option value="">—</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
        <div className="field"><label htmlFor="tn">ملاحظات</label><input id="tn" className="input" value={f.notes} onChange={set('notes')} /></div>
        {tx && <div className="field"><label htmlFor="tu">إضافة تحديث</label><input id="tu" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثل: قدّمنا الأوراق، ينتظرون الفحص الطبي" /></div>}
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {next && <button className="btn primary" disabled={!!reading} onClick={() => saveClose(next)}>{next === 'done' ? <><Icon name="check" /> خلصت</> : `نقلها لـ: ${ST[next][1]}`}</button>}
          <button className={'btn' + (next ? '' : ' primary')} disabled={!!reading} onClick={() => saveClose(null)}>حفظ</button>
          {tx && !['done', 'cancelled'].includes(tx.status) && <button className="btn danger" onClick={() => window.confirm('تلغي المعاملة؟') && saveClose('cancelled')}>إلغاء المعاملة</button>}
          {tx && ['done', 'cancelled'].includes(tx.status) && <button className="btn" onClick={() => saveClose('submitted')}>إعادة فتح</button>}
        </div>
        {events.length > 0 && (
          <div><div className="sub" style={{ marginBottom: 4 }}>السجل</div>
            {events.map((e) => <div key={e.id} className="sub">• {fmtDate(e.at)} — {e.status ? ST[e.status]?.[1] : ''}{e.note ? `${e.status ? ' · ' : ''}${e.note}` : ''}{e.employees?.full_name ? ` (${e.employees.full_name})` : ''}</div>)}</div>)}
      </div>
      {review && <ReviewSheet kind={review.kind} docId={review.id} onClose={() => { setReview(null); onClose() }} onSaved={onSaved} />}
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
    supabase.from('gov_transactions').select('*,employee:employee_id(full_name),branch:branch_id(name),owner:assigned_to(full_name),gov_transaction_files(ai_data)').order('created_at', { ascending: false }).then(({ data }) => setRows(data || []))
  }, [])
  useEffect(() => {
    load()
    supabase.from('employees').select('id,full_name').eq('active', true).order('full_name').then(({ data }) => setEmps(data || []))
    supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
  }, [load])

  const isOpen = (r) => !['done', 'cancelled'].includes(r.status)
  const flat = rows.map((r) => ({ ...r, who: r.employee?.full_name || r.branch?.name || '',
    filetext: (r.gov_transaction_files || []).map((x) => [x.ai_data?.summary_ar, x.ai_data?.reference_no, x.ai_data?.person_name].join(' ')).join(' ') }))
  const shown = flat.filter((r) => (tab === 'all' || (tab === 'open' ? isOpen(r) : !isOpen(r))) && matches(r, q, ['title', 'authority', 'who', 'notes', 'filetext']))
  const openCount = flat.filter(isOpen).length
  const fees = flat.filter((r) => r.status === 'done' && new Date(r.closed_at).getFullYear() === new Date().getFullYear()).reduce((s, r) => s + Number(r.fees || 0), 0)

  return (
    <div>
      <div className="page-head">
        <div><h1>المعاملات الحكومية</h1><div className="sub">متابعة شغل مندوب المعاملات: إقامات، رخص، تجديدات</div></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => setOpen({ auto: true })}><Icon name="camera" /> معاملة من صورة</button>
          <button className="btn" onClick={() => setOpen(null)}><Icon name="plus" /> معاملة يدوي</button>
        </div>
      </div>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat primary"><div className="label">مفتوحة</div><div className="value">{openCount}</div></div>
        <div className="card stat"><div className="label">متأخرة عن موعدها</div><div className="value" style={{ color: 'var(--red)' }}>{flat.filter((r) => isOpen(r) && r.due_date && r.due_date < new Date().toISOString().slice(0, 10)).length}</div></div>
        <div className="card stat"><div className="label">رسوم المعاملات هالسنة</div><div className="value">{fees.toFixed(3)} <span style={{ fontSize: 14 }}>د.ك</span></div></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="chips">{[['open', 'المفتوحة'], ['closed', 'المنتهية'], ['all', 'الكل']].map(([k, t]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}</button>)}</div>
        <input className="input" style={{ maxWidth: 280, height: 42 }} placeholder="بحث، حتى برقم الإيصال…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {shown.length === 0 && <div className="empty">ما فيه معاملات</div>}
        {shown.map((r) => (
          <button key={r.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => setOpen(r)}>
            <span className="grow">
              <div style={{ fontWeight: 600 }}>{r.title}{r.who ? <span className="sub"> · {r.who}</span> : null}{r.gov_transaction_files?.length ? <span className="sub"> · 📎 {r.gov_transaction_files.length}</span> : null}</div>
              <div className="sub">{[r.authority, `فتحت ${fmtDate(r.opened_at)}`, isOpen(r) ? `صار لها ${daysSince(r.opened_at)} يوم` : null, r.due_date ? `قبل ${fmtDate(r.due_date)}` : null, r.owner?.full_name].filter(Boolean).join(' · ')}</div>
            </span>
            <span className={'pill ' + ST[r.status][0]}>{ST[r.status][1]}</span>
          </button>
        ))}
      </div>
      {open !== undefined && <TxSheet tx={open?.auto ? null : open} autoPick={!!open?.auto} emps={emps} branches={branches} onClose={() => setOpen(undefined)} onSaved={load} />}
    </div>
  )
}
