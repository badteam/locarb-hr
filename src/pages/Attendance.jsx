import { useEffect, useState } from 'react'
import { supabase, todayKuwait, fmtTime, fmtDate } from '../lib/supabase'

const daysAgo = (n) => {
  const d = new Date(todayKuwait()); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function Attendance() {
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(todayKuwait())
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState([])
  const [rows, setRows] = useState([])
  const [emps, setEmps] = useState({})

  useEffect(() => {
    supabase.from('branches').select('id,name').order('name').then(({ data }) => setBranches(data || []))
    supabase.from('employees').select('id,full_name,job_title').then(({ data }) => setEmps(Object.fromEntries((data || []).map((e) => [e.id, e]))))
  }, [])

  useEffect(() => {
    let q = supabase.from('attendance').select('*').gte('work_date', from).lte('work_date', to).order('check_in_at', { ascending: false }).limit(1000)
    if (branch) q = q.eq('branch_id', branch)
    q.then(({ data }) => setRows(data || []))
  }, [from, to, branch])

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
        <button className="btn" onClick={exportCsv}>تنزيل Excel</button>
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
            <thead><tr><th>الموظف</th><th>الفرع</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>ملاحظات</th></tr></thead>
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
                    {a.inside_geofence === false && <span className="pill red">برا الفرع</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
