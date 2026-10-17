import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase, fmtDate, fmtTime, errMsg, todayKuwait } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const hrs = (m) => `${Math.floor((m || 0) / 60)}:${String(Math.round((m || 0) % 60)).padStart(2, '0')}`
const STATUS = { pending: ['amber', 'ينتظر'], approved: ['ok', 'معتمد'], rejected: ['red', 'مرفوض'] }
const monthRange = (m) => {
  const from = `${m}-01`
  const d = new Date(from); const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return [from, `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`]
}

function AddForm({ employees, onClose, onSaved }) {
  const [emp, setEmp] = useState('')
  const [date, setDate] = useState(todayKuwait())
  const [h, setH] = useState('')
  const [off, setOff] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    const { error } = await supabase.rpc('add_overtime', { p_employee: emp, p_date: date, p_minutes: Math.round(Number(h) * 60), p_offday: off, p_note: note || null })
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>إضافة إضافي يدوي</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="oe">الموظف</label>
          <select id="oe" className="input" value={emp} onChange={(e) => setEmp(e.target.value)} required>
            <option value="">اختار الموظف…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="od">التاريخ</label><input id="od" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor="oh">عدد الساعات</label><input id="oh" type="number" step="0.25" min="0.25" className="input" value={h} onChange={(e) => setH(e.target.value)} required /></div>
        </div>
        <label className="check"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> كان يوم عطلة / أوف (سعر أعلى)</label>
        <div className="field"><label htmlFor="on">ملاحظة</label><input id="on" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

// One employee's month: days with punch times; approve/reject per day or all at once.
function EmployeeMonth({ emp, rows, att, showMoney, onDone }) {
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const pending = rows.filter((r) => r.status === 'pending')
  const minutes = (s) => rows.filter((r) => r.status === s).reduce((a, r) => a + (s === 'approved' ? r.approved_minutes || 0 : r.minutes || 0), 0)
  const amount = rows.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.amount || 0), 0)

  const decide = async (list, ok) => {
    setErr(''); setBusy(ok ? 'ok' : 'no')
    for (const r of list) {
      const h = edit[r.id]
      if (ok && !r.minutes && !(Number(h) > 0)) { setErr('اكتب الساعات المعتمدة لليوم اليدوي قبل الموافقة'); setBusy(''); return }
      const { error } = await supabase.rpc('decide_overtime', { p_id: r.id, p_approve: ok, p_minutes: h !== undefined && h !== '' ? Math.round(Number(h) * 60) : null, p_note: null })
      if (error) { setErr(error.message.includes('approved') ? 'كشف راتب هالشهر معتمد، ما ينفع تعدّل الإضافي' : errMsg(error)); setBusy(''); return }
    }
    setBusy(''); onDone()
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <button className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start', padding: '12px 14px' }} onClick={() => setOpen(!open)}>
        <span className="avatar">{emp.full_name?.[0]}</span>
        <span className="grow">
          <div style={{ fontWeight: 600 }}>{emp.full_name}{emp.is_driver ? <span className="sub"> · سواق</span> : null}</div>
          <div className="sub">{rows.length} يوم · {pending.length ? `ينتظر ${hrs(minutes('pending'))} ساعة` : 'ما فيه شي ينتظر'}{minutes('approved') ? ` · معتمد ${hrs(minutes('approved'))}` : ''}{showMoney && amount ? ` · ${amount.toFixed(3)} د.ك` : ''}</div>
        </span>
        {pending.length > 0 && <span className="badge">{pending.length}</span>}
        <span className="sub">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '6px 14px 12px' }}>
          <div className="table-wrap"><table>
            <thead><tr><th>اليوم</th><th>الحضور والانصراف</th><th>الزيادة</th><th>المعتمد</th><th>الحالة</th><th /></tr></thead>
            <tbody>{rows.map((r) => {
              const a = att[r.attendance_id]
              return (
                <tr key={r.id}>
                  <td>{fmtDate(r.work_date)}{r.is_offday ? <div className="cell-sub">يوم عطلة</div> : null}</td>
                  <td>{a ? <span className="ltr">{fmtTime(a.check_in_at)} → {fmtTime(a.check_out_at)}</span> : r.source === 'manual' ? 'يدوي' : '—'}{r.note ? <div className="cell-sub">{r.note}</div> : null}</td>
                  <td>{r.source === 'manual' ? '—' : hrs(r.minutes)}</td>
                  <td>{r.status === 'pending'
                    ? <input type="number" step="0.25" min="0" className="input" style={{ width: 80, height: 34 }} placeholder={(r.minutes / 60).toFixed(2)} value={edit[r.id] ?? ''} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} aria-label="الساعات المعتمدة" />
                    : r.status === 'approved' ? hrs(r.approved_minutes) : '—'}</td>
                  <td><span className={'pill ' + STATUS[r.status][0]}>{STATUS[r.status][1]}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.status === 'pending' && <>
                    <button className="btn primary" style={{ minHeight: 32 }} disabled={!!busy} onClick={() => decide([r], true)}>اعتماد</button>{' '}
                    <button className="btn" style={{ minHeight: 32 }} disabled={!!busy} onClick={() => decide([r], false)}>رفض</button></>}</td>
                </tr>)
            })}</tbody>
          </table></div>
          {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
          {pending.length > 1 && (
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" disabled={!!busy} onClick={() => decide(pending, true)}>{busy === 'ok' ? <span className="spinner" /> : <Icon name="check" />} اعتماد كل الأيام ({pending.length})</button>
              <button className="btn" disabled={!!busy} onClick={() => decide(pending, false)}>رفض الكل</button>
            </div>)}
        </div>)}
    </div>
  )
}

function ShortHours({ month }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    const [from, to] = monthRange(month)
    supabase.from('short_hours').select('*, employees:employee_id(full_name, is_driver), attendance:attendance_id(check_in_at, check_out_at)')
      .in('status', ['pending', 'confirmed', 'corrected']).gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [month])
  useEffect(() => { load() }, [load])
  const mark = async (r, status) => {
    setBusy(r.id)
    await supabase.from('short_hours').update({ status, decided_at: new Date().toISOString() }).eq('id', r.id)
    setBusy(''); load()
  }
  const pending = rows.filter((r) => r.status === 'pending')
  return (
    <section>
      <div className="sub" style={{ marginBottom: 10 }}>موظفين اشتغلوا أقل من ساعاتهم. ما فيه خصم، بس تأكد إن البصمة صحيحة. لو غلط، عدّلها من سجل الحضور.</div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {rows.length === 0 && <div className="empty">ما فيه ساعات ناقصة هالشهر ✓</div>}
        {[...pending, ...rows.filter((r) => r.status !== 'pending')].map((r) => (
          <div key={r.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <span className="grow" style={{ minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{r.employees?.full_name}{r.employees?.is_driver ? <span className="sub"> · سواق</span> : null}</div>
              <div className="sub">{fmtDate(r.work_date)} · اشتغل {hrs(r.worked_minutes)} من {hrs(r.required_minutes)}{r.attendance ? <> · <span className="ltr">{fmtTime(r.attendance.check_in_at)} → {fmtTime(r.attendance.check_out_at)}</span></> : null}</div>
            </span>
            {r.status === 'pending' ? <>
              <button className="btn" style={{ minHeight: 34 }} disabled={busy === r.id} onClick={() => mark(r, 'confirmed')}>صحيح</button>
              <Link className="btn" style={{ minHeight: 34 }} to={`/attendance?date=${r.work_date}`}>تعديل البصمة</Link>
              <button className="btn" style={{ minHeight: 34 }} disabled={busy === r.id} onClick={() => mark(r, 'corrected')}>انصلحت</button>
            </> : <span className={'pill ' + (r.status === 'confirmed' ? 'gray' : 'ok')}>{r.status === 'confirmed' ? 'تأكدنا إنه صحيح' : 'انصلحت البصمة'}</span>}
          </div>))}
      </div>
    </section>
  )
}

export default function Overtime() {
  const { can } = useAccess()
  const showMoney = can('manage_payroll')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'month'
  const [month, setMonth] = useState(todayKuwait().slice(0, 7))
  const [pend, setPend] = useState({ month: 0, short: 0 })
  useEffect(() => {
    Promise.all([
      supabase.from('overtime_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('short_hours').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]).then(([a, b]) => setPend({ month: a.count || 0, short: b.count || 0 }))
  }, [tab, month])
  const [rows, setRows] = useState([])
  const [att, setAtt] = useState({})
  const [employees, setEmployees] = useState([])
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const [from, to] = monthRange(month)
    const { data } = await supabase.from('overtime_view').select('*').neq('status', 'void').gte('work_date', from).lte('work_date', to).order('work_date')
    setRows(data || [])
    const ids = (data || []).map((r) => r.attendance_id).filter(Boolean)
    if (ids.length) {
      const { data: a } = await supabase.from('attendance').select('id,check_in_at,check_out_at').in('id', ids)
      setAtt(Object.fromEntries((a || []).map((x) => [x.id, x])))
    } else setAtt({})
  }, [month])
  useEffect(() => {
    load()
    supabase.from('payroll_settings').select('ot_mode,ot_rate').eq('id', 1).single().then(({ data }) => setSettings(data))
    supabase.from('employees').select('id,full_name,is_driver').eq('active', true).order('full_name').then(({ data }) => setEmployees(data || []))
  }, [load])

  const byEmp = {}
  for (const r of rows) (byEmp[r.employee_id] ||= []).push(r)
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]))
  const list = Object.entries(byEmp).map(([id, rs]) => ({ emp: empMap[id] || { id, full_name: rs[0].full_name }, rs }))
    .filter((x) => !q.trim() || x.emp.full_name?.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.rs.filter((r) => r.status === 'pending').length - a.rs.filter((r) => r.status === 'pending').length || a.emp.full_name.localeCompare(b.emp.full_name))
  const pendingMin = rows.filter((r) => r.status === 'pending').reduce((a, r) => a + (r.minutes || 0), 0)
  const approvedMin = rows.filter((r) => r.status === 'approved').reduce((a, r) => a + (r.approved_minutes || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>الإضافي والساعات</h1><div className="sub">الإضافي ينجمع من البصمة، وأنت تراجعه آخر الشهر يوم يوم قبل ما يدخل الراتب</div></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
          {tab === 'month' && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> إضافي يدوي</button>}
        </div>
      </div>
      <div className="chips">{[['month', 'إضافي الشهر'], ['short', 'ساعات ناقصة']].map(([k, t]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setParams({ tab: k }, { replace: true })}>{t}{pend[k] ? <span className="badge" style={{ marginInlineStart: 6 }}>{pend[k]}</span> : null}</button>)}</div>

      {tab === 'short' ? <ShortHours month={month} /> : <>
        {settings?.ot_mode === 'fixed' && !Number(settings?.ot_rate) && (
          <div className="warn">سعر الإضافي العام صفر، يعني الإضافي المعتمد ما بينحسب له مبلغ (إلا الموظفين اللي لهم سعر خاص). حدده من الرواتب ← الإعدادات.</div>)}
        <div className="grid stats">
          <div className="card stat"><div className="label">ينتظر المراجعة</div><div className="value" style={{ color: 'var(--amber)' }}>{hrs(pendingMin)}</div></div>
          <div className="card stat"><div className="label">معتمد هالشهر</div><div className="value" style={{ color: 'var(--ok)' }}>{hrs(approvedMin)}</div></div>
          <div className="card stat"><div className="label">موظفين عندهم إضافي</div><div className="value">{Object.keys(byEmp).length}</div></div>
        </div>
        <input className="input" style={{ maxWidth: 280, height: 42 }} placeholder="بحث باسم الموظف…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.length === 0 && <div className="card empty">ما فيه إضافي هالشهر</div>}
          {list.map(({ emp, rs }) => <EmployeeMonth key={emp.id} emp={emp} rows={rs} att={att} showMoney={showMoney} onDone={load} />)}
        </div>
      </>}
      {adding && <AddForm employees={employees} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  )
}
