import { useEffect, useState } from 'react'
import { supabase, todayKuwait, fmtTime, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const toLocal = (ts) => ts ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuwait' }).format(new Date(ts)) : ''
const toTs = (date, hm) => hm ? new Date(`${date}T${hm}:00+03:00`).toISOString() : null

function EditSheet({ row, emps, onClose, onSaved }) {
  const isNew = !row.id
  const [empId, setEmpId] = useState(row.employee_id || '')
  const [date, setDate] = useState(row.work_date || todayKuwait())
  const [tin, setTin] = useState(toLocal(row.check_in_at))
  const [tout, setTout] = useState(toLocal(row.check_out_at))
  const [late, setLate] = useState(row.late_minutes ?? 0)
  const [note, setNote] = useState(row.note || '')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    let outTs = toTs(date, tout)
    const inTs = toTs(date, tin)
    if (inTs && outTs && outTs < inTs) outTs = new Date(new Date(outTs).getTime() + 86400000).toISOString()
    const emp = emps[empId]
    const data = { employee_id: empId, work_date: date, check_in_at: inTs, check_out_at: outTs, late_minutes: Number(late) || 0, note: note || null, method: 'manual', branch_id: row.branch_id || emp?.branch_id || null }
    const { error } = isNew ? await supabase.from('attendance').insert(data) : await supabase.from('attendance').update(data).eq('id', row.id)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{isNew ? 'إضافة بصمة' : 'تعديل البصمة'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="ee">الموظف</label>
          <select id="ee" className="input" value={empId} onChange={(e) => setEmpId(e.target.value)} disabled={!isNew} required>
            <option value="">اختار…</option>{Object.values(emps).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="ed">التاريخ</label><input id="ed" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="ei">الحضور</label><input id="ei" type="time" className="input" value={tin} onChange={(e) => setTin(e.target.value)} required /></div>
          <div className="field"><label htmlFor="eo">الانصراف</label><input id="eo" type="time" className="input" value={tout} onChange={(e) => setTout(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="el">دقايق التأخير</label><input id="el" type="number" min="0" className="input" value={late} onChange={(e) => setLate(e.target.value)} /></div>
        <div className="field"><label htmlFor="en">ملاحظة</label><input id="en" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

const daysAgo = (n) => {
  const d = new Date(todayKuwait()); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function Attendance() {
  const { can } = useAccess()
  const canEdit = can('manage_attendance')
  const [editing, setEditing] = useState(null)
  const [tick, setTick] = useState(0)
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(todayKuwait())
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState([])
  const [rows, setRows] = useState([])
  const [emps, setEmps] = useState({})

  useEffect(() => {
    supabase.from('branches').select('id,name').order('name').then(({ data }) => setBranches(data || []))
    supabase.from('employees').select('id,full_name,job_title,branch_id').then(({ data }) => setEmps(Object.fromEntries((data || []).map((e) => [e.id, e]))))
  }, [])

  useEffect(() => {
    let q = supabase.from('attendance').select('*').gte('work_date', from).lte('work_date', to).order('check_in_at', { ascending: false }).limit(1000)
    if (branch) q = q.eq('branch_id', branch)
    q.then(({ data }) => setRows(data || []))
  }, [from, to, branch, tick])

  const bName = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const hours = (a) => a.check_out_at ? ((new Date(a.check_out_at) - new Date(a.check_in_at)) / 3600000).toFixed(1) : '—'

  const exportCsv = () => {
    const head = ['الموظف', 'الفرع', 'التاريخ', 'الحضور', 'الانصراف', 'الساعات', 'التأخير (دقيقة)', 'داخل الفرع']
    const lines = rows.map((a) => [emps[a.employee_id]?.full_name, bName[a.branch_id], a.work_date, fmtTime(a.check_in_at), fmtTime(a.check_out_at), hours(a), a.late_minutes, a.inside_geofence === null ? '' : a.inside_geofence ? 'نعم' : 'لا'])
    const csv = '﻿' + [head, ...lines].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${from}_${to}.csv`; a.click()
  }

  return (
    <div>
      <div className="page-head">
        <h1>سجل الحضور</h1>
        <div className="row">
          {canEdit && <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" /> إضافة بصمة</button>}
          <button className="btn" onClick={exportCsv}>تنزيل Excel</button>
        </div>
      </div>
      <div className="card row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="field"><label htmlFor="f">من</label><input id="f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="t">إلى</label><input id="t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><label htmlFor="b">الفرع</label>
          <select id="b" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <div className="empty">ما فيه سجلات في هالفترة</div> : (
          <table>
            <thead><tr><th>الموظف</th><th>الفرع</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>ملاحظات</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{emps[a.employee_id]?.full_name}</td>
                  <td>{bName[a.branch_id] || '—'}</td>
                  <td>{fmtDate(a.work_date)}</td>
                  <td>{fmtTime(a.check_in_at)}</td>
                  <td>{fmtTime(a.check_out_at)}</td>
                  <td>{hours(a)}</td>
                  <td>
                    {a.late_minutes > 0 && <span className="pill amber">متأخر {a.late_minutes} د</span>}{' '}
                    {a.inside_geofence === false && <span className="pill red">برا الفرع</span>}{' '}
                    {['correction', 'manual'].includes(a.method) && <span className="pill gray">معدّلة</span>}{' '}
                    {!a.check_out_at && a.work_date < todayKuwait() && <span className="pill amber">بدون انصراف</span>}
                  </td>
                  {canEdit && <td><button className="btn" style={{ minHeight: 34 }} onClick={() => setEditing(a)}>تعديل</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <EditSheet row={editing} emps={emps} onClose={() => setEditing(null)} onSaved={() => setTick((t) => t + 1)} />}
    </div>
  )
}
