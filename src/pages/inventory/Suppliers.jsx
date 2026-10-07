import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, INVOICE_STATUS, invErr, clearLookups } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

export function SupplierForm({ supplier, presetName, onClose, onSaved }) {
  const [f, setF] = useState({
    name: supplier?.name || presetName || '', phone: supplier?.phone || '', contact_name: supplier?.contact_name || '',
    payment_terms: supplier?.payment_terms || '', notes: supplier?.notes || '', active: supplier?.active ?? true,
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const row = { ...f, phone: f.phone || null, contact_name: f.contact_name || null, payment_terms: f.payment_terms || null, notes: f.notes || null }
    const r = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id).select().single() : await supabase.from('suppliers').insert(row).select().single()
    setBusy(false)
    if (r.error) setErr(invErr(r.error)); else { clearLookups(); onSaved?.(r.data); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{supplier ? supplier.name : 'مورد جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="sn">اسم المورد</label><input id="sn" className="input" value={f.name} onChange={set('name')} required /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="sp">رقم الهاتف</label><input id="sp" className="input ltr" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="sc">اسم المندوب</label><input id="sc" className="input" value={f.contact_name} onChange={set('contact_name')} /></div>
        </div>
        <div className="field"><label htmlFor="pt">طريقة الدفع</label><input id="pt" className="input" placeholder="مثلاً: كاش، آجل ٣٠ يوم" value={f.payment_terms} onChange={set('payment_terms')} /></div>
        <div className="field"><label htmlFor="no">ملاحظات</label><input id="no" className="input" value={f.notes} onChange={set('notes')} /></div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> المورد شغال معانا</label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>حفظ</button>
      </form>
    </div>
  )
}

function SupplierSheet({ supplier, canEdit, onClose, onChanged }) {
  const [items, setItems] = useState([])
  const [invoices, setInvoices] = useState([])
  const [edit, setEdit] = useState(false)
  useEffect(() => {
    supabase.from('supplier_items').select('last_price,last_date,inv_items(name_ar,name_en,inv_units(name))').eq('supplier_id', supplier.id).order('last_date', { ascending: false }).then(({ data }) => setItems(data || []))
    supabase.from('purchase_invoices').select('id,invoice_no,invoice_date,status,created_at,purchase_invoice_lines(qty,unit_price)').eq('supplier_id', supplier.id).order('created_at', { ascending: false }).limit(20).then(({ data }) => setInvoices(data || []))
  }, [supplier.id])
  const total = (inv) => (inv.purchase_invoice_lines || []).reduce((a, l) => a + l.qty * l.unit_price, 0)
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><div><h2 style={{ fontSize: 20 }}>{supplier.name}</h2>
          <div className="sub">{[supplier.phone, supplier.contact_name, supplier.payment_terms].filter(Boolean).join(' · ') || '—'}</div></div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        {canEdit && <button className="btn" onClick={() => setEdit(true)}>تعديل بيانات المورد</button>}
        <div className="card"><strong style={{ fontSize: 14 }}>الأصناف اللي ناخذها منه وآخر سعر</strong>
          {items.length === 0 ? <div className="empty">تبين هنا بعد أول فاتورة معتمدة</div> :
            <div className="list">{items.map((x, i) => <div key={i} className="list-item">
              <span className="grow">{x.inv_items?.name_ar}<div className="sub">{fmtDate(x.last_date)}</div></span>
              <span className="num">{kwd(x.last_price)}</span><span className="sub">/{x.inv_items?.inv_units?.name || ''}</span></div>)}</div>}</div>
        <div className="card"><strong style={{ fontSize: 14 }}>الفواتير</strong>
          {invoices.length === 0 ? <div className="empty">ما فيه فواتير</div> :
            <div className="list">{invoices.map((v) => <Link key={v.id} to={`/inventory/invoices/${v.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="grow">{v.invoice_no ? `رقم ${v.invoice_no}` : 'بدون رقم'}<div className="sub">{fmtDate(v.invoice_date || v.created_at)}</div></span>
              <span className="num">{kwd(total(v))}</span>
              <span className={'pill ' + INVOICE_STATUS[v.status][0]}>{INVOICE_STATUS[v.status][1]}</span></Link>)}</div>}</div>
      </div>
      {edit && <SupplierForm supplier={supplier} onClose={() => setEdit(false)} onSaved={() => { onChanged(); onClose() }} />}
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
  const load = useCallback(() => {
    supabase.from('suppliers').select('*').order('active', { ascending: false }).order('name').then(({ data }) => setList(data || []))
    supabase.from('purchase_invoices').select('supplier_id,invoice_date,created_at,purchase_invoice_lines(qty,unit_price)').eq('status', 'approved')
      .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
      .then(({ data }) => {
        const s = {}
        for (const v of data || []) {
          const t = (v.purchase_invoice_lines || []).reduce((a, l) => a + l.qty * l.unit_price, 0)
          const x = (s[v.supplier_id] ||= { n: 0, total: 0, last: null })
          x.n++; x.total += t
          const d = v.invoice_date || v.created_at
          if (!x.last || d > x.last) x.last = d
        }
        setStats(s)
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
