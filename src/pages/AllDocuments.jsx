import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { matches } from '../lib/docs'
import { useDocs, DocCounts } from './MyDocuments.jsx'
import DocumentList from '../components/DocumentList.jsx'
import DocumentForm from '../components/DocumentForm.jsx'
import ReviewSheet from '../components/ReviewSheet.jsx'
import Icon from '../components/Icon.jsx'

const FILTERS = [{ k: 'attention', t: 'تحتاج انتباه' }, { k: 'review', t: 'بانتظار المراجعة' }, { k: 'all', t: 'الكل' }]
// what needs HR to act: expired first, then waiting for review, then about to expire (nearest first)
const RANK = { expired: 0, review: 1, expiring: 2 }
const SEARCH_KEYS = ['employee_name', 'document_type_name', 'document_number', 'holder_name', 'extracted_text', 'employee_phone', 'job_title']

export default function AllDocuments() {
  const [docs, reload] = useDocs(useCallback((q) => q, []))
  const [params, setParams] = useSearchParams()
  const f = params.get('tab') || 'attention'
  const setF = (k) => setParams({ tab: k }, { replace: true })
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)      // doc id in review sheet
  const [upload, setUpload] = useState(null)  // { employeeId, doc }
  const [picking, setPicking] = useState(false)
  const [emps, setEmps] = useState([])
  const [emp, setEmp] = useState('')

  useEffect(() => { supabase.from('employees').select('id,full_name').eq('active', true).order('full_name').then(({ data }) => setEmps(data || [])) }, [])
  const reviewCount = docs.filter((d) => d.status === 'review').length

  const tab = FILTERS.some((x) => x.k === f) ? f : 'attention'
  const shown = docs.filter((d) =>
    (tab === 'all' || (tab === 'attention' ? d.status in RANK : d.status === tab)) &&
    (!search || matches(d, search, SEARCH_KEYS)))
  if (tab === 'attention') shown.sort((a, b) => RANK[a.status] - RANK[b.status] || (a.days_left ?? 0) - (b.days_left ?? 0))
  const attentionCount = docs.filter((d) => d.status in RANK).length

  return (
    <div>
      <div className="page-head">
        <div><h1>مستندات الموظفين</h1><div className="sub">مرتبة من الأقرب انتهاءً · البحث يدوّر حتى داخل نص المستند</div></div>
        <button className="btn primary" onClick={() => setPicking(true)}><Icon name="plus" /> رفع مستند لموظف</button>
      </div>
      <DocCounts docs={docs} admin />
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="chips">{FILTERS.map((x) => <button key={x.k} className={'chip' + (tab === x.k ? ' on' : '')} onClick={() => setF(x.k)}>{x.t}{x.k === 'attention' && attentionCount ? <span className="badge" style={{ marginInlineStart: 6 }}>{attentionCount}</span> : null}{x.k === 'review' && reviewCount ? <span className="badge" style={{ marginInlineStart: 6 }}>{reviewCount}</span> : null}</button>)}</div>
        <input className="input" style={{ maxWidth: 300, height: 42 }} placeholder="بحث بالاسم، الرقم، أو أي كلمة في المستند…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {tab === 'review' && reviewCount > 0 && <div className="sub" style={{ marginBottom: 8 }}>افتح كل مستند، طابق البيانات مع الصورة، واعتمده. الخانات الملوّنة هي اللي الذكاء الاصطناعي مو متأكد منها.</div>}
      <DocumentList docs={shown} showEmployee onOpen={(d) => setOpen(d.id)} admin />

      {picking && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPicking(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>رفع مستند لموظف</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setPicking(false)}><Icon name="x" /></button></div>
            <div className="field"><label htmlFor="pe">الموظف</label>
              <select id="pe" className="input" value={emp} onChange={(e) => setEmp(e.target.value)}>
                <option value="">اختار الموظف…</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
              </select></div>
            <button className="btn primary block" disabled={!emp} onClick={() => { setPicking(false); setUpload({ employeeId: emp, doc: null }) }}>التالي</button>
          </div>
        </div>
      )}
      {upload && <DocumentForm employeeId={upload.employeeId} doc={upload.doc} admin onClose={() => setUpload(null)} onSaved={reload} onRead={(id) => setOpen(id)} />}
      {open && <ReviewSheet kind="employee" docId={open} onClose={() => setOpen(null)} onSaved={reload}
        onRenew={(d) => { setOpen(null); setUpload({ employeeId: d.employee_id, doc: d }) }} />}
    </div>
  )
}
