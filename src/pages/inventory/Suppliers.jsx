import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, invErr, clearLookups, invoiceStage, STAGE, PAY_STATUS, PAY_METHOD } from '../../lib/inv'
import { PaymentForm } from './Payments.jsx'
import Icon from '../../components/Icon.jsx'
import { uploadAttachment, readFile, readError, openFile, ACCEPT } from '../../lib/ai'

export function SupplierForm({ supplier, presetName, onClose, onSaved }) {
  const { access } = useAccess()
  const [f, setF] = useState({
    name: supplier?.name || presetName || '', phone: supplier?.phone || '', contact_name: supplier?.contact_name || '',
    payment_terms: supplier?.payment_terms || '', credit_days: supplier?.credit_days ?? 0, notes: supplier?.notes || '', active: supplier?.active ?? true,
    licence_no: supplier?.licence_no || '', licence_expiry: supplier?.licence_expiry || '', contract_expiry: supplier?.contract_expiry || '',
    doc_paths: supplier?.doc_paths || [],
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  // licence / contract / business card read by the AI fills the form and is kept with the supplier
  const read = async (file) => {
    if (!file) return
    setBusy(true); setScan(null)
    try {
      const path = await uploadAttachment(file, access.employee.id)
      const r = await readFile('supplier', [path])
      setF((x) => ({ ...x, doc_paths: [...x.doc_paths, path] }))
      if (!r.ok) { setScan({ ok: false, t: readError(r) }); setBusy(false); return }
      const d = r.data
      setF((x) => ({ ...x, name: x.name || d.company_name || '', phone: x.phone || d.phone || '', contact_name: x.contact_name || d.contact_name || '',
        payment_terms: x.payment_terms || d.payment_terms || '', licence_no: d.licence_no || x.licence_no,
        licence_expiry: d.licence_expiry || x.licence_expiry, contract_expiry: d.contract_expiry || x.contract_expiry }))
      const dup = !supplier && r.match?.supplier ? r.match.supplier : null
      setScan(dup ? { ok: false, t: `انتبه: هالمورد شكله موجود عندك باسم "${dup.name}".` }
        : { ok: true, t: `قرا الورقة: ${d.summary_ar || d.company_name || ''}` })
    } catch (e2) { setScan({ ok: false, t: invErr(e2) }) }
    setBusy(false)
  }
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const row = { ...f, credit_days: Math.max(0, parseInt(f.credit_days, 10) || 0), phone: f.phone || null, contact_name: f.contact_name || null, payment_terms: f.payment_terms || null, notes: f.notes || null,
      licence_no: f.licence_no || null, licence_expiry: f.licence_expiry || null, contract_expiry: f.contract_expiry || null,
      ...((f.licence_expiry !== (supplier?.licence_expiry || '') || f.contract_expiry !== (supplier?.contract_expiry || '')) ? { last_alert_stage: null } : {}) }
    const r = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id).select().single() : await supabase.from('suppliers').insert(row).select().single()
    setBusy(false)
    if (r.error) setErr(invErr(r.error)); else { clearLookups(); onSaved?.(r.data); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{supplier ? supplier.name : 'مورد جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <label className="upload" style={{ height: 76 }}>
          <input type="file" accept={ACCEPT} onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
          {busy ? <><span className="spinner" /> جاري القراءة…</> : <><Icon name="camera" /> ارفع رخصة المورد أو العقد أو الكرت، والنظام يعبّي البيانات</>}
        </label>
        {scan && <div className={scan.ok ? 'notice' : 'warn'}>{scan.t}</div>}
        <div className="field"><label htmlFor="sn">اسم المورد</label><input id="sn" className="input" value={f.name} onChange={set('name')} required /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="sp">رقم الهاتف</label><input id="sp" className="input ltr" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="sc">اسم المندوب</label><input id="sc" className="input" value={f.contact_name} onChange={set('contact_name')} /></div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="field"><label htmlFor="pt">طريقة الدفع</label><input id="pt" className="input" placeholder="مثلاً: كاش، آجل ٣٠ يوم" value={f.payment_terms} onChange={set('payment_terms')} /></div>
          <div className="field"><label htmlFor="cd">مهلة الدفع (يوم)</label><input id="cd" className="input num" type="number" min="0" value={f.credit_days} onChange={set('credit_days')} /></div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="field"><label htmlFor="ln">رقم الرخصة التجارية</label><input id="ln" className="input ltr" value={f.licence_no} onChange={set('licence_no')} /></div>
          <div className="field"><label htmlFor="le">انتهاء الرخصة</label><input id="le" type="date" className="input" value={f.licence_expiry} onChange={set('licence_expiry')} /></div>
          <div className="field"><label htmlFor="ce">انتهاء العقد</label><input id="ce" type="date" className="input" value={f.contract_expiry} onChange={set('contract_expiry')} /></div>
        </div>
        {f.doc_paths.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="sub">الأوراق:</span>
          {f.doc_paths.map((p, i) => <button type="button" key={p} className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', p)}>ورقة {i + 1}</button>)}</div>}
        <div className="field"><label htmlFor="no">ملاحظات</label><input id="no" className="input" value={f.notes} onChange={set('notes')} /></div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> المورد شغال معانا</label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>حفظ</button>
      </form>
    </div>
  )
}

function SupplierSheet({ supplier, canEdit, onClose, onChanged }) {
  const { can } = useAccess()
  const [items, setItems] = useState([])
  const [invoices, setInvoices] = useState([])
  const [stmt, setStmt] = useState(null)
  const [edit, setEdit] = useState(false)
  const [paying, setPaying] = useState(false)
  const [tab, setTab] = useState('statement')
  const canStmt = can('supplier_payments') || can('approve_purchases') || can('view_reports')
  const load = useCallback(() => {
    supabase.from('supplier_items').select('last_price,last_date,pack_factor,pack_unit,inv_items(name_ar,name_en,inv_units(name))').eq('supplier_id', supplier.id).order('last_date', { ascending: false }).then(({ data }) => setItems(data || []))
    supabase.from('purchase_invoices').select('id,invoice_no,invoice_date,status,received_at,created_at,total_due,paid_amount,payment_status,due_date,discount,purchase_invoice_lines(qty,unit_price)').eq('supplier_id', supplier.id).order('created_at', { ascending: false }).limit(60).then(({ data }) => setInvoices(data || []))
    if (canStmt) supabase.rpc('supplier_statement', { p_supplier: supplier.id }).then(({ data }) => setStmt(data || null))
  }, [supplier.id, canStmt])
  useEffect(() => { load() }, [load])
  const total = (v) => v.total_due != null ? Number(v.total_due) : (v.purchase_invoice_lines || []).reduce((a, l) => a + l.qty * l.unit_price, 0) - Number(v.discount || 0)
  const openInv = invoices.filter((v) => v.status === 'approved' && v.payment_status !== 'paid')
  const balance = stmt ? Number(stmt.invoiced) - Number(stmt.paid) : null
  let run = 0
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><div><h2 style={{ fontSize: 20 }}>{supplier.name}</h2>
          <div className="sub">{[supplier.phone, supplier.contact_name, supplier.payment_terms, supplier.credit_days ? `مهلة الدفع ${supplier.credit_days} يوم` : 'الدفع فوري'].filter(Boolean).join(' · ')}</div>
          {(supplier.licence_expiry || supplier.contract_expiry) && <div className="sub">{[supplier.licence_no && `رخصة ${supplier.licence_no}`, supplier.licence_expiry && `تنتهي ${fmtDate(supplier.licence_expiry)}`, supplier.contract_expiry && `العقد ينتهي ${fmtDate(supplier.contract_expiry)}`].filter(Boolean).join(' · ')}</div>}
          {supplier.doc_paths?.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{supplier.doc_paths.map((p, i) => <button type="button" key={p} className="chip" style={{ minHeight: 28 }} onClick={() => openFile('attachments', p)}>ورقة {i + 1}</button>)}</div>}</div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        {canEdit && <button className="btn" onClick={() => setEdit(true)}>تعديل بيانات المورد</button>}

        {stmt && (
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
            <div><div className="sub">الرصيد علينا</div><div className="num" style={{ fontWeight: 700, fontSize: 18, color: balance > 0.0005 ? 'var(--red)' : 'var(--ok)' }}>{kwd(balance)}</div></div>
            <div><div className="sub">متأخر الدفع</div><div className="num" style={{ fontWeight: 600, color: Number(stmt.overdue) > 0 ? 'var(--red)' : undefined }}>{kwd(stmt.overdue)}</div></div>
            <div><div className="sub">إجمالي الفواتير</div><div className="num" style={{ fontWeight: 600 }}>{kwd(stmt.invoiced)}</div></div>
            <div><div className="sub">إجمالي المدفوع</div><div className="num" style={{ fontWeight: 600 }}>{kwd(stmt.paid)}</div></div>
            {Number(stmt.free_value) > 0 && <div><div className="sub">بضاعة مجانية منه</div><div className="num" style={{ fontWeight: 600 }}>{kwd(stmt.free_value)}</div></div>}
          </div>)}
        {can('supplier_payments') && <button className="btn primary" onClick={() => setPaying(true)}><Icon name="check" /> تسجيل دفعة</button>}

        <div className="chips">
          {canStmt && <button className={'chip' + (tab === 'statement' ? ' on' : '')} onClick={() => setTab('statement')}>كشف الحساب</button>}
          <button className={'chip' + (tab === 'invoices' || (!canStmt && tab === 'statement') ? ' on' : '')} onClick={() => setTab('invoices')}>الفواتير</button>
          <button className={'chip' + (tab === 'items' ? ' on' : '')} onClick={() => setTab('items')}>الأصناف والأسعار</button>
        </div>

        {tab === 'statement' && canStmt && (
          <div className="card list" style={{ padding: '4px 12px' }}>
            {!stmt?.rows?.length ? <div className="empty">ما فيه حركات للحين</div> : stmt.rows.map((r) => {
              run += Number(r.debit) - Number(r.credit)
              const late = r.kind === 'invoice' && r.payment_status !== 'paid' && r.due_date && r.due_date < today
              return (
                <div key={r.kind + r.id} className="list-item">
                  <span className="grow">{r.kind === 'invoice'
                    ? <Link to={`/inventory/invoices/${r.id}`}>فاتورة {r.ref || ''}</Link>
                    : <span>دفعة {PAY_METHOD[r.payment_status] || ''}{r.ref ? ` · ${r.ref}` : ''}</span>}
                    <div className="sub">{fmtDate(r.d)}{r.kind === 'invoice' && r.due_date ? ` · الاستحقاق ${fmtDate(r.due_date)}` : ''}</div></span>
                  {r.kind === 'invoice' && <span className={'pill ' + (late ? 'red' : PAY_STATUS[r.payment_status]?.[0])}>{late ? 'متأخرة' : PAY_STATUS[r.payment_status]?.[1]}</span>}
                  <span className="num" style={{ minWidth: 80, textAlign: 'left', color: r.kind === 'payment' ? 'var(--ok)' : undefined }}>{r.kind === 'payment' ? '− ' : '+ '}{kwd(r.kind === 'payment' ? r.credit : r.debit)}</span>
                  <span className="num sub" style={{ minWidth: 80, textAlign: 'left' }}>{kwd(run)}</span>
                </div>)
            })}
          </div>)}

        {(tab === 'invoices' || (!canStmt && tab === 'statement')) && (
          <div className="card list" style={{ padding: '4px 12px' }}>
            {invoices.length === 0 ? <div className="empty">ما فيه فواتير</div> :
              invoices.map((v) => { const st = STAGE[invoiceStage(v)]; return (
                <Link key={v.id} to={`/inventory/invoices/${v.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="grow">{v.invoice_no ? `رقم ${v.invoice_no}` : 'بدون رقم'}<div className="sub">{fmtDate(v.invoice_date || v.created_at)}</div></span>
                  <span className="num">{kwd(total(v))}</span>
                  {v.status === 'approved' ? <span className={'pill ' + PAY_STATUS[v.payment_status][0]}>{PAY_STATUS[v.payment_status][1]}</span>
                    : <span className={'pill ' + st[0]}>{st[1]}</span>}</Link>) })}
          </div>)}

        {tab === 'items' && (
          <div className="card list" style={{ padding: '4px 12px' }}>
            {items.length === 0 ? <div className="empty">تبين هنا بعد أول فاتورة تمت مراجعتها</div> :
              items.map((x, i) => <div key={i} className="list-item">
                <span className="grow">{x.inv_items?.name_ar}<div className="sub">{fmtDate(x.last_date)}{Number(x.pack_factor) !== 1 ? ` · ${x.pack_unit || 'الوحدة'} = ${x.pack_factor} ${x.inv_items?.inv_units?.name || ''}` : ''}</div></span>
                <span className="num">{kwd(x.last_price)}</span><span className="sub">/{Number(x.pack_factor) !== 1 ? (x.pack_unit || 'وحدة') : x.inv_items?.inv_units?.name || ''}</span></div>)}
          </div>)}
      </div>
      {edit && <SupplierForm supplier={supplier} onClose={() => setEdit(false)} onSaved={() => { onChanged(); onClose() }} />}
      {paying && <PaymentForm supplierId={supplier.id} supplierName={supplier.name} openInvoices={openInv} onClose={() => setPaying(false)} onSaved={() => { load(); onChanged() }} />}
    </div>
  )
}

export default function Suppliers() {
  const { can } = useAccess()
  const [list, setList] = useState([])
  const [stats, setStats] = useState({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const canEdit = can('manage_suppliers')
  const [owed, setOwed] = useState({})
  const load = useCallback(() => {
    supabase.from('suppliers').select('*').order('active', { ascending: false }).order('name').then(({ data }) => setList(data || []))
    supabase.from('purchase_invoices').select('supplier_id,invoice_date,created_at,total_due,discount,purchase_invoice_lines(qty,unit_price)').eq('status', 'approved')
      .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
      .then(({ data }) => {
        const s = {}
        for (const v of data || []) {
          const t = v.total_due != null ? Number(v.total_due) : (v.purchase_invoice_lines || []).reduce((a, l) => a + l.qty * l.unit_price, 0) - Number(v.discount || 0)
          const x = (s[v.supplier_id] ||= { n: 0, total: 0, last: null })
          x.n++; x.total += t
          const d = v.invoice_date || v.created_at
          if (!x.last || d > x.last) x.last = d
        }
        setStats(s)
      })
    supabase.from('purchase_invoices').select('supplier_id,total_due,paid_amount,due_date').eq('status', 'approved').neq('payment_status', 'paid').then(({ data }) => {
      const o = {}, now = new Date().toISOString().slice(0, 10)
      for (const v of data || []) { const x = (o[v.supplier_id] ||= { amt: 0, late: 0 }); const r = Number(v.total_due || 0) - Number(v.paid_amount || 0); x.amt += r; if (v.due_date && v.due_date < now) x.late += r }
      setOwed(o)
    })
  }, [])
  useEffect(() => { load() }, [load])
  const shown = useMemo(() => list.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || (s.phone || '').includes(q.trim())), [list, q])

  return (
    <div>
      <div className="page-head"><div><h1>الموردين</h1><div className="sub">الأرقام لآخر ٩٠ يوم من الفواتير المعتمدة</div></div>
        {canEdit && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> مورد جديد</button>}</div>
      <div className="toolbar"><div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر بالاسم أو الرقم" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {shown.length === 0 && <div className="empty">ما فيه موردين. أضف أول مورد، أو صوّر فاتورة والنظام يقترح اسم المورد.</div>}
        {shown.map((s) => {
          const st = stats[s.id]
          return (
            <button key={s.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => setOpen(s)}>
              <span className="avatar"><Icon name="truck" /></span>
              <span className="grow"><div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="sub">{st ? `${st.n} فاتورة · آخر وحدة ${fmtDate(st.last)}` : 'ما فيه فواتير معتمدة'}{s.phone ? ` · ${s.phone}` : ''}</div></span>
              {st && <span className="num" style={{ fontWeight: 600 }}>{kwd(st.total)}</span>}
              {owed[s.id]?.amt > 0.0005 && <span className={'pill ' + (owed[s.id].late > 0 ? 'red' : 'amber')}>علينا {kwd(owed[s.id].amt)}</span>}
              {(() => { const d = [s.licence_expiry, s.contract_expiry].filter(Boolean).sort()[0]; if (!d) return null; const left = Math.round((new Date(d) - new Date()) / 864e5)
                return left < 0 ? <span className="pill red">ورقة منتهية</span> : left <= 30 ? <span className="pill amber">ورقة تنتهي بعد {left} يوم</span> : null })()}
              {!s.active && <span className="pill gray">موقوف</span>}
            </button>
          )
        })}
      </div>
      {open && <SupplierSheet supplier={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={load} />}
      {adding && <SupplierForm onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  )
}
