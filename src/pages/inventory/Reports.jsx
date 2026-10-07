import { useEffect, useMemo, useState } from 'react'
import writeXlsxFile from 'write-excel-file/browser'
import { supabase, fmtDate, todayKuwait } from '../../lib/supabase'
import { kwd, qtyFmt, invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const TABS = [['supply', 'المرسل للفروع'], ['waste', 'التالف'], ['variance', 'فروقات الجرد'], ['purchases', 'المشتريات']]
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}
const sumBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = r[key] || '—'
    const x = m.get(k) || { name: k, value: 0, lines: 0, missing: 0 }
    x.value += Number(r.value) || 0; x.lines++; if (r.missing_cost) x.missing++
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

function Bars({ rows, total, onPick, picked }) {
  return (
    <div className="card list" style={{ padding: '4px 14px' }}>
      {rows.map((r) => (
        <button key={r.name} className="list-item" onClick={() => onPick?.(picked === r.name ? '' : r.name)}
          style={{ width: '100%', background: picked === r.name ? 'var(--green-soft)' : 'none', border: 0, cursor: onPick ? 'pointer' : 'default', textAlign: 'right', borderRadius: 10 }}>
          <span style={{ width: 150, flexShrink: 0, fontWeight: 600 }}>{r.name}</span>
          <span className="bar"><div style={{ width: `${total ? Math.max(2, (Math.abs(r.value) / total) * 100) : 0}%` }} /></span>
          <span className="num" style={{ width: 96, textAlign: 'left', fontWeight: 600 }}>{kwd(r.value)}</span>
        </button>
      ))}
    </div>
  )
}

export default function Reports() {
  const today = todayKuwait()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState(monthRange(today.slice(0, 7))[0])
  const [to, setTo] = useState(today)
  const [tab, setTab] = useState('supply')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [pickCat, setPickCat] = useState('')

  const [a, b] = custom ? [from, to] : monthRange(month)
  useEffect(() => {
    setData(null); setErr('')
    supabase.rpc('inventory_report', { p_from: a, p_to: b }).then(({ data: d, error }) => { if (error) setErr(invErr(error)); else setData(d) })
  }, [a, b])
  useEffect(() => { setPick(''); setPickCat('') }, [tab, a, b])

  const rows = useMemo(() => (data ? data[tab] || [] : []), [data, tab])
  const groupKey = tab === 'purchases' ? 'supplier' : 'branch'
  const groups = useMemo(() => (tab === 'variance' ? [] : sumBy(rows, groupKey)), [rows, groupKey, tab])
  const total = groups.reduce((s, g) => s + g.value, 0)
  const scoped = rows.filter((r) => !pick || r[groupKey] === pick)
  const cats = useMemo(() => sumBy(scoped, 'category'), [scoped])
  const itemRows = scoped.filter((r) => !pickCat || r.category === pickCat).sort((x, y) => Number(y.value) - Number(x.value))
  const missing = rows.filter((r) => r.missing_cost).length

  const varShort = rows.filter((r) => Number(r.diff) < 0).reduce((s, r) => s + Number(r.value), 0)
  const varOver = rows.filter((r) => Number(r.diff) > 0).reduce((s, r) => s + Number(r.value), 0)

  const exportXlsx = async () => {
    const label = custom ? `${a}_${b}` : month
    let cols, list
    if (tab === 'variance') {
      cols = [['branch', 'الفرع'], ['date', 'التاريخ'], ['item', 'الصنف'], ['unit', 'الوحدة'], ['expected', 'المتوقع'], ['counted', 'انعدّ'], ['diff', 'الفرق'], ['value', 'القيمة د.ك'], ['counted_by', 'جرده']]
      list = rows.map((r) => ({ ...r, date: fmtDate(r.date) }))
    } else {
      cols = [[groupKey, tab === 'purchases' ? 'المورد' : 'الفرع'], ['category', 'التصنيف'], ['item', 'الصنف'], ['unit', 'الوحدة'], ['qty', 'الكمية'], ['value', 'القيمة د.ك']]
      list = [...rows].sort((x, y) => String(x[groupKey]).localeCompare(String(y[groupKey])) || String(x.category).localeCompare(String(y.category)))
    }
    const head = cols.map(([, h]) => ({ value: h, fontWeight: 'bold' }))
    const body = list.map((r) => cols.map(([k]) => {
      const v = r[k]
      const isNum = ['qty', 'value', 'expected', 'counted', 'diff'].includes(k)
      return v == null || v === '' ? null : { value: isNum ? Number(v) : String(v), type: isNum ? Number : String, ...(k === 'value' ? { format: '0.000' } : {}) }
    }))
    const totalRow = cols.map(([k], i) => (i === 0 ? { value: 'المجموع', fontWeight: 'bold' } : k === 'value' ? { value: list.reduce((s, r) => s + Number(r.value || 0), 0), type: Number, format: '0.000', fontWeight: 'bold' } : null))
    const blob = await writeXlsxFile([head, ...body, totalRow], { rightToLeft: true, columns: cols.map(([k]) => ({ width: k === 'item' ? 42 : 16 })) }).toBlob()
    const el = document.createElement('a')
    el.href = URL.createObjectURL(blob)
    el.download = `locarb_${tab}_${label}.xlsx`
    el.click()
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>تقارير المخزون</h1><div className="sub">من {fmtDate(a)} إلى {fmtDate(b)}</div></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!custom ? <input type="month" className="input" style={{ width: 'auto' }} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="الشهر" />
            : <><input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
              <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى" /></>}
          <button className="btn" onClick={() => setCustom(!custom)}>{custom ? 'شهر كامل' : 'فترة مخصصة'}</button>
          <button className="btn primary" disabled={!rows.length} onClick={exportXlsx}><Icon name="doc" /> تنزيل إكسل</button>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <div className="error">{err}</div>}
      {!data && !err && <div className="center sub" style={{ minHeight: 200 }}><span className="spinner" /></div>}

      {data && tab !== 'variance' && (
        rows.length === 0 ? <div className="card empty">ما فيه بيانات في هالفترة</div> : <>
          <div className="grid stats" style={{ marginBottom: 14 }}>
            <div className="card stat primary"><div className="label">{tab === 'supply' ? 'تكلفة المرسل لكل الفروع' : tab === 'waste' ? 'قيمة التالف' : 'قيمة المشتريات'}</div>
              <div className="value num">{kwd(total)}</div><div className="label">د.ك</div></div>
            <div className="card stat"><div className="label">{tab === 'purchases' ? 'الموردين' : 'الأماكن'}</div><div className="value num">{groups.length}</div></div>
            <div className="card stat"><div className="label">الأصناف</div><div className="value num">{new Set(rows.map((r) => r.item)).size}</div></div>
          </div>
          {missing > 0 && <div className="warn" style={{ marginBottom: 14 }}><Icon name="warn" /> {missing} صنف انرسل بدون سعر، فقيمته محسوبة صفر. حط سعره من صفحة المخزون أو أول فاتورة مورد بتحدثه.</div>}

          <h2 style={{ fontSize: 17, marginBottom: 8 }}>{tab === 'purchases' ? 'حسب المورد' : 'حسب الفرع'} <span className="sub">(اضغط عشان تشوف التفاصيل)</span></h2>
          <Bars rows={groups} total={Math.max(...groups.map((g) => Math.abs(g.value)), 0)} onPick={setPick} picked={pick} />

          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>حسب التصنيف{pick ? ` · ${pick}` : ''}</h2>
          <Bars rows={cats} total={Math.max(...cats.map((g) => Math.abs(g.value)), 0)} onPick={setPickCat} picked={pickCat} />

          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>الأصناف{pick ? ` · ${pick}` : ''}{pickCat ? ` · ${pickCat}` : ''}</h2>
          <div className="card table-wrap" style={{ padding: '4px 10px' }}>
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>الصنف</th>{!pick && <th>{tab === 'purchases' ? 'المورد' : 'الفرع'}</th>}<th>الكمية</th><th>القيمة</th></tr></thead>
              <tbody>{itemRows.slice(0, 300).map((r, i) => <tr key={i}>
                <td>{r.item}<div className="cell-sub">{r.category}</div></td>{!pick && <td className="sub">{r[groupKey]}</td>}
                <td><span className="num">{qtyFmt(r.qty)}</span> <span className="sub">{r.unit}</span></td>
                <td className="num" style={{ fontWeight: 600 }}>{r.missing_cost ? <span className="pill amber">بدون سعر</span> : kwd(r.value)}</td></tr>)}</tbody>
            </table>
          </div>
        </>)}

      {data && tab === 'variance' && (
        rows.length === 0 ? <div className="card empty">ما فيه فروقات جرد في هالفترة{(data.counts || []).length ? ' — كل الجرد كان مطابق ✓' : ' (ما انعمل جرد)'}</div> : <>
          <div className="grid stats" style={{ marginBottom: 14 }}>
            <div className="card stat"><div className="label">قيمة النقص</div><div className="value num" style={{ color: 'var(--red)' }}>{kwd(Math.abs(varShort))}</div><div className="sub">د.ك</div></div>
            <div className="card stat"><div className="label">قيمة الزيادة</div><div className="value num">{kwd(varOver)}</div><div className="sub">د.ك</div></div>
            <div className="card stat"><div className="label">مرات الجرد</div><div className="value num">{(data.counts || []).length}</div></div>
          </div>
          <div className="card table-wrap" style={{ padding: '4px 10px' }}>
            <table>
              <thead><tr><th>الفرع</th><th>الصنف</th><th>المتوقع</th><th>انعدّ</th><th>الفرق</th><th>القيمة</th><th>جرده</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>
                <td>{r.branch}<div className="cell-sub">{fmtDate(r.date)}</div></td><td>{r.item}</td>
                <td className="num">{qtyFmt(r.expected)}</td><td className="num">{qtyFmt(r.counted)}</td>
                <td className="num" style={{ fontWeight: 600, color: r.diff < 0 ? 'var(--red)' : 'var(--amber)' }}>{r.diff > 0 ? '+' : ''}{qtyFmt(r.diff)} <span className="sub">{r.unit}</span></td>
                <td className="num">{kwd(r.value)}</td><td className="sub">{r.counted_by}</td></tr>)}</tbody>
            </table>
          </div>
        </>)}
    </div>
  )
}
