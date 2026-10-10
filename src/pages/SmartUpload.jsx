import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, errMsg, fmtDate, todayKuwait } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { uploadAttachment, readFile, readError, copyFile, openFile, ACCEPT } from '../lib/ai'
import { startRead } from './inventory/Invoices.jsx'
import ReviewSheet from '../components/ReviewSheet.jsx'
import Icon from '../components/Icon.jsx'

const CATS = {
  employee_document: 'مستند موظف', branch_document: 'رخصة / مستند فرع', supplier_invoice: 'فاتورة مورد', maintenance_invoice: 'فاتورة صيانة',
  government_receipt: 'إيصال / ورقة معاملة حكومية', supplier_document: 'ورقة مورد (رخصة / عقد)', medical_report: 'تقرير طبي', other: 'ورقة ثانية',
}
const fold = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
const ext = (p) => (p.endsWith('.pdf') ? 'pdf' : 'jpg')
const findType = (types, name) => types.find((t) => fold(t.name) === fold(name)) || types.find((t) => name && (fold(t.name).includes(fold(name)) || fold(name).includes(fold(t.name))))

function Card({ item, lk, onUpdate, onReview }) {
  const nav = useNavigate()
  const d = item.data || {}, m = item.match || {}
  const [cat, setCat] = useState(d.category || 'other')
  const [emp, setEmp] = useState(m.employee?.id || '')
  const [branch, setBranch] = useState(m.branch?.id || (cat === 'supplier_invoice' ? lk.kitchen : '') || '')
  const [sup, setSup] = useState(m.supplier?.id || '')
  const [maint, setMaint] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (cat === 'supplier_invoice' && !branch) setBranch(lk.kitchen || '') }, [cat, branch, lk.kitchen])

  const doc = async (scope) => {
    const types = lk.types.filter((t) => t.scope === scope)
    const type = findType(types, d.document_type)
    const sure = d.expiry_date && type && d.expiry_confident !== false && !(d.uncertain_fields || []).includes('expiry_date')
    const base = { document_type_id: type?.id || null, document_number: d.document_number || d.licence_no || d.civil_id || null, holder_name: d.holder_name || null,
      issue_date: d.issue_date || null, expiry_date: d.expiry_date || null, review_status: 'pending', ai_status: 'done', ai_data: d, extracted_text: item.text || null,
      review_fields: [!sure && 'expiry_date', !type && 'document_type'].filter(Boolean), remind_days_before: scope === 'branch' ? 60 : 30 }
    if (scope === 'branch') {
      const path = await copyFile('attachments', item.path, 'branch-docs', `${branch}/${crypto.randomUUID()}.${ext(item.path)}`)
      const { data, error } = await supabase.from('branch_documents').insert({ ...base, branch_id: branch, file_paths: [path] }).select('id').single()
      if (error) throw error
      return { kind: 'branch', id: data.id }
    }
    const path = await copyFile('attachments', item.path, 'employee-docs', `${emp}/${crypto.randomUUID()}-front.${ext(item.path)}`)
    const { data, error } = await supabase.from('employee_documents').insert({ ...base, employee_id: emp, front_image_path: path }).select('id').single()
    if (error) throw error
    return { kind: 'employee', id: data.id }
  }

  const go = async () => {
    setBusy(true); setErr('')
    try {
      if (cat === 'employee_document') { if (!emp) throw new Error('اختار الموظف'); const r = await doc('employee'); onUpdate({ done: 'انحفظ في مستندات الموظف' }); onReview(r) }
      else if (cat === 'branch_document') { if (!branch) throw new Error('اختار الفرع'); const r = await doc('branch'); onUpdate({ done: 'انحفظ في تراخيص الفرع' }); onReview(r) }
      else if (cat === 'supplier_invoice') {
        if (!branch) throw new Error('اختار مين استلم البضاعة')
        const { data: inv, error } = await supabase.from('purchase_invoices').insert({ branch_id: branch, supplier_id: sup || null, status: 'draft' }).select().single()
        if (error) throw error
        const p = await copyFile('attachments', item.path, 'invoices', `${inv.id}/1-${Date.now()}.${ext(item.path)}`)
        await supabase.from('purchase_invoices').update({ image_paths: [p] }).eq('id', inv.id)
        startRead(inv.id)
        nav(`/inventory/invoices/${inv.id}`)
      } else if (cat === 'maintenance_invoice') {
        if (!maint) throw new Error('اختار بند الصيانة')
        const it = lk.maint.find((x) => x.id === maint)
        const p = await copyFile('attachments', item.path, 'branch-docs', `${it.branch_id}/maintenance/${crypto.randomUUID()}.${ext(item.path)}`)
        const { error } = await supabase.from('maintenance_logs').insert({ item_id: maint, done_date: d.date || todayKuwait(), vendor: d.supplier_name || d.holder_name || null,
          cost: d.total != null ? Number(d.total) : null, notes: d.summary_ar || null, invoice_paths: [p] })
        if (error) throw error
        onUpdate({ done: `انسجلت الصيانة: ${it.name} · ${it.branch_name}` })
      } else if (cat === 'government_receipt') {
        const { data: tx, error } = await supabase.from('gov_transactions').insert({ title: d.document_type || 'معاملة', authority: d.authority || null, fees: Number(d.total) || 0,
          employee_id: emp || null, branch_id: emp ? null : branch || null, status: 'submitted' }).select().single()
        if (error) throw error
        await supabase.from('gov_transaction_files').insert({ tx_id: tx.id, path: item.path, file_name: item.name, ai_data: { ...d, doc_kind: 'receipt', fees: d.total, match: m } })
        onUpdate({ done: 'انفتحت معاملة جديدة في المعاملات الحكومية' })
      } else if (cat === 'supplier_document') {
        if (!sup) throw new Error('اختار المورد')
        const s = lk.suppliers.find((x) => x.id === sup)
        const { error } = await supabase.from('suppliers').update({ doc_paths: [...(s.doc_paths || []), item.path],
          ...(d.licence_no ? { licence_no: d.licence_no } : {}), ...(d.expiry_date ? { licence_expiry: d.expiry_date, last_alert_stage: null } : {}) }).eq('id', sup)
        if (error) throw error
        onUpdate({ done: `انحفظت مع المورد ${s.name}` })
      }
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  const needs = { employee_document: 'emp', branch_document: 'branch', supplier_invoice: 'branch+sup', maintenance_invoice: 'maint', government_receipt: 'emp|branch', supplier_document: 'sup' }[cat] || ''
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="thumb"><Icon name="doc" /></span>
        <span className="grow"><div style={{ fontWeight: 600 }}>{item.name}</div><div className="sub">{d.summary_ar || (item.error ? '' : 'جاري القراءة…')}</div></span>
        <button className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', item.path)}>فتح</button>
      </div>
      {item.error && <div className="warn">{item.error}</div>}
      {item.done ? <div className="notice">✓ {item.done}</div> : item.data && (
        <>
          <div className="sub">{[d.document_type, d.document_number && `رقم ${d.document_number}`, d.holder_name, d.expiry_date && `ينتهي ${fmtDate(d.expiry_date)}`,
            d.total ? `${Number(d.total).toFixed(3)} د.ك` : null, d.date && fmtDate(d.date)].filter(Boolean).join(' · ')}</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="نوع الورقة">
              {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {needs.includes('emp') && <select className="input" value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="الموظف">
              <option value="">{needs === 'emp|branch' ? 'الموظف (إذا تخص موظف)' : 'اختار الموظف…'}</option>{lk.emps.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>}
            {needs.includes('branch') && <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
              <option value="">{cat === 'supplier_invoice' ? 'مين استلم البضاعة…' : 'اختار الفرع…'}</option>{lk.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            {needs.includes('sup') && <select className="input" value={sup} onChange={(e) => setSup(e.target.value)} aria-label="المورد">
              <option value="">{cat === 'supplier_invoice' ? 'المورد (يقراه النظام)' : 'اختار المورد…'}</option>{lk.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            {needs === 'maint' && <select className="input" value={maint} onChange={(e) => setMaint(e.target.value)} aria-label="بند الصيانة">
              <option value="">اختار بند الصيانة…</option>{lk.maint.map((x) => <option key={x.id} value={x.id}>{x.branch_name} · {x.name}</option>)}</select>}
          </div>
          {m.employee && <div className="sub">لقى الموظف: {m.employee.name}{m.employee.by === 'civil_id' ? ' (بالرقم المدني)' : ' (بالاسم)'}</div>}
          {(m.branch_document || m.employee_document) && <div className="sub">عندك مستند بنفس الرقم أو النوع: {(m.branch_document || m.employee_document).type}</div>}
          {cat === 'medical_report' ? <div className="sub">التقرير الطبي يرفعه الموظف مع طلب الإجازة المرضية أو "كنت مريض"، عشان ينربط بطلبه.</div>
            : cat === 'other' ? <div className="sub">ما عرف وين يحطها. اختار النوع من القائمة لو تعرفه.</div>
            : <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={go}>{busy ? <span className="spinner" /> : <Icon name="check" />} احفظها هناك</button>}
          {err && <div className="error">{err}</div>}
        </>
      )}
    </div>
  )
}

export default function SmartUpload() {
  const { access } = useAccess()
  const [items, setItems] = useState([])
  const [lk, setLk] = useState(null)
  const [review, setReview] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('id,full_name').eq('active', true).order('full_name'),
      supabase.from('branches').select('id,name,is_central_kitchen').eq('active', true).order('name'),
      supabase.from('suppliers').select('id,name,doc_paths').eq('active', true).order('name'),
      supabase.from('document_types').select('id,name,scope'),
      supabase.from('maintenance_status').select('id,name,branch_id,branch_name').eq('active', true).order('branch_name'),
    ]).then(([e, b, s, t, mt]) => setLk({ emps: e.data || [], branches: b.data || [], suppliers: s.data || [], types: t.data || [], maint: mt.data || [],
      kitchen: (b.data || []).find((x) => x.is_central_kitchen)?.id || '' }))
  }, [])

  const update = (key, patch) => setItems((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const add = async (files) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      setItems((l) => [{ key, name: file.name }, ...l])
      try {
        const path = await uploadAttachment(file, access.employee.id)
        update(key, { path })
        const r = await readFile('classify', [path])
        update(key, r.ok ? { data: r.data, match: r.match || {}, text: r.text } : { error: readError(r) })
      } catch (e) { update(key, { error: errMsg(e) }) }
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1>رفع ذكي</h1><div className="sub">ارفع أي ورقة: بطاقة، رخصة، فاتورة، إيصال. النظام يعرف وش هي ولمين، وأنت تأكد وتحفظ.</div></div></div>
      <label className="upload" style={{ height: 150, marginBottom: 16 }}>
        <input type="file" accept={ACCEPT} multiple onChange={(e) => { add([...e.target.files]); e.target.value = '' }} />
        <Icon name="camera" size={30} /><strong style={{ fontSize: 15, color: 'var(--ink)' }}>اختار صور أو ملفات PDF</strong><span>تقدر تختار أكثر من ملف مرة وحدة</span>
      </label>
      {!lk ? <div className="center sub"><span className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((x) => <Card key={x.key + (x.data ? '1' : '0')} item={x} lk={lk} onUpdate={(p) => update(x.key, p)} onReview={setReview} />)}
        </div>)}
      {review && <ReviewSheet kind={review.kind} docId={review.id} onClose={() => setReview(null)} />}
    </div>
  )
}
