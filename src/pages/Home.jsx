import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todayKuwait } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { useLang, LangPicker } from '../lib/i18n.jsx'
import Icon from '../components/Icon.jsx'

const getPosition = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null)
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 10000 },
  )
})

const isMorning = () => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuwait' }).format(new Date())) < 12
const hhmm = (x) => (x ? x.slice(0, 5) : '')

export default function Home() {
  const { access } = useAccess()
  const { t, tn, fmtDate, fmtTime } = useLang()
  const emp = access.employee
  const [today, setToday] = useState(null)
  const [docAlert, setDocAlert] = useState(null)
  const [missed, setMissed] = useState(0)
  const [notices, setNotices] = useState(0)
  const [ot, setOt] = useState({ a: 0, p: 0 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('attendance').select('*').eq('employee_id', emp.id).eq('work_date', todayKuwait()).order('check_in_at', { ascending: false }).limit(1)
    setToday(data?.[0] || null)
    const { data: docs } = await supabase.from('employee_documents_status').select('document_type_name,days_left,status').eq('employee_id', emp.id).in('status', ['expired', 'expiring']).order('days_left').limit(1)
    setDocAlert(docs?.[0] || null)
    supabase.from('missed_punches').select('id', { count: 'exact', head: true }).eq('employee_id', emp.id).eq('resolved', false).then(({ count }) => setMissed(count || 0))
    supabase.from('overtime_entries').select('status,minutes,approved_minutes').eq('employee_id', emp.id).gte('work_date', todayKuwait().slice(0, 7) + '-01').in('status', ['approved', 'pending'])
      .then(({ data }) => setOt({ a: (data || []).filter((x) => x.status === 'approved').reduce((s, x) => s + (x.approved_minutes || 0), 0), p: (data || []).filter((x) => x.status === 'pending').reduce((s, x) => s + x.minutes, 0) }))
    supabase.from('disciplinary_notices').select('id', { count: 'exact', head: true }).eq('employee_id', emp.id).eq('status', 'pending').then(({ count }) => setNotices(count || 0))
  }, [emp.id])
  const { reload } = useAccess()
  useEffect(() => { load(); reload() }, [load, reload])

  const open = today && !today.check_out_at
  const done = today && today.check_out_at

  const act = async () => {
    setBusy(true); setMsg(null)
    try {
      if (open) {
        const { error } = await supabase.rpc('check_out')
        if (error) throw error
        setMsg({ ok: true, text: t('checked_out_ok') })
      } else {
        const pos = await getPosition()
        const { data, error } = await supabase.rpc('check_in', { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_method: 'app' })
        if (error) throw error
        let text = t('checked_in_ok')
        if (data?.late_minutes > 0) text += ' · ' + t('late_by', { n: data.late_minutes })
        if (data?.inside_geofence === false) text += ' · ' + t('outside_branch')
        setMsg({ ok: true, text })
      }
      await load()
    } catch (e) {
      setMsg({ ok: false, text: e.message?.includes('already checked in') ? t('already_in') : e.message })
    }
    setBusy(false)
  }

  const hours = today?.check_in_at ? (((today.check_out_at ? new Date(today.check_out_at) : new Date()) - new Date(today.check_in_at)) / 3600000) : 0

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row">
        <div className="avatar" style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--green)', color: '#fff' }}>{emp.full_name?.[0]}</div>
        <div className="grow">
          <h1 style={{ fontSize: 20 }}>{isMorning() ? t('good_morning') : t('good_evening')}, {emp.full_name.split(' ')[0]}</h1>
          <div className="sub">{[tn(emp.job_title), access.branch_name && `${t('branch')}: ${tn(access.branch_name)}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <LangPicker />

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{fmtDate(new Date())}</strong>
          {access.shift && <span className="sub">{access.shift.name}</span>}
        </div>
        {access.shift
          ? <div style={{ fontSize: 26, fontWeight: 600 }} className="ltr">{hhmm(access.shift.start_time)} — {hhmm(access.shift.end_time)}</div>
          : <div className="sub">{t('no_shift')}</div>}
      </div>

      <div style={{ padding: '18px 0', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {done ? (
          <div className="notice" style={{ textAlign: 'center' }}>{t('day_done')}</div>
        ) : (
          <button className={'checkin' + (open ? ' out' : '')} onClick={act} disabled={busy}>
            <Icon name="finger" size={54} stroke={1.5} />
            {busy ? t('wait') : open ? t('check_out') : t('check_in')}
          </button>
        )}
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">{t('in_time')}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtTime(today?.check_in_at)}</div></div>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">{t('out_time')}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtTime(today?.check_out_at)}</div></div>
        <div className="card stat" style={{ textAlign: 'center', padding: 12 }}><div className="label">{t('hours')}</div><div style={{ fontSize: 17, fontWeight: 600 }} className="ltr">{Math.floor(hours)}:{String(Math.round((hours % 1) * 60)).padStart(2, '0')}</div></div>
      </div>

      {(ot.a > 0 || ot.p > 0) && (
        <div className="card row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <strong>{t('ot_month')}</strong>
          <span className="sub">{t('ot_approved', { n: (ot.a / 60).toFixed(1) })}{ot.p > 0 ? ' · ' + t('ot_pending', { n: (ot.p / 60).toFixed(1) }) : ''}</span>
        </div>
      )}
      {missed > 0 && <Link to="/corrections" className="warn"><Icon name="finger" /><span className="grow">{t('missed_count', { n: missed })}</span><strong>{t('send_request')}</strong></Link>}
      {notices > 0 && <Link to="/notices" className="warn" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}><Icon name="warn" /><span className="grow">{t('notice_needs_sign')}</span><strong>{t('read')}</strong></Link>}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Link to="/leaves" className="btn">{t('request_leave_balance', { n: emp.leave_balance })}</Link>
        <Link to="/corrections" className="btn">{t('forgot_punch')}</Link>
      </div>
      {docAlert && (
        <Link to="/my-documents" className="warn" style={docAlert.status === 'expired' ? { background: 'var(--red-bg)', color: 'var(--red)' } : null}>
          <Icon name="warn" />
          <span className="grow">{docAlert.status === 'expired' ? t('doc_is_expired', { doc: tn(docAlert.document_type_name) }) : t('doc_expires_in', { doc: tn(docAlert.document_type_name), n: docAlert.days_left })}</span>
          <strong>{t('renew')}</strong>
        </Link>
      )}
    </div>
  )
}
