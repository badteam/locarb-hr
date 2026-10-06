import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import DocumentForm from '../components/DocumentForm.jsx'
import DocumentList from '../components/DocumentList.jsx'
import Icon from '../components/Icon.jsx'

export function useDocs(filter) {
  const [docs, setDocs] = useState([])
  const load = useCallback(async () => {
    let q = supabase.from('employee_documents_status').select('*').order('days_left')
    if (filter) q = filter(q)
    const { data } = await q
    setDocs(data || [])
  }, [filter])
  useEffect(() => { load() }, [load])
  return [docs, load]
}

export function DocCounts({ docs }) {
  const c = (s) => docs.filter((d) => d.status === s).length
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
      <div className="card" style={{ textAlign: 'center', padding: 10 }}><div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ok)' }}>{c('valid')}</div><div className="sub">ساري</div></div>
      <div className="card" style={{ textAlign: 'center', padding: 10 }}><div style={{ fontSize: 20, fontWeight: 600, color: 'var(--amber)' }}>{c('expiring')}</div><div className="sub">قرب ينتهي</div></div>
      <div className="card" style={{ textAlign: 'center', padding: 10 }}><div style={{ fontSize: 20, fontWeight: 600, color: 'var(--red)' }}>{c('expired')}</div><div className="sub">منتهي</div></div>
    </div>
  )
}

export default function MyDocuments() {
  const { access } = useAccess()
  const empId = access.employee.id
  const filter = useCallback((q) => q.eq('employee_id', empId), [empId])
  const [docs, reload] = useDocs(filter)
  const [editing, setEditing] = useState(undefined)

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-head">
        <h1>مستنداتي</h1>
        <button className="btn primary" onClick={() => setEditing(null)}><Icon name="plus" /> إضافة مستند</button>
      </div>
      <DocCounts docs={docs} />
      <DocumentList docs={docs} onOpen={setEditing} />
      {editing !== undefined && <DocumentForm employeeId={empId} doc={editing} onClose={() => setEditing(undefined)} onSaved={reload} />}
    </div>
  )
}
