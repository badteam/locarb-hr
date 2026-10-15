import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, fmtDate, todayKuwait } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, qtyFmt, invErr, PAY_STATUS, PAY_METHOD, STAGE, invoiceStage, ISSUES } from '../../lib/inv'
import { CONTACT_ROLE, SUP_STATUS, WEEKDAYS, PAY_PREF, telLink, waLink, mainContact } from '../../lib/supplier'
import { downloadXlsx } from '../../lib/xlsx'
import { SupplierForm } from './Suppliers.jsx'
import { PaymentForm } from './Payments.jsx'
import Icon from '../../components/Icon.jsx'
import { openFile } from '../../lib/ai'

const TABS = [['summary', 'ملخص'], ['invoices', 'الفواتير'], ['goods', 'البضاعة'], ['prices', 'الأسعار'], ['payments', 'الدفعات'], ['statement', 'كشف الحساب'], ['info', 'البيانات'], ['notes', 'الملاحظات'], ['ask', 'اسأل النظام']]
const addMonths = (d, m) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10) }
const PERIODS = (today) => {
  const m0 = today.slice(0, 7) + '-01'
  return [
    ['all', 'الكل', null, null],
    ['month', 'هالشهر', m0, today],
    ['last', 'الشهر اللي فات', addMonths(m0, -1), new Date(new Date(m0 + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10)],
    ['3m', 'آخر ٣ شهور', addMonths(today, -3), today],
    ['year', 'هالسنة', today.slice(0, 4) + '-01-01', today],
  ]
}

function Stars({ value }) {
  if (value == null) return <span className="sub">التقييم يطلع بعد ٥ أصناف مستلمة</span>
  return (
    <span className="row" style={{ gap: 2 }} title={`${value} من ٥`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ color: i <= Math.round(value) ? '#E3A008' : '#D7DCD5' }}><Icon name="star" size={16} /></span>)}
      <span className="num sub" style={{ marginInlineStart: 4 }}>{value}</span>
    </span>
  )
}

function Spark({ points }) {
  if (!points || points.length < 2) return null
  const ps = points.map((p) => Number(p.p)), min = Math.min(...ps), max = Math.max(...ps), w = 90, h = 26
  const xy = ps.map((v, i) => [(i / (ps.length - 1)) * w, max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 4) - 2])
  const up = ps[ps.length - 1] > ps[0]
  return <svg width={w} height={h} aria-hidden="true"><polyline fill="none" stroke={up ? '#B42318' : '#1F6B45'} strokeWidth="2" points={xy.map((p) => p.join(',')).join(' ')} /></svg>
}

function OrderSheet({ supplier, contacts, onClose }) {
  const [items, setItems] = useState([])
  const [qty, setQty] = useState({})
  const [note, setNote] = useState('')
  const [to, setTo] = useState(0)
  const phones = (contacts.length ? contacts : supplier.phone ? [{ role: 'sales', name: supplier.contact_name, phone: supplier.phone, whatsapp: true }] : []).filter((c) => c.phone)
  useEffect(() => {
    supabase.from('supplier_items').select('item_id,last_price,pack_factor,pack_unit,inv_items(name_ar,inv_units(name))').eq('supplier_id', supplier.id).order('last_date', { ascending: false })
      .then(({ data }) => setItems(data || []))
  }, [supplier.id])
  const lines = items.filter((x) => Number(qty[x.item_id]) > 0)
  const text = `السلام عليكم${phones[to]?.name ? ' ' + phones[to].name : ''}،\nطلبية من لوكارب:\n` +
    lines.map((x) => `- ${x.inv_items?.name_ar}: ${qty[x.item_id]} ${Number(x.pack_factor) !== 1 ? (x.pack_unit || '') : (x.inv_items?.inv_units?.name || '')}`).join('\n') +
    (note ? `\n${note}` : '') + '\nالتوصيل: المطبخ المركزي. شكراً'
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>اطلب من {supplier.name}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        {phones.length === 0 && <div className="warn">ما فيه رقم واتساب لهالمورد. أضفه من "تعديل".</div>}
        {phones.length > 1 && <div className="chips">{phones.map((c, i) => <button key={i} className={'chip' + (to === i ? ' on' : '')} onClick={() => setTo(i)}>{CONTACT_ROLE[c.role]} {c.name || c.phone}</button>)}</div>}
        {items.length === 0 && <div className="sub">الأصناف تطلع هنا بعد أول فاتورة من هالمورد. تقدر تكتب الطلب في الملاحظة.</div>}
        <div className="list">{items.map((x) => (
          <div key={x.item_id} className="list-item">
            <span className="grow">{x.inv_items?.name_ar}<div className="sub">آخر سعر {kwd(x.last_price)} / {Number(x.pack_factor) !== 1 ? x.pack_unit || 'وحدة' : x.inv_items?.inv_units?.name || ''}</div></span>
            <input className="input num" style={{ width: 90 }} type="number" min="0" step="any" value={qty[x.item_id] || ''} onChange={(e) => setQty({ ...qty, [x.item_id]: e.target.value })} aria-label="الكمية" />
          </div>))}</div>
        <div className="field"><label htmlFor="on">ملاحظة</label><textarea id="on" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: نبيها بكرة قبل ١٠ الصبح" /></div>
        <div className="card sub" style={{ whiteSpace: 'pre-line' }}>{text}</div>
        <a className={'btn primary block' + (!phones.length || (!lines.length && !note) ? ' disabled' : '')} style={{ pointerEvents: !phones.length || (!lines.length && !note) ? 'none' : undefined, opacity: !phones.length || (!lines.length && !note) ? 0.5 : 1 }}
          href={phones[to] ? waLink(phones[to].phone, text) : '#'} target="_blank" rel="noreferrer"><Icon name="chat" /> أرسل على واتساب</a>
      </div>
    </div>
  )
}

function Ask({ supplierId, name }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [msgs])
  const ask = async (question) => {
    const text = (question || q).trim()
    if (!text || busy) return
    setQ(''); setBusy(true)
    const history = msgs.flatMap((m) => [{ role: 'user', content: m.q }, ...(m.a ? [{ role: 'assistant', content: m.a }] : [])])
    setMsgs((m) => [...m, { q: text }])
    const { data, error } = await supabase.functions.invoke('supplier-ask', { body: { supplier_id: supplierId, question: text, history } })
    let a = data?.answer
    if (error || !data?.ok) {
      let b = {}; try { b = await error?.context?.json() } catch { /* ignore */ }
      const e = b?.error || data?.error || error?.message
      a = e === 'not_configured' ? 'الذكاء الاصطناعي ما تفعّل. المالك يحط المفتاح من الإعدادات.' : e === 'no_credit' ? 'رصيد حساب Anthropic خلص.' : 'صار خطأ: ' + e
    }
    setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, a } : x)))
    setBusy(false)
  }
  const samples = ['كم اشترينا منه هالشهر؟', 'كم علينا له وإيش المتأخر؟', 'إيش أكثر شي نشتريه منه؟', 'أي صنف زاد سعره؟', 'كم مرة رجّعنا له بضاعة أو جات ناقصة؟', 'متى آخر فاتورة وكم كانت؟']
  return (
    <div className="form" style={{ gap: 10 }}>
      <div className="sub">اسأل أي سؤال عن {name} بالعربي، والنظام يجاوب من الفواتير والبضاعة والدفعات والملاحظات.</div>
      {msgs.length === 0 && <div className="chips">{samples.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>}
      {msgs.map((m, i) => (
        <div key={i} className="form" style={{ gap: 6 }}>
          <div className="card" style={{ alignSelf: 'flex-start', background: 'var(--green-soft)', padding: '8px 12px', maxWidth: '85%' }}>{m.q}</div>
          <div className="card" style={{ whiteSpace: 'pre-line', lineHeight: 1.8, padding: '10px 14px' }}>{m.a || <span className="row" style={{ gap: 8 }}><span className="spinner" /> يدوّر في البيانات…</span>}</div>
        </div>))}
      <div ref={end} />
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); ask() }}>
        <input className="input grow" placeholder="اكتب سؤالك…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="السؤال" />
        <button className="btn primary" disabled={busy || !q.trim()}>اسأل</button>
      </form>
    </div>
  )
}

function Photos({ invoices }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    const paths = invoices.flatMap((v) => [...(v.goods || []), ...(v.photos || [])])
    if (!paths.length) return
    supabase.storage.from('invoices').createSignedUrls(paths, 3600).then(({ data }) => setUrls(Object.fromEntries((data || []).map((x, i) => [paths[i], x.signedUrl]))))
  }, [invoices])
  const withPhotos = invoices.filter((v) => (v.goods || []).length || (v.photos || []).length)
  if (!withPhotos.length) return <div className="card empty">ما فيه صور في هالفترة</div>
  return withPhotos.map((v) => (
    <div key={v.id} className="card form" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><Link to={`/inventory/invoices/${v.id}`}>فاتورة {v.no || 'بدون رقم'}</Link><span className="sub">{fmtDate(v.d)}</span></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {[...(v.goods || []).map((p) => [p, 'بضاعة']), ...(v.photos || []).map((p) => [p, 'فاتورة'])].map(([p, kind]) => (
          <a key={p} href={urls[p]} target="_blank" rel="noreferrer" style={{ position: 'relative' }}>
            {p.endsWith('.pdf') ? <span className="thumb" style={{ width: 96, height: 96 }}>PDF</span>
              : <img src={urls[p]} alt={kind} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, background: '#EEF1EC' }} />}
            <span className="pill gray" style={{ position: 'absolute', bottom: 4, insetInlineStart: 4, fontSize: 10, padding: '1px 6px' }}>{kind}</span>
          </a>))}
      </div>
    </div>))
}

export default function SupplierProfile() {
  const { id } = useParams()
  const { can, access } = useAccess()
  const today = todayKuwait()
  const periods = useMemo(() => PERIODS(today), [today])
  const [period, setPeriod] = useState('all')
  const [custom, setCustom] = useState({ from: addMonths(today, -1), to: today })
  const [sup, setSup] = useState(null)
  const [contacts, setContacts] = useState([])
  const [bank, setBank] = useState(null)
  const [p, setP] = useState(null)
  const [stmt, setStmt] = useState(null)
  const [notes, setNotes] = useState([])
  const [note, setNote] = useState({ kind: 'note', body: '' })
  const [tab, setTab] = useState('summary')
  const [edit, setEdit] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [paying, setPaying] = useState(false)
  const [goodsView, setGoodsView] = useState('lines')
  const [err, setErr] = useState('')
  const canEdit = can('manage_suppliers')
  const canPay = can('supplier_payments')
  const [pf, pt] = period === 'custom' ? [custom.from, custom.to] : (periods.find((x) => x[0] === period) || periods[0]).slice(2)

  const loadBase = useCallback(() => {
    supabase.from('suppliers').select('*').eq('id', id).maybeSingle().then(({ data }) => setSup(data || false))
    supabase.from('supplier_contacts').select('*').eq('supplier_id', id).order('sort_order').order('created_at').then(({ data }) => setContacts(data || []))
    supabase.from('supplier_bank').select('*').eq('supplier_id', id).maybeSingle().then(({ data }) => setBank(data || null))
    supabase.from('supplier_notes').select('*, employees:created_by(full_name)').eq('supplier_id', id).order('created_at', { ascending: false }).then(({ data }) => setNotes(data || []))
    supabase.rpc('supplier_statement', { p_supplier: id }).then(({ data }) => setStmt(data || null))
  }, [id])
  const loadProfile = useCallback(() => {
    setP(null)
    supabase.rpc('supplier_profile', { p_supplier: id, p_from: pf, p_to: pt }).then(({ data, error }) => { if (error) setErr(invErr(error)); else setP(data) })
  }, [id, pf, pt])
  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadProfile() }, [loadProfile])

  if (sup === false) return <div className="card empty">المورد مو موجود</div>
  if (!sup) return <div className="center" style={{ minHeight: 300 }}><span className="spinner" /></div>
  const k = p?.kpi || {}
  const money = p?.can_money
  const cats = [...new Set([...(sup.categories || []), ...(p?.categories_auto || [])])]
  const mc = mainContact(sup, contacts)
  const allContacts = contacts.length ? contacts : mc ? [mc] : []
  const label = period === 'custom' ? `${pf}_${pt}` : period === 'all' ? 'الكل' : `${pf}_${pt}`
  const fileName = (what) => `${sup.name}_${what}_${label}`.replace(/[\\/:*?"<>|]/g, '')

  const exportInvoices = () => downloadXlsx(fileName('الفواتير'), [{ name: 'الفواتير', headers: ['التاريخ', 'رقم الفاتورة', 'الحالة', 'عدد الأصناف', 'المبلغ', 'المدفوع', 'الباقي', 'حالة الدفع', 'الاستحقاق'],
    rows: (p.invoices || []).map((v) => [v.d, v.no, STAGE[invoiceStage({ status: v.status, received_at: v.received_at })]?.[1], v.lines, money ? Number(v.total || 0) : null, money ? Number(v.paid || 0) : null,
      money ? Number(v.total || 0) - Number(v.paid || 0) : null, v.status === 'approved' ? PAY_STATUS[v.payment_status]?.[1] : '', v.due_date]), widths: [12, 16, 18, 10, 12, 12, 12, 14, 12], money: [4, 5, 6] }])
  const exportGoods = () => downloadXlsx(fileName('البضاعة'), [{ name: 'البضاعة', headers: ['التاريخ', 'رقم الفاتورة', 'الصنف', 'المكتوب بالفاتورة', 'الكمية', 'الوحدة', 'المستلم', 'ملاحظة الاستلام', 'السعر', 'المدفوع عليه'],
    rows: (p.lines || []).map((l) => [l.d, l.invoice_no, l.item, l.raw, Number(l.qty), l.unit_text, l.received == null ? Number(l.qty) : Number(l.received), l.issue !== 'none' ? `${ISSUES[l.issue]?.[0]}${l.issue_note ? ': ' + l.issue_note : ''}` : '',
      money ? Number(l.price) : null, money ? Number(l.payable) : null]), widths: [12, 14, 30, 30, 10, 10, 10, 24, 10, 12], money: [8, 9] }])
  const exportPrices = () => downloadXlsx(fileName('الأصناف_والأسعار'), [{ name: 'الأصناف', headers: ['الصنف', 'التصنيف', 'الكمية', 'الوحدة', 'عدد الفواتير', 'المجموع', 'أقل سعر', 'أعلى سعر', 'آخر سعر', 'آخر شراء', 'أرخص مورد ثاني', 'سعره'],
    rows: (p.items || []).map((x) => [x.item, x.category, Number(x.stock_qty), x.unit, x.invoices, money ? Number(x.total) : null, Number(x.min_price), Number(x.max_price), Number(x.last_price), x.last_date, x.other_best?.supplier || '', x.other_best ? Number(x.other_best.price) : null]),
    widths: [30, 18, 10, 10, 10, 12, 10, 10, 10, 12, 24, 10], money: [5, 6, 7, 8, 11] }])
  const exportPayments = () => downloadXlsx(fileName('الدفعات'), [{ name: 'الدفعات', headers: ['التاريخ', 'المبلغ', 'الطريقة', 'عن فاتورة', 'ملاحظة'],
    rows: (p.payments || []).map((x) => [x.d, Number(x.amount), PAY_METHOD[x.method] || x.method, x.invoice_no || 'على الحساب', x.note]), widths: [12, 12, 14, 16, 30], money: [1] }])
  const addNote = async () => {
    if (!note.body.trim()) return
    const r = await supabase.from('supplier_notes').insert({ supplier_id: id, kind: note.kind, body: note.body.trim() })
    if (r.error) setErr(invErr(r.error)); else { setNote({ kind: 'note', body: '' }); loadBase() }
  }
  const XL = ({ onClick }) => <button className="btn" onClick={() => onClick().catch((e) => setErr(invErr(e)))}><Icon name="download" /> Excel</button>
  let run = 0

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/inventory/suppliers" className="sub" style={{ textDecoration: 'none' }}>→ الموردين</Link>
          <h1 style={{ marginTop: 4 }}>{sup.name}</h1>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <span className={'pill ' + SUP_STATUS[sup.status || 'active'][0]}>{SUP_STATUS[sup.status || 'active'][1]}</span>
            <Stars value={p?.rating} />
            {cats.map((c) => <span key={c} className="pill gray">{c}</span>)}
          </div>
          {sup.status_reason && sup.status !== 'active' && <div className="sub" style={{ color: 'var(--red)' }}>{sup.status_reason}</div>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {mc?.phone && <a className="btn" href={telLink(mc.phone)}><Icon name="phone" /> اتصال</a>}
          {mc?.phone && <a className="btn" href={waLink(mc.phone)} target="_blank" rel="noreferrer"><Icon name="chat" /> واتساب</a>}
          <button className="btn primary" onClick={() => setOrdering(true)}><Icon name="truck" /> اطلب منه</button>
          {canPay && <button className="btn" onClick={() => setPaying(true)}><Icon name="check" /> دفعة</button>}
          {canEdit && <button className="btn" onClick={() => setEdit(true)}>تعديل</button>}
        </div>
      </div>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {periods.map(([kk, l]) => <button key={kk} className={'chip' + (period === kk ? ' on' : '')} onClick={() => setPeriod(kk)}>{l}</button>)}
        <button className={'chip' + (period === 'custom' ? ' on' : '')} onClick={() => setPeriod('custom')}>فترة مخصصة</button>
        {period === 'custom' && <>
          <input type="date" className="input" style={{ width: 'auto' }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="من" />
          <input type="date" className="input" style={{ width: 'auto' }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="إلى" /></>}
      </div>

      <div className="grid stats" style={{ marginBottom: 14 }}>
        {money && <div className="card stat"><div className="label">اشترينا منه</div><div className="value num" style={{ fontSize: 22 }}>{p ? kwd(k.purchased) : '…'}</div><div className="sub">د.ك · {k.invoices ?? '…'} فاتورة</div></div>}
        {money && <div className="card stat"><div className="label">دفعنا له</div><div className="value num" style={{ fontSize: 22 }}>{p ? kwd(k.paid) : '…'}</div><div className="sub">في الفترة</div></div>}
        {money && <div className="card stat"><div className="label">الرصيد علينا</div><div className="value num" style={{ fontSize: 22, color: Number(k.balance) > 0.0005 ? 'var(--red)' : 'var(--ok)' }}>{p ? kwd(k.balance) : '…'}</div>
          <div className="sub">{Number(k.overdue) > 0 ? <span style={{ color: 'var(--red)' }}>متأخر {kwd(k.overdue)}</span> : 'كل الفترات'}</div></div>}
        <div className="card stat"><div className="label">الأصناف</div><div className="value num">{k.items_count ?? '…'}</div><div className="sub">{k.last_invoice ? `آخر فاتورة ${fmtDate(k.last_invoice)}` : 'ما فيه فواتير'}</div></div>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        {TABS.map(([kk, l]) => <button key={kk} className={'chip' + (tab === kk ? ' on' : '')} onClick={() => setTab(kk)}>{l}</button>)}
      </div>

      {!p && tab !== 'ask' && tab !== 'info' && tab !== 'notes' && tab !== 'statement' ? <div className="center" style={{ minHeight: 160 }}><span className="spinner" /></div> : <>

      {tab === 'summary' && (
        <div className="form" style={{ gap: 12 }}>
          <div className="card form" style={{ gap: 6 }}>
            <strong>جودة التوريد</strong>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="pill gray">{p.issues.lines} صنف مستلم</span>
              {['short', 'return', 'free', 'discount'].map((x) => <span key={x} className={'pill ' + (p.issues[x] ? (x === 'short' || x === 'return' ? 'red' : 'amber') : 'gray')}>{ISSUES[x][0]}: {p.issues[x]}</span>)}
              {money && Number(p.issues.value_not_paid) > 0 && <span className="pill blue">ما دفعناه بسبب المشاكل: {kwd(p.issues.value_not_paid)}</span>}
            </div>
            <div className="sub">التقييم يتحسب من كل الفواتير: الناقص والمرتجع ينزّلونه أكثر من المجاني والخصم.</div>
          </div>
          <div className="card list" style={{ padding: '6px 14px' }}>
            <strong style={{ padding: '6px 0' }}>أكثر الأصناف</strong>
            {p.items.length === 0 && <div className="empty">ما فيه أصناف في هالفترة</div>}
            {p.items.slice(0, 8).map((x) => (
              <div key={x.item_id} className="list-item">
                <span className="grow">{x.item}<div className="sub">{qtyFmt(x.stock_qty)} {x.unit} · {x.invoices} فاتورة</div></span>
                <Spark points={x.history} />
                {money && <span className="num" style={{ fontWeight: 600 }}>{kwd(x.total)}</span>}
              </div>))}
          </div>
          {(sup.delivery_days?.length > 0 || sup.order_cutoff || sup.min_order || sup.agreements) && (
            <div className="card form" style={{ gap: 4 }}>
              <strong>التوريد</strong>
              {sup.delivery_days?.length > 0 && <div>يوصل: {sup.delivery_days.map((d) => WEEKDAYS[d]).join('، ')}</div>}
              {sup.order_cutoff && <div>آخر وقت للطلب: {sup.order_cutoff}</div>}
              {sup.min_order && <div>أقل طلبية: {kwd(sup.min_order)} د.ك</div>}
              {sup.agreements && <div style={{ whiteSpace: 'pre-line' }}>اتفاقيات: {sup.agreements}</div>}
            </div>)}
        </div>)}

      {tab === 'invoices' && (
        <div className="form" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'flex-end' }}><XL onClick={exportInvoices} /></div>
          <div className="card list" style={{ padding: '4px 14px' }}>
            {p.invoices.length === 0 && <div className="empty">ما فيه فواتير في هالفترة</div>}
            {p.invoices.map((v) => {
              const st = STAGE[invoiceStage({ status: v.status, received_at: v.received_at })]
              const late = v.status === 'approved' && v.payment_status !== 'paid' && v.due_date && v.due_date < today
              return (
                <Link key={v.id} to={`/inventory/invoices/${v.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="grow">{v.no ? `رقم ${v.no}` : 'بدون رقم'}<div className="sub">{fmtDate(v.d)} · {v.lines} صنف{v.due_date ? ` · الاستحقاق ${fmtDate(v.due_date)}` : ''}{(v.goods || []).length ? ' · فيها صور بضاعة' : ''}</div></span>
                  {money && <span className="num" style={{ fontWeight: 600 }}>{kwd(v.total)}</span>}
                  {v.status === 'approved' ? <span className={'pill ' + (late ? 'red' : PAY_STATUS[v.payment_status][0])}>{late ? 'متأخرة' : PAY_STATUS[v.payment_status][1]}</span>
                    : <span className={'pill ' + st[0]}>{st[1]}</span>}
                </Link>)
            })}
          </div>
        </div>)}

      {tab === 'goods' && (
        <div className="form" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="chips">
              <button className={'chip' + (goodsView === 'lines' ? ' on' : '')} onClick={() => setGoodsView('lines')}>كل البضاعة</button>
              <button className={'chip' + (goodsView === 'photos' ? ' on' : '')} onClick={() => setGoodsView('photos')}>الصور</button>
            </div>
            <XL onClick={exportGoods} />
          </div>
          {goodsView === 'photos' ? <Photos invoices={p.invoices} /> : (
            <div className="card table-wrap" style={{ padding: '4px 10px' }}>
              <table>
                <thead><tr><th>التاريخ</th><th>الصنف</th><th>الكمية</th><th>المستلم</th>{money && <th>السعر</th>}{money && <th>المدفوع عليه</th>}<th></th></tr></thead>
                <tbody>
                  {p.lines.length === 0 && <tr><td colSpan={7} className="empty">ما فيه بضاعة في هالفترة</td></tr>}
                  {p.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="sub"><Link to={`/inventory/invoices/${l.invoice_id}`}>{fmtDate(l.d)}</Link></td>
                      <td>{l.item || <span className="sub">غير مربوط</span>}<div className="cell-sub">{l.raw}</div></td>
                      <td className="num">{qtyFmt(l.qty)} <span className="sub">{l.unit_text || ''}</span></td>
                      <td className="num">{l.received == null ? '—' : qtyFmt(l.received)}</td>
                      {money && <td className="num">{kwd(l.price)}</td>}
                      {money && <td className="num">{kwd(l.payable)}</td>}
                      <td>{l.issue !== 'none' && <span className={'pill ' + (l.issue === 'short' || l.issue === 'return' ? 'red' : 'amber')} title={l.issue_note || ''}>{ISSUES[l.issue][0]}</span>}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </div>)}

      {tab === 'prices' && (
        <div className="form" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="sub">الأسعار لكل وحدة مخزون. الخط الأحمر يعني السعر زاد.</span><XL onClick={exportPrices} /></div>
          <div className="card table-wrap" style={{ padding: '4px 10px' }}>
            <table>
              <thead><tr><th>الصنف</th><th>الكمية</th>{money && <th>المجموع</th>}<th>أقل / أعلى</th><th>آخر سعر</th><th>التغير</th><th>مورد ثاني أرخص</th></tr></thead>
              <tbody>
                {p.items.length === 0 && <tr><td colSpan={7} className="empty">ما فيه أصناف في هالفترة</td></tr>}
                {p.items.map((x) => (
                  <tr key={x.item_id}>
                    <td style={{ fontWeight: 600 }}>{x.item}<div className="cell-sub">{fmtDate(x.last_date)}</div></td>
                    <td className="num">{qtyFmt(x.stock_qty)} <span className="sub">{x.unit}</span></td>
                    {money && <td className="num">{kwd(x.total)}</td>}
                    <td className="num sub">{kwd(x.min_price)} / {kwd(x.max_price)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{kwd(x.last_price)}</td>
                    <td><Spark points={x.history} /></td>
                    <td>{x.other_best ? <span className={'pill ' + (Number(x.other_best.price) < Number(x.last_price) * 0.97 ? 'amber' : 'gray')}>{x.other_best.supplier}: {kwd(x.other_best.price)}</span> : <span className="sub">—</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </div>)}

      {tab === 'payments' && (
        <div className="form" style={{ gap: 10 }}>
          {!money ? <div className="card empty">ما عندك صلاحية تشوف المبالغ</div> : <>
            <div className="row" style={{ justifyContent: 'space-between' }}>{canPay ? <button className="btn primary" onClick={() => setPaying(true)}><Icon name="check" /> تسجيل دفعة</button> : <span />}<XL onClick={exportPayments} /></div>
            <div className="card list" style={{ padding: '4px 14px' }}>
              {p.payments.length === 0 && <div className="empty">ما فيه دفعات في هالفترة</div>}
              {p.payments.map((x) => (
                <div key={x.id} className="list-item">
                  <span className="grow">{PAY_METHOD[x.method] || x.method} · {x.invoice_no ? `فاتورة ${x.invoice_no}` : 'على الحساب'}<div className="sub">{fmtDate(x.d)}{x.note ? ` · ${x.note}` : ''}</div></span>
                  {x.receipt && <button className="chip" style={{ minHeight: 30 }} onClick={async () => { const { data } = await supabase.storage.from('invoices').createSignedUrl(x.receipt, 600); if (data) window.open(data.signedUrl, '_blank') }}>الإيصال</button>}
                  <span className="num" style={{ fontWeight: 600 }}>{kwd(x.amount)}</span>
                </div>))}
            </div></>}
        </div>)}

      {tab === 'statement' && (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {!stmt ? <div className="empty">ما عندك صلاحية تشوف كشف الحساب</div> : !stmt.rows?.length ? <div className="empty">ما فيه حركات للحين</div> : stmt.rows.map((r) => {
            run += Number(r.debit) - Number(r.credit)
            const late = r.kind === 'invoice' && r.payment_status !== 'paid' && r.due_date && r.due_date < today
            return (
              <div key={r.kind + r.id} className="list-item">
                <span className="grow">{r.kind === 'invoice' ? <Link to={`/inventory/invoices/${r.id}`}>فاتورة <span className="ltr">{r.ref || ''}</span></Link> : <span>دفعة {PAY_METHOD[r.payment_status] || ''}{r.ref ? ` · ${r.ref}` : ''}</span>}
                  <div className="sub">{fmtDate(r.d)}{r.kind === 'invoice' && r.due_date ? ` · الاستحقاق ${fmtDate(r.due_date)}` : ''}</div></span>
                {r.kind === 'invoice' && <span className={'pill ' + (late ? 'red' : PAY_STATUS[r.payment_status]?.[0])}>{late ? 'متأخرة' : PAY_STATUS[r.payment_status]?.[1]}</span>}
                <span style={{ textAlign: 'left', flexShrink: 0 }}>
                  <span className="num" style={{ fontWeight: 600, color: r.kind === 'payment' ? 'var(--ok)' : undefined }}>{r.kind === 'payment' ? '− ' : '+ '}{kwd(r.kind === 'payment' ? r.credit : r.debit)}</span>
                  <div className="sub">الرصيد <span className="num">{kwd(run)}</span></div></span>
              </div>)
          })}
        </div>)}

      {tab === 'info' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <div className="card form" style={{ gap: 8 }}>
            <strong>التواصل</strong>
            {allContacts.length === 0 && <div className="sub">ما فيه أرقام</div>}
            {allContacts.map((c, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <span className="grow"><span className="sub">{CONTACT_ROLE[c.role] || ''}</span> {c.name || ''}<div className="num ltr" style={{ textAlign: 'right' }}>{c.phone}</div></span>
                {c.phone && <a className="icon-btn" style={{ width: 36, height: 36 }} href={telLink(c.phone)} aria-label="اتصال"><Icon name="phone" size={16} /></a>}
                {c.phone && c.whatsapp && <a className="icon-btn" style={{ width: 36, height: 36, color: '#1F8F4E' }} href={waLink(c.phone)} target="_blank" rel="noreferrer" aria-label="واتساب"><Icon name="chat" size={16} /></a>}
              </div>))}
            {sup.phone && contacts.length > 0 && <div>هاتف الشركة: <a href={telLink(sup.phone)} className="num">{sup.phone}</a></div>}
            {sup.email && <div>الإيميل: <a href={`mailto:${sup.email}`} className="ltr">{sup.email}</a></div>}
          </div>
          <div className="card form" style={{ gap: 6 }}>
            <strong>العنوان</strong>
            <div>{[sup.area, sup.address].filter(Boolean).join(' — ') || <span className="sub">ما فيه عنوان</span>}</div>
            {sup.map_url && <a className="btn" href={sup.map_url} target="_blank" rel="noreferrer"><Icon name="pin" /> افتح الخريطة</a>}
          </div>
          <div className="card form" style={{ gap: 6 }}>
            <strong>الدفع</strong>
            <div>الشروط: {sup.payment_terms || '—'} · المهلة: {sup.credit_days ? `${sup.credit_days} يوم` : 'فوري'}</div>
            <div>الطريقة المفضلة: {PAY_PREF[sup.preferred_payment] || '—'}</div>
            {bank ? <div className="form" style={{ gap: 4, background: '#F7F9F5', borderRadius: 10, padding: 10 }}>
              <div>البنك: {bank.bank_name || '—'}</div><div>صاحب الحساب: {bank.account_name || '—'}</div>
              <div>رقم الحساب: <span className="num ltr">{bank.account_no || '—'}</span></div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>IBAN: <span className="num ltr" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{bank.iban || '—'}</span>
                {bank.iban && <button className="chip" style={{ minHeight: 26, fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(bank.iban)}>نسخ</button>}</div>
              {bank.swift && <div>SWIFT: <span className="ltr">{bank.swift}</span></div>}
            </div> : (access.is_owner || canPay) ? <div className="sub">ما فيه بيانات بنك. أضفها من "تعديل".</div> : null}
          </div>
          <div className="card form" style={{ gap: 6 }}>
            <strong>الأوراق</strong>
            <div>السجل التجاري: {sup.cr_no || '—'} · الرخصة: {sup.licence_no || '—'}</div>
            <div>انتهاء الرخصة: {sup.licence_expiry ? fmtDate(sup.licence_expiry) : '—'} · انتهاء العقد: {sup.contract_expiry ? fmtDate(sup.contract_expiry) : '—'}</div>
            {sup.doc_paths?.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{sup.doc_paths.map((x, i) => <button key={x} className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', x)}>ورقة {i + 1}</button>)}</div>}
          </div>
        </div>)}

      {tab === 'notes' && (
        <div className="form" style={{ gap: 10 }}>
          <div className="card form" style={{ gap: 8 }}>
            <div className="chips">{[['note', 'ملاحظة'], ['problem', 'مشكلة'], ['agreement', 'اتفاق']].map(([kk, l]) => <button key={kk} className={'chip' + (note.kind === kk ? ' on' : '')} onClick={() => setNote({ ...note, kind: kk })}>{l}</button>)}</div>
            <textarea className="input" rows={2} placeholder="مثلاً: البضاعة وصلت متأخرة ٣ ساعات" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} aria-label="الملاحظة" />
            <button className="btn primary" disabled={!note.body.trim()} onClick={addNote}>إضافة</button>
          </div>
          <div className="card list" style={{ padding: '4px 14px' }}>
            {notes.length === 0 && <div className="empty">ما فيه ملاحظات</div>}
            {notes.map((x) => (
              <div key={x.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span className={'pill ' + (x.kind === 'problem' ? 'red' : x.kind === 'agreement' ? 'blue' : 'gray')}>{x.kind === 'problem' ? 'مشكلة' : x.kind === 'agreement' ? 'اتفاق' : 'ملاحظة'}</span>
                <span className="grow" style={{ whiteSpace: 'pre-line' }}>{x.body}<div className="sub">{x.employees?.full_name || ''} · {fmtDate(x.created_at)}</div></span>
              </div>))}
            {p?.lines?.filter((l) => l.issue !== 'none').slice(0, 20).map((l, i) => (
              <div key={'i' + i} className="list-item">
                <span className={'pill ' + (l.issue === 'short' || l.issue === 'return' ? 'red' : 'amber')}>{ISSUES[l.issue][0]}</span>
                <span className="grow">{l.item || l.raw}{l.issue_note ? `: ${l.issue_note}` : ''}<div className="sub">من فاتورة {l.invoice_no || ''} · {fmtDate(l.d)}</div></span>
              </div>))}
          </div>
        </div>)}

      {tab === 'ask' && <Ask supplierId={id} name={sup.name} />}
      </>}

      {edit && <SupplierForm supplier={sup} onClose={() => setEdit(false)} onSaved={() => { loadBase(); loadProfile() }} />}
      {ordering && <OrderSheet supplier={sup} contacts={contacts.filter((c) => c.whatsapp)} onClose={() => setOrdering(false)} />}
      {paying && <PaymentForm supplierId={id} supplierName={sup.name} openInvoices={(p?.invoices || []).filter((v) => v.status === 'approved' && v.payment_status !== 'paid').map((v) => ({ id: v.id, invoice_no: v.no, total_due: v.total, paid_amount: v.paid }))}
        onClose={() => setPaying(false)} onSaved={() => { loadBase(); loadProfile() }} />}
    </div>
  )
}
