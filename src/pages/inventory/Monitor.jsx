import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase, selectAll } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { invErr, kwd, itemNames } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import { useLang } from '../../lib/i18n.jsx'

const KINDS = {
  consumption: 'الاستهلاك', protein: 'البروتين', cashier: 'الكاشير', sales: 'المبيعات', count: 'الجرد', waste: 'الهدر',
  odd_hours: 'أوقات غريبة', manual: 'تعديل يدوي', invoice: 'الفواتير', price: 'الأسعار', payment: 'الدفعات',
}
const SEV = { high: ['red', 'مهم جداً'], warn: ['amber', 'انتبه'], info: ['gray', 'للعلم'] }
const FEEDBACK = { correct: ['ok', 'صحيح'], false: ['gray', 'إنذار كاذب'], explained: ['blue', 'له سبب معروف'] }
const TABS = [['alerts', 'التنبيهات'], ['report', 'التقرير الأسبوعي'], ['protein', 'البروتين'], ['cashiers', 'الكاشيرية'], ['setup', 'إعدادات البروتين']]
const n1 = (v) => (v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: 1 }))
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10) }

function useWeeks() {
  const [weeks, setWeeks] = useState([])
  useEffect(() => {
    supabase.from('cashier_sales').select('period_from,period_to').order('period_from', { ascending: false }).limit(200).then(({ data }) => {
      const seen = new Map()
      for (const r of data || []) if (!seen.has(r.period_from)) seen.set(r.period_from, r.period_to)
      setWeeks([...seen].map(([f, t]) => ({ from: f, to: t })))
    })
  }, [])
  return weeks
}
function WeekPicker({ weeks, value, onChange }) {
  const { tr, fmtDate } = useLang()
  if (!weeks.length) return <div className="sub">{tr('ما فيه بيانات أسبوعية للحين. تنسحب من فودكس كل أحد الصبح.')}</div>
  return (
    <select className="input" style={{ width: 'auto' }} value={value?.from || ''} onChange={(e) => onChange(weeks.find((w) => w.from === e.target.value))} aria-label={tr('الأسبوع')}>
      {weeks.map((w) => <option key={w.from} value={w.from}>{fmtDate(w.from)} — {fmtDate(w.to)}</option>)}
    </select>
  )
}

function FeedbackBox({ alert, onDone }) {
  const { tr } = useLang()
  const { access } = useAccess()
  const [note, setNote] = useState(alert.feedback_note || '')
  const [open, setOpen] = useState(false)
  const save = async (fb) => {
    await supabase.from('monitor_alerts').update({ feedback: fb, feedback_note: note || null, feedback_by: access.employee.id, feedback_at: new Date().toISOString(),
      seen_at: alert.seen_at || new Date().toISOString(), seen_by: alert.seen_by || access.employee.id }).eq('id', alert.id)
    setOpen(false); onDone()
  }
  if (alert.feedback && !open) return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className={'pill ' + FEEDBACK[alert.feedback][0]}>{tr(FEEDBACK[alert.feedback][1])}</span>
      {alert.feedback_note && <span className="sub">{alert.feedback_note}</span>}
      <button className="chip" style={{ minHeight: 26, fontSize: 12 }} onClick={() => setOpen(true)}>{tr('تغيير')}</button></div>)
  return (
    <div className="form" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="sub">{tr('رأيك؟')}</span>
        {Object.entries(FEEDBACK).map(([k, [, l]]) => <button key={k} className="chip" style={{ minHeight: 30, fontSize: 13 }} onClick={() => save(k)}>{tr(l)}</button>)}
      </div>
      <input className="input" style={{ minHeight: 36 }} placeholder={tr('ملاحظة (اختياري): مثلاً عرض أو طلبية تخزين')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={tr('ملاحظة')} />
    </div>
  )
}

function Alerts() {
  const { tr, fmtDate } = useLang()
  const { access } = useAccess()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('new')
  const [kind, setKind] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    let q = supabase.from('monitor_alerts').select('*, branches(name)').order('created_at', { ascending: false }).limit(300)
    if (filter === 'new') q = q.is('seen_at', null)
    if (kind) q = q.eq('kind', kind)
    q.then(({ data, error }) => { if (error) setErr(tr(invErr(error))); else setRows(data || []) })
  }, [filter, kind])
  useEffect(() => { load() }, [load])
  const runNow = async () => {
    setBusy(true); setMsg(''); setErr('')
    const { data, error } = await supabase.rpc('run_monitor')
    setBusy(false)
    if (error) setErr(tr(invErr(error))); else { setMsg(data.new_alerts ? tr('طلع {new_alerts} تنبيه جديد', { new_alerts: data.new_alerts }) : tr('ما فيه شي جديد. كل شي طبيعي.')); load() }
  }
  const seen = async (ids) => { await supabase.from('monitor_alerts').update({ seen_at: new Date().toISOString(), seen_by: access.employee.id }).in('id', ids); load(); window.dispatchEvent(new Event('badges-changed')) }
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div className="sub">{tr('قيّم كل تنبيه: "إنذار كاذب" يخلّي المراقب أقل حساسية لنفس النوع في نفس الفرع، و"صحيح" يخليه أدق.')}</div>
        <button className="btn" disabled={busy} onClick={runNow}>{busy ? <span className="spinner" /> : <Icon name="refresh" />} {tr('افحص الحين')}</button>
      </div>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={'chip' + (filter === 'new' ? ' on' : '')} onClick={() => setFilter('new')}>{tr('الجديدة')}</button>
        <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>{tr('الكل')}</button>
        <span style={{ width: 10 }} />
        <button className={'chip' + (!kind ? ' on' : '')} onClick={() => setKind('')}>{tr('كل الأنواع')}</button>
        {Object.entries(KINDS).map(([k, l]) => <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{tr(l)}</button>)}
      </div>
      {filter === 'new' && rows?.length > 1 && <button className="btn" style={{ marginBottom: 10 }} onClick={() => seen(rows.map((r) => r.id))}><Icon name="check" /> {tr('شفتها كلها')}</button>}
      <div className="card list" style={{ padding: '4px 14px' }}>
        {!rows ? <div className="center" style={{ minHeight: 120 }}><span className="spinner" /></div>
          : rows.length === 0 ? <div className="empty">{filter === 'new' ? tr('ما فيه تنبيهات جديدة') : tr('ما فيه تنبيهات')}</div>
          : rows.map((r) => (
            <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', opacity: r.seen_at && !r.feedback ? 0.7 : 1 }}>
              <span className={'pill ' + SEV[r.severity][0]} style={{ flexShrink: 0 }}>{tr(SEV[r.severity][1])}</span>
              <span className="grow form" style={{ gap: 6 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                {r.body && <div className="sub" style={{ lineHeight: 1.8, whiteSpace: 'pre-line' }}>{r.body}</div>}
                <div className="sub">{tr(KINDS[r.kind] || r.kind)} · {fmtDate(r.created_at)}{r.link ? <> · <Link to={r.link}>{tr('افتح')}</Link></> : null}</div>
                {['consumption', 'protein', 'cashier', 'sales', 'count', 'waste'].includes(r.kind) && <FeedbackBox alert={r} onDone={load} />}
              </span>
              {!r.seen_at && <button className="chip" style={{ minHeight: 30 }} onClick={() => seen([r.id])}>{tr('شفته')}</button>}
            </div>))}
      </div>
    </div>
  )
}

function Report() {
  const { tr, fmtDate } = useLang()
  const [rows, setRows] = useState(null)
  const [pick, setPick] = useState(0)
  useEffect(() => { supabase.from('monitor_reports').select('*').order('period_from', { ascending: false }).limit(30).then(({ data }) => setRows(data || [])) }, [])
  if (!rows) return <div className="center" style={{ minHeight: 120 }}><span className="spinner" /></div>
  if (!rows.length) return <div className="card empty">{tr('أول تقرير يوصلك يوم الأحد الصبح. كلود يقرا أرقام الأسبوع كلها ويكتب لك أهم الأشياء.')}</div>
  const r = rows[pick]
  return (
    <div className="form" style={{ gap: 12 }}>
      {rows.length > 1 && <select className="input" style={{ width: 'auto' }} value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label={tr('التقرير')}>
        {rows.map((x, i) => <option key={x.id} value={i}>{fmtDate(x.period_from)} — {fmtDate(x.period_to)}</option>)}</select>}
      <div className="card">
        <div className="sub">{fmtDate(r.period_from)} — {fmtDate(r.period_to)}</div>
        <h2 style={{ fontSize: 19, margin: '4px 0 10px' }}>{r.title || tr('تقرير الأسبوع')}</h2>
        <div style={{ whiteSpace: 'pre-line', lineHeight: 1.9 }}>{r.body}</div>
      </div>
    </div>
  )
}

function Protein() {
  const { tr, tn } = useLang()
  const weeks = useWeeks()
  const [week, setWeek] = useState(null)
  const [rows, setRows] = useState(null)
  const [prev, setPrev] = useState([])
  useEffect(() => { if (!week && weeks.length) setWeek(weeks[0]) }, [weeks, week])
  useEffect(() => {
    if (!week) return
    setRows(null)
    supabase.rpc('protein_report', { p_from: week.from, p_to: week.to }).then(({ data }) => setRows(data || []))
    supabase.rpc('protein_report', { p_from: addDays(week.from, -7), p_to: addDays(week.to, -7) }).then(({ data }) => setPrev(data || []))
  }, [week])
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) { if (!m.has(r.protein)) m.set(r.protein, { name: r.protein_name, rows: [] }); m.get(r.protein).rows.push(r) }
    return [...m.values()]
  }, [rows])
  const pv = (r) => prev.find((p) => p.branch_id === r.branch_id && p.protein === r.protein)
  const anyUsage = (rows || []).some((r) => Number(r.usage_kg) > 0)
  return (
    <div className="form" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><WeekPicker weeks={weeks} value={week} onChange={setWeek} /></div>
      <div className="sub">{tr('المفروض = اللي انباع من فودكس × الجرامات × نسبة الفاقد بالطبخ (بالكيلو نيّ). المصروف = اللي استلمه الفرع ناقص الهدر، أو من الجرد لو انجرد آخر الأسبوع.')}</div>
      {!anyUsage && rows && <div className="warn"><Icon name="warn" /> {tr('الفروع ما تطلب البروتين من النظام للحين، فما نقدر نقارن المصروف. الحين تقدر تشوف المفروض يصرف كل فرع، وتستخدمه للتخطيط في المطبخ.')}</div>}
      {!rows ? <div className="center" style={{ minHeight: 120 }}><span className="spinner" /></div> : groups.map((g) => {
        const tot = g.rows.reduce((a, r) => ({ e: a.e + Number(r.expected_kg), u: a.u + Number(r.usage_kg), o: a.o + Number(r.orders) }), { e: 0, u: 0, o: 0 })
        return (
          <div key={g.name} className="card table-wrap" style={{ padding: '6px 10px' }}>
            <div className="row" style={{ justifyContent: 'space-between', padding: '4px 4px 0' }}><strong>{g.name}</strong><span className="sub">{tr('المجموع المفروض {e} كغ', { e: n1(tot.e) })}</span></div>
            <table>
              <thead><tr><th>{tr('الفرع')}</th><th>{tr('المفروض (كغ)')}</th><th>{tr('لكل ١٠٠ طلب')}</th><th>{tr('الأسبوع اللي قبله')}</th><th>{tr('المصروف (كغ)')}</th><th>{tr('الفرق')}</th></tr></thead>
              <tbody>{g.rows.map((r) => {
                const p = pv(r); const per = Number(r.orders) ? 100 * r.expected_kg / r.orders : null
                const used = Number(r.usage_kg) > 0
                return (
                  <tr key={r.branch_id}>
                    <td style={{ fontWeight: 600 }}>{tn(r.branch)}</td>
                    <td className="num">{n1(r.expected_kg)}</td>
                    <td className="num sub">{per == null ? '—' : n1(per)}</td>
                    <td className="num sub">{p ? n1(p.expected_kg) : '—'}</td>
                    <td className="num">{used ? <>{n1(r.usage_kg)}{!r.counted && <span className="sub"> *</span>}</> : <span className="sub">—</span>}</td>
                    <td>{used && r.variance_pct != null ? <span className={'pill ' + (r.variance_pct > r.tolerance_pct ? 'red' : r.variance_pct < -r.tolerance_pct ? 'amber' : 'ok')}>
                      {r.variance_kg > 0 ? '+' : ''}{tr('{variance_kg} كغ ({variance_pct}٪)', { variance_kg: n1(r.variance_kg), variance_pct: n1(r.variance_pct) })}{Number(r.value_kwd) > 0 ? ` · ${kwd(r.value_kwd)}` : ''}</span> : <span className="sub">—</span>}</td>
                  </tr>)
              })}</tbody>
            </table>
          </div>)
      })}
      {anyUsage && <div className="sub">{tr('* بدون جرد آخر الأسبوع: المصروف محسوب من اللي استلمه الفرع، فممكن يكون فيه تخزين.')}</div>}
    </div>
  )
}

function Cashiers() {
  const { tr, tn } = useLang()
  const weeks = useWeeks()
  const [week, setWeek] = useState(null)
  const [rows, setRows] = useState(null)
  useEffect(() => { if (!week && weeks.length) setWeek(weeks[0]) }, [weeks, week])
  useEffect(() => {
    if (!week) return
    supabase.from('cashier_sales').select('*, branches(name)').eq('period_from', week.from).order('net_sales', { ascending: false }).then(({ data }) => setRows(data || []))
  }, [week])
  const med = (k) => { const v = (rows || []).filter((r) => r.net_sales > 0).map((r) => r[k] / r.net_sales).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0 }
  const mv = med('void_amount'), md = med('discount_amount')
  return (
    <div className="form" style={{ gap: 12 }}>
      <WeekPicker weeks={weeks} value={week} onChange={setWeek} />
      <div className="sub">{tr('الإلغاء (void) بعد ما ينطلب الطلب والخصومات اليدوية من أشهر أبواب السرقة. اللون الأحمر = ٣ أضعاف المعتاد بين الكاشيرية أو أكثر.')}</div>
      <div className="card table-wrap" style={{ padding: '4px 10px' }}>
        <table>
          <thead><tr><th>{tr('الكاشير')}</th><th>{tr('الفرع')}</th><th>{tr('الطلبات')}</th><th>{tr('المبيعات')}</th><th>{tr('الإلغاءات')}</th><th>{tr('الخصومات')}</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => {
              const vr = r.net_sales ? r.void_amount / r.net_sales : 0, dr = r.net_sales ? r.discount_amount / r.net_sales : 0
              return (
                <tr key={r.cashier_id + r.branch_id}>
                  <td style={{ fontWeight: 600 }}>{r.cashier}</td><td className="sub">{tn(r.branches?.name)}</td>
                  <td className="num">{r.order_count}</td><td className="num">{kwd(r.net_sales)}</td>
                  <td><span className={'pill ' + (r.void_amount >= 10 && vr >= 3 * mv ? 'red' : 'gray')}>{kwd(r.void_amount)} · {tr('{v}٪', { v: (100 * vr).toFixed(2) })}</span></td>
                  <td><span className={'pill ' + (r.discount_amount >= 10 && dr >= 3 * md ? 'red' : 'gray')}>{kwd(r.discount_amount)} · {tr('{v}٪', { v: (100 * dr).toFixed(2) })}</span></td>
                </tr>)
            })}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="empty">{tr('ما فيه بيانات')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sub">{tr('المعتاد هالأسبوع: الإلغاءات {v}٪ · الخصومات {v2}٪ من المبيعات.', { v: (100 * mv).toFixed(2), v2: (100 * md).toFixed(2) })}</div>
    </div>
  )
}

function Setup() {
  const { tr, lang, tn } = useLang()
  const { can, access } = useAccess()
  const canEdit = access.is_owner || can('manage_inventory')
  const [groups, setGroups] = useState([])
  const [map, setMap] = useState([])
  const [items, setItems] = useState([])
  const [show, setShow] = useState('estimate')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => {
    supabase.from('protein_groups').select('*').order('sort_order').then(({ data }) => setGroups(data || []))
    supabase.from('foodics_protein_map').select('*').order('product_name').then(({ data }) => setMap(data || []))
    selectAll(() => supabase.from('inv_items').select('id,name_ar,protein_group,unit_grams,inv_units(name)').eq('active', true).order('name_ar').order('id')).then((data) => setItems(data || []))
  }, [])
  useEffect(() => { load() }, [load])
  const saveGroup = async (g, patch) => { const r = await supabase.from('protein_groups').update(patch).eq('key', g.key); setMsg(r.error ? tr(invErr(r.error)) : tr('انحفظ')); load() }
  const saveMap = async (m, patch) => { const r = await supabase.from('foodics_protein_map').update({ ...patch, source: 'manual', updated_at: new Date().toISOString() }).eq('id', m.id); setMsg(r.error ? tr(invErr(r.error)) : tr('انحفظ')); load() }
  const saveItem = async (i, patch) => { const r = await supabase.from('inv_items').update(patch).eq('id', i.id); setMsg(r.error ? tr(invErr(r.error)) : tr('انحفظ')); load() }
  const shownMap = map.filter((m) => (show === 'all' || (show === 'estimate' ? m.source === 'estimate' : m.kind !== 'default')))
  const kgOf = (i) => (['كغ'].includes(i.inv_units?.name) ? 1 : i.inv_units?.name === 'غرام' ? 0.001 : i.unit_grams ? i.unit_grams / 1000 : null)
  const protItems = items.filter((i) => i.protein_group)
  return (
    <div className="form" style={{ gap: 14 }}>
      {msg && <div className="notice">{msg}</div>}
      <div className="card form" style={{ gap: 8 }}>
        <strong>{tr('البروتينات المراقبة')}</strong>
        <div className="sub">{tr('نسبة الطبخ = وزن اللحم بعد الطبخ من وزنه نيّ (مثلاً الدجاج ٧٥٪ يعني ١٠٠ جرام مطبوخ تحتاج ١٣٣ جرام نيّ). المسموح = الفرق اللي ما ينبّه عليه.')}</div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr('البروتين')}</th><th>{tr('نسبة الطبخ ٪')}</th><th>{tr('المسموح ٪')}</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.key}><td style={{ fontWeight: 600 }}>{g.name_ar}</td>
              <td><input className="input num" style={{ width: 90 }} type="number" defaultValue={g.yield_pct} disabled={!canEdit} onBlur={(e) => Number(e.target.value) !== Number(g.yield_pct) && saveGroup(g, { yield_pct: Number(e.target.value) })} aria-label={tr('نسبة الطبخ')} /></td>
              <td><input className="input num" style={{ width: 90 }} type="number" defaultValue={g.tolerance_pct} disabled={!canEdit} onBlur={(e) => Number(e.target.value) !== Number(g.tolerance_pct) && saveGroup(g, { tolerance_pct: Number(e.target.value) })} aria-label={tr('المسموح')} /></td></tr>))}
          </tbody></table></div>
      </div>

      <div className="card form" style={{ gap: 8 }}>
        <strong>{tr('أصناف المخزون المربوطة بالبروتين')}</strong>
        <div className="sub">{tr('لازم كل صنف دجاج أو لحم أو سمك يكون مربوط هنا، ونعرف كم كيلو في الوحدة، عشان نحسب المصروف. النظام يربطها لحاله من الاسم.')}</div>
        {protItems.length === 0 && <div className="empty">{tr('ما فيه أصناف بروتين في المخزون للحين. لما تضيفها تنربط لحالها وتطلع هنا.')}</div>}
        {protItems.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{tr('الصنف')}</th><th>{tr('البروتين')}</th><th>{tr('الوحدة')}</th><th>{tr('جرام في الوحدة')}</th></tr></thead>
          <tbody>{protItems.map((i) => (
            <tr key={i.id}><td>{itemNames(i, lang)[0]}</td>
              <td><select className="input" style={{ width: 'auto' }} value={i.protein_group || ''} disabled={!canEdit} onChange={(e) => saveItem(i, { protein_group: e.target.value || null })} aria-label={tr('البروتين')}>
                <option value="">{tr('مو بروتين')}</option>{groups.map((g) => <option key={g.key} value={g.key}>{g.name_ar}</option>)}</select></td>
              <td className="sub">{tn(i.inv_units?.name) || '—'}</td>
              <td>{['كغ', 'غرام'].includes(i.inv_units?.name) ? <span className="sub">{tr('تلقائي')}</span>
                : <><input className="input num" style={{ width: 90, borderColor: kgOf(i) ? undefined : '#E8B65A' }} type="number" defaultValue={i.unit_grams ?? ''} disabled={!canEdit}
                  onBlur={(e) => Number(e.target.value || 0) !== Number(i.unit_grams || 0) && saveItem(i, { unit_grams: Number(e.target.value) || null })} aria-label={tr('جرام في الوحدة')} />
                  {!kgOf(i) && <span className="sub" style={{ color: 'var(--amber)' }}> {tr('اكتب الوزن')}</span>}</>}</td></tr>))}
          </tbody></table></div>}
      </div>

      <div className="card form" style={{ gap: 8 }}>
        <strong>{tr('أطباق فودكس وجرامات البروتين')}</strong>
        <div className="sub">{tr('الأحجام (١٠٠ج، ١٥٠ج، ٢٠٠ج) والإضافات انقرت تلقائي من فودكس. الأطباق اللي ما لها حجم (الراب، البرجر، الساندويتش) حطيت لها تقدير، راجعه وعدّله لو غلط.')}</div>
        <div className="chips">
          {[['estimate', tr('تقديرات تحتاج مراجعة ({n})', { n: map.filter((m) => m.source === 'estimate').length })], ['sizes', tr('الأحجام والإضافات')], ['all', tr('الكل')]].map(([k, l]) =>
            <button key={k} className={'chip' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr('الطبق')}</th><th>{tr('الخيار')}</th><th>{tr('البروتين')}</th><th>{tr('جرام')}</th><th></th></tr></thead>
          <tbody>{shownMap.map((m) => (
            <tr key={m.id}><td>{m.product_name}</td><td className="sub">{m.kind === 'default' ? tr('كل طبق') : m.option_name}</td>
              <td><select className="input" style={{ width: 'auto' }} value={m.protein || ''} disabled={!canEdit} onChange={(e) => saveMap(m, { protein: e.target.value || null })} aria-label={tr('البروتين')}>
                <option value="">{tr('ما يحسب')}</option>{groups.map((g) => <option key={g.key} value={g.key}>{g.name_ar}</option>)}</select></td>
              <td><input className="input num" style={{ width: 80 }} type="number" defaultValue={m.grams} disabled={!canEdit} onBlur={(e) => Number(e.target.value) !== Number(m.grams) && saveMap(m, { grams: Number(e.target.value) || 0 })} aria-label={tr('جرام')} /></td>
              <td>{m.source === 'estimate' ? <span className="pill amber">{tr('تقدير')}</span> : m.source === 'manual' ? <span className="pill ok">{tr('معدّل')}</span> : <span className="pill gray">{tr('من فودكس')}</span>}</td></tr>))}
          </tbody></table></div>
      </div>
    </div>
  )
}

export default function Monitor() {
  const { tr } = useLang()
  const [tab, setTab] = useState('alerts')
  const [newCount, setNewCount] = useState(0)
  useEffect(() => {
    const load = () => supabase.from('monitor_alerts').select('id', { count: 'exact', head: true }).is('seen_at', null).then(({ count }) => setNewCount(count || 0))
    load(); const t = setInterval(load, 30000); return () => clearInterval(t)
  }, [tab])
  return (
    <div>
      <div className="page-head"><div><h1>{tr('المراقب')}</h1>
        <div className="sub">{tr('يقارن كل فرع بنفسه وبالفروع الثانية، بالطلبات مو بس بالفلوس، ويدوّر على السبب. يفحص كل يوم، وكل أحد يكتب لك تقرير.')}</div></div></div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{tr(l)}
          {k === 'alerts' && newCount ? <span className="badge" style={{ marginInlineStart: 6 }}>{newCount}</span> : null}</button>)}
      </div>
      {tab === 'alerts' && <Alerts />}
      {tab === 'report' && <Report />}
      {tab === 'protein' && <Protein />}
      {tab === 'cashiers' && <Cashiers />}
      {tab === 'setup' && <Setup />}
    </div>
  )
}
