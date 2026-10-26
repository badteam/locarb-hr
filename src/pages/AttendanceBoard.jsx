import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, todayKuwait, fmtTime, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Avatar from '../components/Avatar.jsx'
import Icon from '../components/Icon.jsx'

const monthEnd = (d) => { const x = new Date(d.slice(0, 8) + '01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10) }
const shiftDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const DAYNAME = (d) => new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))

// Branch attendance: who came, who didn't (HR / owner can send them a "you didn't punch" message), and a month view of absences.
export default function AttendanceBoard() {
  const { can } = useAccess()
  const isHr = can('manage_employees')
  const [params, setParams] = useSearchParams()
  const branch = params.get('branch') || ''
  const mode = params.get('view') === 'month' ? 'month' : 'day'
  const date = params.get('date') || todayKuwait()
  const month = (params.get('month') || todayKuwait().slice(0, 7))
  const setP = (patch) => setParams(Object.fromEntries(Object.entries({ branch, view: mode, date, month, ...patch }).filter(([, v]) => v)), { replace: true })

  const [branches, setBranches] = useState([])
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')
  const [sort, setSort] = useState('absent')
  const [openEmp, setOpenEmp] = useState(null)

  useEffect(() => { supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || [])) }, [])
  const bName = Object.fromEntries(branches.map((b) => [b.id, b.name]))

  const load = useCallback(async () => {
    setRows(null); setErr('')
    const from = mode === 'day' ? date : month + '-01'
    const to = mode === 'day' ? date : monthEnd(month + '-01')
    const { data, error } = await supabase.rpc('attendance_days', { p_branch: branch || null, p_from: from, p_to: to })
    if (error) { setErr(errMsg(error)); setRows([]); return }
    setRows(data || [])
  }, [branch, mode, date, month])
  useEffect(() => { load() }, [load])

  const notify = async (ids) => {
    setBusy(ids.length > 1 ? 'all' : ids[0]); setMsg(null)
    const { data, error } = await supabase.rpc('notify_no_punch', { p_employees: ids, p_date: date })
    setBusy('')
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    setMsg({ ok: true, t: data ? `انرسلت الرسالة لـ ${data} موظف ✓` : 'كلهم انرسل لهم من قبل' })
    setRows((r) => r.map((x) => (ids.includes(x.employee_id) ? { ...x, notified: true } : x)))
  }

  const groups = useMemo(() => {
    const g = { present: [], absent: [], not_started: [], leave: [], off: [] }
    for (const r of rows || []) (g[r.status] || (g[r.status] = [])).push(r)
    g.present.sort((a, b) => new Date(a.check_in_at) - new Date(b.check_in_at))
    return g
  }, [rows])

  const monthly = useMemo(() => {
    if (mode !== 'month' || !rows) return []
    const m = {}
    for (const r of rows) {
      const x = m[r.employee_id] || (m[r.employee_id] = { id: r.employee_id, name: r.full_name, job: r.job_title, branch_id: r.branch_id, pic: r.pic, present: 0, absent: 0, leave: 0, off: 0, late: 0, lateMin: 0, never: false, absentDays: [], lateDays: [] })
      if (r.status === 'never') { x.never = true; continue }
      if (r.status === 'present') { x.present++; if (r.late_minutes > 0) { x.late++; x.lateMin += r.late_minutes; x.lateDays.push([r.work_date, r.late_minutes]) } }
      else if (r.status === 'absent') { x.absent++; x.absentDays.push(r.work_date) }
      else if (r.status === 'leave') x.leave++
      else if (r.status === 'off') x.off++
    }
    const list = Object.values(m)
    list.sort((a, b) => (sort === 'late' ? b.lateMin - a.lateMin : (b.never - a.never) || b.absent - a.absent) || a.name.localeCompare(b.name))
    return list
  }, [rows, mode, sort])

  const Person = ({ r, right, sub }) => (
    <div className="list-item">
      <Avatar name={r.full_name} path={r.pic} size={36} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{r.full_name}</div>
        <div className="sub">{[r.job_title, !branch && bName[r.branch_id], sub].filter(Boolean).join(' · ')}</div>
      </div>
      {right}
    </div>)

  const absentIds = groups.absent.filter((r) => !r.notified).map((r) => r.employee_id)
  const title = branch ? bName[branch] || 'الفرع' : 'كل الفروع'

  return (
    <div>
      <div className="page-head">
        <div><h1>الحضور والغياب · {title}</h1>
          <div className="sub">{mode === 'day' ? `${DAYNAME(date)} ${fmtDate(date)}` : 'الشهر كامل، مرتب من الأكثر غياب'}</div></div>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="input" style={{ maxWidth: 200, height: 42 }} value={branch} onChange={(e) => setP({ branch: e.target.value })} aria-label="الفرع">
          <option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="chips">{[['day', 'يوم'], ['month', 'الشهر']].map(([k, t]) => <button key={k} className={'chip' + (mode === k ? ' on' : '')} onClick={() => setP({ view: k })}>{t}</button>)}</div>
        {mode === 'day' ? (
          <div className="row">
            <button className="chip" onClick={() => setP({ date: shiftDay(date, -1) })}>اليوم اللي قبل</button>
            <input type="date" className="input" style={{ height: 42, maxWidth: 170 }} max={todayKuwait()} value={date} onChange={(e) => e.target.value && setP({ date: e.target.value })} />
            {date !== todayKuwait() && <button className="chip" onClick={() => setP({ date: shiftDay(date, 1) })}>اللي بعده</button>}
            {date !== todayKuwait() && <button className="chip" onClick={() => setP({ date: todayKuwait() })}>اليوم</button>}
          </div>
        ) : (
          <input type="month" className="input" style={{ height: 42, maxWidth: 170 }} max={todayKuwait().slice(0, 7)} value={month} onChange={(e) => e.target.value && setP({ month: e.target.value })} />
        )}
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className={msg.ok ? 'notice' : 'error'} style={{ marginBottom: 12 }}>{msg.t}</div>}
      {!rows ? <div className="center" style={{ minHeight: 200 }}><span className="spinner" /></div> : mode === 'day' ? (
        <>
          <div className="grid stats" style={{ marginBottom: 14 }}>
            <div className="card stat"><div className="label">حضروا</div><div className="value" style={{ color: 'var(--ok)' }}>{groups.present.length}</div></div>
            <div className="card stat"><div className="label">ما حضروا</div><div className="value" style={{ color: groups.absent.length ? 'var(--red)' : undefined }}>{groups.absent.length}</div></div>
            <div className="card stat"><div className="label">ما بدأ دوامهم</div><div className="value">{groups.not_started.length}</div></div>
            <div className="card stat"><div className="label">إجازة / أوف</div><div className="value">{groups.leave.length + groups.off.length}</div></div>
          </div>

          <section className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 17, color: 'var(--red)' }}>ما حضروا ({groups.absent.length})</h2>
              {isHr && absentIds.length > 1 && <button className="btn" disabled={!!busy} onClick={() => notify(absentIds)}>{busy === 'all' ? <span className="spinner" /> : <Icon name="bell" />} أرسل للكل ({absentIds.length})</button>}
            </div>
            {groups.absent.length === 0 ? <div className="empty">كلهم حضروا ✓</div> : <div className="list">{groups.absent.map((r) => (
              <Person key={r.employee_id} r={r} right={isHr && (r.notified
                ? <span className="pill ok">انرسل ✓</span>
                : <button className="btn" style={{ minHeight: 36 }} disabled={!!busy} onClick={() => notify([r.employee_id])}>{busy === r.employee_id ? <span className="spinner" /> : <Icon name="bell" />} أرسل له</button>)} />))}</div>}
            {isHr && groups.absent.length > 0 && <div className="sub" style={{ marginTop: 6 }}>توصله رسالة بالتطبيق بلغته: «ما بصمت حضور بهاليوم، إذا حضرت أرسل طلب نسيان بصمة».</div>}
          </section>

          {groups.not_started.length > 0 && <section className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>ما بدأ دوامهم للحين ({groups.not_started.length})</h2>
            <div className="list">{groups.not_started.map((r) => <Person key={r.employee_id} r={r} right={r.detail && <span className="pill gray ltr">{r.detail}</span>} />)}</div>
          </section>}

          <section className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, marginBottom: 6, color: 'var(--ok)' }}>حضروا ({groups.present.length})</h2>
            {groups.present.length === 0 ? <div className="empty">ما حضر أحد</div> : <div className="list">{groups.present.map((r) => (
              <Person key={r.employee_id} r={r}
                sub={r.att_branch_id && r.att_branch_id !== r.branch_id ? `حضر بفرع ${bName[r.att_branch_id] || 'ثاني'}` : null}
                right={<div style={{ textAlign: 'left' }}>
                  <div className="ltr num">{fmtTime(r.check_in_at)}{r.check_out_at ? ` – ${fmtTime(r.check_out_at)}` : ''}</div>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {r.late_minutes > 0 && <span className="pill amber">متأخر {r.late_minutes} د</span>}
                    {r.outside && <span className="pill red">برا الفرع</span>}
                  </div></div>} />))}</div>}
          </section>

          {(groups.leave.length + groups.off.length) > 0 && <section className="card">
            <h2 style={{ fontSize: 17, marginBottom: 6 }}>ما عليهم دوام ({groups.leave.length + groups.off.length})</h2>
            <div className="list">{[...groups.leave, ...groups.off].map((r) => <Person key={r.employee_id} r={r} right={<span className="pill gray">{r.status === 'off' ? 'أوف' : r.detail || 'إجازة'}</span>} />)}</div>
          </section>}
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="sub">رتّب حسب:</span>
            <div className="chips">{[['absent', 'الأكثر غياب'], ['late', 'الأكثر تأخير']].map(([k, t]) => <button key={k} className={'chip' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}>{t}</button>)}</div>
          </div>
          <div className="sub" style={{ marginBottom: 10 }}>الغياب ينحسب من أول بصمة للموظف بالنظام. الإجازات المعتمدة وأيام الأوف ما تنحسب غياب.</div>
          <div className="card table-wrap">
            {monthly.length === 0 ? <div className="empty">ما فيه موظفين</div> : (
              <table>
                <thead><tr><th>الموظف</th><th>حضور</th><th>غياب</th><th>تأخير</th><th>إجازة</th><th>أوف</th></tr></thead>
                <tbody>{monthly.map((x) => (
                  <Fragment key={x.id}>
                    <tr onClick={() => setOpenEmp(openEmp === x.id ? null : x.id)} style={{ cursor: 'pointer' }}>
                      <td><div className="row" style={{ gap: 8 }}><Avatar name={x.name} path={x.pic} size={30} /><div><div style={{ fontWeight: 600 }}>{x.name}</div><div className="cell-sub">{[x.job, !branch && bName[x.branch_id]].filter(Boolean).join(' · ')}</div></div></div></td>
                      {x.never ? <td colSpan={5}><span className="pill red">ما بصم أبداً بالنظام</span></td> : <>
                        <td className="num">{x.present}</td>
                        <td className="num" style={{ fontWeight: 700, color: x.absent ? 'var(--red)' : undefined }}>{x.absent}</td>
                        <td className="num">{x.late ? `${x.late} مرة · ${x.lateMin} د` : '—'}</td>
                        <td className="num">{x.leave || '—'}</td>
                        <td className="num">{x.off || '—'}</td></>}
                    </tr>
                    {openEmp === x.id && !x.never && (
                      <tr><td colSpan={6} style={{ background: 'var(--bg)' }}>
                        {x.absentDays.length > 0 && <div style={{ marginBottom: 6 }}><strong style={{ color: 'var(--red)' }}>أيام الغياب: </strong>
                          <span className="chips" style={{ display: 'inline-flex' }}>{x.absentDays.sort().map((d) => <button key={d} className="chip" style={{ minHeight: 30 }} onClick={() => setP({ view: 'day', date: d })}>{DAYNAME(d)} {fmtDate(d)}</button>)}</span></div>}
                        {x.lateDays.length > 0 && <div><strong>أيام التأخير: </strong>{x.lateDays.sort().map(([d, m]) => `${fmtDate(d)} (${m} د)`).join('، ')}</div>}
                        {!x.absentDays.length && !x.lateDays.length && <span className="sub">ما غاب ولا تأخر ✓</span>}
                      </td></tr>)}
                  </Fragment>))}</tbody>
              </table>)}
          </div>
        </>
      )}
    </div>
  )
}
