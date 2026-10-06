import { useState, useCallback } from 'react'
import { useDocs, DocCounts } from './MyDocuments.jsx'
import DocumentList from '../components/DocumentList.jsx'
import DocumentForm from '../components/DocumentForm.jsx'

const FILTERS = [{ k: 'attention', t: 'تحتاج انتباه' }, { k: 'expired', t: 'منتهي' }, { k: 'expiring', t: 'قرب ينتهي' }, { k: 'all', t: 'الكل' }]

export default function AllDocuments() {
  const [docs, reload] = useDocs(useCallback((q) => q, []))
  const [f, setF] = useState('attention')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const shown = docs.filter((d) =>
    (f === 'all' || (f === 'attention' ? d.status !== 'valid' : d.status === f)) &&
    (!search || d.employee_name?.includes(search) || d.document_type_name?.includes(search)))

  return (
    <div>
      <div className="page-head">
        <div><h1>كل المستندات</h1><div className="sub">مرتبة من الأقرب انتهاءً</div></div>
      </div>
      <DocCounts docs={docs} />
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="chips">{FILTERS.map((x) => <button key={x.k} className={'chip' + (f === x.k ? ' on' : '')} onClick={() => setF(x.k)}>{x.t}</button>)}</div>
        <input className="input" style={{ maxWidth: 260, height: 42 }} placeholder="بحث باسم الموظف…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DocumentList docs={shown} showEmployee onOpen={setEditing} />
      {editing && <DocumentForm employeeId={editing.employee_id} doc={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  )
}
