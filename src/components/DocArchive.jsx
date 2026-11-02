import { useEffect, useState } from 'react'
import { supabase, fmtDate } from '../lib/supabase'
import { matches } from '../lib/docs'
import { openFile } from '../lib/ai'
import Icon from './Icon.jsx'

// Old copies of employee documents (replaced by a newer approved copy). One employee, or everyone with a search box.
export default function DocArchive({ employeeId, search = '' }) {
  const [rows, setRows] = useState(null)
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let q = supabase.from('employee_documents')
      .select('id,employee_id,document_number,holder_name,issue_date,expiry_date,front_image_path,back_image_path,archived_at,created_at,document_types(name),employees!employee_documents_employee_id_fkey(full_name,active)')
      .eq('archived', true).order('archived_at', { ascending: false, nullsFirst: false }).limit(500)
    if (employeeId) q = q.eq('employee_id', employeeId)
    q.then(async ({ data, error }) => {
      if (error) { setRows([]); return }
      const list = (data || []).map((d) => ({ ...d, document_type_name: d.document_types?.name || 'مستند', employee_name: d.employees?.full_name || '' }))
      setRows(list)
      const paths = list.map((d) => d.front_image_path).filter((p) => p && !/\.pdf$/i.test(p)).slice(0, 200)
      if (paths.length) {
        const { data: s } = await supabase.storage.from('employee-docs').createSignedUrls(paths, 3600)
        setUrls(Object.fromEntries((s || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])))
      }
    })
  }, [employeeId])

  if (!rows) return <div className="center" style={{ minHeight: 80 }}><span className="spinner" /></div>
  const shown = rows.filter((d) => !search || matches(d, search, ['employee_name', 'document_type_name', 'document_number', 'holder_name']))
  if (!shown.length) return <div className="empty">{search ? 'ما فيه نتائج' : 'الأرشيف فاضي'}</div>
  return (
    <div className="list">
      {shown.map((d) => (
        <div key={d.id} className="list-item" style={{ alignItems: 'center' }}>
          <button type="button" onClick={() => d.front_image_path && openFile('employee-docs', d.front_image_path)} title="افتح النسخة"
            style={{ width: 76, height: 52, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg)', padding: 0, cursor: 'pointer', flexShrink: 0, display: 'grid', placeItems: 'center', opacity: 0.85 }}>
            {urls[d.front_image_path] ? <img src={urls[d.front_image_path]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="doc" />}
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{d.document_type_name}{!employeeId && d.employee_name ? ` · ${d.employee_name}` : ''}</div>
            <div className="sub">{[d.document_number && <span key="n" className="ltr num">{d.document_number}</span>, d.expiry_date && `كان ينتهي ${fmtDate(d.expiry_date)}`,
              d.archived_at && `انأرشف ${fmtDate(d.archived_at.slice(0, 10))}`].filter(Boolean).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</div>
          </div>
          {d.back_image_path && <button type="button" className="chip" style={{ minHeight: 30 }} onClick={() => openFile('employee-docs', d.back_image_path)}>الخلف</button>}
          <span className="pill gray">أرشيف</span>
        </div>))}
    </div>)
}
