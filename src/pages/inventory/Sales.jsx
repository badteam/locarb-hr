import { useEffect, useState, useCallback } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { supabase, fmtDate, todayKuwait } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0)
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const toDate = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}
// find the columns in a Foodics "sales by branch" export (English or Arabic headers)
const COLS = {
  branch: ['branch', 'الفرع', 'branch name', 'اسم الفرع'],
  date: ['day', 'date', 'business date', 'day date', 'التاريخ', 'اليوم', 'تاريخ العمل'],
  net: ['net sales', 'صافي المبيعات', 'net sales with tax', 'net'],
  gross: ['gross sales', 'إجمالي المبيعات', 'اجمالي المبيعات'],
  orders: ['orders', 'order count', 'orders count', 'number of orders', 'عدد الطلبات', 'الطلبات'],
}
function parseSheet(data) {
  for (let h = 0; h < Math.min(15, data.length); h++) {
    const head = data[h].map(norm)
    const find = (names) => head.findIndex((c) => names.includes(c))
    const ix = Object.fromEntries(Object.entries(COLS).map(([k, v]) => [k, find(v)]))
    if (ix.branch >= 0 && ix.net >= 0) {
      const rows = []
      for (const r of data.slice(h + 1)) {
        const branch = String(r[ix.branch] ?? '').trim()
        if (!branch || /total|المجموع|الإجمالي/i.test(branch)) continue
        rows.push({ branch, date: ix.date >= 0 ? toDate(r[ix.date]) : null, net_sales: num(r[ix.net]),
          gross_sales: ix.gross >= 0 ? num(r[ix.gross]) : null, order_count: ix.orders >= 0 ? Math.round(num(r[ix.orders])) : null })
      }
      return { rows, hasDate: ix.date >= 0 }
    }
  }
  return null
}

function Upload({ onDone }) {
  const [parsed, setParsed] = useState(null)
  const [day, setDay] = useState(todayKuwait())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const pick = async (file) => {
    setErr(''); setRes(null); setParsed(null)
    if (!file) return
    try {
      const sheets = await readXlsxFile(file)
      for (const s of sheets) { const p = parseSheet(s.data || []); if (p?.rows.length) { setParsed(p); return } }
      setErr('ما لقينا أعمدة "الفرع" و"صافي المبيعات" في الملف. صدّر من فودكس تقرير "المبيعات حسب الفرع" مقسّم باليوم.')
    } catch (e) { setErr('ما قدرنا نفتح الملف: ' + e.message) }
  }
  const save = async () => {
    setBusy(true); setErr('')
    const rows = parsed.rows.map((r) => ({ ...r, date: r.date || day }))
    const { data, error } = await supabase.rpc('import_sales_daily', { p_rows: rows, p_source: 'excel' })
    setBusy(false)
    if (error) { setErr(invErr(error)); return }
    setRes(data); setParsed(null); onDone()
  }
  return (
    <div className="form" style={{ gap: 10 }}>
      <label className="upload" style={{ height: 80 }}>
        <input type="file" accept=".xlsx" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <Icon name="doc" /> <span><strong style={{ color: 'var(--ink)' }}>ارفع ملف إكسل من فودكس</strong><br />تقرير المبيعات حسب الفرع، مقسّم باليوم</span>
      </label>
      {parsed && (
        <div className="card form" style={{ gap: 8 }}>
          <div>لقينا <strong>{parsed.rows.length}</strong> سطر · مجموع صافي المبيعات <strong className="num">{kwd(parsed.rows.reduce((a, r) => a + r.net_sales, 0))}</strong> د.ك</div>
          {!parsed.hasDate && (
            <div className="field"><label htmlFor="sd">الملف ما فيه تاريخ لكل سطر. المبيعات هذي لأي يوم؟</label>
              <input id="sd" type="date" className="input" value={day} max={todayKuwait()} onChange={(e) => setDay(e.target.value)} /></div>)}
          <button className="btn primary block" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : <Icon name="check" />} حفظ المبيعات</button>
        </div>)}
      {res && <div className={res.unknown_branches?.length ? 'warn' : 'notice'}>
        انحفظ {res.rows} يوم{res.from ? ` من ${fmtDate(res.from)} إلى ${fmtDate(res.to)}` : ''}.
        {res.unknown_branches?.length ? ` ما عرفنا هالفروع: ${res.unknown_branches.join('، ')}` : ''}</div>}
      {err && <div className="error">{err}</div>}
    </div>
  )
}

export default function Sales() {
  const { can, access } = useAccess()
  const today = todayKuwait()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState(monthRange(today.slice(0, 7))[0])
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState(null)
  const [last, setLast] = useState(null)
  const [err, setErr] = useState('')
  const [showUpdate, setShowUpdate] = useState(false)
  const [copied, setCopied] = useState(false)
  const canImport = access.is_owner || can('manage_inventory')
  const [a, b] = custom ? [from, to] : monthRange(month)

  const load = useCallback(() => {
    setRows(null); setErr('')
    supabase.rpc('food_cost_report', { p_from: a, p_to: b }).then(({ data, error }) => { if (error) setErr(invErr(error)); else setRows(data || []) })
    supabase.from('sales_daily').select('sale_date,source,imported_at').order('sale_date', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setLast(data))
  }, [a, b])
  useEffect(() => { load() }, [load])

  const shown = (rows || []).filter((r) => Number(r.net_sales) > 0 || Number(r.supplies) > 0 || Number(r.purchases) > 0)
  const tot = shown.reduce((x, r) => ({ s: x.s + Number(r.net_sales), o: x.o + Number(r.orders), m: x.m + Number(r.supplies) + Number(r.purchases), w: x.w + Number(r.waste), g: x.g + Number(r.count_gap) }), { s: 0, o: 0, m: 0, w: 0, g: 0 })
  const ask = 'حدّث مبيعات فودكس في نظام LoCarb لحد أمس'
  const stale = last && last.sale_date < new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)

  return (
    <div>
      <div className="page-head"><div><h1>المبيعات وتكلفة المواد</h1>
        <div className="sub">المبيعات من فودكس، والمواد = اللي انرسل للفرع من المطبخ + مشترياته المباشرة</div></div>
        {canImport && <button className="btn primary" onClick={() => setShowUpdate(!showUpdate)}><Icon name="refresh" /> تحديث المبيعات</button>}</div>

      {last && <div className={stale ? 'warn' : 'sub'} style={{ marginBottom: 12 }}>{stale && <Icon name="warn" />} آخر يوم مبيعات مسجل: <strong>{fmtDate(last.sale_date)}</strong> ({last.source === 'foodics' ? 'من فودكس عن طريق كلود' : last.source === 'excel' ? 'من ملف إكسل' : 'يدوي'})</div>}

      {showUpdate && canImport && (
        <div className="card form" style={{ gap: 12, marginBottom: 14 }}>
          <strong>طريقتين للتحديث، اختار وحدة:</strong>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div className="card form" style={{ gap: 8 }}>
              <strong>١. اسأل كلود</strong>
              <div className="sub">كلود مربوط بفودكس. افتح المحادثة معه واكتب:</div>
              <div className="input" style={{ background: '#F7F9F5', userSelect: 'all' }}>{ask}</div>
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(ask); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
                <Icon name="check" /> {copied ? 'انتسخت' : 'انسخ الجملة'}</button>
              <div className="sub">يسحب المبيعات يوم بيوم لكل فرع ويحفظها هنا.</div>
            </div>
            <div className="card form" style={{ gap: 8 }}>
              <strong>٢. ارفع ملف إكسل</strong>
              <Upload onDone={load} />
            </div>
          </div>
        </div>)}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        {!custom ? <input type="month" className="input" style={{ width: 'auto' }} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="الشهر" />
          : <><input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
            <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى" /></>}
        <button className="chip" onClick={() => setCustom(!custom)}>{custom ? 'شهر كامل' : 'فترة مخصصة'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {!rows ? <div className="center" style={{ minHeight: 160 }}><span className="spinner" /></div> : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="table">
            <thead><tr><th>الفرع</th><th>صافي المبيعات</th><th>الطلبات</th><th>تكلفة المواد</th><th>نسبة المواد</th><th>الهدر</th><th>نقص الجرد</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="empty">ما فيه بيانات للفترة هذي</td></tr>}
              {shown.map((r) => (
                <tr key={r.branch_id}>
                  <td style={{ fontWeight: 600 }}>{r.branch}{Number(r.sales_days) > 0 && <div className="sub">{r.sales_days} يوم مبيعات</div>}</td>
                  <td className="num">{kwd(r.net_sales)}</td>
                  <td className="num">{Number(r.orders) || '—'}</td>
                  <td className="num">{kwd(Number(r.supplies) + Number(r.purchases))}</td>
                  <td className="num">{r.food_cost_pct != null ? <span className={'pill ' + (r.food_cost_pct > 40 ? 'red' : r.food_cost_pct > 32 ? 'amber' : 'ok')}>{r.food_cost_pct}٪</span> : '—'}</td>
                  <td className="num">{Number(r.waste) ? kwd(r.waste) : '—'}</td>
                  <td className="num" style={{ color: Number(r.count_gap) > 0 ? 'var(--red)' : undefined }}>{Number(r.count_gap) ? kwd(r.count_gap) : '—'}</td>
                </tr>))}
              {shown.length > 1 && <tr style={{ fontWeight: 700 }}><td>المجموع</td><td className="num">{kwd(tot.s)}</td><td className="num">{tot.o}</td><td className="num">{kwd(tot.m)}</td>
                <td className="num">{tot.s > 0 ? `${(100 * tot.m / tot.s).toFixed(1)}٪` : '—'}</td><td className="num">{kwd(tot.w)}</td><td className="num">{kwd(tot.g)}</td></tr>}
            </tbody>
          </table>
        </div>)}
      <div className="sub" style={{ marginTop: 10 }}>نسبة المواد تصير دقيقة لما الفروع تطلب كل موادها من النظام. نقص الجرد = اللي طلع أقل من الدفتر لما انجرد.</div>
    </div>
  )
}
