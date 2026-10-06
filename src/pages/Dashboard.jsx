import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todayKuwait, fmtDate, fmtTime, docStatusPill } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'

export default function Dashboard() {
  const { can } = useAccess()
  const [emps, setEmps] = useState([])
  const [att, setAtt] = useState([])
  const [branches, setBranches] = useState([])
  const [docs, setDocs] = useState([])
  const [pend, setPend] = useState({ leaves: 0, corrections: 0, missed: 0, notices: 0, ot: 0 })

  useEffect(() => {
    supabase.from('employees').select('id,full_name,job_title,branch_id').eq('active', true).then(({ data }) => setEmps(data || []))
    supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
    if (can('view_attendance')) supabase.from('attendance').select('*').eq('work_date', todayKuwait()).then(({ data }) => setAtt(data || []))
    if (can('manage_documents')) supabase.from('employee_documents_status').select('*').neq('status', 'valid').order('days_left').limit(8).then(({ data }) => setDocs(data || []))
    const cnt = (q) => q.then(({ count }) => count || 0)
    Promise.all([
      can('approve_leaves') ? cnt(supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : 0,
      can('manage_attendance') ? cnt(supabase.from('punch_corrections').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : 0,
      can('view_attendance') ? cnt(supabase.from('missed_punches').select('id', { count: 'exact', head: true }).eq('resolved', false)) : 0,
      can('issue_notices') ? cnt(supabase.from('disciplinary_notices').select('id', { count: 'exact', head: true }).eq('status', 'refused')) : 0,
      can('approve_overtime') ? cnt(supabase.from('overtime_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : 0,
    ]).then(([leaves, corrections, missed, notices, ot]) => setPend({ leaves, corrections, missed, notices, ot }))
  }, [can])

  const present = new Set(att.filter((a) => !a.check_out_at).map((a) => a.employee_id))
  const came = new Set(att.map((a) => a.employee_id))
  const late = att.filter((a) => a.late_minutes > 0)
  const outside = att.filter((a) => a.inside_geofence === false)
  const empName = Object.fromEntries(emps.map((e) => [e.id, e.full_name]))
  const recent = [...att].sort((a, b) => new Date(b.check_in_at) - new Date(a.check_in_at)).slice(0, 8)

  return (
    <div>
      <div className="page-head">
        <div><div className="sub">{fmtDate(new Date())}</div><h1>لوحة اليوم</h1></div>
      </div>

      {can('view_attendance') && (
        <div className="grid stats" style={{ marginBottom: 20 }}>
          <div className="card stat primary"><div className="label">حاضرين الحين</div><div className="value">{present.size} <span style={{ fontSize: 15, fontWeight: 400 }}>/ {emps.length}</span></div></div>
          <div className="card stat"><div className="label">سجلوا اليوم</div><div className="value">{came.size}</div></div>
          <div className="card stat"><div className="label">متأخرين</div><div className="value" style={{ color: 'var(--amber)' }}>{late.length}</div></div>
          <div className="card stat"><div className="label">ما سجلوا</div><div className="value" style={{ color: 'var(--red)' }}>{Math.max(0, emps.length - came.size)}</div></div>
          <div className="card stat"><div className="label">سجلوا من برا الفرع</div><div className="value">{outside.length}</div></div>
        </div>
      )}

      {(pend.leaves + pend.corrections + pend.missed + pend.notices + pend.ot) > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 20 }}>
          {pend.leaves > 0 && <Link to="/leaves" className="warn"><strong>{pend.leaves}</strong> طلب إجازة ينتظر موافقتك</Link>}
          {pend.corrections > 0 && <Link to="/corrections" className="warn"><strong>{pend.corrections}</strong> طلب نسيان بصمة</Link>}
          {pend.missed > 0 && <Link to="/corrections" className="warn"><strong>{pend.missed}</strong> بصمة ناقصة</Link>}
          {pend.ot > 0 && <Link to="/overtime" className="warn"><strong>{pend.ot}</strong> إضافي ينتظر موافقتك</Link>}
          {pend.notices > 0 && <Link to="/notices" className="warn" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}><strong>{pend.notices}</strong> رفض توقيع</Link>}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
        {can('manage_documents') && (
          <section className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 17 }}>مستندات تحتاج انتباهك</h2>
              <Link to="/documents" className="sub" style={{ color: 'var(--green)' }}>عرض الكل</Link>
            </div>
            {docs.length === 0 ? <div className="empty">كل المستندات سارية ✓</div> : (
              <div className="list">
                {docs.map((d) => {
                  const p = docStatusPill(d.status, d.days_left)
                  return (
                    <div key={d.id} className="list-item">
                      <div className="avatar">{d.employee_name?.[0]}</div>
                      <div className="grow"><div style={{ fontWeight: 600 }}>{d.employee_name}</div><div className="sub">{d.document_type_name}</div></div>
                      <span className={'pill ' + p.cls}>{p.text}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {can('view_attendance') && (
          <section className="card">
            <h2 style={{ fontSize: 17, marginBottom: 12 }}>الحضور حسب الفرع</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {branches.map((b) => {
                const total = emps.filter((e) => e.branch_id === b.id).length
                const here = new Set(att.filter((a) => a.branch_id === b.id).map((a) => a.employee_id)).size
                if (!total) return null
                const pct = Math.round((here / total) * 100)
                return (
                  <div key={b.id} className="row" style={{ fontSize: 14 }}>
                    <div style={{ width: 110 }}>{b.name}</div>
                    <div className="bar"><div style={{ width: pct + '%', background: pct < 60 ? '#B45309' : undefined }} /></div>
                    <div className="ltr" style={{ width: 48, textAlign: 'left' }}>{here}/{total}</div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {can('view_attendance') && (
          <section className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 17 }}>آخر التسجيلات</h2>
              <Link to="/attendance" className="sub" style={{ color: 'var(--green)' }}>السجل كامل</Link>
            </div>
            {recent.length === 0 ? <div className="empty">ما فيه تسجيلات اليوم</div> : (
              <div className="list">
                {recent.map((a) => (
                  <div key={a.id} className="list-item">
                    <div className="grow"><div style={{ fontWeight: 500 }}>{empName[a.employee_id] || '—'}</div>
                      <div className="sub">حضور {fmtTime(a.check_in_at)}{a.check_out_at ? ` · انصراف ${fmtTime(a.check_out_at)}` : ''}</div></div>
                    {a.late_minutes > 0 && <span className="pill amber">متأخر {a.late_minutes} د</span>}
                    {a.inside_geofence === false && <span className="pill red">برا الفرع</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
