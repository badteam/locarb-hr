import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, loadLookups, invErr, invoiceStage, STAGE, PAY_STATUS } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

// shrink phone photos before upload (keeps text sharp, avoids 10MB uploads)
export async function compress(file) {
  if (!file.type.startsWith('image/') || file.size < 1.5e6) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88))
    return blob ? new File([blob], 'invoice.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

export async function startRead(id) {
  const { data, error } = await supabase.functions.invoke('read-invoice', { body: { invoice_id: id } })
  if (error) {
    let body = {}
    try { body = await error.context?.json() } catch { /* ignore */ }
    return { error: body?.error || error.message }
  }
  return data
}

function NewInvoice({ onClose }) {
  const nav = useNavigate()
  const [lookups, setLookups] = useState(null)
  const [files, setFiles] = useState([])
  const [goods, setGoods] = useState([])
  const [supplier, setSupplier] = useState('')
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { loadLookups().then((l) => { setLookups(l); setBranch(l.kitchen?.id || '') }) }, [])
  const previews = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null))

  const create = async (manual) => {
    setErr('')
    if (!manual && !files.length) { setErr('صوّر الفاتورة أو اختار الصورة'); return }
    setBusy('saving')
    const { data: inv, error } = await supabase.from('purchase_invoices').insert({ branch_id: branch, supplier_id: supplier || null, status: 'draft' }).select().single()
    if (error) { setErr(invErr(error)); setBusy(''); return }
    const paths = []
    for (let i = 0; i < files.length; i++) {
      const f = await compress(files[i])
      const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg'
      const path = `${inv.id}/${i + 1}-${Date.now()}.${ext}`
      const up = await supabase.storage.from('invoices').upload(path, f, { contentType: f.type || 'image/jpeg' })
      if (up.error) { setErr('ما قدرنا نرفع الصورة: ' + up.error.message); setBusy(''); return }
      paths.push(path)
    }
    const gpaths = []
    for (let i = 0; i < goods.length; i++) {
      const f = await compress(goods[i])
      const path = `${inv.id}/goods-${i + 1}-${Date.now()}.jpg`
      const up = await supabase.storage.from('invoices').upload(path, f, { contentType: f.type || 'image/jpeg' })
      if (!up.error) gpaths.push(path)
    }
    if (paths.length || gpaths.length) await supabase.from('purchase_invoices').update({ image_paths: paths, goods_photo_paths: gpaths }).eq('id', inv.id)
    if (paths.length && !manual) startRead(inv.id) // runs in the background; the detail page follows it
    nav(`/inventory/invoices/${inv.id}`)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>استلام بضاعة من مورد</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose} disabled={!!busy}><Icon name="x" /></button></div>
        <label className="upload" style={{ height: files.length ? 'auto' : 150, padding: files.length ? 8 : 0 }}>
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...files, ...e.target.files])} />
          {files.length === 0 ? <><Icon name="camera" size={30} /><strong style={{ fontSize: 15, color: 'var(--ink)' }}>صوّر الفاتورة</strong><span>أو اختار صورة أو ملف PDF. لو الفاتورة أكثر من صفحة صوّر كل صفحة.</span></> :
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
              {files.map((f, i) => previews[i] ? <img key={i} src={previews[i]} alt="" style={{ position: 'static', width: 90, height: 120, objectFit: 'cover', borderRadius: 8 }} /> :
                <span key={i} className="thumb" style={{ width: 90, height: 120 }}>PDF</span>)}
              <span className="thumb" style={{ width: 90, height: 120, flexDirection: 'column' }}><Icon name="plus" />صفحة ثانية</span>
            </div>}
        </label>
        <label className="upload" style={{ height: goods.length ? 'auto' : 80, padding: goods.length ? 8 : 0 }}>
          <input type="file" accept="image/*" multiple onChange={(e) => setGoods([...goods, ...e.target.files])} />
          {goods.length === 0 ? <><Icon name="camera" /> <span><strong style={{ color: 'var(--ink)' }}>صوّر البضاعة</strong> كما وصلت (اختياري، ينفع بعدين)</span></> :
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
              {goods.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" style={{ position: 'static', width: 70, height: 70, objectFit: 'cover', borderRadius: 8 }} />)}
              <span className="thumb" style={{ width: 70, height: 70 }}><Icon name="plus" /></span>
            </div>}
        </label>
        <div className="field"><label htmlFor="sp">المورد (اختياري، النظام يقراه من الفاتورة)</label>
          <select id="sp" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">يقراه النظام من الفاتورة</option>
            {lookups?.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="br">استلمتها في</label>
          <select id="br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {lookups?.stockBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={!!busy || !files.length} onClick={() => create(false)}>
          {busy ? <><span className="spinner" /> جاري الرفع…</> : 'اقرا الفاتورة'}</button>
        <button className="btn" disabled={!!busy} onClick={() => create(true)}>إدخال يدوي بدون قراءة</button>
      </div>
    </div>
  )
}

const TABS = [
  ['receive', 'تنتظر الاستلام'], ['review', 'تنتظر المراجعة'], ['unpaid', 'غير مدفوعة'],
  ['approved', 'تمت المراجعة'], ['rejected', 'مرفوضة'], ['all', 'الكل'],
]
const OPEN_ST = ['draft', 'reading', 'review', 'failed']

export default function Invoices() {
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || (can('approve_purchases') ? 'review' : can('supplier_payments') ? 'unpaid' : 'receive'))
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const [creating, setCreating] = useState(params.get('new') === '1')
  const canCreate = can('manage_suppliers') || can('approve_purchases') || can('receive_goods')

  const load = useCallback(() => {
    let q = supabase.from('purchase_invoices').select('id,invoice_no,invoice_date,status,received_at,created_at,supplier_name_read,total_due,paid_amount,payment_status,due_date,suppliers(name),employees:created_by(full_name),purchase_invoice_lines(qty,unit_price),discount')
      .eq('price_only', false).order('created_at', { ascending: false }).limit(300)
    if (tab === 'receive') q = q.in('status', OPEN_ST).is('received_at', null)
    else if (tab === 'review') q = q.eq('status', 'review').not('received_at', 'is', null)
    else if (tab === 'unpaid') q = q.eq('status', 'approved').neq('payment_status', 'paid')
    else if (tab !== 'all') q = q.eq('status', tab)
    q.then(({ data }) => {
      const d = data || []
      if (tab === 'unpaid') d.sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))
      setRows(d)
    })
    supabase.from('purchase_invoices').select('status,received_at,payment_status,total_due,paid_amount,due_date').eq('price_only', false)
      .or('status.in.(draft,reading,review,failed),and(status.eq.approved,payment_status.neq.paid)').then(({ data }) => {
        const c = { receive: 0, review: 0, unpaid: 0, owed: 0, overdue: 0 }
        const now = new Date().toISOString().slice(0, 10)
        for (const r of data || []) {
          if (r.status === 'approved') { c.unpaid++; c.owed += Number(r.total_due || 0) - Number(r.paid_amount || 0); if (r.due_date && r.due_date < now) c.overdue++ }
          else if (r.received_at) c.review++
          else c.receive++
        }
        setCounts(c)
      })
  }, [tab])
  useEffect(() => { load() }, [load])

  const total = (v) => v.total_due != null ? Number(v.total_due) : (v.purchase_invoice_lines || []).reduce((a, l) => a + l.qty * l.unit_price, 0) - Number(v.discount || 0)
  const today = new Date().toISOString().slice(0, 10)
  const hint = {
    receive: 'المستلم يصوّر الفاتورة والبضاعة، يطابق اللي وصل فعلاً، ويأكد الاستلام. البضاعة تدخل المخزون مباشرة.',
    review: 'المحاسب يراجع الأسعار والمرتجع والمجاني ويضغط "تمت المراجعة".',
    unpaid: 'فواتير تمت مراجعتها وباقي عليها مبلغ. الأقرب استحقاقاً فوق.',
  }[tab]

  return (
    <div>
      <div className="page-head"><div><h1>فواتير الموردين</h1><div className="sub">استلام ← مراجعة المحاسب ← الدفع</div></div>
        {canCreate && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="camera" /> استلام بضاعة</button>}</div>
      {(counts.owed > 0 || counts.overdue > 0) && (can('supplier_payments') || can('approve_purchases')) && (
        <div className={counts.overdue ? 'warn' : 'notice'} style={{ marginBottom: 12 }}>
          {counts.overdue ? <Icon name="warn" /> : null}<span>علينا للموردين <strong className="num">{kwd(counts.owed)}</strong> د.ك</span>{counts.overdue ? <span>· {counts.overdue} فاتورة فات موعد دفعها</span> : null}</div>)}
      <div className="chips" style={{ marginBottom: 8 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
          {l}{counts[k] ? <span className="badge" style={{ marginInlineStart: 6 }}>{counts[k]}</span> : null}</button>)}
      </div>
      {hint && <div className="sub" style={{ marginBottom: 12 }}>{hint}</div>}
      <div className="card list" style={{ padding: '4px 14px' }}>
        {rows.length === 0 && <div className="empty">ما فيه فواتير هنا</div>}
        {rows.map((v) => {
          const stg = STAGE[invoiceStage(v)]
          const late = v.status === 'approved' && v.payment_status !== 'paid' && v.due_date && v.due_date < today
          return (
            <Link key={v.id} to={`/inventory/invoices/${v.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="avatar"><Icon name="receipt" /></span>
              <span className="grow"><div style={{ fontWeight: 600 }}>{v.suppliers?.name || v.supplier_name_read || 'مورد غير محدد'}</div>
                <div className="sub">{v.invoice_no ? `رقم ${v.invoice_no} · ` : ''}{fmtDate(v.invoice_date || v.created_at)} · {(v.purchase_invoice_lines || []).length} صنف{v.employees?.full_name ? ` · ${v.employees.full_name}` : ''}
                  {v.status === 'approved' && v.due_date ? ` · الاستحقاق ${fmtDate(v.due_date)}` : ''}</div></span>
              <span className="num" style={{ fontWeight: 600 }}>{kwd(total(v))}
                {v.status === 'approved' && Number(v.paid_amount) > 0 && v.payment_status !== 'paid' && <div className="sub">باقي {kwd(total(v) - Number(v.paid_amount))}</div>}</span>
              {v.status === 'approved'
                ? <span className={'pill ' + (late ? 'red' : PAY_STATUS[v.payment_status][0])}>{late ? 'متأخرة' : PAY_STATUS[v.payment_status][1]}</span>
                : <span className={'pill ' + stg[0]}>{v.status === 'failed' ? 'ما انقرت' : stg[1]}</span>}
            </Link>
          )
        })}
      </div>
      {creating && <NewInvoice onClose={() => { setCreating(false); if (params.get('new')) setParams({}) }} />}
    </div>
  )
}
