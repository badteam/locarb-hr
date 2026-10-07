import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, INVOICE_STATUS, loadLookups, invErr, pctChange } from '../../lib/inv'
import { startRead } from './Invoices.jsx'
import { ItemForm } from './Inventory.jsx'
import { SupplierForm } from './Suppliers.jsx'
import Icon from '../../components/Icon.jsx'

const OPEN = ['draft', 'reading', 'review', 'failed']
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

export default function InvoiceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { can } = useAccess()
  const [inv, setInv] = useState(null)
  const [head, setHead] = useState({})
  const [lines, setLines] = useState([])
  const [removed, setRemoved] = useState([])
  const [urls, setUrls] = useState([])
  const [lookups, setLookups] = useState(null)
  const [prev, setPrev] = useState({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [addSupplier, setAddSupplier] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [names, setNames] = useState({})

  const canEdit = can('manage_suppliers') || can('approve_purchases')
  const canApprove = can('approve_purchases')

  const load = useCallback(async () => {
    const { data } = await supabase.from('purchase_invoices').select('*, purchase_invoice_lines(*, inv_items(id,name_ar,name_en,inv_units(name)))').eq('id', id).maybeSingle()
    if (!data) { setInv(false); return }
    setInv(data)
    setHead({ supplier_id: data.supplier_id || '', invoice_no: data.invoice_no || '', invoice_date: data.invoice_date || '', branch_id: data.branch_id, discount: data.discount ?? 0, notes: data.notes || '' })
    setLines((data.purchase_invoice_lines || []).sort((a, b) => a.line_no - b.line_no).map((l) => ({
      ...l, auto: true, item: l.inv_items ? { id: l.inv_items.id, name_ar: l.inv_items.name_ar, name_en: l.inv_items.name_en, unit: l.inv_items.inv_units?.name } : null,
    })))
    setRemoved([]); setDirty(false)
    const ids = [data.created_by, data.approved_by].filter(Boolean)
    if (ids.length) supabase.from('employees').select('id,full_name').in('id', ids).then(({ data: e }) => setNames(Object.fromEntries((e || []).map((x) => [x.id, x.full_name]))))
    if (data.image_paths?.length) {
      const { data: s } = await supabase.storage.from('invoices').createSignedUrls(data.image_paths, 3600)
      setUrls((s || []).map((x, i) => ({ url: x.signedUrl, pdf: data.image_paths[i].endsWith('.pdf') })))
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

  // previous prices for the linked items
  const itemKey = lines.map((l) => l.item?.id).join(',') + '|' + head.supplier_id
  useEffect(() => {
    const ids = [...new Set(lines.map((l) => l.item?.id).filter(Boolean))]
    if (!ids.length) { setPrev({}); return }
    Promise.all([
      supabase.from('inv_items').select('id,last_price').in('id', ids),
      head.supplier_id ? supabase.from('supplier_items').select('item_id,last_price').eq('supplier_id', head.supplier_id).in('item_id', ids) : Promise.resolve({ data: [] }),
    ]).then(([a, b]) => {
      const p = Object.fromEntries((a.data || []).map((x) => [x.id, x.last_price]))
      for (const x of b.data || []) p[x.item_id] = x.last_price
      setPrev(p)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey])

  if (inv === false) return <div className="card empty">الفاتورة مو موجودة</div>
  if (!inv || !lookups) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  const editable = canEdit && OPEN.includes(inv.status) && inv.status !== 'reading'
  const setH = (k) => (e) => { setHead({ ...head, [k]: e.target.value }); setDirty(true) }
  const setL = (i, patch) => { setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true) }
  const addLine = () => { setLines([...lines, { tmp: ++tmpId, raw_name: '', qty: 1, unit_price: 0, item: null }]); setDirty(true) }
  const delLine = (i) => { const l = lines[i]; if (l.id) setRemoved([...removed, l.id]); setLines(lines.filter((_, j) => j !== i)); setDirty(true) }

  const sum = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
  const net = sum - (Number(head.discount) || 0)
  const mismatch = inv.total_read != null && Math.abs(net - Number(inv.total_read)) > 0.01
  const unlinked = lines.filter((l) => !l.item).length
  const supplier = lookups.suppliers.find((s) => s.id === head.supplier_id)

  const save = async () => {
    setErr('')
    const h = { supplier_id: head.supplier_id || null, invoice_no: head.invoice_no || null, invoice_date: head.invoice_date || null, branch_id: head.branch_id, discount: Number(head.discount) || 0, notes: head.notes || null }
    const r1 = await supabase.from('purchase_invoices').update(h).eq('id', id)
    if (r1.error) throw r1.error
    if (removed.length) { const r = await supabase.from('purchase_invoice_lines').delete().in('id', removed); if (r.error) throw r.error }
    const rows = lines.map((l, i) => ({
      ...(l.id ? { id: l.id } : {}), invoice_id: id, line_no: i + 1, raw_name: l.raw_name || null, item_id: l.item?.id || null,
      qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0, unit_text: l.unit_text || null, line_total: Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * 1000) / 1000, match_score: l.match_score ?? null,
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
  const onSend = () => run('send', async () => {
    await save()
    const r = await supabase.from('purchase_invoices').update({ status: 'review' }).eq('id', id)
    if (r.error) throw r.error
    await load(); setMsg('انرسلت للموافقة')
  })
  const onApprove = () => run('approve', async () => {
    await save()
    const { data, error } = await supabase.rpc('approve_purchase_invoice', { p_invoice: id })
    if (error) throw error
    await load()
    setMsg(`تمت الموافقة. انضاف ${data.lines} صنف للمخزون بقيمة ${kwd(data.total)} د.ك${data.price_rises?.length ? ` · زيادة أسعار: ${data.price_rises.join('، ')}` : ''}`)
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
    if (r?.error === 'not_configured') setErr('قراءة الصور لسه ما تفعّلت. تقدر تدخل الأصناف يدوي.')
    else if (r?.error === 'unreadable') setErr('ما قدرنا نقرا الصورة. صوّرها من جديد بإضاءة أوضح، أو دخّل الأصناف يدوي.')
    else if (r?.error) setErr('صار خطأ في القراءة: ' + r.error)
  })
  const onDelete = () => run('delete', async () => {
    if (!window.confirm('تمسح الفاتورة؟')) return
    if (inv.image_paths?.length) await supabase.storage.from('invoices').remove(inv.image_paths)
    const { error } = await supabase.from('purchase_invoices').delete().eq('id', id)
    if (error) throw error
    nav('/inventory/invoices')
  })

  const st = INVOICE_STATUS[inv.status]
  return (
    <div>
      <div className="page-head">
        <div><Link to="/inventory/invoices" className="sub" style={{ textDecoration: 'none' }}>→ فواتير الموردين</Link>
          <h1 style={{ marginTop: 4 }}>{supplier?.name || inv.supplier_name_read || 'فاتورة مورد'}</h1>
          <div className="sub">{names[inv.created_by] ? `أدخلها ${names[inv.created_by]} · ` : ''}{fmtDate(inv.created_at)}</div></div>
        <span className={'pill ' + st[0]} style={{ fontSize: 14, padding: '6px 14px' }}>{st[1]}</span>
      </div>

      {inv.status === 'reading' && <div className="notice row" style={{ marginBottom: 14 }}><span className="spinner" /> جاري قراءة الفاتورة… تاخذ تقريباً ٢٠ ثانية.</div>}
      {inv.status === 'failed' && <div className="error" style={{ marginBottom: 14 }}>ما قدرنا نقرا الفاتورة. جرّب تصورها من جديد بإضاءة أوضح، أو دخّل الأصناف يدوي.</div>}
      {inv.read_error === 'not_configured' && inv.status === 'draft' && <div className="warn" style={{ marginBottom: 14 }}><Icon name="warn" /> قراءة الصور لسه ما تفعّلت. دخّل الأصناف يدوي، والصورة محفوظة مع الفاتورة.</div>}
      {inv.status === 'approved' && <div className="notice" style={{ marginBottom: 14 }}>اعتمدها {names[inv.approved_by] || '—'} · {fmtDate(inv.approved_at)}. الكميات انضافت للمخزون والأسعار اتحدثت.</div>}
      {inv.status === 'rejected' && <div className="error" style={{ marginBottom: 14 }}>انرفضت{inv.reject_note ? `: ${inv.reject_note}` : ''}</div>}
      {msg && <div className="notice" style={{ marginBottom: 14 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 14 }}>{err}</div>}

      <div className={urls.length ? 'inv-split' : ''}>
        {urls.length > 0 && <div className="photo-box">{urls.map((u, i) => u.pdf
          ? <a key={i} href={u.url} target="_blank" rel="noreferrer" className="btn" style={{ margin: 12 }}>فتح ملف PDF</a>
          : <a key={i} href={u.url} target="_blank" rel="noreferrer"><img src={u.url} alt={`صورة الفاتورة ${i + 1}`} /></a>)}</div>}

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
              <div className="field"><label htmlFor="br">استلمها</label>
                <select id="br" className="input" value={head.branch_id} onChange={setH('branch_id')} disabled={!editable}>
                  {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18 }}>الأصناف ({lines.length})</h2>
            {unlinked > 0 && editable && <span className="pill amber">{unlinked} سطر محتاج ربط بصنف</span>}
          </div>

          {lines.map((l, i) => {
            const p = l.item ? prev[l.item.id] : null
            const ch = pctChange(l.unit_price, p)
            return (
              <div key={l.id || l.tmp} className="line-card">
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
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>الكمية {l.item?.unit ? `(${l.item.unit})` : ''}</span>
                    <input className="input num" type="number" step="any" min="0" value={l.qty} disabled={!editable} onChange={(e) => setL(i, { qty: e.target.value })} aria-label="الكمية" /></div>
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>سعر الوحدة</span>
                    <input className="input num" type="number" step="any" min="0" value={l.unit_price} disabled={!editable} onChange={(e) => setL(i, { unit_price: e.target.value })} aria-label="سعر الوحدة" /></div>
                  <div className="field"><span className="lbl" style={{ fontSize: 12 }}>المجموع</span>
                    <div className="input num" style={{ display: 'flex', alignItems: 'center', background: '#F7F9F5' }}>{kwd((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</div></div>
                </div>
                {p != null && Number(p) > 0 && (
                  <div className="sub">آخر سعر <span className="num">{kwd(p)}</span>
                    {ch != null && Math.abs(ch) >= 0.5 && <span className={'pill ' + (ch > 5 ? 'red' : ch > 0 ? 'amber' : 'ok')} style={{ marginInlineStart: 8 }}>
                      {ch > 0 ? 'زاد' : 'نزل'} {Math.abs(ch).toFixed(0)}٪</span>}</div>)}
              </div>
            )
          })}
          {lines.length === 0 && inv.status !== 'reading' && <div className="card empty">ما فيه أصناف للحين</div>}
          {editable && <button className="btn" onClick={addLine}><Icon name="plus" /> إضافة سطر</button>}

          <div className="card form" style={{ gap: 10 }}>
            <div className="row"><span className="grow">مجموع الأصناف</span><span className="num">{kwd(sum)}</span></div>
            <div className="row"><label className="grow" htmlFor="ds">الخصم</label>
              <input id="ds" className="input num" style={{ width: 130 }} type="number" step="any" min="0" value={head.discount} onChange={setH('discount')} disabled={!editable} /></div>
            <div className="row" style={{ fontWeight: 700, fontSize: 18 }}><span className="grow">الصافي</span><span className="num">{kwd(net)} د.ك</span></div>
            {inv.total_read != null && <div className={mismatch ? 'warn' : 'sub'}>{mismatch && <Icon name="warn" />}
              المجموع المكتوب في الفاتورة <span className="num">{kwd(inv.total_read)}</span>{mismatch ? '، والفرق لازم تراجعه قبل الموافقة' : ' ✓ مطابق'}</div>}
          </div>

          {editable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {canApprove ? (
                <button className="btn primary block" disabled={!!busy || !lines.length} onClick={onApprove}>
                  {busy === 'approve' ? <span className="spinner" /> : <Icon name="check" />} موافقة وإدخال للمخزون</button>
              ) : inv.status !== 'review' ? (
                <button className="btn primary block" disabled={!!busy || !lines.length} onClick={onSend}>{busy === 'send' ? <span className="spinner" /> : null} إرسال للموافقة</button>
              ) : <div className="notice">الفاتورة عند المسؤول للموافقة. تقدر تعدل عليها لين يوافق.</div>}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button className="btn" disabled={!!busy || !dirty} onClick={onSave}>{busy === 'save' ? <span className="spinner" /> : null} حفظ التعديلات</button>
                {inv.image_paths?.length > 0 && <button className="btn" disabled={!!busy} onClick={onReread}><Icon name="refresh" /> اقرا الصورة من جديد</button>}
                {canApprove && inv.status === 'review' && <button className="btn danger" disabled={!!busy} onClick={() => setRejecting(true)}>رفض</button>}
                <span className="grow" />
                <button className="btn danger" disabled={!!busy} onClick={onDelete}><Icon name="trash" /> حذف</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {addSupplier && <SupplierForm presetName={inv.supplier_name_read} onClose={() => setAddSupplier(false)}
        onSaved={async (s) => { const l = await loadLookups(true); setLookups(l); setHead((h) => ({ ...h, supplier_id: s.id })); setDirty(true) }} />}
      {rejecting && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRejecting(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>رفض الفاتورة</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setRejecting(false)}><Icon name="x" /></button></div>
            <div className="field"><label htmlFor="rn">السبب</label><input id="rn" className="input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="مثلاً: الكميات ما تطابق اللي استلمناه" /></div>
            <button className="btn primary block" disabled={!!busy} onClick={onReject}>رفض</button>
          </div>
        </div>
      )}
    </div>
  )
}
