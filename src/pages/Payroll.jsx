import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import Icon from '../components/Icon.jsx'
import PayslipView from '../components/PayslipView.jsx'

const money = (n) => Number(n || 0).toFixed(3)
const thisMonth = () => new Date().toISOString().slice(0, 7)
const KIND = { bonus: ['ok', 'مكافأة'], deduction: ['red', 'خصم'] }

function AdjustmentForm({ employees, month, onClose, onSaved }) {
  const [emp, setEmp] = useState('')
  const [kind, setKind] = useState('bonus')
  const [amount, setAmount] = useState('')
  const [m, setM] = useState(month)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('salary_adjustments').insert({ employee_id: emp, kind, amount: Number(amount), period: `${m}-01`, reason: reason || null })
    if (error) setErr(error.message.includes('approved') ? 'كشف هالشهر معتمد، ما ينفع تضيف عليه' : errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>مكافأة / خصم</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="ae">الموظف</label>
          <select id="ae" className="input" value={emp} onChange={(e) => setEmp(e.target.value)} required>
            <option value="">اختار الموظف…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></div>
        <div className="chips">{Object.entries(KIND).map(([k, [, t]]) => <button type="button" key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{t}</button>)}</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="aa">المبلغ (د.ك)</label><input id="aa" type="number" step="0.001" min="0.001" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div className="field"><label htmlFor="am">لشهر</label><input id="am" type="month" className="input" value={m} onChange={(e) => setM(e.target.value)} required /></div>
        </div>
        <div className="sub">ينطبق على هالشهر بس، وما يتكرر.</div>
        <div className="field"><label htmlFor="ar">السبب</label><input id="ar" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

function Settings({ onClose }) {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.from('payroll_settings').select('*').eq('id', 1).single().then(({ data }) => setS(data)) }, [])
  if (!s) return null
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('payroll_settings').update({
      working_days_per_month: Number(s.working_days_per_month), hours_per_day: Number(s.hours_per_day),
      late_deduction_enabled: s.late_deduction_enabled, absence_deduction_enabled: s.absence_deduction_enabled,
      monthly_leave_accrual: Number(s.monthly_leave_accrual),
      ot_mode: s.ot_mode, ot_rate: Number(s.ot_rate) || 0, ot_multiplier: Number(s.ot_multiplier) || 1,
      ot_offday_factor: Number(s.ot_offday_factor) || 1, ot_min_minutes: Number(s.ot_min_minutes) || 0,
    }).eq('id', 1)
    if (error) setErr(errMsg(error)); else onClose()
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>إعدادات الرواتب</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="wd">أيام العمل بالشهر</label><input id="wd" type="number" step="0.5" className="input" value={s.working_days_per_month} onChange={set('working_days_per_month')} /></div>
          <div className="field"><label htmlFor="hd">ساعات العمل باليوم</label><input id="hd" type="number" step="0.5" className="input" value={s.hours_per_day} onChange={set('hours_per_day')} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={s.late_deduction_enabled} onChange={set('late_deduction_enabled')} /> خصم التأخير تلقائياً (بالدقيقة)</label>
        <label className="check"><input type="checkbox" checked={s.absence_deduction_enabled} onChange={set('absence_deduction_enabled')} /> خصم الغياب تلقائياً (باليوم)</label>
        <div className="field"><label htmlFor="ac">رصيد الإجازة اللي ينضاف كل شهر (يوم)</label><input id="ac" type="number" step="0.25" className="input" value={s.monthly_leave_accrual} onChange={set('monthly_leave_accrual')} /></div>
        <div className="sub">قيمة اليوم = الراتب الأساسي ÷ أيام العمل. قيمة الدقيقة = قيمة اليوم ÷ (الساعات × 60).</div>
        <div className="card form" style={{ gap: 10 }}>
          <strong style={{ fontSize: 15 }}>الإضافي (السعر العام لكل الموظفين)</strong>
          <div className="chips">
            <button type="button" className={'chip' + (s.ot_mode === 'fixed' ? ' on' : '')} onClick={() => setS({ ...s, ot_mode: 'fixed' })}>مبلغ ثابت للساعة</button>
            <button type="button" className={'chip' + (s.ot_mode === 'multiplier' ? ' on' : '')} onClick={() => setS({ ...s, ot_mode: 'multiplier' })}>نسبة من أجر الساعة</button>
          </div>
          {s.ot_mode === 'fixed'
            ? <div className="field"><label htmlFor="otr">سعر الساعة الإضافية (د.ك)</label><input id="otr" type="number" step="0.001" min="0" className="input" value={s.ot_rate} onChange={set('ot_rate')} /></div>
            : <div className="field"><label htmlFor="otm">كم ضعف أجر الساعة العادية</label><input id="otm" type="number" step="0.05" min="1" className="input" value={s.ot_multiplier} onChange={set('ot_multiplier')} />
                <div className="sub">مثلاً 1.25 = أجر الساعة + ٢٥٪. أجر الساعة = الراتب ÷ أيام العمل ÷ ساعات اليوم.</div></div>}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="otf">يوم العطلة / الأوف: × كم</label><input id="otf" type="number" step="0.05" min="1" className="input" value={s.ot_offday_factor} onChange={set('ot_offday_factor')} /></div>
            <div className="field"><label htmlFor="otmin">أقل مدة تنحسب (دقيقة)</label><input id="otmin" type="number" step="5" min="0" className="input" value={s.ot_min_minutes} onChange={set('ot_min_minutes')} /></div>
          </div>
          <div className="sub">تقدر تحط سعر خاص لموظف معيّن من صفحته في "الموظفين".</div>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

export default function Payroll() {
  const [month, setMonth] = useState(thisMonth())
  const [slips, setSlips] = useState([])
  const [adjs, setAdjs] = useState([])
  const [emps, setEmps] = useState({})
  const [branches, setBranches] = useState({})
  const [view, setView] = useState(null)
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const period = `${month}-01`

  const load = useCallback(() => {
    supabase.from('payslips').select('*').eq('period', period).then(({ data }) => setSlips(data || []))
    supabase.from('salary_adjustments').select('*').eq('period', period).in('kind', ['bonus', 'deduction']).order('created_at', { ascending: false }).then(({ data }) => setAdjs(data || []))
  }, [period])
  useEffect(() => {
    load()
    supabase.from('employees').select('id,full_name,job_title,branch_id,active').order('full_name').then(({ data }) => setEmps(Object.fromEntries((data || []).map((e) => [e.id, e]))))
    supabase.from('branches').select('id,name').then(({ data }) => setBranches(Object.fromEntries((data || []).map((b) => [b.id, b.name]))))
  }, [load])

  const generate = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('generate_payslips', { p_month: period })
    setMsg(error ? { ok: false, t: errMsg(error) } : { ok: true, t: `تم تجهيز ${data} كشف. راجعها قبل الاعتماد.` })
    load(); setBusy(false)
  }
  const approve = async () => {
    if (!window.confirm('اعتماد كل كشوف هالشهر؟ بعد الاعتماد يشوفها الموظفين وما تقدر تعدّلها.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('approve_payslips', { p_month: period })
    setMsg(error ? { ok: false, t: errMsg(error) } : { ok: true, t: `تم اعتماد ${data} كشف وإرسالها للموظفين` })
    load(); setBusy(false)
  }
  const delAdj = async (id) => { const { error } = await supabase.from('salary_adjustments').delete().eq('id', id); if (error) setMsg({ ok: false, t: errMsg(error) }); load() }

  const total = slips.reduce((s, x) => s + Number(x.net_salary), 0)
  const drafts = slips.filter((s) => s.status === 'draft').length
  const empList = Object.values(emps).filter((e) => e.active)

  const exportCsv = () => {
    const head = ['الموظف', 'الأساسي', 'البدلات', 'الإضافي', 'خصم التأخير', 'خصم الغياب', 'مكافآت/خصومات', 'الصافي']
    const lines = slips.map((s) => [emps[s.employee_id]?.full_name, s.basic_salary, s.allowances_total, s.overtime_total, s.late_deduction, s.absence_deduction, s.extra_total, s.net_salary])
    const csv = '﻿' + [head, ...lines].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `payroll_${month}.csv`; a.click()
  }

  if (view) return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-head no-print">
        <button className="btn" onClick={() => setView(null)}>رجوع</button>
        <button className="btn" onClick={() => window.print()}>طباعة / PDF</button>
      </div>
      <PayslipView slip={view} employee={emps[view.employee_id]} branchName={branches[emps[view.employee_id]?.branch_id]} admin />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>الرواتب</h1><div className="sub">التأخير والغياب ينحسبون من الحضور تلقائياً</div></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
          <button className="btn" onClick={() => setSettings(true)}>الإعدادات</button>
        </div>
      </div>

      <div className="grid stats">
        <div className="card stat primary"><div className="label">إجمالي الصافي</div><div className="value">{money(total)}</div></div>
        <div className="card stat"><div className="label">الكشوف</div><div className="value">{slips.length}</div></div>
        <div className="card stat"><div className="label">مسودات</div><div className="value" style={{ color: 'var(--amber)' }}>{drafts}</div></div>
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy} onClick={generate}>{slips.length ? 'إعادة حساب الكشوف' : 'تجهيز كشوف الشهر'}</button>
        {drafts > 0 && <button className="btn" disabled={busy} onClick={approve}>اعتماد وإرسال للموظفين</button>}
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> مكافأة / خصم</button>
        {slips.length > 0 && <button className="btn" onClick={exportCsv}>تنزيل Excel</button>}
      </div>
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>المكافآت والخصومات لهالشهر</h2>
        <div className="sub" style={{ marginBottom: 8 }}>الإضافي صار من صفحة "الإضافي" بالساعات وبعد الموافقة.</div>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {adjs.length === 0 ? <div className="empty">ما فيه شي لهالشهر</div> : adjs.map((a) => (
            <div key={a.id} className="list-item">
              <span className={'pill ' + KIND[a.kind][0]}>{KIND[a.kind][1]}</span>
              <div className="grow"><div style={{ fontWeight: 600 }}>{emps[a.employee_id]?.full_name}</div><div className="sub">{a.reason || '—'}</div></div>
              <strong className="ltr">{money(a.amount)}</strong>
              {!a.notice_id && <button className="btn danger" style={{ minHeight: 36 }} onClick={() => delAdj(a.id)}>حذف</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="card table-wrap">
        {slips.length === 0 ? <div className="empty">اضغط "تجهيز كشوف الشهر" عشان تنحسب الرواتب</div> : (
          <table>
            <thead><tr><th>الموظف</th><th>الأساسي</th><th>البدلات</th><th>الإضافي</th><th>التأخير</th><th>الغياب</th><th>مكافآت/خصومات</th><th>الصافي</th><th></th></tr></thead>
            <tbody>
              {slips.sort((a, b) => (emps[a.employee_id]?.full_name || '').localeCompare(emps[b.employee_id]?.full_name || '')).map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{emps[s.employee_id]?.full_name}</td>
                  <td>{money(s.basic_salary)}</td>
                  <td>{money(s.allowances_total)}</td>
                  <td>{money(s.overtime_total)}</td>
                  <td style={{ color: Number(s.late_deduction) ? 'var(--red)' : undefined }}>{money(s.late_deduction)}</td>
                  <td style={{ color: Number(s.absence_deduction) ? 'var(--red)' : undefined }}>{money(s.absence_deduction)} {s.absence_days ? <span className="sub">({s.absence_days} يوم)</span> : null}</td>
                  <td>{money(s.extra_total)}</td>
                  <td><strong>{money(s.net_salary)}</strong></td>
                  <td><button className="btn" style={{ minHeight: 34 }} onClick={() => setView(s)}>عرض</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {adding && <AdjustmentForm employees={empList} month={month} onClose={() => setAdding(false)} onSaved={load} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  )
}
