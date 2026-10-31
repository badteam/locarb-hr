import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate, selectAll } from '../../lib/supabase'
import { kwd, loadLookups } from '../../lib/inv'
import { useAccess } from '../../lib/access.jsx'
import { startRead, compress } from './Invoices.jsx'
import { isPdf } from '../../lib/pdfPages'
import { splitPdf } from '../../lib/pdfSplit'
import { parsePack, parseWeight, MEASURE_UNITS, fmtContent } from '../../components/UnitContent.jsx'
import Icon from '../../components/Icon.jsx'
import ItemSearchSheet from '../../components/ItemSearchSheet.jsx'

// Old invoices uploaded only to learn prices: no quantities go into stock, nothing becomes payable.
// A price is written only on items that have no price yet, once per item.
const CARTON_RE = /ctn|carton|box|كرتون|صندوق/i
const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01

const KILO_RE = /^(كيلو|كغ|كجم|kg|kgs|k\.g)$/i
const LITRE_RE = /^(لتر|ltr|l|lt)$/i

// invoice price -> price of ONE stock unit of the item. Returns { price, how, grams?, pieces?, measure?, skip? }
function stockPrice(line, item, packFactor) {
  const price = Number(line.unit_price) || 0
  if (!price) return { price: 0 }
  const unit = item.inv_units?.name || ''
  const mu = MEASURE_UNITS[unit]
  const ut = String(line.unit_text || '').trim()
  const perKilo = KILO_RE.test(ut) || LITRE_RE.test(ut)
  const pk = parsePack(line.raw_name) || parsePack(ut)
  const w = pk ? pk.total : (parseWeight(ut)?.each || parseWeight(line.raw_name)?.each || null)
  const wm = pk?.measure || parseWeight(ut)?.measure || parseWeight(line.raw_name)?.measure || 'g'
  const invCarton = CARTON_RE.test(ut) || CARTON_RE.test(line.raw_name || '')
  const itemCarton = /كرتون/.test(unit)
  if (Number(packFactor) > 1) return { price: price / Number(packFactor), how: `وحدة الفاتورة = ${Number(packFactor)} ${unit}` }
  if (mu) {
    if (perKilo) return { price: price * mu[0] / 1000, how: 'الفاتورة بالكيلو' }
    if (w) { const k = w / mu[0]; return { price: price / k, how: `وحدة الفاتورة فيها ${fmtContent(w, wm)} = ${+k.toFixed(3)} ${unit}` } }
    return { price, how: `اعتبرت وحدة الفاتورة = 1 ${unit}` }
  }
  if (perKilo) {
    const g = Number(item.unit_grams)
    if (g) return { price: price * g / 1000, how: `الفاتورة بالكيلو، والـ${unit} = ${fmtContent(g, item.unit_measure)}` }
    return { price: 0, skip: `الفاتورة بسعر الكيلو، والـ${unit} مش معروف وزنه. اكتب وزنه في الصنف وارفعها تاني` }
  }
  if (itemCarton) return { price, ...(w ? { grams: w, measure: wm, ...(pk ? { pieces: pk.n } : {}) } : {}) }
  if (pk && invCarton) return { price: price / pk.n, how: `الكرتونة فيها ${pk.n} ${unit}`, grams: pk.each, measure: pk.measure }
  return { price, ...(w && !invCarton ? { grams: w, measure: wm } : {}) }
}

const ST = {
  set: ['اتسعّر', 'ok'], has: ['عنده سعر من قبل', 'gray'], done: ['اتسعّر من فاتورة قبلها', 'gray'],
  confirm: ['هو ده الصنف؟', 'amber'], wrong: ['مش هو، اتساب', 'gray'], zero: ['السعر صفر في الفاتورة', 'gray'], skip: ['محتاج وزن الوحدة', 'amber'], none: ['مش موجود في المخزون', 'amber'], undone: ['اتلغى', 'gray'],
}

export default function PriceFill() {
  const { access } = useAccess()
  const [lk, setLk] = useState(null)
  const [jobs, setJobs] = useState([])
  const priced = useRef(new Set())
  const [items, setItems] = useState([])
  const [picking, setPicking] = useState(null)   // { key, i }
  const [busyRow, setBusyRow] = useState('')
  const queue = useRef(Promise.resolve())
  const started = useRef(new Set())
  useEffect(() => {
    loadLookups().then(setLk)
    selectAll(() => supabase.from('inv_stock').select('id,name_ar,name_en,unit,category').eq('active', true).order('name_ar').order('id')).then((data) => setItems(data || []))
  }, [])
  // invoices that were read but not finished (page closed, or an error): finish them now
  useEffect(() => {
    supabase.from('purchase_invoices').select('id,created_at').eq('price_only', true).eq('status', 'review').order('created_at').then(({ data }) => {
      for (const x of data || []) {
        const key = x.id
        if (started.current.has(key)) continue
        started.current.add(key)
        setJobs((l) => (l.some((j) => j.key === key) ? l : [...l, { key, name: 'فاتورة اترفعت قبل كده', id: x.id, state: 'بيقارن الأسعار…' }]))
        queue.current = queue.current.then(() => apply(key, x.id))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upd = (key, patch) => setJobs((l) => l.map((j) => (j.key === key ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)))

  // a PDF with several invoices scanned together is cut into one PDF per invoice, and each is read on its own
  // (its own supplier, number and date). Any size works: huge scans are re-drawn page by page first.
  const add = async (files) => {
    for (const file of files) {
      let parts = [{ file }]
      if (isPdf(file)) {
        const key = crypto.randomUUID()
        setJobs((l) => [...l, { key, name: file.name, state: 'بشوف كم فاتورة في الملف…' }])
        try { parts = await splitPdf(file, { kind: 'invoices', employeeId: access.employee?.id, onState: (t) => upd(key, { state: t }) }) }
        catch (e) {
          const m = e.message === 'no_credit' ? 'رصيد قارئ الفواتير خلص' : e.message === 'not_configured' ? 'قارئ الفواتير مش متفعّل' : 'ما قدرت أفتح الـ PDF: ' + (e.message || e)
          upd(key, { state: null, error: m }); continue
        }
        setJobs((l) => l.filter((j) => j.key !== key))
      }
      for (const p of parts) {
        const key = crypto.randomUUID()
        const name = parts.length > 1 ? `${p.title || file.name} · ${p.from === p.to ? `صفحة ${p.from}` : `صفحات ${p.from}-${p.to}`} من ${p.pages}` : file.name
        setJobs((l) => [...l, { key, name, state: 'قاعد يرفع…' }])
        read(key, [p.file]).then((id) => { if (id) queue.current = queue.current.then(() => apply(key, id)) })
      }
    }
  }

  const read = async (key, files) => {
    try {
      const { data: inv, error } = await supabase.from('purchase_invoices').insert({ branch_id: lk.kitchen.id, status: 'draft', price_only: true, notes: 'تسعير فقط من فاتورة قديمة' }).select('id').single()
      if (error) throw error
      const paths = []
      for (let i = 0; i < files.length; i++) {
        const f = await compress(files[i])
        const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg'
        const path = `${inv.id}/${i + 1}-${Date.now()}.${ext}`
        const up = await supabase.storage.from('invoices').upload(path, f, { contentType: f.type || 'image/jpeg' })
        if (up.error) throw up.error
        paths.push(path)
      }
      await supabase.from('purchase_invoices').update({ image_paths: paths }).eq('id', inv.id)
      upd(key, { state: 'قاعد يقرا الفاتورة…', id: inv.id })
      const r = await startRead(inv.id)
      if (r?.error) throw new Error(r.error === 'no_credit' ? 'رصيد قارئ الفواتير خلص' : r.error === 'not_configured' ? 'قارئ الفواتير مش متفعّل' : r.error)
      upd(key, { state: 'بيقارن الأسعار…' })
      return inv.id
    } catch (e) { upd(key, { state: null, error: e.message || String(e) }); return null }
  }

  const apply = async (key, id) => {
    try {
      const { data: inv } = await supabase.from('purchase_invoices')
        .select('id,invoice_no,invoice_date,supplier_id,total_read,supplier_name_read,suppliers(name),purchase_invoice_lines(id,line_no,raw_name,qty,unit_text,unit_price,item_id,match_score,inv_items!purchase_invoice_lines_item_id_fkey(id,name_ar,last_price,avg_cost,alert_base_price,unit_grams,unit_measure,inv_units(name)))')
        .eq('id', id).single()
      if (!inv) throw new Error('ما قدرتش أفتح الفاتورة بعد القراءة')
      const head = { supplier: inv.suppliers?.name || inv.supplier_name_read || 'مورد غير معروف', supplier_id: inv.supplier_id, no: inv.invoice_no, date: inv.invoice_date, total: inv.total_read }

      // same invoice uploaded before (as a real invoice, or already used for prices)?
      let dup = null
      if (inv.invoice_no || inv.invoice_date) {
        let q = supabase.from('purchase_invoices').select('id,invoice_no,invoice_date,total_read,price_only,status,notes,supplier_id,supplier_name_read').neq('id', id).neq('status', 'failed')
        q = inv.invoice_no ? q.eq('invoice_no', inv.invoice_no) : q.eq('invoice_date', inv.invoice_date)
        const { data: others } = await q
        const sameSup = (o) => (inv.supplier_id && o.supplier_id === inv.supplier_id) || (!inv.supplier_id && (!o.supplier_id || o.supplier_name_read === inv.supplier_name_read)) || near(o.total_read, inv.total_read)
        const counted = (o) => !o.price_only || (o.status === 'rejected' && !String(o.notes || '').includes('متدبلة'))
        dup = (others || []).find((o) => counted(o) && sameSup(o) && (inv.invoice_no ? true : near(o.total_read, inv.total_read)))
      }
      if (dup) {
        await supabase.from('purchase_invoices').update({ status: 'rejected', notes: 'تسعير فقط: فاتورة متدبلة' }).eq('id', id)
        upd(key, { state: null, head, dup: dup.price_only ? 'اترفعت قبل كده للتسعير' : 'موجودة في فواتير الموردين', rows: [] })
        return
      }

      const ids = [...new Set(inv.purchase_invoice_lines.map((l) => l.item_id).filter(Boolean))]
      const { data: si } = inv.supplier_id && ids.length
        ? await supabase.from('supplier_items').select('item_id,pack_factor').eq('supplier_id', inv.supplier_id).in('item_id', ids) : { data: [] }
      const pf = Object.fromEntries((si || []).map((x) => [x.item_id, x.pack_factor]))

      const rows = []
      for (const l of inv.purchase_invoice_lines.sort((a, b) => a.line_no - b.line_no)) {
        const it = l.inv_items
        if (!it) { rows.push({ l, st: 'none' }); continue }
        const sp = stockPrice(l, it, pf[it.id])
        if (sp.skip) { rows.push({ l, it, st: 'skip', how: sp.skip }); continue }
        const p = Math.round(sp.price * 1000) / 1000
        if (!p) { rows.push({ l, it, st: 'zero' }); continue }
        if (priced.current.has(it.id)) { rows.push({ l, it, p, how: sp.how, st: 'done' }); continue }
        if (Number(it.last_price) > 0) { rows.push({ l, it, p, how: sp.how, st: 'has' }); continue }
        const ug = Number(it.unit_grams)
        const patch = { last_price: p, ...(Number(it.avg_cost) > 0 ? {} : { avg_cost: p }), ...(Number(it.alert_base_price) > 0 ? {} : { alert_base_price: p }),
          ...(sp.grams && (!ug || ug < sp.grams * 0.6) ? { unit_grams: sp.grams, unit_measure: sp.measure, ...(sp.pieces ? { unit_pieces: sp.pieces } : {}) } : {}) }
        // a weak name match is not trusted: the user confirms it first
        if (l.match_score != null && Number(l.match_score) < 0.75) { priced.current.add(it.id); rows.push({ l, it, p, how: sp.how, st: 'confirm', patch }); continue }
        const st = await setPrice(it.id, patch)
        rows.push({ l, it, p, how: sp.how, st, patch })
      }
      await supabase.from('purchase_invoices').update({ status: 'rejected', notes: 'تسعير فقط من فاتورة قديمة (الكميات ما دخلت المخزون)' }).eq('id', id)
      upd(key, { state: null, head, rows })
    } catch (e) { upd(key, { state: null, error: e.message || String(e) }) }
  }

  const setPrice = async (itemId, patch) => {
    const r = await supabase.from('inv_items').update(patch).eq('id', itemId).or('last_price.is.null,last_price.eq.0').select('id')
    if (r.error) return 'none'
    priced.current.add(itemId)
    return r.data?.length ? 'set' : 'has'
  }
  const confirm = async (key, i, ok) => {
    const row = jobs.find((x) => x.key === key).rows[i]
    const st = ok ? await setPrice(row.it.id, row.patch) : 'wrong'
    if (!ok) priced.current.delete(row.it.id)
    upd(key, (x) => ({ rows: x.rows.map((y, n) => (n === i ? { ...y, st } : y)) }))
  }

  // the manager picks the right item for a line (wrong link, or none): the old price comes off, the new one goes on,
  // and the link is remembered for this supplier
  const relink = async (key, i, itemId) => {
    const j = jobs.find((x) => x.key === key), row = j.rows[i]
    setBusyRow(`${key}:${i}`)
    try {
      if (row.st === 'set' && row.it) {
        const back = Object.fromEntries(Object.keys(row.patch).map((k) => [k, null]))
        await supabase.from('inv_items').update(back).eq('id', row.it.id).eq('last_price', row.p)
        priced.current.delete(row.it.id)
      } else if (row.st === 'confirm' && row.it) priced.current.delete(row.it.id)
      if (row.l.raw_name) await supabase.rpc('save_item_alias', { p_supplier: j.head?.supplier_id || null, p_alias: row.l.raw_name, p_item: itemId })
      const { data: it } = await supabase.from('inv_items').select('id,name_ar,last_price,avg_cost,alert_base_price,unit_grams,unit_measure,inv_units(name)').eq('id', itemId).single()
      const { data: si } = j.head?.supplier_id ? await supabase.from('supplier_items').select('pack_factor').eq('supplier_id', j.head.supplier_id).eq('item_id', itemId).maybeSingle() : { data: null }
      const sp = stockPrice(row.l, it, si?.pack_factor)
      let next
      if (sp.skip) next = { l: row.l, it, st: 'skip', how: sp.skip }
      else {
        const p = Math.round(sp.price * 1000) / 1000
        if (!p) next = { l: row.l, it, st: 'zero' }
        else if (Number(it.last_price) > 0) next = { l: row.l, it, p, how: sp.how, st: 'has' }
        else {
          const ug = Number(it.unit_grams)
          const patch = { last_price: p, ...(Number(it.avg_cost) > 0 ? {} : { avg_cost: p }), ...(Number(it.alert_base_price) > 0 ? {} : { alert_base_price: p }),
            ...(sp.grams && (!ug || ug < sp.grams * 0.6) ? { unit_grams: sp.grams, unit_measure: sp.measure, ...(sp.pieces ? { unit_pieces: sp.pieces } : {}) } : {}) }
          next = { l: row.l, it, p, how: sp.how, st: await setPrice(it.id, patch), patch }
        }
      }
      upd(key, (x) => ({ rows: x.rows.map((y, n) => (n === i ? { ...next, manual: true } : y)) }))
    } catch (e) { upd(key, { error: e.message || String(e) }) }
    setBusyRow('')
  }

  const undo = async (key, i) => {
    const j = jobs.find((x) => x.key === key), row = j.rows[i]
    const back = Object.fromEntries(Object.keys(row.patch).map((k) => [k, null]))
    const r = await supabase.from('inv_items').update(back).eq('id', row.it.id).eq('last_price', row.p)
    if (!r.error) { priced.current.delete(row.it.id); upd(key, (x) => ({ rows: x.rows.map((y, n) => (n === i ? { ...y, st: 'undone' } : y)) })) }
  }

  const all = jobs.flatMap((j) => j.rows || [])
  const n = (st) => all.filter((r) => r.st === st).length

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1>تسعير من فواتير قديمة</h1>
        <div className="sub">ارفع فواتير قديمة. السيستم ياخد منها <b>الأسعار بس</b>: الكميات ما تدخلش المخزون، والفاتورة ما تتحسبش عليك فلوس.</div></div>
        <Link className="btn" to="/inventory">رجوع للمخزون</Link></div>

      <div className="card" style={{ marginBottom: 14 }}>
        <ul className="sub" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.9 }}>
          <li>الصنف اللي <b>عنده سعر</b> في المخزون: ما يتغيرش.</li>
          <li>الصنف اللي <b>ما لوش سعر</b>: ياخد السعر من الفاتورة، مرة واحدة بس، حتى لو الصنف متكرر في كذا فاتورة.</li>
          <li>الفاتورة <b>المتدبلة</b> (نفس المورد ونفس الرقم، أو نفس التاريخ والمبلغ): تتقال لك ومش بتتقرا.</li>
          <li>لو اسم الصنف في الفاتورة <b>مش متأكد منه</b>، بيسألك «هو ده الصنف؟» قبل ما يحط السعر.</li>
          <li>لو الفاتورة بالكرتونة ومكتوب «10 × 1 كغ»، بيحوّل السعر لسعر وحدة المخزون (الكيلو أو الكيس).</li>
        </ul>
      </div>

      <label className="upload" style={{ height: 140, marginBottom: 16, opacity: lk ? 1 : 0.5 }}>
        <input type="file" accept="image/*,application/pdf" multiple disabled={!lk} onChange={(e) => { add([...e.target.files]); e.target.value = '' }} />
        <Icon name="camera" size={30} /><strong style={{ fontSize: 15, color: 'var(--ink)' }}>اختار صور الفواتير القديمة</strong><span>تقدر تختار كذا فاتورة مرة واحدة (كل صورة = فاتورة)</span>
      </label>

      {all.length > 0 && <div className="grid stats" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="label">اتسعّر</div><div className="value num" style={{ color: 'var(--ok)' }}>{n('set')}</div></div>
        <div className="card stat"><div className="label">عنده سعر (ما اتغيرش)</div><div className="value num">{n('has') + n('done')}</div></div>
        {n('confirm') > 0 && <div className="card stat" style={{ borderColor: '#F3DDA8' }}><div className="label">محتاج تأكيد منك</div><div className="value num" style={{ color: 'var(--amber)' }}>{n('confirm')}</div></div>}
        <div className="card stat"><div className="label">مش موجود في المخزون</div><div className="value num" style={{ color: n('none') ? 'var(--amber)' : undefined }}>{n('none')}</div></div>
        <div className="card stat"><div className="label">فواتير متدبلة</div><div className="value num">{jobs.filter((j) => j.dup).length}</div></div>
      </div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {jobs.map((j) => (
          <div key={j.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="grow"><div style={{ fontWeight: 600 }}>{j.head ? j.head.supplier : j.name}</div>
                <div className="sub">{j.head ? [j.head.no && `رقم ${j.head.no}`, j.head.date && fmtDate(j.head.date), j.head.total != null && `${kwd(j.head.total)} د.ك`].filter(Boolean).join(' · ') : j.name}</div></span>
              {j.state && <span className="sub"><span className="spinner" /> {j.state}</span>}
              {j.dup && <span className="pill amber">متدبلة: {j.dup}، ما اتقرتش</span>}
              {j.rows && !j.dup && <span className="pill ok">{j.rows.filter((r) => r.st === 'set').length} سعر جديد</span>}
            </div>
            {j.error && <div className="error">{j.error}</div>}
            {j.rows?.length > 0 && <div className="table-wrap"><table>
              <thead><tr><th>في الفاتورة</th><th>الصنف في المخزون</th><th>السعر</th><th></th></tr></thead>
              <tbody>{j.rows.map((r, i) => (
                <tr key={r.l.id}>
                  <td><div>{r.l.raw_name}</div><div className="cell-sub num">{kwd(r.l.unit_price)}{r.l.unit_text ? ` / ${r.l.unit_text}` : ''}</div></td>
                  <td>{r.it ? <><div>{r.it.name_ar}</div><div className="cell-sub">{r.it.inv_units?.name}{r.st === 'has' ? ` · سعره ${kwd(r.it.last_price)}` : ''}</div></> : <span className="sub">—</span>}</td>
                  <td>{r.p ? <><div className="num">{kwd(r.p)} / {r.it?.inv_units?.name || ''}</div>{r.how && <div className="cell-sub">{r.how}</div>}</> : r.how ? <div className="cell-sub">{r.how}</div> : '—'}</td>
                  <td><span className={'pill ' + ST[r.st][1]}>{ST[r.st][0]}</span>
                    {r.st === 'confirm' && <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <button className="chip on" style={{ minHeight: 28 }} onClick={() => confirm(j.key, i, true)}>أيوه، حط السعر</button>
                      <button className="chip" style={{ minHeight: 28 }} onClick={() => confirm(j.key, i, false)}>مش هو</button>
                      <button className="chip" style={{ minHeight: 28 }} onClick={() => setPicking({ key: j.key, i })}>اختار غيره</button></div>}
                    {r.st === 'set' && <button className="chip" style={{ minHeight: 28, marginInlineStart: 6 }} onClick={() => undo(j.key, i)}>تراجع</button>}
                    {r.st !== 'confirm' && <div style={{ marginTop: 6 }}>
                      <button className={'chip' + (r.it ? '' : ' on')} style={{ minHeight: 28 }} disabled={busyRow === `${j.key}:${i}`} onClick={() => setPicking({ key: j.key, i })}>
                        {busyRow === `${j.key}:${i}` ? <span className="spinner" /> : null} {r.it ? 'غيّر الصنف' : 'اختار الصنف'}</button>
                      {r.manual && <span className="cell-sub" style={{ marginInlineStart: 6 }}>ربطته أنت</span>}</div>}</td>
                </tr>))}</tbody></table></div>}
          </div>))}
      </div>
      {picking && (() => {
        const row = jobs.find((x) => x.key === picking.key)?.rows?.[picking.i]
        return <ItemSearchSheet items={items} line={{ name: row?.l.raw_name || '', unit: row?.l.unit_text || '' }} current={row?.it?.id}
          hint="السعر بيتحط على الصنف ده، والربط بيتحفظ مع المورد" onClose={() => setPicking(null)}
          onPick={(id) => { const p = picking; setPicking(null); relink(p.key, p.i, id) }} />
      })()}
    </div>
  )
}
