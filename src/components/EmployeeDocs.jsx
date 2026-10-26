import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { statusPill } from '../lib/docs'
import DocumentForm from './DocumentForm.jsx'
import ReviewSheet from './ReviewSheet.jsx'
import Icon from './Icon.jsx'

// Inside the employee's page: the required papers (civil ID, health card, passport) with their photo,
// what is missing in red with "upload for him" / "remind him", then any other document he uploaded.
export default function EmployeeDocs({ employee, canManage }) {
  const [types, setTypes] = useState([])
  const [docs, setDocs] = useState(null)
  const [urls, setUrls] = useState({})
  const [upload, setUpload] = useState(null) // { typeId }
  const [open, setOpen] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: t }, { data: d }] = await Promise.all([
      supabase.from('document_types').select('id,name,required,sort_order').eq('scope', 'employee').order('sort_order'),
      supabase.from('employee_documents_status').select('id,document_type_id,document_type_name,document_number,expiry_date,days_left,status,front_image_path,back_image_path,created_at')
        .eq('employee_id', employee.id).neq('status', 'rejected').order('created_at', { ascending: false }),
    ])
    setTypes(t || []); setDocs(d || [])
    const paths = (d || []).map((x) => x.front_image_path).filter((p) => p && !p.toLowerCase().endsWith('.pdf'))
    if (paths.length) {
      const { data: s } = await supabase.storage.from('employee-docs').createSignedUrls(paths, 3600)
      setUrls(Object.fromEntries((s || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])))
    }
  }, [employee.id])
  useEffect(() => { load() }, [load])

  if (!docs) return <div className="card center" style={{ minHeight: 90 }}><span className="spinner" /></div>
  const required = types.filter((t) => t.required)
  const byType = (id) => docs.find((d) => d.document_type_id === id)
  const missing = required.filter((t) => !byType(t.id))
  const others = docs.filter((d) => !required.some((t) => t.id === d.document_type_id))

  const remind = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('remind_missing_docs', { p_employee: employee.id })
    setBusy(false)
    setMsg(error ? { ok: false, t: errMsg(error) } : { ok: true, t: data ? `وصله تنبيه يرفع ${missing.map((m) => m.name).join('، ')}` : 'ما عنده شي ناقص' })
  }

  const Thumb = ({ d }) => {
    const pdf = d.front_image_path?.toLowerCase().endsWith('.pdf')
    const url = urls[d.front_image_path]
    return (
      <button type="button" onClick={() => setOpen(d.id)} title="افتح المستند"
        style={{ width: 92, height: 62, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg)', padding: 0, cursor: 'pointer', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        {url ? <img src={url} alt={d.document_type_name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={pdf ? 'doc' : 'camera'} />}
      </button>)
  }
  const Row = ({ d, name }) => {
    const pill = statusPill(d.status, d.days_left)
    return (
      <div className="row" style={{ gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
        <Thumb d={d} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{name || d.document_type_name || 'مستند'} <span className={'pill ' + pill.cls}>{pill.text}</span></div>
          <div className="sub">{[d.document_number && <span key="n" className="ltr num">{d.document_number}</span>, d.expiry_date && `ينتهي ${fmtDate(d.expiry_date)}`].filter(Boolean).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</div>
        </div>
      </div>)
  }

  return (
    <div className="card form" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>المستندات</strong>
        {missing.length > 0 ? <span className="pill red">ناقص {missing.length}</span> : <span className="pill ok">الأساسية كاملة ✓</span>}
      </div>
      {required.map((t) => {
        const d = byType(t.id)
        if (d) return <Row key={t.id} d={d} name={t.name} />
        return (
          <div key={t.id} className="row" style={{ gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
            <div style={{ width: 92, height: 62, borderRadius: 10, border: '2px dashed var(--red)', display: 'grid', placeItems: 'center', color: 'var(--red)', flexShrink: 0 }}><Icon name="x" /></div>
            <div className="grow"><div style={{ fontWeight: 600, color: 'var(--red)' }}>ما رفع {t.name}</div></div>
            {canManage && <button type="button" className="btn" style={{ minHeight: 38 }} onClick={() => setUpload({ typeId: t.id })}><Icon name="plus" /> ارفع عنه</button>}
          </div>)
      })}
      {others.length > 0 && <div className="sub" style={{ marginTop: 6 }}>مستندات ثانية</div>}
      {others.map((d) => <Row key={d.id} d={d} />)}
      {canManage && (
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          {missing.length > 0 && <button type="button" className="btn" disabled={busy} onClick={remind}>{busy ? <span className="spinner" /> : <Icon name="bell" />} ذكّره يرفع الناقص</button>}
          <button type="button" className="btn" onClick={() => setUpload({ typeId: '' })}><Icon name="plus" /> مستند ثاني</button>
        </div>)}
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}
      {(upload || open) && createPortal(
        // own layer outside the employee form, so its buttons never submit that form
        <div onSubmit={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {upload && <DocumentForm employeeId={employee.id} doc={null} typeId={upload.typeId} admin onClose={() => setUpload(null)} onSaved={load} onRead={(id) => setOpen(id)} />}
          {open && <ReviewSheet kind="employee" docId={open} onClose={() => setOpen(null)} onSaved={load} />}
        </div>, document.body)}
    </div>
  )
}
