import { useEffect, useState, useCallback } from 'react'
import { supabase, todayKuwait, fmtTime, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const toLocal = (ts) => ts ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuwait' }).format(new Date(ts)) : ''
const toTs = (date, hm) => hm ? new Date(`${date}T${hm}:00+03:00`).toISOString() : null

function EditSheet({ row, emps, branches, onClose, onSaved }) {
  const isNew = !row.id
  const [empId, setEmpId] = useState(row.employee_id || '')
  const [date, setDate] = useState(row.work_date || todayKuwait())
  const [tin, setTin] = useState(toLocal(row.check_in_at))
  const [tout, setTout] = useState(toLocal(row.check_out_at))
  const [late, setLate] = useState(row.late_minutes ?? 0)
  const [note, setNote] = useState(row.note || '')
  const [branchId, setBranchId] = useState(row.branch_id || emps[row.employee_id]?.branch_id || '')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    let outTs = toTs(date, tout)
    const inTs = toTs(date, tin)
    if (inTs && outTs && outTs < inTs) outTs = new Date(new Date(outTs).getTime() + 86400000).toISOString()
    setErr('')
    if (date > todayKuwait()) { setErr('ما تقدر تختار تاريخ بعد اليوم'); return }
    if ((inTs && new Date(inTs) > new Date()) || (outTs && new Date(outTs) > new Date())) { setErr('ما تقدر تختار وقت بعد الوقت الحالي'); return }
    if (inTs && outTs && outTs === inTs) { setErr('وقت الانصراف لازم يكون بعد الحضور'); return }
    const emp = emps[empId]
    const data = { employee_id: empId, work_date: date, check_in_at: inTs, check_out_at: outTs, late_minutes: Number(late) || 0, note: note || null, method: 'manual', branch_id: branchId || row.branch_id || emp?.branch_id || null }
    const { error } = isNew ? await supabase.from('attendance').insert(data) : await supabase.from('attendance').update(data).eq('id', row.id)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{isNew ? 'إضافة بصمة' : 'تعديل البصمة'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="ee">الموظف</label>
          <select id="ee" className="input" value={empId} onChange={(e) => { setEmpId(e.target.value); if (isNew) setBranchId(emps[e.target.value]?.branch_id || '') }} disabled={!isNew} required>
            <option value="">اختار…</option>{Object.values(emps).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="eb">الفرع</label>
          <select id="eb" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
            <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {empId && branchId && emps[empId]?.branch_id && branchId !== emps[empId].branch_id && <div className="sub">هذي البصمة بتنحسب على هالفرع. فرع الموظف الأساسي في ملفه ما يتغيّر.</div>}</div>
        <div className="field"><label htmlFor="ed">التاريخ</label><input id="ed" type="date" className="input" max={todayKuwait()} value={date} onChange={(e) => setDate(e.target.value)} required /></div>
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

const METHOD = { app: 'الجوال', device: 'جهاز البصمة', kiosk: 'آيباد الفرع', manual: 'يدوي', correction: 'طلب تعديل' }

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
  const [empFilter, setEmpFilter] = useState('')
  const [exporting, setExporting] = useState(false)
  const [branches, setBranches] = useState([])
  const [rows, setRows] = useState([])
  const [ot, setOt] = useState({})
  const [emps, setEmps] = useState({})

  useEffect(() => {
    supabase.from('branches').select('id,name').order('name').then(({ data }) => setBranches(data || []))
    supabase.from('employees').select('id,full_name,job_title,branch_id,location_mode').then(({ data }) => setEmps(Object.fromEntries((data || []).map((e) => [e.id, e]))))
  }, [])

  // same filters for the screen (first 1000) and the export (everything, fetched page by page)
  const query = useCallback(() => {
    let q = supabase.from('attendance').select('*').gte('work_date', from).lte('work_date', to).order('check_in_at', { ascending: false })
    if (branch) q = q.eq('branch_id', branch)
    if (empFilter) q = q.eq('employee_id', empFilter)
    return q
  }, [from, to, branch, empFilter])

  useEffect(() => {
    query().limit(1000).then(({ data }) => setRows(data || []))
    supabase.from('overtime_entries').select('employee_id,work_date,minutes,approved_minutes,status').gte('work_date', from).lte('work_date', to).in('status', ['pending', 'approved'])
      .then(({ data }) => setOt(Object.fromEntries((data || []).map((o) => [o.employee_id + o.work_date, o]))))
  }, [from, to, query, tick])

  const bName = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const hours = (a) => a.check_out_at ? ((new Date(a.check_out_at) - new Date(a.check_in_at)) / 3600000).toFixed(1) : '—'

  const exportCsv = async () => {
    setExporting(true)
    const all = []
    for (let i = 0; ; i += 1000) {
      const { data, error } = await query().range(i, i + 999)
      if (error) { setExporting(false); alert(errMsg(error)); return }
      all.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    setExporting(false)
    const rows = all
    const head = ['الموظف', 'الفرع', 'التاريخ', 'الحضور', 'الانصراف', 'الساعات', 'التأخير (دقيقة)', 'داخل الفرع', 'طريقة البصمة']
    const lines = rows.map((a) => [emps[a.employee_id]?.full_name, bName[a.branch_id], a.work_date, fmtTime(a.check_in_at), fmtTime(a.check_out_at), hours(a), a.late_minutes, a.inside_geofence === null ? '' : a.inside_geofence ? 'نعم' : 'لا', METHOD[a.method] || a.method || ''])
    const csv = '﻿' + [head, ...lines].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${empFilter ? (emps[empFilter]?.full_name || 'employee').replace(/\s+/g, '_') + '_' : ''}${from}_${to}.csv`; a.click()
  }

  return (
    <div>
      <div className="page-head">
        <h1>سجل الحضور</h1>
        <div className="row">
          {canEdit && <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" /> إضافة بصمة</button>}
          <button className="btn" onClick={exportCsv} disabled={exporting}>{exporting ? <span className="spinner" /> : null} تنزيل Excel</button>
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
        <div className="field" style={{ minWidth: 220 }}><label htmlFor="ef">الموظف</label>
          <select id="ef" className="input" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
            <option value="">كل الموظفين</option>
            {Object.values(emps).sort((x, y) => (x.full_name || '').localeCompare(y.full_name || '')).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
      </div>
      {rows.length >= 1000 && <div className="warn" style={{ marginBottom: 12 }}>الصفحة تعرض أول 1000 بصمة. ملف Excel فيه كل بصمات الفترة.</div>}
      <div className="card table-wrap">
        {rows.length === 0 ? <div className="empty">ما فيه سجلات في هالفترة</div> : (
          <table>
            <thead><tr><th>الموظف</th><th>الفرع</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>إضافي</th><th>ملاحظات</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{emps[a.employee_id]?.full_name}</td>
                  <td>{bName[a.branch_id] || '—'}{emps[a.employee_id]?.location_mode === 'flex' && <div className="cell-sub">مرن</div>}</td>
                  <td>{fmtDate(a.work_date)}</td>
                  <td>{fmtTime(a.check_in_at)}</td>
                  <td>{fmtTime(a.check_out_at)}
                    {a.check_out_at && a.check_out_lat != null && (a.check_out_inside === false
                      ? <div><span className="pill red">برا الفرع</span></div>
                      : a.check_out_branch_id && a.check_out_branch_id !== a.branch_id ? <div className="cell-sub">من {bName[a.check_out_branch_id]}</div> : null)}</td>
                  <td>{hours(a)}</td>
                  <td>{(() => { const o = ot[a.employee_id + a.work_date]; if (!o) return '—'; const m = o.status === 'approved' ? o.approved_minutes : o.minutes; return <span className={'pill ' + (o.status === 'approved' ? 'ok' : 'amber')}>{(m / 60).toFixed(1)} س{o.status === 'pending' ? ' · ينتظر' : ''}</span> })()}</td>
                  <td>
                    {a.late_minutes > 0 && <span className="pill amber">متأخر {a.late_minutes} د</span>}{' '}
                    {a.inside_geofence === false && <span className="pill red">برا الفرع</span>}{' '}
                    {['correction', 'manual'].includes(a.method) && <span className="pill gray">معدّلة</span>}{' '}
                    {a.method === 'device' && <span className="pill blue" title={a.note || ''}>جهاز البصمة</span>}{' '}
                    {a.method === 'kiosk' && <span className="pill blue" title={a.note || ''}>آيباد الفرع</span>}{' '}
                    {!a.check_out_at && a.work_date < todayKuwait() && <span className="pill amber">بدون انصراف</span>}
                  </td>
                  {canEdit && <td><button className="btn" style={{ minHeight: 34 }} onClick={() => setEditing(a)}>تعديل</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <EditSheet row={editing} emps={emps} branches={branches} onClose={() => setEditing(null)} onSaved={() => setTick((t) => t + 1)} />}
    </div>
  )
}
