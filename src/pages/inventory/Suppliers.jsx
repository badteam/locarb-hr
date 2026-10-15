import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, invErr, clearLookups } from '../../lib/inv'
import { CONTACT_ROLE, SUP_STATUS, WEEKDAYS, PAY_PREF, telLink, waLink } from '../../lib/supplier'
import Icon from '../../components/Icon.jsx'
import { uploadAttachment, readFile, readError, openFile, ACCEPT } from '../../lib/ai'

const Section = ({ title, children }) => <div className="card form" style={{ gap: 10, padding: 14 }}><strong style={{ fontSize: 15 }}>{title}</strong>{children}</div>
const blankContact = () => ({ tmp: Math.random(), role: 'sales', name: '', phone: '', whatsapp: true })

export function SupplierForm({ supplier, presetName, onClose, onSaved }) {
  const { access, can } = useAccess()
  const canBank = access.is_owner || can('supplier_payments') || can('manage_suppliers')
  const s = supplier || {}
  const [f, setF] = useState({
    name: s.name || presetName || '', status: s.status || (s.active === false ? 'paused' : 'active'), status_reason: s.status_reason || '',
    categories: (s.categories || []).join('، '), phone: s.phone || '', email: s.email || '',
    area: s.area || '', address: s.address || '', map_url: s.map_url || '',
    payment_terms: s.payment_terms || '', credit_days: s.credit_days ?? 0, preferred_payment: s.preferred_payment || '',
    min_order: s.min_order ?? '', delivery_days: s.delivery_days || [], order_cutoff: s.order_cutoff || '', agreements: s.agreements || '',
    cr_no: s.cr_no || '', licence_no: s.licence_no || '', licence_expiry: s.licence_expiry || '', contract_expiry: s.contract_expiry || '',
    doc_paths: s.doc_paths || [], notes: s.notes || '',
  })
  const [contacts, setContacts] = useState([])
  const [removed, setRemoved] = useState([])
  const [bank, setBank] = useState({ bank_name: '', account_name: '', account_no: '', iban: '', swift: '', notes: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState(null)
  useEffect(() => {
    if (!s.id) { setContacts(s.contact_name || s.phone ? [] : [blankContact()]); return }
    supabase.from('supplier_contacts').select('*').eq('supplier_id', s.id).order('sort_order').order('created_at').then(({ data }) => {
      const list = data || []
      // older suppliers kept one contact on the supplier itself
      if (!list.length && (s.contact_name || s.phone)) list.push({ ...blankContact(), name: s.contact_name || '', phone: s.phone || '' })
      setContacts(list.length ? list : [blankContact()])
    })
    if (canBank) supabase.from('supplier_bank').select('*').eq('supplier_id', s.id).maybeSingle().then(({ data }) => data && setBank(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setC = (i, patch) => setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const read = async (file) => {
    if (!file) return
    setBusy(true); setScan(null)
    try {
      const path = await uploadAttachment(file, access.employee.id)
      const r = await readFile('supplier', [path])
      setF((x) => ({ ...x, doc_paths: [...x.doc_paths, path] }))
      if (!r.ok) { setScan({ ok: false, t: readError(r) }); setBusy(false); return }
      const d = r.data
      setF((x) => ({ ...x, name: x.name || d.company_name || '', phone: x.phone || d.phone || '', payment_terms: x.payment_terms || d.payment_terms || '',
        licence_no: d.licence_no || x.licence_no, licence_expiry: d.licence_expiry || x.licence_expiry, contract_expiry: d.contract_expiry || x.contract_expiry }))
      if (d.contact_name || d.phone) setContacts((cs) => (cs.some((c) => c.phone === d.phone) ? cs : [...cs.filter((c) => c.name || c.phone), { ...blankContact(), name: d.contact_name || '', phone: d.phone || '' }]))
      const dup = !supplier && r.match?.supplier ? r.match.supplier : null
      setScan(dup ? { ok: false, t: `انتبه: هالمورد شكله موجود عندك باسم "${dup.name}".` } : { ok: true, t: `قرا الورقة: ${d.summary_ar || d.company_name || ''}` })
    } catch (e2) { setScan({ ok: false, t: invErr(e2) }) }
    setBusy(false)
  }
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const n = (v) => (v === '' || v == null ? null : v)
    const first = contacts.find((c) => c.phone || c.name)
    const row = {
      name: f.name.trim(), status: f.status, active: f.status !== 'paused' && f.status !== 'blocked', status_reason: n(f.status_reason),
      categories: f.categories.split(/[،,]/).map((x) => x.trim()).filter(Boolean),
      phone: n(f.phone) || first?.phone || null, contact_name: first?.name || null, email: n(f.email),
      area: n(f.area), address: n(f.address), map_url: n(f.map_url),
      payment_terms: n(f.payment_terms), credit_days: Math.max(0, parseInt(f.credit_days, 10) || 0), preferred_payment: n(f.preferred_payment),
      min_order: f.min_order === '' ? null : Number(f.min_order), delivery_days: f.delivery_days, order_cutoff: n(f.order_cutoff), agreements: n(f.agreements),
      cr_no: n(f.cr_no), licence_no: n(f.licence_no), licence_expiry: n(f.licence_expiry), contract_expiry: n(f.contract_expiry), doc_paths: f.doc_paths, notes: n(f.notes),
      ...((f.licence_expiry !== (s.licence_expiry || '') || f.contract_expiry !== (s.contract_expiry || '')) ? { last_alert_stage: null } : {}),
    }
    const r = s.id ? await supabase.from('suppliers').update(row).eq('id', s.id).select().single() : await supabase.from('suppliers').insert(row).select().single()
    if (r.error) { setErr(invErr(r.error)); setBusy(false); return }
    const sid = r.data.id
    const keep = contacts.filter((c) => c.name || c.phone)
    if (removed.length) await supabase.from('supplier_contacts').delete().in('id', removed)
    for (let i = 0; i < keep.length; i++) {
      const c = keep[i]
      const rowC = { supplier_id: sid, role: c.role, name: n(c.name), phone: n(c.phone), whatsapp: !!c.whatsapp, email: n(c.email), notes: n(c.notes), sort_order: i }
      const rr = c.id ? await supabase.from('supplier_contacts').update(rowC).eq('id', c.id) : await supabase.from('supplier_contacts').insert(rowC)
      if (rr.error) { setErr(invErr(rr.error)); setBusy(false); return }
    }
    if (canBank && Object.entries(bank).some(([k, v]) => !['supplier_id', 'updated_at', 'updated_by'].includes(k) && v)) {
      const b = { supplier_id: sid, bank_name: n(bank.bank_name), account_name: n(bank.account_name), account_no: n(bank.account_no),
        iban: n((bank.iban || '').replace(/\s+/g, '').toUpperCase()), swift: n(bank.swift), notes: n(bank.notes), updated_at: new Date().toISOString() }
      const rb = await supabase.from('supplier_bank').upsert(b)
      if (rb.error) { setErr('انحفظ المورد، بس بيانات البنك ما انحفظت: ' + invErr(rb.error)); setBusy(false); return }
    }
    setBusy(false); clearLookups(); onSaved?.(r.data); onClose()
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save} style={{ maxWidth: 720 }}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{s.id ? s.name : 'مورد جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <label className="upload" style={{ height: 70 }}>
          <input type="file" accept={ACCEPT} onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
          {busy ? <><span className="spinner" /> جاري القراءة…</> : <><Icon name="camera" /> ارفع رخصة المورد أو العقد أو الكرت، والنظام يعبّي البيانات</>}
        </label>
        {scan && <div className={scan.ok ? 'notice' : 'warn'}>{scan.t}</div>}

        <Section title="الأساسي">
          <div className="field"><label htmlFor="sn">اسم المورد</label><input id="sn" className="input" value={f.name} onChange={set('name')} required /></div>
          <div className="field"><label htmlFor="sc">إيش يورّد (افصل بفاصلة)</label><input id="sc" className="input" placeholder="مثلاً: دجاج، لحوم، تغليف" value={f.categories} onChange={set('categories')} />
            <div className="sub">النظام يضيف لحاله التصنيفات من الفواتير.</div></div>
          <div className="field"><span className="lbl">الحالة</span>
            <div className="chips">{Object.entries(SUP_STATUS).map(([k, [, l]]) => <button type="button" key={k} className={'chip' + (f.status === k ? ' on' : '')} onClick={() => setF({ ...f, status: k })}>{l}</button>)}</div></div>
          {f.status !== 'active' && <div className="field"><label htmlFor="sr">السبب</label><input id="sr" className="input" value={f.status_reason} onChange={set('status_reason')} /></div>}
        </Section>

        <Section title="أرقام التواصل">
          {contacts.map((c, i) => (
            <div key={c.id || c.tmp} className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
              <select className="input" value={c.role} onChange={(e) => setC(i, { role: e.target.value })} aria-label="الصفة">
                {Object.entries(CONTACT_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="input" placeholder="الاسم" value={c.name || ''} onChange={(e) => setC(i, { name: e.target.value })} aria-label="الاسم" />
              <input className="input ltr" inputMode="tel" placeholder="الرقم" value={c.phone || ''} onChange={(e) => setC(i, { phone: e.target.value })} aria-label="الرقم" />
              <div className="row" style={{ gap: 4 }}>
                <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={!!c.whatsapp} onChange={(e) => setC(i, { whatsapp: e.target.checked })} /> واتساب</label>
                <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="حذف" onClick={() => { if (c.id) setRemoved([...removed, c.id]); setContacts(contacts.filter((_, j) => j !== i)) }}><Icon name="trash" size={15} /></button>
              </div>
            </div>))}
          <button type="button" className="btn" onClick={() => setContacts([...contacts, blankContact()])}><Icon name="plus" /> رقم ثاني</button>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="ph">هاتف الشركة</label><input id="ph" className="input ltr" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
            <div className="field"><label htmlFor="em">الإيميل</label><input id="em" className="input ltr" type="email" value={f.email} onChange={set('email')} /></div>
          </div>
        </Section>

        <Section title="العنوان">
          <div className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <div className="field"><label htmlFor="ar">المنطقة</label><input id="ar" className="input" value={f.area} onChange={set('area')} placeholder="مثلاً: الري" /></div>
            <div className="field"><label htmlFor="ad">العنوان</label><input id="ad" className="input" value={f.address} onChange={set('address')} placeholder="قطعة، شارع، مبنى" /></div>
          </div>
          <div className="field"><label htmlFor="mp">رابط اللوكيشن (خرائط جوجل)</label><input id="mp" className="input ltr" value={f.map_url} onChange={set('map_url')} /></div>
        </Section>

        <Section title="الدفع والتوريد">
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
            <div className="field"><label htmlFor="pt">شروط الدفع</label><input id="pt" className="input" placeholder="مثلاً: آجل ٣٠ يوم" value={f.payment_terms} onChange={set('payment_terms')} /></div>
            <div className="field"><label htmlFor="cd">مهلة الدفع (يوم)</label><input id="cd" className="input num" type="number" min="0" value={f.credit_days} onChange={set('credit_days')} /></div>
            <div className="field"><label htmlFor="pp">طريقة الدفع</label>
              <select id="pp" className="input" value={f.preferred_payment} onChange={set('preferred_payment')}><option value="">—</option>
                {Object.entries(PAY_PREF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <div className="field"><span className="lbl">أيام التوصيل</span>
            <div className="chips">{WEEKDAYS.map((d, i) => <button type="button" key={i} className={'chip' + (f.delivery_days.includes(i) ? ' on' : '')}
              onClick={() => setF({ ...f, delivery_days: f.delivery_days.includes(i) ? f.delivery_days.filter((x) => x !== i) : [...f.delivery_days, i].sort() })}>{d}</button>)}</div></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="oc">آخر وقت للطلب</label><input id="oc" className="input" placeholder="مثلاً: قبل ٢ الظهر لليوم اللي بعده" value={f.order_cutoff} onChange={set('order_cutoff')} /></div>
            <div className="field"><label htmlFor="mo">أقل طلبية (د.ك)</label><input id="mo" className="input num" type="number" min="0" step="any" value={f.min_order} onChange={set('min_order')} /></div>
          </div>
          <div className="field"><label htmlFor="ag">اتفاقيات خاصة</label><textarea id="ag" className="input" rows={2} placeholder="مثلاً: سعر ثابت للدجاج لين نهاية السنة، خصم ٣٪ فوق ٥٠٠ د.ك" value={f.agreements} onChange={set('agreements')} /></div>
        </Section>

        {canBank && <Section title="بيانات البنك (تبين للمالك والمحاسب بس)">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="bn">البنك</label><input id="bn" className="input" value={bank.bank_name || ''} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ba">اسم صاحب الحساب</label><input id="ba" className="input" value={bank.account_name || ''} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="bc">رقم الحساب</label><input id="bc" className="input ltr" value={bank.account_no || ''} onChange={(e) => setBank({ ...bank, account_no: e.target.value })} /></div>
            <div className="field"><label htmlFor="bs">SWIFT</label><input id="bs" className="input ltr" value={bank.swift || ''} onChange={(e) => setBank({ ...bank, swift: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="bi">الآيبان IBAN</label><input id="bi" className="input ltr" placeholder="KW.." value={bank.iban || ''} onChange={(e) => setBank({ ...bank, iban: e.target.value })} /></div>
        </Section>}

        <Section title="الأوراق الرسمية">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="field"><label htmlFor="cr">السجل التجاري</label><input id="cr" className="input ltr" value={f.cr_no} onChange={set('cr_no')} /></div>
            <div className="field"><label htmlFor="ln">رقم الرخصة</label><input id="ln" className="input ltr" value={f.licence_no} onChange={set('licence_no')} /></div>
            <div className="field"><label htmlFor="le">انتهاء الرخصة</label><input id="le" type="date" className="input" value={f.licence_expiry} onChange={set('licence_expiry')} /></div>
            <div className="field"><label htmlFor="ce">انتهاء العقد</label><input id="ce" type="date" className="input" value={f.contract_expiry} onChange={set('contract_expiry')} /></div>
          </div>
          {f.doc_paths.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="sub">الأوراق:</span>
            {f.doc_paths.map((p, i) => <button type="button" key={p} className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', p)}>ورقة {i + 1}</button>)}</div>}
        </Section>
        <div className="field"><label htmlFor="no">ملاحظات عامة</label><input id="no" className="input" value={f.notes} onChange={set('notes')} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : null} حفظ</button>
      </form>
    </div>
  )
}

function Directory() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { supabase.rpc('supplier_directory').then(({ data }) => setRows(data || [])) }, [])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows || []).filter((s) => !t || [s.name, s.area, ...(s.categories || []), ...(s.categories_auto || []), ...(s.items || []), ...(s.contacts || []).map((c) => `${c.name} ${c.phone}`), s.phone]
      .some((x) => String(x || '').toLowerCase().includes(t)))
  }, [rows, q])
  const nav = useNavigate()
  return (
    <div>
      <div className="toolbar"><div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر باسم المورد أو بالصنف (مثلاً: دجاج) أو بالرقم" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {!rows ? <div className="center" style={{ minHeight: 120 }}><span className="spinner" /></div> :
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
          {shown.map((s) => {
            const cats = [...new Set([...(s.categories || []), ...(s.categories_auto || [])])]
            const contacts = s.contacts?.length ? s.contacts : s.phone ? [{ role: 'sales', name: s.contact_name, phone: s.phone, whatsapp: true }] : []
            const hit = q.trim() && (s.items || []).filter((i) => i.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 4)
            return (
              <div key={s.id} className="card form" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button className="btn-link" style={{ fontWeight: 700, fontSize: 16, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)' }} onClick={() => nav(`/inventory/suppliers/${s.id}`)}>{s.name}</button>
                  {s.status !== 'active' && <span className={'pill ' + SUP_STATUS[s.status][0]}>{SUP_STATUS[s.status][1]}</span>}
                </div>
                {cats.length > 0 && <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{cats.map((c) => <span key={c} className="pill gray">{c}</span>)}</div>}
                {hit?.length > 0 && <div className="sub">يبيع: {hit.join('، ')}</div>}
                {s.area && <div className="sub">{s.area}</div>}
                {contacts.length === 0 && <div className="sub">ما فيه أرقام مسجلة</div>}
                {contacts.map((c, i) => (
                  <div key={i} className="row" style={{ gap: 6 }}>
                    <span className="grow"><span className="sub">{CONTACT_ROLE[c.role] || ''}</span> {c.name || ''} <span className="num ltr">{c.phone}</span></span>
                    {c.phone && <a className="icon-btn" style={{ width: 36, height: 36 }} href={telLink(c.phone)} aria-label="اتصال"><Icon name="phone" size={16} /></a>}
                    {c.phone && c.whatsapp && <a className="icon-btn" style={{ width: 36, height: 36, color: '#1F8F4E' }} href={waLink(c.phone)} target="_blank" rel="noreferrer" aria-label="واتساب"><Icon name="chat" size={16} /></a>}
                  </div>))}
              </div>)
          })}
          {shown.length === 0 && <div className="card empty">ما لقينا شي</div>}
        </div>}
    </div>
  )
}

export default function Suppliers() {
  const { can } = useAccess()
  const nav = useNavigate()
  const [tab, setTab] = useState('list')
  const [list, setList] = useState([])
  const [stats, setStats] = useState({})
  const [q, setQ] = useState('')
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
  const shown = useMemo(() => list.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || (s.phone || '').includes(q.trim())
    || (s.categories || []).some((c) => c.includes(q.trim()))), [list, q])

  return (
    <div>
      <div className="page-head"><div><h1>الموردين</h1><div className="sub">افتح أي مورد تشوف كل شي عنه: فواتيره، بضاعته، أسعاره، حسابه، وتقدر تسأل النظام عنه</div></div>
        {canEdit && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> مورد جديد</button>}</div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip' + (tab === 'list' ? ' on' : '')} onClick={() => setTab('list')}>الموردين</button>
        <button className={'chip' + (tab === 'dir' ? ' on' : '')} onClick={() => setTab('dir')}>دليل الأرقام</button>
      </div>
      {tab === 'dir' ? <Directory /> : <>
        <div className="toolbar"><div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر بالاسم أو الرقم أو إيش يورّد" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {shown.length === 0 && <div className="empty">ما فيه موردين. أضف أول مورد، أو صوّر فاتورة والنظام يقترح اسم المورد.</div>}
          {shown.map((s) => {
            const st = stats[s.id]
            return (
              <button key={s.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => nav(`/inventory/suppliers/${s.id}`)}>
                <span className="avatar"><Icon name="truck" /></span>
                <span className="grow"><div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="sub">{(s.categories || []).length ? s.categories.join('، ') + ' · ' : ''}{st ? `${st.n} فاتورة آخر ٩٠ يوم · آخر وحدة ${fmtDate(st.last)}` : 'ما فيه فواتير معتمدة'}</div></span>
                {st && <span className="num" style={{ fontWeight: 600 }}>{kwd(st.total)}</span>}
                {owed[s.id]?.amt > 0.0005 && <span className={'pill ' + (owed[s.id].late > 0 ? 'red' : 'amber')}>علينا {kwd(owed[s.id].amt)}</span>}
                {(() => { const d = [s.licence_expiry, s.contract_expiry].filter(Boolean).sort()[0]; if (!d) return null; const left = Math.round((new Date(d) - new Date()) / 864e5)
                  return left < 0 ? <span className="pill red">ورقة منتهية</span> : left <= 30 ? <span className="pill amber">ورقة تنتهي بعد {left} يوم</span> : null })()}
                {s.status && s.status !== 'active' && <span className={'pill ' + SUP_STATUS[s.status][0]}>{SUP_STATUS[s.status][1]}</span>}
              </button>
            )
          })}
        </div>
      </>}
      {adding && <SupplierForm onClose={() => setAdding(false)} onSaved={(s) => nav(`/inventory/suppliers/${s.id}`)} />}
    </div>
  )
}
