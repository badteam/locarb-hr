import { useEffect, useState, useCallback, useMemo } from 'react'
import writeXlsxFile from 'write-excel-file/browser'
import readXlsxFile from 'read-excel-file/browser'
import { supabase, errMsg } from '../../lib/supabase'
import Icon from '../../components/Icon.jsx'

const fold = (s) => String(s ?? '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim()
const num = (v) => {
  const t = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/[^\d.]/g, '')
  return t === '' ? null : Number(t)
}
const COLS = [['id', 'رقم الصنف (لا تغيّره)'], ['name', 'الصنف'], ['unit', 'الوحدة'], ['category', 'القسم'], ['qty', 'الكمية بالمخزون'], ['current', 'السعر الحالي'], ['suggest', 'آخر سعر مورد'], ['price', 'السعر الجديد']]

// Prices of stock items per unit: items without a price first, typed in place or filled in Excel.
export default function Prices() {
  const [items, setItems] = useState(null)
  const [sug, setSug] = useState({})
  const [f, setF] = useState('none')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState({})
  const [saving, setSaving] = useState({})
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    supabase.from('inv_stock').select('id,name_ar,name_en,unit,category,last_price,avg_cost,total_qty').eq('active', true).order('name_ar').then(({ data }) => setItems(data || []))
    supabase.from('item_price_suggestions').select('*').then(({ data }) => setSug(Object.fromEntries((data || []).map((x) => [x.item_id, x]))))
  }, [])
  useEffect(() => { load() }, [load])

  const priceOf = (i) => Number(i.last_price) || Number(i.avg_cost) || 0
  const cats = useMemo(() => [...new Set((items || []).map((i) => i.category).filter(Boolean))].sort(), [items])
  const missing = (items || []).filter((i) => !priceOf(i)).length
  const shown = (items || []).filter((i) => (f === 'all' || !priceOf(i)) && (!cat || i.category === cat)
    && (!q.trim() || fold(i.name_ar).includes(fold(q)) || fold(i.name_en).includes(fold(q))))

  const save = async (i, value) => {
    const v = num(value)
    if (v === null || v === priceOf(i)) return
    setSaving((s) => ({ ...s, [i.id]: 'saving' }))
    const { error } = await supabase.rpc('set_item_prices', { p_rows: [{ id: i.id, price: v }], p_source: 'manual' })
    if (error) { setSaving((s) => ({ ...s, [i.id]: 'error' })); setMsg({ ok: false, t: errMsg(error) }); return }
    setItems((l) => l.map((x) => (x.id === i.id ? { ...x, last_price: v, avg_cost: Number(x.avg_cost) || v } : x)))
    setSaving((s) => ({ ...s, [i.id]: 'ok' }))
  }

  const exportXlsx = async () => {
    setBusy('export')
    try {
      const rows = (items || []).filter((i) => (f === 'all' || !priceOf(i)) && (!cat || i.category === cat))
      const data = [COLS.map(([, h]) => ({ value: h, fontWeight: 'bold' })), ...rows.map((i) => [
        { value: i.id, type: String }, { value: i.name_ar, type: String }, { value: i.unit || '', type: String }, { value: i.category || '', type: String },
        { value: Number(i.total_qty) || 0, type: Number }, priceOf(i) ? { value: priceOf(i), type: Number } : null,
        sug[i.id] ? { value: Number(sug[i.id].unit_price), type: Number } : null, null])]
      const blob = await writeXlsxFile(data, { rightToLeft: true, columns: [{ width: 38 }, { width: 40 }, { width: 10 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }] }).toBlob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prices_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click()
    } catch (e) { setMsg({ ok: false, t: errMsg(e) }) }
    setBusy('')
  }

  const importXlsx = async (file) => {
    setMsg(null); setPreview(null)
    if (!file) return
    try {
      const sheets = await readXlsxFile(file)
      const data = sheets[0]?.data || []
      const head = (data[0] || []).map((h) => String(h ?? '').trim())
      const iId = head.indexOf(COLS[0][1]), iName = head.indexOf('الصنف'), iPrice = head.indexOf('السعر الجديد')
      if (iPrice < 0) throw new Error('ما لقيت عمود "السعر الجديد". نزّل الملف من هالصفحة وعبّيه.')
      const byId = Object.fromEntries((items || []).map((i) => [i.id, i]))
      const byName = Object.fromEntries((items || []).map((i) => [fold(i.name_ar), i]))
      const ok = [], bad = []
      for (const row of data.slice(1)) {
        const price = num(row[iPrice])
        if (price === null) continue
        const it = byId[String(row[iId] ?? '').trim()] || byName[fold(row[iName])]
        if (!it) bad.push(String(row[iName] ?? row[iId] ?? '—')); else if (price < 0 || Number.isNaN(price)) bad.push(it.name_ar); else ok.push({ id: it.id, name: it.name_ar, old: priceOf(it), price })
      }
      setPreview({ ok, bad })
    } catch (e) { setMsg({ ok: false, t: errMsg(e) }) }
  }
  const applyImport = async () => {
    setBusy('import')
    const { data, error } = await supabase.rpc('set_item_prices', { p_rows: preview.ok.map(({ id, price }) => ({ id, price })), p_source: 'excel' })
    setBusy('')
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    setPreview(null); setMsg({ ok: true, t: `انحفظ سعر ${data} صنف ✓` }); load()
  }

  if (!items) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  return (
    <div>
      <div className="page-head">
        <div><h1>أسعار الأصناف</h1><div className="sub">سعر الوحدة اللي ينحسب فيها المخزون (الحبة، الكيلو…). الأسعار تتحدث بروحها من فواتير الموردين المعتمدة.</div></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" disabled={!!busy} onClick={exportXlsx}>{busy === 'export' ? <span className="spinner" /> : <Icon name="download" />} تنزيل إكسل</button>
          <label className="btn" style={{ cursor: 'pointer' }}><Icon name="plus" /> رفع إكسل<input type="file" accept=".xlsx" hidden onChange={(e) => { importXlsx(e.target.files?.[0]); e.target.value = '' }} /></label>
        </div>
      </div>

      <div className="grid stats" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="label">أصناف بدون سعر</div><div className="value" style={{ color: missing ? 'var(--red)' : 'var(--ok)' }}>{missing}</div></div>
        <div className="card stat"><div className="label">أصناف لها سعر</div><div className="value">{items.length - missing}</div></div>
      </div>

      {preview && (
        <div className="card form" style={{ marginBottom: 14, gap: 8 }}>
          <strong>من ملف الإكسل: {preview.ok.length} سعر جاهز{preview.bad.length ? ` · ${preview.bad.length} ما انعرف` : ''}</strong>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}><table>
            <thead><tr><th>الصنف</th><th>السعر الحالي</th><th>الجديد</th></tr></thead>
            <tbody>{preview.ok.slice(0, 200).map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.old ? r.old.toFixed(3) : '—'}</td><td className="num" style={{ fontWeight: 600 }}>{r.price.toFixed(3)}</td></tr>)}</tbody>
          </table></div>
          {preview.bad.length > 0 && <div className="sub" style={{ color: 'var(--red)' }}>ما انعرفت: {preview.bad.slice(0, 10).join('، ')}{preview.bad.length > 10 ? '…' : ''}</div>}
          <div className="row"><button className="btn primary" disabled={!preview.ok.length || !!busy} onClick={applyImport}>{busy === 'import' ? <span className="spinner" /> : <Icon name="check" />} احفظ الأسعار</button>
            <button className="btn" onClick={() => setPreview(null)}>إلغاء</button></div>
        </div>)}
      {msg && <div className={msg.ok ? 'notice' : 'error'} style={{ marginBottom: 12 }}>{msg.t}</div>}

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="chips">{[['none', `بدون سعر (${missing})`], ['all', 'الكل']].map(([k, t]) => <button key={k} className={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>{t}</button>)}</div>
        <select className="input" style={{ maxWidth: 200, height: 42 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="القسم">
          <option value="">كل الأقسام</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input className="input" style={{ maxWidth: 260, height: 42 }} placeholder="بحث بالاسم…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card table-wrap">
        {shown.length === 0 ? <div className="empty">{f === 'none' ? 'كل الأصناف لها سعر ✓' : 'ما فيه أصناف'}</div> : (
          <table>
            <thead><tr><th>الصنف</th><th>الوحدة</th><th>بالمخزون</th><th>آخر سعر مورد</th><th>السعر (د.ك)</th></tr></thead>
            <tbody>{shown.map((i) => {
              const sg = sug[i.id]; const st = saving[i.id]
              return (
                <tr key={i.id}>
                  <td style={{ fontWeight: 500 }}>{i.name_ar}{i.category ? <div className="cell-sub">{i.category}</div> : null}</td>
                  <td>{i.unit || '—'}</td>
                  <td className="num">{Number(i.total_qty) || 0}</td>
                  <td>{sg ? <button className="chip" style={{ minHeight: 30 }} title={`${sg.supplier}`} onClick={() => { setEdit({ ...edit, [i.id]: String(sg.unit_price) }); save(i, sg.unit_price) }}>{Number(sg.unit_price).toFixed(3)}</button> : <span className="sub">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <input className="input num ltr" inputMode="decimal" style={{ width: 110, height: 38, borderColor: st === 'error' ? 'var(--red)' : undefined }} placeholder="0.000"
                      value={edit[i.id] ?? (priceOf(i) ? String(priceOf(i)) : '')} onChange={(e) => setEdit({ ...edit, [i.id]: e.target.value })}
                      onBlur={(e) => save(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} aria-label={`سعر ${i.name_ar}`} />
                    {' '}{st === 'saving' ? <span className="spinner" /> : st === 'ok' ? <span style={{ color: 'var(--ok)' }}>✓</span> : null}
                  </td>
                </tr>)
            })}</tbody>
          </table>)}
      </div>
    </div>
  )
}
