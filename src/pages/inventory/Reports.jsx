import { useEffect, useMemo, useState } from 'react'
import writeXlsxFile from 'write-excel-file/browser'
import { supabase, todayKuwait } from '../../lib/supabase'
import { kwd, qtyFmt, invErr, loadLookups } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import { useLang } from '../../lib/i18n.jsx'

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
  const { tn } = useLang()
  return (
    <div className="card list" style={{ padding: '4px 14px' }}>
      {rows.map((r) => (
        <button key={r.name} className="list-item" onClick={() => onPick?.(picked === r.name ? '' : r.name)}
          style={{ width: '100%', background: picked === r.name ? 'var(--green-soft)' : 'none', border: 0, cursor: onPick ? 'pointer' : 'default', textAlign: 'start', borderRadius: 10 }}>
          <span style={{ width: 150, flexShrink: 0, fontWeight: 600 }}>{tn(r.name)}</span>
          <span className="bar"><div style={{ width: `${total ? Math.max(2, (Math.abs(r.value) / total) * 100) : 0}%` }} /></span>
          <span className="num" style={{ width: 96, textAlign: 'end', fontWeight: 600 }}>{kwd(r.value)}</span>
        </button>
      ))}
    </div>
  )
}

export default function Reports() {
  const { tr, fmtDate, tn } = useLang()
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
  const [branch, setBranch] = useState('')      // branch name, '' = all
  const [branches, setBranches] = useState([])
  const [busyXl, setBusyXl] = useState(false)
  useEffect(() => { loadLookups().then((l) => setBranches(l.branches)) }, [])

  const [a, b] = custom ? [from, to] : monthRange(month)
  useEffect(() => {
    setData(null); setErr('')
    supabase.rpc('inventory_report', { p_from: a, p_to: b }).then(({ data: d, error }) => { if (error) setErr(tr(invErr(error))); else setData(d) })
  }, [a, b])
  useEffect(() => { setPick(''); setPickCat('') }, [tab, a, b])

  const rows = useMemo(() => (data ? (data[tab] || []).filter((r) => !branch || tab === 'purchases' || r.branch === branch) : []), [data, tab, branch])
  const groupKey = tab === 'purchases' ? 'supplier' : 'branch'
  const groups = useMemo(() => (tab === 'variance' ? [] : sumBy(rows, groupKey)), [rows, groupKey, tab])
  const total = groups.reduce((s, g) => s + g.value, 0)
  const scoped = rows.filter((r) => !pick || r[groupKey] === pick)
  const cats = useMemo(() => sumBy(scoped, 'category'), [scoped])
  const itemRows = scoped.filter((r) => !pickCat || r.category === pickCat).sort((x, y) => Number(y.value) - Number(x.value))
  const missing = rows.filter((r) => r.missing_cost).length

  const varShort = rows.filter((r) => Number(r.diff) < 0).reduce((s, r) => s + Number(r.value), 0)
  const varOver = rows.filter((r) => Number(r.diff) > 0).reduce((s, r) => s + Number(r.value), 0)

  // branch supply: every order with its lines, plus a summary per item and the total
  const exportSupply = async () => {
    setBusyXl(true)
    try {
      const br = branches.find((x) => x.name === branch)
      let q = supabase.from('branch_requests')
        .select('id,created_at,dispatched_at,received_at,status,branch_id,branches:branch_id(name),branch_request_lines(requested_qty,sent_qty,received_qty,unit_cost,inv_items(name_ar,name_en,inv_categories(name),inv_units(name)))')
        .in('status', ['dispatched', 'received']).gte('dispatched_at', `${a}T00:00:00+03:00`).lte('dispatched_at', `${b}T23:59:59.999+03:00`)
        .order('dispatched_at')
      if (br) q = q.eq('branch_id', br.id)
      const { data: orders, error } = await q
      if (error) throw error
      const B = { fontWeight: 'bold' }
      const N = (v, f) => (v == null ? null : { value: Number(v), type: Number, ...(f ? { format: f } : {}) })
      const S = (v) => (v == null || v === '' ? null : { value: String(v), type: String })
      const lineRows = [], perOrder = [], perItem = new Map()
      let grand = 0
      orders.forEach((o, idx) => {
        const no = idx + 1
        let ov = 0
        for (const l of o.branch_request_lines || []) {
          if (!Number(l.sent_qty)) continue
          const val = Number(l.sent_qty) * Number(l.unit_cost || 0)
          ov += val
          const it = l.inv_items || {}
          lineRows.push([N(no), S(fmtDate(o.dispatched_at)), S(o.branches?.name), S(it.inv_categories?.name), S(it.name_ar), S(it.name_en), S(it.inv_units?.name),
            N(l.requested_qty), N(l.sent_qty), N(l.received_qty), N(l.unit_cost, '0.000'), N(val, '0.000')])
          const k = it.name_ar
          const x = perItem.get(k) || { cat: it.inv_categories?.name, unit: it.inv_units?.name, qty: 0, value: 0 }
          x.qty += Number(l.sent_qty); x.value += val; perItem.set(k, x)
        }
        grand += ov
        perOrder.push([N(no), S(fmtDate(o.dispatched_at)), S(o.branches?.name), N((o.branch_request_lines || []).filter((l) => Number(l.sent_qty)).length), N(ov, '0.000'), S(o.status === 'received' ? 'انستلم' : 'في الطريق')])
      })
      const totalRow = (n, at) => Array.from({ length: n }, (_, i) => (i === 0 ? { value: 'المجموع', ...B } : i === at ? { value: grand, type: Number, format: '0.000', ...B } : null))
      const h = (arr) => arr.map((x) => ({ value: x, ...B }))
      const sum = [h(['التصنيف', 'الصنف', 'الوحدة', 'الكمية المرسلة', 'متوسط سعر الوحدة', 'القيمة د.ك']),
        ...[...perItem.entries()].sort((x, y) => (x[1].cat || '').localeCompare(y[1].cat || '') || x[0].localeCompare(y[0]))
          .map(([name, x]) => [S(x.cat), S(name), S(x.unit), N(x.qty), N(x.qty ? x.value / x.qty : 0, '0.000'), N(x.value, '0.000')]),
        totalRow(6, 5)]
      const det = [h(['رقم الطلب', 'تاريخ الإرسال', 'الفرع', 'التصنيف', 'الصنف', 'English', 'الوحدة', 'المطلوب', 'المرسل', 'المستلم', 'سعر الوحدة', 'القيمة د.ك']), ...lineRows, totalRow(12, 11)]
      const ord = [h(['رقم الطلب', 'تاريخ الإرسال', 'الفرع', 'عدد الأصناف', 'قيمة الطلب د.ك', 'الحالة']), ...perOrder, totalRow(6, 4)]
      const blob = await writeXlsxFile([
        { data: sum, sheet: 'ملخص الأصناف', rightToLeft: true, stickyRowsCount: 1, columns: [{ width: 24 }, { width: 44 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 14 }] },
        { data: ord, sheet: 'الطلبات', rightToLeft: true, stickyRowsCount: 1, columns: [{ width: 10 }, { width: 18 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 12 }] },
        { data: det, sheet: 'تفصيل الطلبات', rightToLeft: true, stickyRowsCount: 1, columns: [{ width: 10 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 40 }, { width: 30 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 14 }] },
      ]).toBlob()
      const el = document.createElement('a')
      el.href = URL.createObjectURL(blob)
      el.download = `توريد_${branch || 'كل_الفروع'}_${custom ? `${a}_${b}` : month}.xlsx`
      el.click()
    } catch (e) { setErr(tr(invErr(e))) }
    setBusyXl(false)
  }

  const exportXlsx = async () => {
    if (tab === 'supply') return exportSupply()
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
        <div><h1>{tr('تقارير المخزون')}</h1><div className="sub">{branch && tab !== 'purchases' ? `${branch} · ` : ''}{tr('من {a} إلى {b}', { a: fmtDate(a), b: fmtDate(b) })}</div></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!custom ? <input type="month" className="input" style={{ width: 'auto' }} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={tr('الشهر')} />
            : <><input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr('من')} />
              <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label={tr('إلى')} /></>}
          <button className="btn" onClick={() => setCustom(!custom)}>{custom ? tr('شهر كامل') : tr('فترة مخصصة')}</button>
          <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => { setBranch(e.target.value); setPick(''); setPickCat('') }} aria-label={tr('الفرع')} disabled={tab === 'purchases'}>
            <option value="">{tr('كل الفروع')}</option>
            {branches.filter((x) => !x.is_central_kitchen || tab !== 'supply').map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
          </select>
          <button className="btn primary" disabled={!rows.length || busyXl} onClick={exportXlsx}>{busyXl ? <span className="spinner" /> : <Icon name="doc" />} {tr('تنزيل إكسل')}</button>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{tr(l)}</button>)}
      </div>
      {err && <div className="error">{err}</div>}
      {!data && !err && <div className="center sub" style={{ minHeight: 200 }}><span className="spinner" /></div>}

      {data && tab !== 'variance' && (
        rows.length === 0 ? <div className="card empty">{tr('ما فيه بيانات في هالفترة')}</div> : <>
          <div className="grid stats" style={{ marginBottom: 14 }}>
            <div className="card stat primary"><div className="label">{tab === 'supply' ? (branch ? tr('تكلفة المرسل لـ{branch}', { branch }) : tr('تكلفة المرسل لكل الفروع')) : tab === 'waste' ? tr('قيمة التالف') : tr('قيمة المشتريات')}</div>
              <div className="value num">{kwd(total)}</div><div className="label">{tr('د.ك')}</div></div>
            <div className="card stat"><div className="label">{tab === 'purchases' ? tr('الموردين') : tr('الأماكن')}</div><div className="value num">{groups.length}</div></div>
            <div className="card stat"><div className="label">{tr('الأصناف')}</div><div className="value num">{new Set(rows.map((r) => r.item)).size}</div></div>
          </div>
          {missing > 0 && <div className="warn" style={{ marginBottom: 14 }}><Icon name="warn" /> {tr('{missing} صنف انرسل بدون سعر، فقيمته محسوبة صفر. حط سعره من صفحة المخزون أو أول فاتورة مورد بتحدثه.', { missing })}</div>}

          <h2 style={{ fontSize: 17, marginBottom: 8 }}>{tab === 'purchases' ? tr('حسب المورد') : tr('حسب الفرع')} <span className="sub">({tr('اضغط عشان تشوف التفاصيل')})</span></h2>
          <Bars rows={groups} total={Math.max(...groups.map((g) => Math.abs(g.value)), 0)} onPick={setPick} picked={pick} />

          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>{tr('حسب التصنيف')}{pick ? ` · ${pick}` : ''}</h2>
          <Bars rows={cats} total={Math.max(...cats.map((g) => Math.abs(g.value)), 0)} onPick={setPickCat} picked={pickCat} />

          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>{tr('الأصناف')}{pick ? ` · ${pick}` : ''}{pickCat ? ` · ${pickCat}` : ''}</h2>
          <div className="card table-wrap" style={{ padding: '4px 10px' }}>
            <table style={{ minWidth: 0 }}>
              <thead><tr><th>{tr('الصنف')}</th>{!pick && <th>{tab === 'purchases' ? tr('المورد') : tr('الفرع')}</th>}<th>{tr('الكمية')}</th><th>{tr('القيمة')}</th></tr></thead>
              <tbody>{itemRows.slice(0, 300).map((r, i) => <tr key={i}>
                <td>{r.item}<div className="cell-sub">{tn(r.category)}</div></td>{!pick && <td className="sub">{r[groupKey]}</td>}
                <td><span className="num">{qtyFmt(r.qty)}</span> <span className="sub">{tn(r.unit)}</span></td>
                <td className="num" style={{ fontWeight: 600 }}>{r.missing_cost ? <span className="pill amber">{tr('بدون سعر')}</span> : kwd(r.value)}</td></tr>)}</tbody>
            </table>
          </div>
        </>)}

      {data && tab === 'variance' && (
        rows.length === 0 ? <div className="card empty">{tr('ما فيه فروقات جرد في هالفترة')}{(data.counts || []).length ? tr(' — كل الجرد كان مطابق ✓') : tr(' (ما انعمل جرد)')}</div> : <>
          <div className="grid stats" style={{ marginBottom: 14 }}>
            <div className="card stat"><div className="label">{tr('قيمة النقص')}</div><div className="value num" style={{ color: 'var(--red)' }}>{kwd(Math.abs(varShort))}</div><div className="sub">{tr('د.ك')}</div></div>
            <div className="card stat"><div className="label">{tr('قيمة الزيادة')}</div><div className="value num">{kwd(varOver)}</div><div className="sub">{tr('د.ك')}</div></div>
            <div className="card stat"><div className="label">{tr('مرات الجرد')}</div><div className="value num">{(data.counts || []).length}</div></div>
          </div>
          <div className="card table-wrap" style={{ padding: '4px 10px' }}>
            <table>
              <thead><tr><th>{tr('الفرع')}</th><th>{tr('الصنف')}</th><th>{tr('المتوقع')}</th><th>{tr('انعدّ')}</th><th>{tr('الفرق')}</th><th>{tr('القيمة')}</th><th>{tr('جرده')}</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>
                <td>{tn(r.branch)}<div className="cell-sub">{fmtDate(r.date)}</div></td><td>{r.item}</td>
                <td className="num">{qtyFmt(r.expected)}</td><td className="num">{qtyFmt(r.counted)}</td>
                <td className="num" style={{ fontWeight: 600, color: r.diff < 0 ? 'var(--red)' : 'var(--amber)' }}>{r.diff > 0 ? '+' : ''}{qtyFmt(r.diff)} <span className="sub">{tn(r.unit)}</span></td>
                <td className="num">{kwd(r.value)}</td><td className="sub">{r.counted_by}</td></tr>)}</tbody>
            </table>
          </div>
        </>)}
    </div>
  )
}
