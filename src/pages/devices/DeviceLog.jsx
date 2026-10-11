import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate, fmtTime } from '../../lib/supabase'

const KIND = { open_door: 'فتح الباب', set_user: 'إضافة/تعديل اسم', delete_user: 'مسح اسم', query_users: 'سحب الأسماء', reupload: 'إعادة إرسال البصمات' }
const STATUS = { pending: ['ينتظر الجهاز', 'amber'], sent: ['انرسل للجهاز', 'blue'], ok: ['تم', 'ok'], failed: ['الجهاز رفض', 'red'], expired: ['انتهى بدون تنفيذ', 'gray'] }
const RESULT = { in: ['حضور', 'ok'], out: ['انصراف', 'ok'], duplicate: ['مكررة', 'gray'], unknown_pin: ['رقم غير مربوط', 'amber'], before_start: ['قبل الربط', 'gray'], pending: ['الجهاز غير معتمد', 'amber'] }

export default function DeviceLog() {
  const [tab, setTab] = useState('commands')
  const [rows, setRows] = useState(null)
  const [devices, setDevices] = useState({})
  const [emps, setEmps] = useState({})

  useEffect(() => {
    supabase.from('bio_devices').select('id,name,serial').then(({ data }) => setDevices(Object.fromEntries((data || []).map((d) => [d.id, d.name || d.serial]))))
    supabase.from('employees').select('id,full_name').then(({ data }) => setEmps(Object.fromEntries((data || []).map((e) => [e.id, e.full_name]))))
  }, [])
  useEffect(() => {
    setRows(null)
    const q = tab === 'commands'
      ? supabase.from('bio_commands').select('*').order('id', { ascending: false }).limit(200)
      : supabase.from('bio_punches').select('id,device_id,pin,punched_at,employee_id,result').order('punched_at', { ascending: false }).limit(200)
    q.then(({ data }) => setRows(data || []))
  }, [tab])

  return (
    <div>
      <div className="page-head">
        <div><Link to="/devices" className="sub" style={{ color: 'var(--green)' }}>الأجهزة ←</Link><h1>السجل</h1></div>
        <div className="chips">
          <button className={'chip' + (tab === 'commands' ? ' on' : '')} onClick={() => setTab('commands')}>الأبواب والأوامر</button>
          <button className={'chip' + (tab === 'punches' ? ' on' : '')} onClick={() => setTab('punches')}>آخر البصمات من الأجهزة</button>
        </div>
      </div>
      <div className="card table-wrap">
        {rows === null ? <div className="empty"><span className="spinner" /></div> : rows.length === 0 ? <div className="empty">ما فيه شي للحين</div> : tab === 'commands' ? (
          <table>
            <thead><tr><th>الوقت</th><th>الجهاز</th><th>الأمر</th><th>بواسطة</th><th>الحالة</th></tr></thead>
            <tbody>{rows.map((c) => {
              const [t, cls] = STATUS[c.status] || [c.status, 'gray']
              return (
                <tr key={c.id}>
                  <td>{fmtDate(c.created_at)} · {fmtTime(c.created_at)}</td>
                  <td>{devices[c.device_id] || '—'}</td>
                  <td style={{ fontWeight: 500 }}>{KIND[c.kind] || c.kind}{c.pin ? <span className="sub"> · رقم {c.pin}</span> : null}</td>
                  <td>{emps[c.created_by] || '—'}</td>
                  <td><span className={'pill ' + cls}>{t}</span></td>
                </tr>)
            })}</tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>الوقت</th><th>الجهاز</th><th>رقم الجهاز</th><th>الموظف</th><th>انحسبت</th></tr></thead>
            <tbody>{rows.map((p) => {
              const [t, cls] = RESULT[p.result] || [p.result || '—', 'gray']
              return (
                <tr key={p.id}>
                  <td>{fmtDate(p.punched_at)} · {fmtTime(p.punched_at)}</td>
                  <td>{devices[p.device_id] || '—'}</td>
                  <td className="num">{p.pin}</td>
                  <td style={{ fontWeight: 500 }}>{emps[p.employee_id] || '—'}</td>
                  <td><span className={'pill ' + cls}>{t}</span></td>
                </tr>)
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
