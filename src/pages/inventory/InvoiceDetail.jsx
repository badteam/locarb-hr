import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, qtyFmt, loadLookups, invErr, pctChange, invoiceStage, STAGE, PAY_STATUS, PAY_METHOD, ISSUES, lineRecv, linePayable } from '../../lib/inv'
import { startRead, compress } from './Invoices.jsx'
import { PaymentForm } from './Payments.jsx'
import { ItemForm } from './Inventory.jsx'
import { SupplierForm } from './Suppliers.jsx'
import Icon from '../../components/Icon.jsx'

let tmpId = 0

function ItemPicker({ line, supplierId, disabled, canCreate, lookups, onPick }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState([])
  const [creating, setCreating] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const text = q.trim() || line.raw_name || ''
    if (text.length < 2) { setOpts([]); return }
    const t = setTimeout(() => {
      supabase.rpc('match_items', { p_name: text, p_supplier: supplierId || null, p_limit: 8 }).then(({ data }) => setOpts(data || []))
    }, 200)
    return () => clearTimeout(t)
  }, [open, q, line.raw_name, supplierId])

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const label = line.item ? line.item.name_ar : null
  return (
    <div className="picker" ref={box}>
      <button type="button" className="input" disabled={disabled} onClick={() => setOpen(!open)}
        style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', borderColor: label ? undefined : '#E8B65A', background: label ? '#fff' : '#FFFBEB' }}>
        {label ? <><Icon name="check" size={16} /><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          {line.match_score != null && line.match_score < 0.75 && line.auto && <span className="pill amber">تأكد</span>}</>
          : <span style={{ color: 'var(--amber)' }}>اربط بصنف من المخزون…</span>}
      </button>
      {open && (
        <div className="picker-menu">
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input className="input" autoFocus placeholder="دوّر على الصنف" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {opts.map((o) => (
            <button type="button" key={o.item_id} onClick={() => { onPick({ id: o.item_id, name_ar: o.name_ar, name_en: o.name_en, unit: o.unit }); setOpen(false); setQ('') }}>
              <div style={{ fontWeight: 500 }}>{o.name_ar}</div>
              <div className="cell-sub"><span className="ltr">{o.name_en}</span>{o.unit ? ` · ${o.unit}` : ''}{o.via === 'alias' ? ' · نفس اسم الفاتورة السابقة' : ''}</div>
            </button>
          ))}
          {opts.length === 0 && <div className="empty" style={{ padding: 14 }}>ما لقينا صنف مشابه</div>}
          {canCreate && <button type="button" style={{ color: 'var(--green)', fontWeight: 600 }} onClick={() => { setCreating(true); setOpen(false) }}>+ إضافة "{(q || line.raw_name || '').slice(0, 40)}" كصنف جديد</button>}
        </div>
      )}
      {creating && <ItemForm lookups={lookups} presetName={q || line.raw_name} onClose={() => setCreating(false)}
        onSaved={(it) => onPick({ id: it.id, name_ar: it.name_ar, name_en: it.name_en, unit: lookups.units.find((u) => u.id === it.unit_id)?.name })} />}
    </div>
  )
}

function Photos({ urls, title }) {
  if (!urls.length) return null
  return (
    <div>
      {title && <div className="sub" style={{ margin: '8px 4px' }}>{title}</div>}
      {urls.map((u, i) => u.pdf
        ? <a key={i} href={u.url} target="_blank" rel="noreferrer" className="btn" style={{ margin: 12 }}>فتح ملف PDF</a>
        : <a key={i} href={u.url} target="_blank" rel="noreferrer"><img src={u.url} alt={`${title || 'صورة'} ${i + 1}`} /></a>)}
    </div>
  )
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { can } = useAccess()
  const [inv, setInv] = useState(null)
  const [head, setHead] = useState({})
  const [lines, setLines] = useState([])
  const [removed, setRemoved] = useState([])
  const [urls, setUrls] = useState([])
  const [goodsUrls, setGoodsUrls] = useState([])
  const [lookups, setLookups] = useState(null)
  const [prev, setPrev] = useState({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [dup, setDup] = useState(null)
  const [addSupplier, setAddSupplier] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [names, setNames] = useState({})
  const [payments, setPayments] = useState([])
  const [paying, setPaying] = useState(false)

  const canReceive = can('receive_goods') || can('manage_suppliers') || can('approve_purchases')
  const canReview = can('approve_purchases')
  const canPay = can('supplier_payments')

  const signed = async (paths) => {
    if (!paths?.length) return []
    const { data: s } = await supabase.storage.from('invoices').createSignedUrls(paths, 3600)
    return (s || []).map((x, i) => ({ url: x.signedUrl, pdf: paths[i].endsWith('.pdf') }))
  }

  const load = useCallback(async () => {
    const { data } = await supabase.from('purchase_invoices').select('*, purchase_invoice_lines(*, inv_items:item_id(id,name_ar,name_en,inv_units(name)))').eq('id', id).maybeSingle()
    if (!data) { setInv(false); return }
    setInv(data)
    setHead({ supplier_id: data.supplier_id || '', invoice_no: data.invoice_no || '', invoice_date: data.invoice_date || '', branch_id: data.branch_id,
      discount: data.discount ?? 0, extra_charges: data.extra_charges ?? 0, notes: data.notes || '' })
    setLines((data.purchase_invoice_lines || []).sort((a, b) => a.line_no - b.line_no).map((l) => ({
      ...l, auto: true, received_qty: l.received_qty ?? '', charge_price: l.charge_price ?? '',
      item: l.inv_items ? { id: l.inv_items.id, name_ar: l.inv_items.name_ar, name_en: l.inv_items.name_en, unit: l.inv_items.inv_units?.name } : null,
    })))
    setRemoved([]); setDirty(false)
    const ids = [data.created_by, data.approved_by, data.received_by].filter(Boolean)
    if (ids.length) supabase.from('employees').select('id,full_name').in('id', ids).then(({ data: e }) => setNames(Object.fromEntries((e || []).map((x) => [x.id, x.full_name]))))
    setUrls(await signed(data.image_paths))
    setGoodsUrls(await signed(data.goods_photo_paths))
    if (data.status !== 'approved' && data.status !== 'rejected' && data.supplier_id && data.invoice_no) {
      supabase.rpc('check_invoice_duplicate', { p_invoice: id }).then(({ data: d }) => setDup(d || null))
    } else setDup(null)
    if (data.status === 'approved') {
      supabase.from('supplier_payments').select('*').eq('invoice_id', id).order('paid_at').then(({ data: p }) => setPayments(p || []))
    }
  }, [id])

  useEffect(() => { load(); loadLookups(true).then(setLookups) }, [load])

  // follow the reader while it works
  useEffect(() => {
    if (inv?.status !== 'reading' && !(inv?.status === 'draft' && inv?.image_paths?.length && !inv?.read_error && !(inv?.purchase_invoice_lines || []).length && Date.now() - new Date(inv.created_at) < 120000)) return
    const t = setInterval(async () => {
      const { data } = await supabase.from('purchase_invoices').select('status').eq('id', id).single()
      if (data && data.status !== inv.status) load()
    }, 2500)
    return () => clearInterval(t)
  }, [inv, id, load])

  // previous prices for the linked items (per supplier unit when known)
  const itemKey = lines.map((l) => l.item?.id).join(',') + '|' + head.supplier_id
  useEffect(() => {
    const ids = [...new Set(lines.map((l) => l.item?.id).filter(Boolean))]
    if (!ids.length) { setPrev({}); return }
    Promise.all([
      supabase.from('inv_items').select('id,last_price').in('id', ids),
      head.supplier_id ? supabase.from('supplier_items').select('item_id,last_price,pack_factor').eq('supplier_id', head.supplier_id).in('item_id', ids) : Promise.resolve({ data: [] }),
    ]).then(([a, b]) => {
      const p = Object.fromEntries((a.data || []).map((x) => [x.id, { unit: Number(x.last_price) }]))
      for (const x of b.data || []) p[x.item_id] = { unit: Number(x.last_price) / (Number(x.pack_factor) || 1) }
      setPrev(p)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])

  if (inv === false) return <div className="card empty">الفاتورة مو موجودة</div>
  if (!inv || !lookups) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  const stage = invoiceStage(inv)
  const editable = inv.status !== 'reading' && ((stage === 'receive' && canReceive) || (stage === 'review' && canReview))
  const setH = (k) => (e) => { setHead({ ...head, [k]: e.target.value }); setDirty(true) }
  const setL = (i, patch) => { setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true) }
  const setIssue = (i, issue) => {
    const l = lines[i]
    const patch = { issue }
    if (issue === 'none') Object.assign(patch, { received_qty: '', charge_price: '', issue_note: l.issue_note })
    if (issue === 'return') patch.received_qty = 0
    if (issue === 'short') patch.received_qty = l.received_qty === '' ? '' : l.received_qty
    if (issue === 'free') Object.assign(patch, { received_qty: l.received_qty === '' || Number(l.received_qty) === 0 ? '' : l.received_qty, charge_price: 0 })
    if (issue === 'discount') Object.assign(patch, { charge_price: l.unit_price, received_qty: l.received_qty })
    if (issue !== 'free' && l.issue === 'free') patch.charge_price = issue === 'discount' ? l.unit_price : ''
    setL(i, patch)
  }
  const addLine = () => { setLines([...lines, { tmp: ++tmpId, raw_name: '', qty: 1, unit_price: 0, item: null, issue: 'none', received_qty: '', charge_price: '', pack_factor: 1, posted_qty: 0 }]); setDirty(true) }
  const delLine = (i) => {
    const l = lines[i]
    if (Number(l.posted_qty) !== 0) { setErr('السطر هذا دخل المخزون. خلّ "استلمت فعلاً" صفر بدال ما تمسحه'); return }
    if (l.id) setRemoved([...removed, l.id]); setLines(lines.filter((_, j) => j !== i)); setDirty(true)
  }

  const sum = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
  const written = sum - (Number(head.discount) || 0) + (Number(head.extra_charges) || 0)
  const payable = lines.reduce((a, l) => a + linePayable(l), 0) - (Number(head.discount) || 0) + (Number(head.extra_charges) || 0)
  const issueGap = sum - lines.reduce((a, l) => a + linePayable(l), 0)
  const mismatch = inv.total_read != null && Math.abs(written - Number(inv.total_read)) > 0.01
  const unlinked = lines.filter((l) => !l.item).length
  const supplier = lookups.suppliers.find((s) => s.id === head.supplier_id)
  const due = Number(inv.total_due ?? payable)
  const remaining = Math.max(0, due - Number(inv.paid_amount || 0))
  const late = inv.status === 'approved' && inv.payment_status !== 'paid' && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10)

  const save = async () => {
    setErr('')
    const h = { supplier_id: head.supplier_id || null, invoice_no: head.invoice_no?.trim() || null, invoice_date: head.invoice_date || null, branch_id: head.branch_id,
      discount: Number(head.discount) || 0, extra_charges: Number(head.extra_charges) || 0, notes: head.notes || null }
    const r1 = await supabase.from('purchase_invoices').update(h).eq('id', id)
    if (r1.error) throw r1.error
    if (removed.length) { const r = await supabase.from('purchase_invoice_lines').delete().in('id', removed); if (r.error) throw r.error }
    const rows = lines.map((l, i) => ({
      ...(l.id ? { id: l.id } : {}), invoice_id: id, line_no: i + 1, raw_name: l.raw_name || null, item_id: l.item?.id || null,
      qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0, unit_text: l.unit_text || null,
      line_total: Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * 1000) / 1000, match_score: l.match_score ?? null,
      issue: l.issue || 'none', issue_note: l.issue_note || null, pack_factor: Number(l.pack_factor) > 0 ? Number(l.pack_factor) : 1,
      received_qty: l.issue && l.issue !== 'none' && l.received_qty !== '' ? Number(l.received_qty) || 0 : null,
      charge_price: l.issue === 'free' ? 0 : l.issue === 'discount' && l.charge_price !== '' ? Number(l.charge_price) || 0 : null,
    }))
    const existing = rows.filter((r) => r.id), fresh = rows.filter((r) => !r.id)
    if (existing.length) { const r = await supabase.from('purchase_invoice_lines').upsert(existing); if (r.error) throw r.error }
    if (fresh.length) { const r = await supabase.from('purchase_invoice_lines').insert(fresh); if (r.error) throw r.error }
  }

  const run = async (what, fn) => {
    setBusy(what); setErr(''); setMsg('')
    try { await fn() } catch (e) { setErr(invErr(e)) }
    setBusy('')
  }

  const onSave = () => run('save', async () => { await save(); await load(); setMsg('انحفظت') })
  const onReceive = () => run('receive', async () => {
    await save()
    const { data, error } = await supabase.rpc('receive_purchase_invoice', { p_invoice: id, p_note: null })
    if (error) throw error
    await load()
    setMsg(`تم الاستلام. دخل المخزون ${data.posted} صنف${data.pending ? ` · ${data.pending} سطر غير مربوط بصنف، يدخل لما المحاسب يربطه` : ''}. الفاتورة الحين عند المحاسب للمراجعة.`)
  })
  const onReview = () => run('review', async () => {
    await save()
    const { data, error } = await supabase.rpc('review_purchase_invoice', { p_invoice: id, p_note: reviewNote || null })
    if (error) throw error
    await load()
    setMsg(`تمت المراجعة. المستحق للمورد ${kwd(data.total)} د.ك${data.price_rises?.length ? ` · زيادة أسعار: ${data.price_rises.join('، ')}` : ''}`)
  })
  const onReject = () => run('reject', async () => {
    const { error } = await supabase.rpc('reject_purchase_invoice', { p_invoice: id, p_note: rejectNote || null })
    if (error) throw error
    setRejecting(false); await load()
  })
  const onReread = () => run('read', async () => {
    if (lines.length && !window.confirm('القراءة من جديد بتمسح الأسطر الحالية. تكمل؟')) return
    setInv({ ...inv, status: 'reading' })
    const r = await startRead(id)
    await load()
    if (r?.error === 'not_configured') setErr('قراءة الصور لسه ما تفعّلت. المالك يحط المفتاح من صفحة الإعدادات. تقدر تدخل الأصناف يدوي.')
    else if (r?.error === 'invalid_key') setErr('مفتاح قراءة الفواتير غلط. المالك يغيّره من صفحة الإعدادات.')
    else if (r?.error === 'no_credit') setErr('رصيد حساب Anthropic خلص. اشحن الرصيد وجرّب من جديد.')
    else if (r?.error === 'unreadable') setErr('ما قدرنا نقرا الصورة. صوّرها من جديد بإضاءة أوضح، أو دخّل الأصناف يدوي.')
    else if (r?.error) setErr('صار خطأ في القراءة: ' + r.error)
  })
  const onDelete = () => run('delete', async () => {
    if (!window.confirm('تمسح الفاتورة؟')) return
    const { error } = await supabase.from('purchase_invoices').delete().eq('id', id)
    if (error) throw error
    const all = [...(inv.image_paths || []), ...(inv.goods_photo_paths || [])]
    if (all.length) await supabase.storage.from('invoices').remove(all)
    nav('/inventory/invoices')
  })
  const addGoods = (files) => run('goods', async () => {
    const paths = [...(inv.goods_photo_paths || [])]
    for (const file of files) {
      const f = await compress(file)
      const path = `${id}/goods-${paths.length + 1}-${Date.now()}.jpg`
      const up = await supabase.storage.from('invoices').upload(path, f, { contentType: f.type || 'image/jpeg' })
      if (up.error) throw up.error
      paths.push(path)
    }
    const r = await supabase.from('purchase_invoices').update({ goods_photo_paths: paths }).eq('id', id)
    if (r.error) throw r.error
    setInv({ ...inv, goods_photo_paths: paths }); setGoodsUrls(await signed(paths))
  })

  const stg = STAGE[stage]
  return (
    <div>
      <div className="page-head">
        <div><Link to="/inventory/invoices" className="sub" style={{ textDecoration: 'none' }}>→ فواتير الموردين</Link>
          <h1 style={{ marginTop: 4 }}>{supplier?.name || inv.supplier_name_read || 'فاتورة مورد'}</h1>
          <div className="sub">{names[inv.created_by] ? `أدخلها ${names[inv.created_by]} · ` : ''}{fmtDate(inv.created_at)}</div></div>
        <div className="row" style={{ gap: 6 }}>
          <span className={'pill ' + stg[0]} style={{ fontSize: 14, padding: '6px 14px' }}>{inv.status === 'failed' ? 'ما انقرت' : stg[1]}</span>
          {inv.status === 'approved' && <span className={'pill ' + (late ? 'red' : PAY_STATUS[inv.payment_status][0])} style={{ fontSize: 14, padding: '6px 14px' }}>{late ? 'متأخرة الدفع' : PAY_STATUS[inv.payment_status][1]}</span>}
        </div>
      </div>

      {/* where the invoice is in the flow */}
      <div className="chips" style={{ marginBottom: 14, pointerEvents: 'none' }}>
        {[['receive', '١ الاستلام'], ['review', '٢ مراجعة المحاسب'], ['approved', '٣ الدفع']].map(([k, l]) => {
          const order = { receive: 0, reading: 0, review: 1, approved: 2, rejected: -1 }
          const done = order[stage] > order[k], on = order[stage] === order[k] || (k === 'receive' && stage === 'reading')
          return <span key={k} className={'chip' + (on ? ' on' : '')} style={done ? { opacity: 0.7 } : undefined}>{done ? '✓ ' : ''}{l}</span>
        })}
      </div>

      {inv.status === 'reading' && <div className="notice row" style={{ marginBottom: 14 }}><span className="spinner" /> جاري قراءة الفاتورة… تاخذ تقريباً ٢٠ ثانية.</div>}
      {inv.status === 'failed' && <div className="error" style={{ marginBottom: 14 }}>{inv.read_error === 'invalid_key' ? 'مفتاح قراءة الفواتير غلط. المالك يغيّره من صفحة الإعدادات، وبعدين اضغط "اقرا الصورة من جديد".'
        : inv.read_error === 'no_credit' ? 'رصيد حساب Anthropic خلص. اشحن الرصيد، وبعدين اضغط "اقرا الصورة من جديد".'
        : 'ما قدرنا نقرا الفاتورة. جرّب تصورها من جديد بإضاءة أوضح، أو دخّل الأصناف يدوي.'}</div>}
      {inv.read_error === 'not_configured' && inv.status === 'draft' && <div className="warn" style={{ marginBottom: 14 }}><Icon name="warn" /> قراءة الصور لسه ما تفعّلت (المالك يفعّلها من صفحة الإعدادات). دخّل الأصناف يدوي، والصورة محفوظة مع الفاتورة.</div>}
      {dup && <div className="error" style={{ marginBottom: 14 }}><Icon name="warn" /> انتبه: نفس المورد عنده فاتورة مدخلة من قبل بنفس الرقم {dup}. لا تدخلها مرتين.</div>}
      {inv.received_at && <div className="notice" style={{ marginBottom: 10 }}>استلمها {names[inv.received_by] || '—'} · {fmtDate(inv.received_at)}. البضاعة دخلت المخزون.{inv.receive_note ? ` ملاحظة: ${inv.receive_note}` : ''}</div>}
      {stage === 'review' && !canReview && <div className="notice" style={{ marginBottom: 14 }}>الفاتورة الحين عند المحاسب للمراجعة.</div>}
      {inv.status === 'approved' && <div className="notice" style={{ marginBottom: 14 }}>راجعها {names[inv.approved_by] || '—'} · {fmtDate(inv.approved_at)}{inv.review_note ? ` · ${inv.review_note}` : ''}</div>}
      {inv.status === 'rejected' && <div className="error" style={{ marginBottom: 14 }}>انرفضت{inv.reject_note ? `: ${inv.reject_note}` : ''}{inv.received_at ? '. كمياتها طلعت من المخزون.' : ''}</div>}
      {msg && <div className="notice" style={{ marginBottom: 14 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 14 }}>{err}</div>}

      <div className={urls.length || goodsUrls.length ? 'inv-split' : ''}>
        {(urls.length > 0 || goodsUrls.length > 0) && <div className="photo-box">
          <Photos urls={urls} title={goodsUrls.length ? 'الفاتورة' : ''} />
          <Photos urls={goodsUrls} title="البضاعة كما وصلت" />
        </div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card form" style={{ gap: 12 }}>
            {!head.supplier_id && inv.supplier_name_read && editable && (
              <div className="warn" style={{ flexWrap: 'wrap' }}><span className="grow">المورد اللي انقرا: <strong>{inv.supplier_name_read}</strong>، ومو موجود عندنا.</span>
                {can('manage_suppliers') && <button className="btn" onClick={() => setAddSupplier(true)}>أضفه كمورد جديد</button>}</div>)}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div className="field"><label htmlFor="sup">المورد</label>
                <select id="sup" className="input" value={head.supplier_id} onChange={setH('supplier_id')} disabled={!editable}>
                  <option value="">— اختار —</option>
                  {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="no">رقم الفاتورة</label><input id="no" className="input ltr" value={head.invoice_no} onChange={setH('invoice_no')} disabled={!editable} /></div>
              <div className="field"><label htmlFor="dt">التاريخ</label><input id="dt" type="date" className="input" value={head.invoice_date} onChange={setH('invoice_date')} disabled={!editable} /></div>
              <div className="field"><label htmlFor="br">استلمتها في</label>
                <select id="br" className="input" value={head.branch_id} onChange={setH('branch_id')} disabled={!editable}>
                  {lookups.stockBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            </div>
            {editable && (
              <label className="upload" style={{ height: 56 }}>
                <input type="file" accept="image/*" multiple onChange={(e) => { addGoods([...e.target.files]); e.target.value = '' }} />
                {busy === 'goods' ? <><span className="spinner" /> جاري الرفع…</> : <><Icon name="camera" /> {goodsUrls.length ? `صور البضاعة (${goodsUrls.length}) · أضف صورة` : 'صوّر البضاعة كما وصلت'}</>}
              </label>)}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18 }}>الأصناف ({lines.length})</h2>
            {unlinked > 0 && editable && <span className="pill amber">{unlinked} سطر محتاج ربط بصنف</span>}
          </div>
          {editable && stage === 'receive' && <div className="sub">طابق كل صنف مع اللي وصل. لو فيه مشكلة اختار: ناقص، مرتجع، مجاني (المورد قال خلوه)، أو خصم.</div>}

          {lines.map((l, i) => {
            const f = Number(l.pack_factor) || 1
            const p = l.item ? prev[l.item.id] : null
            const pSupplierUnit = p && p.unit > 0 ? p.unit * f : null
            const ch = pctChange(l.unit_price, pSupplierUnit)
            const issue = l.issue || 'none'
            const recv = lineRecv(l)
            return (
              <div key={l.id || l.tmp} className="line-card" style={issue !== 'none' ? { borderColor: issue === 'free' || issue === 'return' ? '#E8B65A' : undefined } : undefined}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    {editable && !l.id && !l.raw_name ? null : <div style={{ fontWeight: 500 }}>{l.raw_name || '—'}</div>}
                    {l.raw_name && <div className="cell-sub">مكتوب في الفاتورة{l.unit_text ? ` · ${l.unit_text}` : ''}</div>}
                  </div>
                  {editable && <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label="حذف السطر" onClick={() => delLine(i)}><Icon name="trash" size={16} /></button>}
                </div>
                <ItemPicker line={l} supplierId={head.supplier_id} disabled={!editable} canCreate={can('manage_inventory')} lookups={lookups}
                  onPick={(it) => setL(i, { item: it, auto: false, match_score: null })} />
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>الكمية بالفاتورة</span>
                    <input className="input num" type="number" step="any" min="0" value={l.qty} disabled={!editable} onChange={(e) => setL(i, { qty: e.target.value })} aria-label="الكمية" /></div>
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>سعر الوحدة</span>
                    <input className="input num" type="number" step="any" min="0" value={l.unit_price} disabled={!editable} onChange={(e) => setL(i, { unit_price: e.target.value })} aria-label="سعر الوحدة" /></div>
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>المجموع</span>
                    <div className="input num" style={{ display: 'flex', alignItems: 'center', background: '#F7F9F5' }}>{kwd((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</div></div>
                </div>

                {(editable || issue !== 'none') && (
                  <div className="chips" style={{ gap: 6 }}>
                    {Object.entries(ISSUES).map(([k, [lbl]]) => (
                      <button type="button" key={k} disabled={!editable} className={'chip' + (issue === k ? ' on' : '')} style={{ minHeight: 32, fontSize: 13 }} onClick={() => setIssue(i, k)}>{lbl}</button>))}
                  </div>)}
                {issue !== 'none' && (
                  <div className="form" style={{ gap: 8, background: '#FFFBEB', borderRadius: 10, padding: 10 }}>
                    <div className="sub">{ISSUES[issue][1]}</div>
                    <div className="grid" style={{ gridTemplateColumns: issue === 'discount' ? '1fr 1fr' : '1fr', gap: 8 }}>
                      <div className="field"><span className="lbl" style={{ fontSize: 12 }}>{issue === 'return' ? 'كم خلّيت عندك' : 'استلمت فعلاً'}</span>
                        <input className="input num" type="number" step="any" min="0" placeholder={String(l.qty)} value={l.received_qty} disabled={!editable} onChange={(e) => setL(i, { received_qty: e.target.value })} aria-label="الكمية المستلمة" /></div>
                      {issue === 'discount' && <div className="field"><span className="lbl" style={{ fontSize: 12 }}>السعر بعد الخصم</span>
                        <input className="input num" type="number" step="any" min="0" value={l.charge_price} disabled={!editable} onChange={(e) => setL(i, { charge_price: e.target.value })} aria-label="السعر بعد الخصم" /></div>}
                    </div>
                    <input className="input" placeholder="ملاحظة: ايش المشكلة؟" value={l.issue_note || ''} disabled={!editable} onChange={(e) => setL(i, { issue_note: e.target.value })} aria-label="ملاحظة المشكلة" />
                    <div className="sub">ندفع عليه: <strong className="num">{kwd(linePayable(l))}</strong>{issue === 'return' && Number(l.qty) - recv > 0 ? ` · رجّعنا ${Number(l.qty) - recv}` : ''}</div>
                  </div>)}

                {l.item && (editable || f !== 1) && (
                  <div className="row sub" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span>١ {l.unit_text || 'وحدة الفاتورة'} =</span>
                    <input className="input num" style={{ width: 80, minHeight: 34, padding: '4px 8px' }} type="number" step="any" min="0" value={l.pack_factor ?? 1} disabled={!editable}
                      onChange={(e) => setL(i, { pack_factor: e.target.value })} aria-label="كم حبة في الوحدة" />
                    <span>{l.item.unit || 'وحدة مخزون'}</span>
                    <span className="grow" />
                    <span>يدخل المخزون: <strong className="num">{qtyFmt(recv * f)}</strong> {l.item.unit || ''}</span>
                  </div>)}

                {pSupplierUnit != null && (
                  <div className="sub">آخر سعر <span className="num">{kwd(pSupplierUnit)}</span>
                    {ch != null && Math.abs(ch) >= 0.5 && <span className={'pill ' + (ch > 5 ? 'red' : ch > 0 ? 'amber' : 'ok')} style={{ marginInlineStart: 8 }}>
                      {ch > 0 ? 'زاد' : 'نزل'} {Math.abs(ch).toFixed(0)}٪</span>}</div>)}
              </div>
            )
          })}
          {lines.length === 0 && inv.status !== 'reading' && <div className="card empty">ما فيه أصناف للحين</div>}
          {editable && <button className="btn" onClick={addLine}><Icon name="plus" /> إضافة سطر</button>}

          <div className="card form" style={{ gap: 10 }}>
            <div className="row"><span className="grow">مجموع الأصناف بالفاتورة</span><span className="num">{kwd(sum)}</span></div>
            <div className="row"><label className="grow" htmlFor="ds">خصم الفاتورة</label>
              <input id="ds" className="input num" style={{ width: 130 }} type="number" step="any" min="0" value={head.discount} onChange={setH('discount')} disabled={!editable} /></div>
            {inv.total_read != null && <div className={mismatch ? 'warn' : 'sub'}>{mismatch && <Icon name="warn" />}
              المكتوب في الفاتورة <span className="num">{kwd(inv.total_read)}</span>{mismatch ? ` والمحسوب ${kwd(written)}، راجع الفرق` : ' ✓ مطابق'}</div>}
            {Math.abs(issueGap) > 0.0005 && <div className="row" style={{ color: 'var(--amber)' }}><span className="grow">ناقص / مرتجع / مجاني / خصم</span><span className="num">− {kwd(issueGap)}</span></div>}
            <div className="row"><label className="grow" htmlFor="ex">مصاريف إضافية (توصيل وغيره) <span className="sub">تتوزع على تكلفة الأصناف</span></label>
              <input id="ex" className="input num" style={{ width: 130 }} type="number" step="any" min="0" value={head.extra_charges} onChange={setH('extra_charges')} disabled={!editable} /></div>
            <div className="row" style={{ fontWeight: 700, fontSize: 18 }}><span className="grow">المستحق للمورد</span><span className="num">{kwd(inv.status === 'approved' ? due : payable)} د.ك</span></div>
          </div>

          {inv.status === 'approved' && (
            <div className="card form" style={{ gap: 10 }}>
              <strong>الدفع</strong>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                <div><div className="sub">المستحق</div><div className="num" style={{ fontWeight: 600 }}>{kwd(due)}</div></div>
                <div><div className="sub">المدفوع</div><div className="num" style={{ fontWeight: 600 }}>{kwd(inv.paid_amount)}</div></div>
                <div><div className="sub">الباقي</div><div className="num" style={{ fontWeight: 700, color: remaining > 0 ? 'var(--red)' : 'var(--ok)' }}>{kwd(remaining)}</div></div>
                <div><div className="sub">موعد الدفع</div><div style={{ fontWeight: 600, color: late ? 'var(--red)' : undefined }}>{inv.due_date ? fmtDate(inv.due_date) : '—'}</div></div>
              </div>
              {payments.length > 0 && <div className="list">{payments.map((p) => (
                <div key={p.id} className="list-item">
                  <span className="grow">{PAY_METHOD[p.method] || p.method} · {fmtDate(p.paid_at)}{p.note ? <div className="sub">{p.note}</div> : null}</span>
                  {p.receipt_path && <button className="chip" style={{ minHeight: 30 }} onClick={async () => { const { data } = await supabase.storage.from('invoices').createSignedUrl(p.receipt_path, 600); if (data) window.open(data.signedUrl, '_blank') }}>الإيصال</button>}
                  <span className="num" style={{ fontWeight: 600 }}>{kwd(p.amount)}</span>
                </div>))}</div>}
              {canPay && remaining > 0 && <button className="btn primary block" onClick={() => setPaying(true)}><Icon name="check" /> تسجيل دفعة</button>}
              {!canPay && remaining > 0 && <div className="sub">تسجيل الدفعات لصاحب صلاحية "دفعات الموردين".</div>}
            </div>)}

          {editable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stage === 'receive' && (
                <button className="btn primary block" disabled={!!busy || !lines.length} onClick={onReceive}>
                  {busy === 'receive' ? <span className="spinner" /> : <Icon name="check" />} تأكيد الاستلام وإدخال المخزون</button>)}
              {stage === 'review' && canReview && (<>
                <input className="input" placeholder="ملاحظة المراجعة (اختياري)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} aria-label="ملاحظة المراجعة" />
                <button className="btn primary block" disabled={!!busy || !lines.length} onClick={onReview}>
                  {busy === 'review' ? <span className="spinner" /> : <Icon name="check" />} تمت المراجعة</button></>)}
              {stage === 'receive' && canReview && (
                <button className="btn block" disabled={!!busy || !lines.length} onClick={onReview}>{busy === 'review' ? <span className="spinner" /> : null} استلام ومراجعة مرة وحدة</button>)}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button className="btn" disabled={!!busy || !dirty} onClick={onSave}>{busy === 'save' ? <span className="spinner" /> : null} حفظ التعديلات</button>
                {stage === 'receive' && inv.image_paths?.length > 0 && <button className="btn" disabled={!!busy} onClick={onReread}><Icon name="refresh" /> اقرا الصورة من جديد</button>}
                {canReview && <button className="btn danger" disabled={!!busy} onClick={() => setRejecting(true)}>رفض</button>}
                <span className="grow" />
                {stage === 'receive' && <button className="btn danger" disabled={!!busy} onClick={onDelete}><Icon name="trash" /> حذف</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      {addSupplier && <SupplierForm presetName={inv.supplier_name_read} onClose={() => setAddSupplier(false)}
        onSaved={async (s) => { const l = await loadLookups(true); setLookups(l); setHead((h) => ({ ...h, supplier_id: s.id })); setDirty(true) }} />}
      {paying && <PaymentForm supplierId={inv.supplier_id} supplierName={supplier?.name} invoice={inv} onClose={() => setPaying(false)} onSaved={load} />}
      {rejecting && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRejecting(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>رفض الفاتورة</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setRejecting(false)}><Icon name="x" /></button></div>
            {inv.received_at && <div className="warn">البضاعة انستلمت. الرفض يطلّع كمياتها من المخزون.</div>}
            <div className="field"><label htmlFor="rn">السبب</label><input id="rn" className="input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="مثلاً: الفاتورة مدخلة مرتين" /></div>
            <button className="btn primary block" disabled={!!busy} onClick={onReject}>رفض</button>
          </div>
        </div>
      )}
    </div>
  )
}
