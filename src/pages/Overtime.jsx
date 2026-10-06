import { useEffect, useState, useCallback } from 'react'
import { supabase, fmtDate, errMsg, todayKuwait } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const hrs = (m) => `${Math.floor((m || 0) / 60)}:${String((m || 0) % 60).padStart(2, '0')}`
const STATUS = { pending: ['amber', 'بانتظار الموافقة'], approved: ['ok', 'معتمد'], rejected: ['red', 'مرفوض'] }

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

export default function Overtime() {
  const { can } = useAccess()
  const showMoney = can('manage_payroll')
  const [month, setMonth] = useState(todayKuwait().slice(0, 7))
  const [rows, setRows] = useState([])
  const [employees, setEmployees] = useState([])
  const [edit, setEdit] = useState({})
  const [msg, setMsg] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    const from = `${month}-01`
    const to = new Date(new Date(from).getFullYear(), new Date(from).getMonth() + 1, 0).toISOString().slice(0, 10)
    supabase.from('overtime_view').select('*').neq('status', 'void').or(`status.eq.pending,and(work_date.gte.${from},work_date.lte.${to})`)
      .order('work_date', { ascending: false }).then(({ data }) => setRows(data || []))
  }, [month])
  useEffect(() => { load(); supabase.from('employees').select('id,full_name').eq('active', true).order('full_name').then(({ data }) => setEmployees(data || [])) }, [load])

  const decide = async (r, ok) => {
    setMsg(null)
    const h = edit[r.id]
    const { error } = await supabase.rpc('decide_overtime', { p_id: r.id, p_approve: ok, p_minutes: h !== undefined && h !== '' ? Math.round(Number(h) * 60) : null, p_note: null })
    if (error) setMsg({ ok: false, t: error.message.includes('approved') ? 'كشف راتب هالشهر معتمد، ما ينفع تعدّل الإضافي' : errMsg(error) })
    else { setMsg({ ok: true, t: ok ? `تم اعتماد ${h || hrs(r.minutes)} ساعة إضافي لـ ${r.full_name}` : `تم رفض إضافي ${r.full_name}` }); load() }
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const done = rows.filter((r) => r.status !== 'pending')
  const totalMin = done.filter((r) => r.status === 'approved').reduce((s, r) => s + (r.approved_minutes || 0), 0)
  const totalAmt = done.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.amount || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>الإضافي</h1><div className="sub">ينحسب من البصمة تلقائياً، وما ينضاف للراتب إلا بعد موافقتك</div></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> إضافي يدوي</button>
        </div>
      </div>
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>ينتظر موافقتك {pending.length > 0 && <span className="badge">{pending.length}</span>}</h2>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {pending.length === 0 ? <div className="empty">ما فيه إضافي ينتظر ✓</div> : pending.map((r) => (
            <div key={r.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                <div className="sub">{fmtDate(r.work_date)} · من البصمة: {hrs(r.minutes)} ساعة{r.is_offday ? ' · يوم عطلة' : ''}</div>
              </div>
              <label className="row sub" style={{ gap: 6 }}>الساعات المعتمدة
                <input type="number" step="0.25" min="0" className="input" style={{ width: 90, height: 38 }} placeholder={(r.minutes / 60).toFixed(2)} value={edit[r.id] ?? ''} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} />
              </label>
              <button className="btn primary" style={{ minHeight: 38 }} onClick={() => decide(r, true)}>موافقة</button>
              <button className="btn danger" style={{ minHeight: 38 }} onClick={() => decide(r, false)}>رفض</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18 }}>سجل الشهر</h2>
          <div className="sub">المعتمد: {hrs(totalMin)} ساعة{showMoney ? ` · ${totalAmt.toFixed(3)} د.ك` : ''}</div>
        </div>
        <div className="card table-wrap">
          {done.length === 0 ? <div className="empty">ما فيه سجلات</div> : (
            <table>
              <thead><tr><th>الموظف</th><th>التاريخ</th><th>من البصمة</th><th>المعتمد</th><th>النوع</th>{showMoney && <th>المبلغ</th>}<th>الحالة</th></tr></thead>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.full_name}</td>
                    <td>{fmtDate(r.work_date)}</td>
                    <td>{r.source === 'manual' ? '—' : hrs(r.minutes)}</td>
                    <td>{r.status === 'approved' ? hrs(r.approved_minutes) : '—'}</td>
                    <td>{r.source === 'manual' ? 'يدوي' : 'من البصمة'}{r.is_offday ? ' · عطلة' : ''}</td>
                    {showMoney && <td>{r.status === 'approved' ? Number(r.amount).toFixed(3) : '—'}</td>}
                    <td><span className={'pill ' + STATUS[r.status][0]}>{STATUS[r.status][1]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {adding && <AddForm employees={employees} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  )
}
