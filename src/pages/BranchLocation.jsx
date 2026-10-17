import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { parseCoord, parsePair, validPair, mapLink, distance, currentPosition } from '../lib/geo'
import Icon from '../components/Icon.jsx'

const ST = { pending: ['amber', 'بانتظار موافقة HR'], approved: ['ok', 'انعتمد'], rejected: ['red', 'مرفوض'] }

// Branch manager: stand inside the branch, take the phone's location, send it; HR approves it.
export default function BranchLocation() {
  const { access, can } = useAccess()
  const all = can('manage_branches')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState(access.employee.branch_id || '')
  const [pos, setPos] = useState(null)
  const [manual, setManual] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [mine, setMine] = useState([])

  const load = useCallback(() => {
    supabase.from('branches').select('id,name,latitude,longitude,geofence_radius_m').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
    supabase.from('branch_location_requests').select('*, branches:branch_id(name)').eq('requested_by', access.employee.id).order('created_at', { ascending: false }).limit(10).then(({ data }) => setMine(data || []))
  }, [access.employee.id])
  useEffect(() => { load() }, [load])

  const branch = branches.find((b) => b.id === branchId)
  const here = async () => {
    setMsg(null); setBusy('locate')
    const p = await currentPosition()
    setBusy('')
    if (p.error) { setMsg({ ok: false, t: p.error }); return }
    setPos(p); setManual('')
  }
  const fromManual = (v) => {
    setManual(v)
    const pair = parsePair(v)
    if (pair) setPos({ ...pair, accuracy: null })
    else if (v.trim()) { const n = parseCoord(v); if (Number.isNaN(n)) setPos(null) }
  }
  const send = async () => {
    setMsg(null)
    if (!branchId) { setMsg({ ok: false, t: 'اختار الفرع' }); return }
    if (!pos || !validPair(pos.lat, pos.lng)) { setMsg({ ok: false, t: 'حدد الموقع أول' }); return }
    setBusy('send')
    const { error } = await supabase.from('branch_location_requests').insert({ branch_id: branchId, latitude: pos.lat, longitude: pos.lng, accuracy_m: pos.accuracy, note: note || null })
    setBusy('')
    if (error) { setMsg({ ok: false, t: error.message.includes('row-level') ? 'ما عندك صلاحية ترسل موقع هالفرع' : errMsg(error) }); return }
    setMsg({ ok: true, t: 'انرسل الموقع لـHR. أول ما يوافقون، البصمة تشتغل عليه.' }); setPos(null); setNote(''); load()
  }
  const moved = pos && branch?.latitude ? distance({ lat: branch.latitude, lng: branch.longitude }, pos) : null

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>موقع الفرع</h1><div className="sub">عشان البصمة تعرف إن الموظف داخل الفرع</div></div></div>

      <div className="card form">
        {all ? (
          <div className="field"><label htmlFor="lb">الفرع</label>
            <select id="lb" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        ) : <div><strong>{branch?.name || '—'}</strong></div>}
        {branch && <div className="sub">{branch.latitude ? <>الموقع المعتمد الحين: <a href={mapLink(branch.latitude, branch.longitude)} target="_blank" rel="noreferrer">شوفه على الخريطة</a> · المسافة المسموحة {branch.geofence_radius_m} م</> : 'هالفرع ما له موقع معتمد لين الحين.'}</div>}

        <div className="notice">وقّف داخل الفرع (مو برا ولا في السيارة)، وتأكد إن الـGPS شغال، واضغط الزر.</div>
        <button type="button" className="btn primary block" onClick={here} disabled={!!busy}>
          {busy === 'locate' ? <><span className="spinner" /> جاري تحديد الموقع…</> : <><Icon name="pin" /> أنا داخل الفرع، خذ موقعي</>}</button>
        <div className="field"><label htmlFor="lm">أو الصق الإحداثيات / رابط خرايط جوجل</label>
          <input id="lm" className="input ltr" inputMode="decimal" value={manual} onChange={(e) => fromManual(e.target.value)} placeholder="29.33, 48.00" /></div>

        {pos && validPair(pos.lat, pos.lng) && (
          <div className="card" style={{ background: '#F7F9F5', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="ltr" style={{ textAlign: 'right' }}>{pos.lat}, {pos.lng}</div>
            {pos.accuracy != null && <div className={pos.accuracy > 60 ? 'warn' : 'sub'}>دقة الموقع: ±{pos.accuracy} متر{pos.accuracy > 60 ? '. الدقة ضعيفة، اطلع لمكان مفتوح داخل الفرع واضغط الزر مرة ثانية.' : ''}</div>}
            {moved != null && <div className="sub">يبعد {moved} متر عن الموقع المعتمد الحين</div>}
            <a className="btn" href={mapLink(pos.lat, pos.lng)} target="_blank" rel="noreferrer"><Icon name="pin" /> تأكد على الخريطة</a>
            <input className="input" placeholder="ملاحظة لـHR (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn primary block" disabled={!!busy} onClick={send}>{busy === 'send' ? <span className="spinner" /> : <Icon name="check" />} أرسل للموافقة</button>
          </div>)}
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}
      </div>

      {mine.length > 0 && (
        <section><h2 style={{ fontSize: 17, marginBottom: 8 }}>طلباتي</h2>
          <div className="card list" style={{ padding: '4px 14px' }}>
            {mine.map((r) => <div key={r.id} className="list-item">
              <span className="grow">{r.branches?.name}<div className="sub">{fmtDate(r.created_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}</div></span>
              <span className={'pill ' + ST[r.status][0]}>{ST[r.status][1]}</span></div>)}
          </div></section>)}
    </div>
  )
}
