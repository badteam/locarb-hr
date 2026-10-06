import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import Icon from '../components/Icon.jsx'

function BranchForm({ branch, onClose, onSaved }) {
  const [f, setF] = useState({
    name: branch?.name || '', is_central_kitchen: branch?.is_central_kitchen || false,
    latitude: branch?.latitude ?? '', longitude: branch?.longitude ?? '', geofence_radius_m: branch?.geofence_radius_m || 150, active: branch?.active ?? true,
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const useHere = () => navigator.geolocation?.getCurrentPosition(
    (p) => setF((x) => ({ ...x, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })),
    () => setErr('ما قدرنا ناخذ موقعك. اسمح للمتصفح بالموقع.'), { enableHighAccuracy: true })

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const row = { ...f, latitude: f.latitude === '' ? null : Number(f.latitude), longitude: f.longitude === '' ? null : Number(f.longitude), geofence_radius_m: Number(f.geofence_radius_m) || 150 }
    const { error } = branch ? await supabase.from('branches').update(row).eq('id', branch.id) : await supabase.from('branches').insert(row)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{branch ? branch.name : 'فرع جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="bn">اسم الفرع</label><input id="bn" className="input" value={f.name} onChange={set('name')} required /></div>
        <label className="check"><input type="checkbox" checked={f.is_central_kitchen} onChange={set('is_central_kitchen')} /> هذا المطبخ المركزي</label>
        <div className="card form" style={{ gap: 10 }}>
          <strong style={{ fontSize: 14 }}>موقع الفرع (للتأكد إن الموظف داخل الفرع)</strong>
          <div className="sub">أسهل طريقة: افتح هالصفحة من جوالك وأنت داخل الفرع واضغط "استخدم موقعي الحالي".</div>
          <button type="button" className="btn" onClick={useHere}><Icon name="pin" /> استخدم موقعي الحالي</button>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <input className="input ltr" placeholder="Latitude" value={f.latitude} onChange={set('latitude')} />
            <input className="input ltr" placeholder="Longitude" value={f.longitude} onChange={set('longitude')} />
          </div>
          <div className="field"><label htmlFor="rad">المسافة المسموحة (متر)</label><input id="rad" type="number" className="input" value={f.geofence_radius_m} onChange={set('geofence_radius_m')} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> الفرع شغال</label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>حفظ</button>
      </form>
    </div>
  )
}

function ShiftForm({ shift, onClose, onSaved }) {
  const [f, setF] = useState({ name: shift?.name || '', start_time: shift?.start_time?.slice(0, 5) || '08:00', end_time: shift?.end_time?.slice(0, 5) || '16:00', grace_minutes: shift?.grace_minutes ?? 10 })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    const row = { ...f, grace_minutes: Number(f.grace_minutes) || 0 }
    const { error } = shift ? await supabase.from('shifts').update(row).eq('id', shift.id) : await supabase.from('shifts').insert(row)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{shift ? shift.name : 'شفت جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="sn">اسم الشفت</label><input id="sn" className="input" placeholder="صباحي، مسائي…" value={f.name} onChange={set('name')} required /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="st">يبدأ</label><input id="st" type="time" className="input" value={f.start_time} onChange={set('start_time')} /></div>
          <div className="field"><label htmlFor="et">ينتهي</label><input id="et" type="time" className="input" value={f.end_time} onChange={set('end_time')} /></div>
        </div>
        <div className="field"><label htmlFor="g">سماحية التأخير (دقايق)</label><input id="g" type="number" className="input" value={f.grace_minutes} onChange={set('grace_minutes')} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

export default function Branches() {
  const [branches, setBranches] = useState([])
  const [shifts, setShifts] = useState([])
  const [eb, setEb] = useState(undefined)
  const [es, setEs] = useState(undefined)
  const load = useCallback(() => {
    supabase.from('branches').select('*').order('is_central_kitchen', { ascending: false }).order('name').then(({ data }) => setBranches(data || []))
    supabase.from('shifts').select('*').order('start_time').then(({ data }) => setShifts(data || []))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <div className="page-head"><h1>الفروع</h1><button className="btn primary" onClick={() => setEb(null)}><Icon name="plus" /> فرع جديد</button></div>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {branches.map((b) => (
            <button key={b.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => setEb(b)}>
              <span className="avatar"><Icon name="branch" /></span>
              <span className="grow"><div style={{ fontWeight: 600 }}>{b.name}</div>
                <div className="sub">{b.is_central_kitchen ? 'المطبخ المركزي · ' : ''}{b.latitude ? `الموقع محدد · ${b.geofence_radius_m} م` : 'الموقع مو محدد'}</div></span>
              {!b.active && <span className="pill gray">مقفل</span>}
              {!b.latitude && b.active && <span className="pill amber">حدد الموقع</span>}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="page-head"><h2 style={{ fontSize: 20 }}>الشفتات</h2><button className="btn" onClick={() => setEs(null)}><Icon name="plus" /> شفت جديد</button></div>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {shifts.length === 0 && <div className="empty">ما فيه شفتات. أضف الشفتات عشان النظام يحسب التأخير.</div>}
          {shifts.map((s) => (
            <button key={s.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => setEs(s)}>
              <span className="grow"><div style={{ fontWeight: 600 }}>{s.name}</div><div className="sub ltr" style={{ textAlign: 'right' }}>{s.start_time.slice(0, 5)} — {s.end_time.slice(0, 5)} · سماحية {s.grace_minutes} د</div></span>
            </button>
          ))}
        </div>
      </section>
      {eb !== undefined && <BranchForm branch={eb} onClose={() => setEb(undefined)} onSaved={load} />}
      {es !== undefined && <ShiftForm shift={es} onClose={() => setEs(undefined)} onSaved={load} />}
    </div>
  )
}
