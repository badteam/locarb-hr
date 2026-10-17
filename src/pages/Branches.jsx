import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { parseCoord, parsePair, validPair, mapLink, distance, currentPosition } from '../lib/geo'
import Icon from '../components/Icon.jsx'

function BranchForm({ branch, pinSet, onClose, onSaved }) {
  const [kioskPw, setKioskPw] = useState('')
  const [f, setF] = useState({
    name: branch?.name || '', name_en: branch?.name_en || '', is_central_kitchen: branch?.is_central_kitchen || false,
    latitude: branch?.latitude ?? '', longitude: branch?.longitude ?? '', geofence_radius_m: branch?.geofence_radius_m || 150, active: branch?.active ?? true,
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const [locating, setLocating] = useState(false)
  const [acc, setAcc] = useState(null)
  const useHere = async () => {
    setErr(''); setLocating(true)
    const p = await currentPosition()
    setLocating(false)
    if (p.error) { setErr(p.error); return }
    setAcc(p.accuracy)
    setF((x) => ({ ...x, latitude: String(p.lat), longitude: String(p.lng) }))
  }
  // pasting "lat, lng" or a Google Maps link into either box fills both
  const pasteCoords = (k) => (e) => {
    const v = e.target.value
    const pair = parsePair(v)
    if (pair && /[,\s/]/.test(v.trim())) { setF((x) => ({ ...x, latitude: String(pair.lat), longitude: String(pair.lng) })); setAcc(null); return }
    setF((x) => ({ ...x, [k]: v }))
  }
  const lat = parseCoord(f.latitude), lng = parseCoord(f.longitude)

  const save = async (e) => {
    e.preventDefault(); setErr('')
    if ((lat === null) !== (lng === null)) { setErr('لازم تكتب الإحداثيتين مع بعض، أو تخليهم فاضيين.'); return }
    if (lat !== null && !validPair(lat, lng)) { setErr('الإحداثيات مو صحيحة. انسخها من خرايط جوجل أو اضغط "استخدم موقعي الحالي".'); return }
    setBusy(true)
    const row = { ...f, name: f.name.trim(), name_en: f.name_en.trim() || null, latitude: lat, longitude: lng, geofence_radius_m: Number(parseCoord(f.geofence_radius_m)) || 150 }
    const { data: saved, error } = branch ? await supabase.from('branches').update(row).eq('id', branch.id).select('id').single() : await supabase.from('branches').insert(row).select('id').single()
    if (error) { setErr(errMsg(error)); setBusy(false); return }
    if (kioskPw.trim()) {
      if (kioskPw.trim().length < 4) { setErr('الرقم السري لصفحة البصمة لازم ٤ أرقام أو أكثر'); setBusy(false); return }
      const { error: e2 } = await supabase.rpc('set_branch_kiosk_password', { p_branch: saved.id, p_password: kioskPw.trim() })
      if (e2) { setErr(errMsg(e2)); setBusy(false); return }
    }
    onSaved(); onClose()
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{branch ? branch.name : 'فرع جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="bn">اسم الفرع بالعربي</label><input id="bn" className="input" value={f.name} onChange={set('name')} required /></div>
        <div className="field"><label htmlFor="bne">اسم الفرع بالإنجليزي</label><input id="bne" className="input ltr" style={{ textAlign: 'left' }} value={f.name_en} onChange={set('name_en')} /></div>
        <label className="check"><input type="checkbox" checked={f.is_central_kitchen} onChange={set('is_central_kitchen')} /> هذا المطبخ المركزي</label>
        <div className="card form" style={{ gap: 10 }}>
          <strong style={{ fontSize: 14 }}>موقع الفرع (للتأكد إن الموظف داخل الفرع)</strong>
          <div className="sub">أسهل طريقة: افتح هالصفحة من جوالك وأنت داخل الفرع واضغط "استخدم موقعي الحالي".</div>
          <button type="button" className="btn" onClick={useHere} disabled={locating}>{locating ? <><span className="spinner" /> جاري تحديد الموقع…</> : <><Icon name="pin" /> استخدم موقعي الحالي</>}</button>
          <div className="sub">أو الصق الإحداثيات أو رابط خرايط جوجل في أي خانة.</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <input className="input ltr" inputMode="decimal" placeholder="Latitude (مثل 29.3375)" aria-label="Latitude" value={f.latitude} onChange={pasteCoords('latitude')} style={Number.isNaN(lat) ? { borderColor: 'var(--red)' } : null} />
            <input className="input ltr" inputMode="decimal" placeholder="Longitude (مثل 48.0012)" aria-label="Longitude" value={f.longitude} onChange={pasteCoords('longitude')} style={Number.isNaN(lng) ? { borderColor: 'var(--red)' } : null} />
          </div>
          {acc != null && <div className={acc > 60 ? 'warn' : 'sub'}>دقة الموقع: ±{acc} متر{acc > 60 ? '. الدقة ضعيفة، اطلع لمكان مفتوح داخل الفرع وجرّب مرة ثانية. الكمبيوتر يعطي موقع تقريبي، استخدم الجوال.' : ''}</div>}
          {validPair(lat, lng) && <a className="btn" href={mapLink(lat, lng)} target="_blank" rel="noreferrer"><Icon name="pin" /> شوف الموقع على الخريطة</a>}
          <div className="field"><label htmlFor="rad">المسافة المسموحة (متر)</label><input id="rad" type="number" inputMode="numeric" className="input" value={f.geofence_radius_m} onChange={set('geofence_radius_m')} /></div>
        </div>
        <div className="card form" style={{ gap: 8 }}>
          <strong style={{ fontSize: 14 }}>صفحة البصمة في الفرع (آيباد أو جوال الفرع)</strong>
          <div className="sub">افتح الرابط على جهاز الفرع، اختار الفرع واكتب الرقم السري. الجهاز بعدها يطلع صفحة البصمة بس، والموظف يبصم برقم جواله والكود حقه.</div>
          <div className="sub ltr" style={{ textAlign: 'right', userSelect: 'all' }}>{window.location.origin + import.meta.env.BASE_URL}kiosk</div>
          <div className="field"><label htmlFor="kpw">{pinSet ? 'تغيير الرقم السري (محطوط)' : 'الرقم السري لصفحة البصمة'}</label>
            <input id="kpw" className="input ltr" inputMode="numeric" autoComplete="off" placeholder={pinSet ? '••••' : 'مثلاً 4821'} value={kioskPw} onChange={(e) => setKioskPw(e.target.value)} /></div>
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

function LocationRequests({ branches, onDone }) {
  const [reqs, setReqs] = useState([])
  const [note, setNote] = useState({})
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => {
    supabase.from('branch_location_requests').select('*, employees:requested_by(full_name)').eq('status', 'pending').order('created_at', { ascending: false }).then(({ data }) => setReqs(data || []))
  }, [])
  useEffect(() => { load() }, [load])
  const decide = async (r, ok) => {
    setMsg(null)
    const { error } = await supabase.rpc('decide_branch_location', { p_id: r.id, p_approve: ok, p_note: note[r.id] || null })
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    setMsg({ ok: true, t: ok ? 'تم اعتماد الموقع والبصمة بتشتغل عليه من الحين' : 'تم رفض الموقع' }); load(); onDone()
  }
  if (!reqs.length) return msg ? <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div> : null
  const bmap = Object.fromEntries(branches.map((b) => [b.id, b]))
  return (
    <section>
      <h2 style={{ fontSize: 18, marginBottom: 10 }}>مواقع فروع تنتظر موافقتك <span className="badge">{reqs.length}</span></h2>
      {msg && <div className={msg.ok ? 'notice' : 'error'} style={{ marginBottom: 8 }}>{msg.t}</div>}
      <div className="card list" style={{ padding: '4px 14px' }}>
        {reqs.map((r) => {
          const b = bmap[r.branch_id]
          const moved = b?.latitude ? distance({ lat: b.latitude, lng: b.longitude }, { lat: r.latitude, lng: r.longitude }) : null
          return (
            <div key={r.id} className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>{b?.name} · أرسله {r.employees?.full_name || '—'}</div>
                <div className="sub">{fmtDate(r.created_at)}{r.accuracy_m != null ? ` · دقة ±${r.accuracy_m} م` : ''}{moved != null ? ` · يبعد ${moved} م عن الموقع الحالي` : ' · الفرع ما له موقع لين الحين'}</div>
                {r.accuracy_m > 60 && <div className="sub" style={{ color: 'var(--amber)' }}>الدقة ضعيفة، ممكن الموقع مو مضبوط</div>}
                {r.note && <div className="sub">ملاحظة: {r.note}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <a className="btn" style={{ minHeight: 36 }} href={mapLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer"><Icon name="pin" /> شوفه على الخريطة</a>
                <input className="input" style={{ height: 38, width: 200 }} placeholder="ملاحظة (اختياري)" value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary" style={{ minHeight: 38 }} onClick={() => decide(r, true)}>اعتماد</button>
                  <button className="btn danger" style={{ minHeight: 38 }} onClick={() => decide(r, false)}>رفض</button>
                </div>
              </div>
            </div>)
        })}
      </div>
    </section>
  )
}

export default function Branches() {
  const [branches, setBranches] = useState([])
  const [shifts, setShifts] = useState([])
  const [eb, setEb] = useState(undefined)
  const [es, setEs] = useState(undefined)
  const [pins, setPins] = useState({})
  const load = useCallback(() => {
    supabase.rpc('kiosk_password_status').then(({ data }) => setPins(data || {}))
    supabase.from('branches').select('*').order('is_central_kitchen', { ascending: false }).order('name').then(({ data }) => setBranches(data || []))
    supabase.from('shifts').select('*').order('start_time').then(({ data }) => setShifts(data || []))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <LocationRequests branches={branches} onDone={load} />
      <section>
        <div className="page-head"><h1>الفروع</h1><button className="btn primary" onClick={() => setEb(null)}><Icon name="plus" /> فرع جديد</button></div>
        <div className="card list" style={{ padding: '4px 14px' }}>
          {branches.map((b) => (
            <button key={b.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => setEb(b)}>
              <span className="avatar"><Icon name="branch" /></span>
              <span className="grow"><div style={{ fontWeight: 600 }}>{b.name}{b.name_en && <span className="sub ltr" style={{ fontWeight: 400 }}> · {b.name_en}</span>}</div>
                <div className="sub">{b.is_central_kitchen ? 'المطبخ المركزي · ' : ''}{b.latitude ? `الموقع محدد · ${b.geofence_radius_m} م` : 'الموقع مو محدد'}</div></span>
              {!b.active && <span className="pill gray">مقفل</span>}
              {!b.latitude && b.active && <span className="pill amber">حدد الموقع</span>}
              {b.latitude && b.active && branches.some((o) => o.id !== b.id && o.active && o.latitude === b.latitude && o.longitude === b.longitude) && <span className="pill red">نفس موقع فرع ثاني</span>}
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
      {eb !== undefined && <BranchForm branch={eb} pinSet={!!(eb && pins[eb.id])} onClose={() => setEb(undefined)} onSaved={load} />}
      {es !== undefined && <ShiftForm shift={es} onClose={() => setEs(undefined)} onSaved={load} />}
    </div>
  )
}
