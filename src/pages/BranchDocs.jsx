import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { readDocument, statusPill, matches, ext } from '../lib/docs'
import ReviewSheet from '../components/ReviewSheet.jsx'
import AddDocType from '../components/AddDocType.jsx'
import Icon from '../components/Icon.jsx'

const FILTERS = [['attention', 'تحتاج انتباه'], ['review', 'بانتظار المراجعة'], ['all', 'الكل']]
const KEYS = ['document_type_name', 'document_number', 'holder_name', 'extracted_text', 'notes', 'branch_name']

function UploadSheet({ branches, types, branchId: initial, renew, onClose, onRead, onTypeAdded }) {
  const [branchId, setBranchId] = useState(renew?.branch_id || initial || '')
  const [typeId, setTypeId] = useState(renew?.document_type_id || '')
  const [files, setFiles] = useState([])
  const [step, setStep] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    if (!branchId) { setErr('اختار الفرع'); return }
    if (!files.length) { setErr('صوّر المستند أو اختار الملف'); return }
    setErr(''); setStep('saving')
    try {
      const paths = []
      for (const f of files) {
        const path = `${branchId}/${crypto.randomUUID()}.${ext(f)}`
        const { error } = await supabase.storage.from('branch-docs').upload(path, f, { contentType: f.type })
        if (error) throw error
        paths.push(path)
      }
      const type = types.find((x) => x.id === typeId)
      const { data, error } = await supabase.from('branch_documents').insert({
        branch_id: branchId, document_type_id: typeId || null, file_paths: paths, review_status: 'pending',
        remind_days_before: type?.default_remind_days || renew?.remind_days_before || 60, replaces_id: renew?.id || null,
      }).select('id').single()
      if (error) throw error
      setStep('reading')
      await readDocument('branch', data.id)
      onRead(data.id); onClose()
    } catch (e) { setErr(errMsg(e)); setStep('') }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !step && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{renew && !renew.isNew ? `تجديد ${renew.document_type_name || 'المستند'}` : 'رفع مستند فرع'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose} disabled={!!step}><Icon name="x" /></button></div>
        <div className="sub">ارفع الرخصة أو المستند، والذكاء الاصطناعي يقرا النوع والرقم والتواريخ. بعدها تراجع وتعتمد.</div>
        <div className="field"><label htmlFor="ub">الفرع</label>
          <select id="ub" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!!renew && !renew.isNew}>
            <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div className="field"><span className="lbl">نوع المستند (اختياري، يقراه النظام)</span>
          <div className="chips">{types.map((x) => <button type="button" key={x.id} className={'chip' + (typeId === x.id ? ' on' : '')} onClick={() => setTypeId(typeId === x.id ? '' : x.id)}>{x.name}</button>)}
            <AddDocType scope="branch" onAdded={(t) => { onTypeAdded(); setTypeId(t.id) }} /></div></div>
        <label className="upload" style={{ height: files.length ? 'auto' : 140, padding: files.length ? 10 : 0 }}>
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...files, ...e.target.files])} />
          {files.length === 0 ? <><Icon name="camera" size={28} /><strong>صوّر المستند أو اختار PDF</strong><span>لو أكثر من صفحة، اختارهم كلهم</span></>
            : <span style={{ position: 'relative', zIndex: 1 }}>{files.map((f) => f.name).join('، ')} · <u>إضافة صفحة</u></span>}
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={!!step} onClick={save}>
          {step ? <><span className="spinner" /> {step === 'reading' ? 'جاري قراءة المستند…' : 'جاري الرفع…'}</> : 'رفع وقراءة'}</button>
      </div>
    </div>
  )
}

export default function BranchDocs() {
  const { can } = useAccess()
  const manage = can('manage_branch_docs')
  const [docs, setDocs] = useState([])
  const [branches, setBranches] = useState([])
  const [types, setTypes] = useState([])
  const [branch, setBranch] = useState('')
  const [f, setF] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [upload, setUpload] = useState(null)
  const [newType, setNewType] = useState(null)

  const load = useCallback(() => {
    supabase.from('branch_documents_status').select('*').eq('archived', false).order('expiry_date', { ascending: true, nullsFirst: true }).then(({ data }) => setDocs(data || []))
  }, [])
  const loadTypes = () => supabase.from('document_types').select('*').eq('scope', 'branch').order('sort_order').then(({ data }) => setTypes(data || []))
  useEffect(() => {
    load(); loadTypes()
    supabase.from('branches').select('id,name,is_central_kitchen').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
  }, [load])

  const addType = async () => {
    if (!newType?.trim()) return
    const { error } = await supabase.from('document_types').insert({ name: newType.trim(), scope: 'branch', default_remind_days: 60, sort_order: 50 })
    if (!error) { setNewType(null); loadTypes() }
  }

  const count = (s) => docs.filter((d) => d.status === s).length
  const shown = docs.filter((d) => (!branch || d.branch_id === branch) &&
    (f === 'all' || (f === 'attention' ? ['expired', 'expiring', 'review'].includes(d.status) : d.status === f)) && matches(d, q, KEYS))
  const visibleBranches = branches.filter((b) => !branch || b.id === branch)

  return (
    <div>
      <div className="page-head">
        <div><h1>تراخيص ومستندات الفروع</h1><div className="sub">المطبخ المركزي والفروع والإدارة · التنبيه يروح لمندوب المعاملات ولك</div></div>
        {manage && <button className="btn primary" onClick={() => setUpload({ branchId: branch })}><Icon name="plus" /> رفع مستند</button>}
      </div>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">منتهية</div><div className="value" style={{ color: 'var(--red)' }}>{count('expired')}</div></div>
        <div className="card stat"><div className="label">قربت تنتهي</div><div className="value" style={{ color: 'var(--amber)' }}>{count('expiring')}</div></div>
        <div className="card stat"><div className="label">بانتظار المراجعة</div><div className="value">{count('review')}</div></div>
        <div className="card stat"><div className="label">سارية</div><div className="value" style={{ color: 'var(--ok)' }}>{count('valid')}</div></div>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="input" style={{ maxWidth: 200, height: 42 }} value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="chips">{FILTERS.map(([k, t]) => <button key={k} className={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>{t}</button>)}</div>
        <input className="input" style={{ maxWidth: 280, height: 42 }} placeholder="بحث بالرقم أو أي كلمة في المستند…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {visibleBranches.map((b) => {
          const list = shown.filter((d) => d.branch_id === b.id)
          const have = new Set(docs.filter((d) => d.branch_id === b.id).map((d) => d.document_type_id))
          const missing = types.filter((t) => !have.has(t.id))
          if (!list.length && (f !== 'all' || q)) return null
          return (
            <section key={b.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <h2 style={{ fontSize: 17 }}>{b.name}</h2>
                {manage && <button className="btn" style={{ minHeight: 36 }} onClick={() => setUpload({ branchId: b.id })}><Icon name="plus" /> مستند</button>}
              </div>
              <div className="list">
                {list.length === 0 && <div className="empty">ما فيه مستندات مرفوعة</div>}
                {list.map((d) => {
                  const p = statusPill(d.status, d.days_left)
                  return (
                    <button key={d.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => setOpen(d.id)}>
                      <span className="thumb"><Icon name="doc" /></span>
                      <span className="grow">
                        <div style={{ fontWeight: 600 }}>{d.document_type_name || 'مستند جديد'}{d.document_number ? <span className="sub ltr"> · {d.document_number}</span> : null}</div>
                        <div className="sub">{d.expiry_date ? `ينتهي ${fmtDate(d.expiry_date)}` : d.status === 'review' ? 'بانتظار المراجعة' : 'بدون تاريخ انتهاء'}{d.notes ? ' · ' + d.notes : ''}</div>
                      </span>
                      <span className={'pill ' + p.cls}>{p.text}</span>
                    </button>
                  )
                })}
              </div>
              {manage && f === 'all' && !q && missing.length > 0 && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <span className="sub">ما انرفع:</span>
                  {missing.map((t) => <button key={t.id} className="chip" style={{ borderStyle: 'dashed', minHeight: 30, fontSize: 13 }} onClick={() => setUpload({ branchId: b.id, typeId: t.id })}>{t.name}</button>)}
                </div>)}
            </section>
          )
        })}
      </div>

      {manage && (
        <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
          <span className="sub">أنواع مستندات الفروع: {types.map((t) => t.name).join('، ')}</span>
          {newType === null ? <button className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setNewType('')}>+ نوع جديد</button>
            : <span className="row" style={{ gap: 6 }}><input className="input" style={{ height: 40, width: 200 }} placeholder="مثل: شهادة صحية للمبنى" value={newType} onChange={(e) => setNewType(e.target.value)} />
              <button className="btn" style={{ minHeight: 40 }} onClick={addType}>إضافة</button></span>}
        </div>)}

      {upload && <UploadSheet branches={branches} types={types} onTypeAdded={loadTypes} branchId={upload.branchId} renew={upload.renew || (upload.typeId ? { branch_id: upload.branchId, document_type_id: upload.typeId, id: null, isNew: true } : null)}
        onClose={() => setUpload(null)} onRead={(id) => { load(); setOpen(id) }} />}
      {open && <ReviewSheet kind="branch" docId={open} readOnly={!manage} onClose={() => setOpen(null)} onSaved={load}
        onRenew={manage ? (d) => { setOpen(null); setUpload({ renew: d }) } : null} />}
    </div>
  )
}
