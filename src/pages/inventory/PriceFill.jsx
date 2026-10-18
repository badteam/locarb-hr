import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { kwd, loadLookups } from '../../lib/inv'
import { startRead, compress } from './Invoices.jsx'
import { parsePack, MEASURE_UNITS, fmtContent } from '../../components/UnitContent.jsx'
import Icon from '../../components/Icon.jsx'

// Old invoices uploaded only to learn prices: no quantities go into stock, nothing becomes payable.
// A price is written only on items that have no price yet, once per item.
const CARTON_RE = /ctn|carton|box|كرتون|صندوق/i
const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01

// invoice price -> price of ONE stock unit of the item
function stockPrice(line, item, packFactor) {
  const price = Number(line.unit_price) || 0
  if (!price) return { price: 0 }
  const unit = item.inv_units?.name
  const mu = MEASURE_UNITS[unit || '']
  const pk = parsePack(line.raw_name)
  if (Number(packFactor) > 1) return { price: price / Number(packFactor), how: `الكرتونة = ${Number(packFactor)} ${unit || ''}` }
  if (mu && pk) { const k = pk.total / mu[0]; return { price: price / k, how: `${pk.n} × ${fmtContent(pk.each, pk.measure)} = ${+k.toFixed(3)} ${unit}` } }
  if (pk && !/كرتون/.test(unit || '') && (CARTON_RE.test(line.unit_text || '') || CARTON_RE.test(line.raw_name || '')))
    return { price: price / pk.n, how: `الكرتونة فيها ${pk.n} ${unit || ''}`, grams: pk.each, measure: pk.measure }
  if (pk && /كرتون/.test(unit || '')) return { price, grams: pk.total, pieces: pk.n, measure: pk.measure }
  return { price }
}

const ST = {
  set: ['اتسعّر', 'ok'], has: ['عنده سعر من قبل', 'gray'], done: ['اتسعّر من فاتورة قبلها', 'gray'],
  zero: ['السعر صفر في الفاتورة', 'gray'], none: ['مش موجود في المخزون', 'amber'], undone: ['اتلغى', 'gray'],
}

export default function PriceFill() {
  const [lk, setLk] = useState(null)
  const [jobs, setJobs] = useState([])
  const priced = useRef(new Set())
  const queue = useRef(Promise.resolve())
  useEffect(() => { loadLookups().then(setLk) }, [])

  const upd = (key, patch) => setJobs((l) => l.map((j) => (j.key === key ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)))

  const add = (files) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      setJobs((l) => [...l, { key, name: file.name, state: 'قاعد يرفع…' }])
      read(key, file).then((id) => { if (id) queue.current = queue.current.then(() => apply(key, id)) })
    }
  }

  const read = async (key, file) => {
    try {
      const { data: inv, error } = await supabase.from('purchase_invoices').insert({ branch_id: lk.kitchen.id, status: 'draft', price_only: true, notes: 'تسعير فقط من فاتورة قديمة' }).select('id').single()
      if (error) throw error
      const f = await compress(file)
      const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg'
      const path = `${inv.id}/1-${Date.now()}.${ext}`
      const up = await supabase.storage.from('invoices').upload(path, f, { contentType: f.type || 'image/jpeg' })
      if (up.error) throw up.error
      await supabase.from('purchase_invoices').update({ image_paths: [path] }).eq('id', inv.id)
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
        .select('id,invoice_no,invoice_date,supplier_id,total_read,supplier_name_read,suppliers(name),purchase_invoice_lines(id,line_no,raw_name,qty,unit_text,unit_price,item_id,inv_items(id,name_ar,last_price,avg_cost,alert_base_price,unit_grams,inv_units(name)))')
        .eq('id', id).single()
      const head = { supplier: inv.suppliers?.name || inv.supplier_name_read || 'مورد غير معروف', no: inv.invoice_no, date: inv.invoice_date, total: inv.total_read }

      // same invoice uploaded before (here or as a real received invoice)?
      let dup = null
      if (inv.supplier_id && (inv.invoice_no || inv.invoice_date)) {
        const { data: others } = await supabase.from('purchase_invoices').select('id,invoice_no,invoice_date,total_read,price_only,status')
          .eq('supplier_id', inv.supplier_id).neq('id', id).neq('status', 'failed')
        dup = (others || []).find((o) => (inv.invoice_no && o.invoice_no && String(o.invoice_no).trim() === String(inv.invoice_no).trim())
          || (inv.invoice_date && o.invoice_date === inv.invoice_date && near(o.total_read, inv.total_read)))
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
        const p = Math.round(sp.price * 1000) / 1000
        if (!p) { rows.push({ l, it, st: 'zero' }); continue }
        if (priced.current.has(it.id)) { rows.push({ l, it, p, how: sp.how, st: 'done' }); continue }
        if (Number(it.last_price) > 0) { rows.push({ l, it, p, how: sp.how, st: 'has' }); continue }
        const patch = { last_price: p, ...(Number(it.avg_cost) > 0 ? {} : { avg_cost: p }), ...(Number(it.alert_base_price) > 0 ? {} : { alert_base_price: p }),
          ...(sp.grams && !Number(it.unit_grams) ? { unit_grams: sp.grams, unit_measure: sp.measure, ...(sp.pieces ? { unit_pieces: sp.pieces } : {}) } : {}) }
        const r = await supabase.from('inv_items').update(patch).eq('id', it.id).or('last_price.is.null,last_price.eq.0').select('id')
        if (r.error) { rows.push({ l, it, p, st: 'none', err: r.error.message }); continue }
        priced.current.add(it.id)
        rows.push({ l, it, p, how: sp.how, st: r.data?.length ? 'set' : 'has', patch })
      }
      await supabase.from('purchase_invoices').update({ status: 'rejected', notes: 'تسعير فقط من فاتورة قديمة (الكميات ما دخلت المخزون)' }).eq('id', id)
      upd(key, { state: null, head, rows })
    } catch (e) { upd(key, { state: null, error: e.message || String(e) }) }
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
                  <td>{r.p ? <><div className="num">{kwd(r.p)}</div>{r.how && <div className="cell-sub">{r.how}</div>}</> : '—'}</td>
                  <td><span className={'pill ' + ST[r.st][1]}>{ST[r.st][0]}</span>
                    {r.st === 'set' && <button className="chip" style={{ minHeight: 28, marginInlineStart: 6 }} onClick={() => undo(j.key, i)}>تراجع</button>}</td>
                </tr>))}</tbody></table></div>}
          </div>))}
      </div>
    </div>
  )
}
