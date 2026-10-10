import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import writeXlsxFile from 'write-excel-file/browser'
import readXlsxFile from 'read-excel-file/browser'
import { supabase } from '../../lib/supabase'
import { kwd, qtyFmt, loadLookups, invErr } from '../../lib/inv'
import ProductImage from '../../components/ProductImage.jsx'
import Icon from '../../components/Icon.jsx'

// Opening balance: quantity + unit cost per item for one place.
const draftKey = (b) => `opening-draft-${b}`
const readDraft = (b) => { try { return JSON.parse(localStorage.getItem(draftKey(b)) || '{}') } catch { return {} } }
const writeDraft = (b, v) => { try { localStorage.setItem(draftKey(b), JSON.stringify(v)) } catch { /* private mode */ } }
const clean = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '')

export default function OpeningBalance() {
  const [lookups, setLookups] = useState(null)
  const [branch, setBranch] = useState('')
  const [items, setItems] = useState([])
  const [levels, setLevels] = useState({})
  const [vals, setVals] = useState({})          // item_id -> { qty, price }
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)
  const [limit, setLimit] = useState(120)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    loadLookups(true).then((l) => { setLookups(l); setBranch(l.kitchen?.id || l.stockBranches[0]?.id || '') })
    supabase.from('inv_stock').select('id,name_ar,name_en,unit,category_id,category,avg_cost,last_price').eq('active', true).order('name_ar').then(({ data }) => setItems(data || []))
  }, [])
  useEffect(() => {
    if (!branch) return
    setVals(readDraft(branch))
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data }) => setLevels(Object.fromEntries((data || []).map((x) => [x.item_id, Number(x.qty)]))))
  }, [branch])

  const setV = (id, k, v) => setVals((s) => {
    const n = { ...s, [id]: { ...(s[id] || {}), [k]: clean(v) } }
    if (!n[id].qty && !n[id].price) delete n[id]
    writeDraft(branch, n)
    return n
  })

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) => (!cat || i.category_id === cat) && (!onlyFilled || vals[i.id]) &&
      (!s || i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s)))
  }, [items, q, cat, onlyFilled, vals])

  const filled = Object.entries(vals).filter(([, v]) => v.qty !== undefined && v.qty !== '' || v.price !== undefined && v.price !== '')
  const total = filled.reduce((a, [id, v]) => {
    const it = items.find((i) => i.id === id)
    const price = v.price !== undefined && v.price !== '' ? Number(v.price) : Number(it?.avg_cost || 0)
    return a + (Number(v.qty) || 0) * price
  }, 0)
  const noPrice = filled.filter(([id, v]) => Number(v.qty) > 0 && (v.price === undefined || v.price === '') && !Number(items.find((i) => i.id === id)?.avg_cost)).length

  const exportTemplate = async () => {
    setBusy('xl')
    const head = ['رقم الصنف (لا تغيّره)', 'التصنيف', 'الصنف', 'English', 'الوحدة', 'الكمية', 'سعر الوحدة د.ك'].map((h) => ({ value: h, fontWeight: 'bold' }))
    const rows = items.slice().sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name_ar.localeCompare(b.name_ar)).map((i) => {
      const v = vals[i.id] || {}
      const qty = v.qty !== undefined && v.qty !== '' ? Number(v.qty) : levels[i.id] ?? null
      const price = v.price !== undefined && v.price !== '' ? Number(v.price) : (i.avg_cost != null ? Number(i.avg_cost) : null)
      return [{ value: i.id, type: String }, { value: i.category || '', type: String }, { value: i.name_ar, type: String }, { value: i.name_en || '', type: String },
        { value: i.unit || '', type: String }, qty == null ? null : { value: qty, type: Number }, price == null ? null : { value: price, type: Number, format: '0.000' }]
    })
    const blob = await writeXlsxFile([head, ...rows], { rightToLeft: true, columns: [{ width: 38 }, { width: 22 }, { width: 40 }, { width: 34 }, { width: 10 }, { width: 12 }, { width: 14 }] }).toBlob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `رصيد_أول_المدة_${lookups.branches.find((b) => b.id === branch)?.name || ''}.xlsx`
    a.click()
    setBusy('')
  }

  const importFile = async (file) => {
    if (!file) return
    setErr(''); setMsg(''); setBusy('import')
    try {
      const sheets = await readXlsxFile(file)
      const data = sheets[0]?.data || []
      const byId = new Set(items.map((i) => i.id))
      const byName = Object.fromEntries(items.map((i) => [i.name_ar.trim(), i.id]))
      const next = { ...vals }
      let n = 0, skipped = 0
      for (const row of data.slice(1)) {
        const id = byId.has(String(row[0] || '').trim()) ? String(row[0]).trim() : byName[String(row[2] || '').trim()]
        if (!id) { if (row.some((c) => c !== null && c !== '')) skipped++; continue }
        const qty = row[5] == null || row[5] === '' ? '' : clean(row[5])
        const price = row[6] == null || row[6] === '' ? '' : clean(row[6])
        if (qty === '' && price === '') continue
        next[id] = { qty, price }; n++
      }
      setVals(next); writeDraft(branch, next)
      setOnlyFilled(true)
      setMsg(`انقرى ${n} صنف من الملف${skipped ? `، و${skipped} سطر ما عرفناه` : ''}. راجعهم واضغط "حفظ رصيد أول المدة".`)
    } catch (e) { setErr('ما قدرنا نقرا الملف: ' + (e.message || e)) }
    setBusy('')
  }

  const save = async () => {
    setBusy('save'); setErr('')
    const lines = filled.map(([item_id, v]) => ({ item_id, qty: v.qty === '' ? null : v.qty, price: v.price === '' ? null : v.price }))
    const { data, error } = await supabase.rpc('set_opening_balance', { p_branch: branch, p_lines: lines })
    setBusy(''); setConfirm(false)
    if (error) { setErr(invErr(error)); return }
    writeDraft(branch, {}); setVals({}); setOnlyFilled(false)
    setMsg(`انحفظ رصيد أول المدة: ${data.lines} صنف بقيمة ${kwd(data.value)} د.ك.`)
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data: d }) => setLevels(Object.fromEntries((d || []).map((x) => [x.item_id, Number(x.qty)]))))
    supabase.from('inv_stock').select('id,name_ar,name_en,unit,category_id,category,avg_cost,last_price').eq('active', true).order('name_ar').then(({ data: d }) => setItems(d || []))
  }

  if (!lookups) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  const branchName = lookups.branches.find((b) => b.id === branch)?.name
  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="page-head">
        <div><Link to="/inventory" className="sub" style={{ textDecoration: 'none' }}>→ المخزون</Link><h1 style={{ marginTop: 4 }}>رصيد أول المدة</h1>
          <div className="sub">اكتب الكمية الموجودة وسعر الوحدة لكل صنف. الكمية تصير هي الرصيد، والسعر يصير متوسط التكلفة.</div></div>
        <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="المكان">
          {lookups.stockBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="card row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <span className="grow sub">أسهل طريقة: نزّل ملف الإكسل، اكتب الكمية والسعر قدام كل صنف، وارفعه.</span>
        <button className="btn" disabled={!!busy} onClick={exportTemplate}>{busy === 'xl' ? <span className="spinner" /> : <Icon name="doc" />} تنزيل ملف إكسل</button>
        <label className="btn" style={{ cursor: 'pointer' }}>{busy === 'import' ? <span className="spinner" /> : <Icon name="plus" />} رفع الملف
          <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { importFile(e.target.files[0]); e.target.value = '' }} /></label>
      </div>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="toolbar">
        <div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر على صنف" value={q} onChange={(e) => { setQ(e.target.value); setLimit(120) }} /></div>
        <select className="input" style={{ width: 'auto', flex: '0 1 220px' }} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(120) }} aria-label="التصنيف">
          <option value="">كل التصنيفات</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> اللي كتبت لها بس</label>
      </div>

      <div className="order-list">
        {shown.slice(0, limit).map((i) => {
          const v = vals[i.id] || {}
          const price = v.price !== undefined && v.price !== '' ? Number(v.price) : Number(i.avg_cost || 0)
          return (
            <div key={i.id} className="order-row">
              <div className="row" style={{ gap: 10 }}>
                <ProductImage itemId={i.id} size={44} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{i.name_ar}</div>
                  <div className="cell-sub">{i.category}{i.unit ? ` · ${i.unit}` : ''}{levels[i.id] != null ? ` · الرصيد الحالي ${qtyFmt(levels[i.id])}` : ''}{i.avg_cost ? ` · التكلفة الحالية ${kwd(i.avg_cost)}` : ''}</div></div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div className="field"><span className="lbl" style={{ fontSize: 12 }}>الكمية {i.unit ? `(${i.unit})` : ''}</span>
                  <input className="input num" style={{ height: 44 }} inputMode="decimal" placeholder="—" value={v.qty ?? ''} onChange={(e) => setV(i.id, 'qty', e.target.value)} aria-label={`كمية ${i.name_ar}`} /></div>
                <div className="field"><span className="lbl" style={{ fontSize: 12 }}>سعر الوحدة د.ك</span>
                  <input className="input num" style={{ height: 44 }} inputMode="decimal" placeholder={i.avg_cost ? kwd(i.avg_cost) : '—'} value={v.price ?? ''} onChange={(e) => setV(i.id, 'price', e.target.value)} aria-label={`سعر ${i.name_ar}`} /></div>
                <div className="field"><span className="lbl" style={{ fontSize: 12 }}>القيمة</span>
                  <div className="input num" style={{ height: 44, display: 'flex', alignItems: 'center', background: '#F7F9F5' }}>{v.qty ? kwd(Number(v.qty) * price) : '—'}</div></div>
              </div>
            </div>
          )
        })}
        {shown.length === 0 && <div className="card empty">ما فيه أصناف هنا</div>}
        {shown.length > limit && <button className="btn" onClick={() => setLimit(limit + 120)}>عرض المزيد ({shown.length - limit})</button>}
      </div>

      <div className="order-bar">
        <div className="grow"><strong>{filled.length}</strong> صنف · <span className="num">{kwd(total)}</span> د.ك</div>
        <button className="btn primary" disabled={!filled.length || !branch} onClick={() => setConfirm(true)}>حفظ رصيد أول المدة</button>
      </div>

      {confirm && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>تأكيد رصيد أول المدة</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setConfirm(false)}><Icon name="x" /></button></div>
            <div>{filled.length} صنف في <strong>{branchName}</strong> بقيمة <strong className="num">{kwd(total)}</strong> د.ك.</div>
            <div className="sub">الكمية اللي كتبتها بتصير هي رصيد الصنف في {branchName}، والسعر بيصير متوسط التكلفة وآخر سعر للصنف.</div>
            {noPrice > 0 && <div className="warn"><Icon name="warn" /> {noPrice} صنف له كمية بدون سعر. بينحفظ، بس قيمته في التقارير بتطلع صفر.</div>}
            <button className="btn primary block" disabled={!!busy} onClick={save}>{busy === 'save' ? <span className="spinner" /> : null} حفظ</button>
          </div>
        </div>
      )}
    </div>
  )
}
