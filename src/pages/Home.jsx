import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todayKuwait, fmtTime, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'

const getPosition = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null)
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuwait' }).format(new Date()))
  return h < 12 ? 'صباح الخير' : 'مساء الخير'
}

const hhmm = (t) => (t ? t.slice(0, 5) : '')

export default function Home() {
  const { access } = useAccess()
  const emp = access.employee
  const [today, setToday] = useState(null)
  const [docAlert, setDocAlert] = useState(null)
  const [missed, setMissed] = useState(0)
  const [notices, setNotices] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('attendance').select('*').eq('employee_id', emp.id).eq('work_date', todayKuwait()).order('check_in_at', { ascending: false }).limit(1)
    setToday(data?.[0] || null)
    const { data: docs } = await supabase.from('employee_documents_status').select('document_type_name,days_left,status').eq('employee_id', emp.id).neq('status', 'valid').order('days_left').limit(1)
    setDocAlert(docs?.[0] || null)
    supabase.from('missed_punches').select('id', { count: 'exact', head: true }).eq('employee_id', emp.id).eq('resolved', false).then(({ count }) => setMissed(count || 0))
    supabase.from('disciplinary_notices').select('id', { count: 'exact', head: true }).eq('employee_id', emp.id).eq('status', 'pending').then(({ count }) => setNotices(count || 0))
  }, [emp.id])

  useEffect(() => { load() }, [load])

  const open = today && !today.check_out_at
  const done = today && today.check_out_at

  const act = async () => {
    setBusy(true); setMsg(null)
    try {
      if (open) {
        const { error } = await supabase.rpc('check_out')
        if (error) throw error
        setMsg({ ok: true, text: 'تم تسجيل الانصراف' })
      } else {
        const pos = await getPosition()
        const { data, error } = await supabase.rpc('check_in', { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_method: 'app' })
        if (error) throw error
        let text = 'تم تسجيل الحضور'
        if (data?.late_minutes > 0) text += ` · متأخر ${data.late_minutes} دقيقة`
        if (data?.inside_geofence === false) text += ' · ملاحظة: موقعك خارج الفرع'
        setMsg({ ok: true, text })
      }
      await load()
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) })
    }
    setBusy(false)
  }

  const hours = today?.check_in_at
    ? (((today.check_out_at ? new Date(today.check_out_at) : new Date()) - new Date(today.check_in_at)) / 3600000)
    : 0

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row">
        <div className="avatar" style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--green)', color: '#fff' }}>{emp.full_name?.[0]}</div>
        <div className="grow">
          <h1 style={{ fontSize: 20 }}>{greeting()}، {emp.full_name.split(' ')[0]}</h1>
          <div className="sub">{[emp.job_title, access.branch_name && `فرع ${access.branch_name}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{fmtDate(new Date())}</strong>
          {access.shift && <span className="sub">{access.shift.name}</span>}
        </div>
        {access.shift
          ? <div style={{ fontSize: 26, fontWeight: 600 }} className="ltr">{hhmm(access.shift.start_time)} — {hhmm(access.shift.end_time)}</div>
          : <div className="sub">ما فيه شفت محدد لك</div>}
      </div>

      <div style={{ padding: '18px 0', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {done ? (
          <div className="notice" style={{ textAlign: 'center' }}>خلصت دوامك اليوم 👋</div>
        ) : (
          <button className={'checkin' + (open ? ' out' : '')} onClick={act} disabled={busy}>
            <Icon name="finger" size={54} stroke={1.5} />
            {busy ? 'لحظة…' : open ? 'تسجيل انصراف' : 'تسجيل حضور'}
          </button>
        )}
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">الحضور</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtTime(today?.check_in_at)}</div></div>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">الانصراف</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtTime(today?.check_out_at)}</div></div>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">الساعات</div><div style={{ fontSize: 17, fontWeight: 600 }} className="ltr">{Math.floor(hours)}:{String(Math.round((hours % 1) * 60)).padStart(2, '0')}</div></div>
      </div>

      {missed > 0 && <Link to="/corrections" className="warn"><Icon name="finger" /><span className="grow">عندك {missed} بصمة ناقصة</span><strong>أرسل طلب</strong></Link>}
      {notices > 0 && <Link to="/notices" className="warn" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}><Icon name="warn" /><span className="grow">وصلك إشعار من الإدارة يحتاج توقيعك</span><strong>اقرأ</strong></Link>}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Link to="/leaves" className="btn">طلب إجازة · رصيدك {emp.leave_balance}</Link>
        <Link to="/corrections" className="btn">نسيت أبصم</Link>
      </div>
      {docAlert && (
        <Link to="/my-documents" className="warn" style={docAlert.status === 'expired' ? { background: 'var(--red-bg)', color: 'var(--red)' } : null}>
          <Icon name="warn" />
          <span className="grow">{docAlert.document_type_name} {docAlert.status === 'expired' ? 'منتهية' : `تنتهي بعد ${docAlert.days_left} يوم`}</span>
          <strong>جدّدها</strong>
        </Link>
      )}
    </div>
  )
}
