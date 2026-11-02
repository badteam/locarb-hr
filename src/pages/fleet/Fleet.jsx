import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, selectAll, fmtTime, todayKuwait } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import Icon from '../../components/Icon.jsx'
import FleetMap from './FleetMap.jsx'
import { useFleet, useDemo } from './useFleet'
import { statusOf, ago, carName, kindLabel, kindTone, KINDS, kuwaitDay, distanceKm, demoTrack } from './fleetLib'

export function DemoBar() {
  const [demo, setDemo] = useDemo()
  if (!demo) return null
  return (
    <div className="demo-bar">
      <Icon name="warn" size={18} /> <span className="grow">هذي <b>بيانات تجريبية</b> عشان تشوف شكل الصفحة. السيارات الحقيقية تظهر هنا أول ما توصل الكاميرات.</span>
      <button className="btn" style={{ minHeight: 36 }} onClick={() => setDemo(false)}>إيقاف التجربة</button>
    </div>
  )
}

export function AlertRow({ e, car, driver, onSeen, compact }) {
  const tone = kindTone(e.kind)
  return (
    <div className={'alert-row' + (!e.seen_at && KINDS[e.kind]?.group !== 'engine' ? ' unseen' : '')}>
      <span className={'alert-ico ' + tone}><Icon name={KINDS[e.kind]?.group === 'engine' ? 'truck' : 'warn'} size={18} /></span>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{kindLabel(e.kind)}{e.kind === 'overspeed' && e.speed != null ? <> · <span className="num">{Math.round(e.speed)}</span> كم/س</> : null}</div>
        <div className="sub">{!compact && <>{carName(car)}{driver ? ` · ${driver}` : ''} · </>}{fmtTime(e.at)} · {ago(e.at)}</div>
        <div className="row" style={{ gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          {e.media_url && <a href={e.media_url} target="_blank" rel="noreferrer" className="sub" style={{ color: 'var(--green)' }}>{e.media_kind === 'video' ? 'شوف الفيديو' : 'شوف الصورة'}</a>}
          {e.lat != null && <a href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" className="sub" style={{ color: 'var(--green)' }}>المكان على الخريطة</a>}
          {onSeen && !e.seen_at && KINDS[e.kind]?.group !== 'engine' && <button className="sub" style={{ border: 0, background: 'none', color: 'var(--green)', cursor: 'pointer', padding: 0 }} onClick={() => onSeen([e.id])}>تم الاطلاع</button>}
        </div>
      </div>
    </div>
  )
}

function CarPanel({ v, demo, events, personName, onClose, onTrack }) {
  const [date, setDate] = useState(todayKuwait())
  const [track, setTrack] = useState(null)
  const [busy, setBusy] = useState(false)
  const s = statusOf(v)
  const dayEvents = useMemo(() => {
    const [a, b] = kuwaitDay(date)
    return events.filter((e) => e.vehicle_id === v.id && e.at >= a && e.at < b)
  }, [events, v.id, date])

  const showRoute = useCallback(async () => {
    setBusy(true)
    let pts
    if (demo) pts = demoTrack(v)
    else {
      const [a, b] = kuwaitDay(date)
      pts = await selectAll(() => supabase.from('fleet_positions').select('at,lat,lng,speed,ignition').eq('vehicle_id', v.id).gte('at', a).lt('at', b).order('at')).catch(() => [])
    }
    setTrack(pts); onTrack(pts, dayEvents); setBusy(false)
  }, [demo, v, date, dayEvents, onTrack])

  // a different car or day clears the old route
  useEffect(() => { setTrack(null); onTrack(null, null) }, [v.id, date, onTrack])

  const moving = track?.filter((p) => Number(p.speed) > 3) || []
  return (
    <div className="card form" style={{ gap: 12 }}>
      <div className="row">
        <span className="car-dot" style={{ background: s.color, width: 16, height: 16, borderRadius: 8 }} />
        <div className="grow"><h2 style={{ fontSize: 18 }}>{carName(v)}</h2>
          <div className="sub">{personName(v.driver_id) || 'ما فيه سواق محدد'}{v.plate ? <> · <span className="num">{v.plate}</span></> : null}</div></div>
        <button className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><div className="sub">الحالة</div><span className={'pill ' + s.tone}>{s.label}</span></div>
        <div><div className="sub">السرعة</div><b className="num">{v.last_speed != null ? Math.round(v.last_speed) : '—'}</b> <span className="sub">كم/س</span></div>
        <div><div className="sub">آخر تحديث</div><b>{ago(v.last_at)}</b></div>
      </div>
      {v.ignition_at && <div className="sub">{v.ignition ? 'المحرك شغال من' : 'المحرك طافي من'} {fmtTime(v.ignition_at)} ({ago(v.ignition_at)})</div>}
      {v.last_lat != null && <a className="sub" style={{ color: 'var(--green)' }} href={`https://maps.google.com/?q=${v.last_lat},${v.last_lng}`} target="_blank" rel="noreferrer">افتح المكان في خرائط جوجل</a>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="date" className="input" style={{ width: 170, height: 44 }} value={date} max={todayKuwait()} onChange={(e) => setDate(e.target.value)} />
        <button className="btn primary" onClick={showRoute} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="pin" />} مسار اليوم</button>
        {track && <button className="btn" onClick={() => { setTrack(null); onTrack(null, null) }}>إخفاء المسار</button>}
      </div>
      {track && (track.length === 0
        ? <div className="notice">ما فيه حركة مسجلة في هذا اليوم.</div>
        : <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div><div className="sub">المسافة</div><b className="num">{distanceKm(track).toFixed(1)}</b> <span className="sub">كم</span></div>
            <div><div className="sub">أول حركة</div><b>{fmtTime(track[0].at)}</b></div>
            <div><div className="sub">أعلى سرعة</div><b className="num">{Math.round(Math.max(0, ...moving.map((p) => Number(p.speed))))}</b> <span className="sub">كم/س</span></div>
          </div>)}

      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>تنبيهات اليوم</b><span className="sub">{dayEvents.length}</span></div>
        <div className="scroll-list" style={{ maxHeight: 300 }}>
          {dayEvents.length === 0 && <div className="empty">ما فيه تنبيهات</div>}
          {dayEvents.map((e) => <AlertRow key={e.id} e={e} car={v} compact />)}
        </div>
      </div>
    </div>
  )
}

export default function Fleet() {
  const { can } = useAccess()
  const [demo, setDemo] = useDemo()
  const { vehicles, events, loadedAt, error, personName } = useFleet()
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [track, setTrack] = useState(null)
  const onTrack = useCallback((pts, evs) => setTrack(pts ? { pts, evs } : null), [])

  const approved = useMemo(() => (vehicles || []).filter((v) => v.approved), [vehicles])
  const pending = (vehicles || []).filter((v) => !v.approved).length
  const withStatus = approved.map((v) => ({ v, s: statusOf(v) }))
  const counts = withStatus.reduce((a, x) => ({ ...a, [x.s.key]: (a[x.s.key] || 0) + 1 }), {})
  const today = kuwaitDay(todayKuwait())[0]
  const todayAlerts = events.filter((e) => e.at >= today && KINDS[e.kind]?.group !== 'engine')
  const smokingToday = todayAlerts.filter((e) => e.kind === 'smoking').length

  const shown = withStatus.filter(({ v, s }) =>
    (filter === 'all' || (filter === 'off' ? ['offline', 'never'].includes(s.key) : s.key === filter)) &&
    (!q || `${carName(v)} ${v.plate || ''} ${personName(v.driver_id)}`.toLowerCase().includes(q.toLowerCase())))
  const selected = approved.find((v) => v.id === sel)

  if (vehicles === null) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  return (
    <div>
      <div className="page-head">
        <div><h1>GPS وداش كام السيارات</h1><div className="sub">{loadedAt ? `آخر تحديث ${fmtTime(loadedAt)} · يتحدث تلقائياً` : ''}</div></div>
        <div className="row" style={{ gap: 8 }}>
          {!demo && <button className="btn" onClick={() => setDemo(true)}>عرض تجريبي</button>}
          <Link className="btn" to="/fleet/alerts"><Icon name="bell" /> التنبيهات</Link>
        </div>
      </div>
      <DemoBar />
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {!demo && pending > 0 && can('fleet_manage') && <Link to="/fleet/vehicles" className="warn" style={{ marginBottom: 12 }}><Icon name="warn" /> {pending} جهاز جديد اتصل وينتظر تحدد له السيارة والسواق</Link>}

      {!demo && approved.length === 0 ? (
        <div className="card form" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 20 }}>لسه ما فيه سيارة موصولة</h2>
          <p className="sub" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            الصفحة جاهزة. أول ما الداش كام في أول سيارة تتصل، هتظهر هنا على الخريطة، وتوصلك تنبيهات تشغيل المحرك وإيقافه والسرعة الزايدة والتدخين والجوال والنعاس على جرس الإشعارات.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => setDemo(true)}>شوف مثال تجريبي بـ ١٨ سيارة</button>
            {can('fleet_manage') && <Link className="btn" to="/fleet/vehicles">إضافة السيارات</Link>}
          </div>
        </div>
      ) : (<>
        <div className="grid stats" style={{ marginBottom: 14 }}>
          <div className="card stat primary"><div className="label">السيارات</div><div className="value num">{approved.length}</div></div>
          <div className="card stat"><div className="label">تمشي الحين</div><div className="value num" style={{ color: '#1F8A4C' }}>{counts.moving || 0}</div></div>
          <div className="card stat"><div className="label">المحرك شغال وهي واقفة</div><div className="value num" style={{ color: '#D97706' }}>{counts.idle || 0}</div></div>
          <div className="card stat"><div className="label">غير متصلة</div><div className="value num">{(counts.offline || 0) + (counts.never || 0)}</div></div>
          <Link to="/fleet/alerts" className="card stat red" style={{ textDecoration: 'none', color: 'inherit' }}><div className="label">تنبيهات اليوم</div><div className="value num">{todayAlerts.length}</div>{smokingToday ? <div className="sub">منها تدخين: {smokingToday}</div> : null}</Link>
        </div>

        <div className="fleet-split">
          <div className="form" style={{ gap: 14 }}>
            <FleetMap vehicles={approved} selectedId={sel} onSelect={setSel} track={track?.pts} trackEvents={track?.evs} fitKey={demo ? 'demo' : 'live'} height={520} />
            {selected && <CarPanel key={selected.id} v={selected} demo={demo} events={events} personName={personName} onClose={() => { setSel(null); setTrack(null) }} onTrack={onTrack} />}
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="search" style={{ marginBottom: 10 }}><Icon name="search" /><input className="input" placeholder="ابحث بالسيارة أو السواق" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chips" style={{ marginBottom: 8 }}>
              {[['all', 'الكل'], ['moving', 'تمشي'], ['idle', 'شغالة واقفة'], ['parked', 'طافية'], ['off', 'غير متصلة']].map(([k, l]) =>
                <button key={k} className={'chip' + (filter === k ? ' on' : '')} style={{ minHeight: 34, padding: '0 10px', fontSize: 13 }} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            <div className="scroll-list">
              {shown.length === 0 && <div className="empty">ما فيه سيارات</div>}
              {shown.map(({ v, s }) => (
                <button key={v.id} className={'car-row' + (v.id === sel ? ' on' : '')} onClick={() => setSel(v.id === sel ? null : v.id)}>
                  <span className="car-dot" style={{ background: s.color }} />
                  <span className="grow">
                    <div style={{ fontWeight: 600 }}>{carName(v)}</div>
                    <div className="sub">{personName(v.driver_id) || 'بدون سواق'} · {s.label}</div>
                  </span>
                  <span style={{ textAlign: 'end' }}>
                    {s.key === 'moving' && <div className="num" style={{ fontWeight: 600 }}>{Math.round(v.last_speed)} <span className="sub">كم/س</span></div>}
                    <div className="sub">{ago(v.last_at)}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><h2 style={{ fontSize: 18 }}>آخر التنبيهات</h2><Link to="/fleet/alerts" className="sub" style={{ color: 'var(--green)' }}>الكل</Link></div>
          {events.slice(0, 8).map((e) => <AlertRow key={e.id} e={e} car={(vehicles || []).find((v) => v.id === e.vehicle_id)} driver={personName(e.driver_id)} />)}
          {events.length === 0 && <div className="empty">ما فيه تنبيهات للحين</div>}
        </div>
      </>)}
    </div>
  )
}
