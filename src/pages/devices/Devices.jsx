import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, fmtDate, fmtTime, errMsg } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import Icon from '../../components/Icon.jsx'

export const KIOSK_KEY = 'locarb_kiosk_token'

// a device asks the server for work every few seconds; quiet for 3 minutes means it's off or offline
export const isOnline = (d) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 3 * 60000

export const ago = (ts) => {
  if (!ts) return 'ما اتصل أبداً'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'الحين'
  if (m < 60) return `قبل ${m} دقيقة`
  if (m < 1440) return `قبل ${Math.round(m / 60)} ساعة`
  return `${fmtDate(ts)} ${fmtTime(ts)}`
}

function DoorButton({ device }) {
  const [state, setState] = useState(null) // sending | ok | failed | timeout | error text
  const open = async () => {
    if (!window.confirm(`تفتح باب ${device.name || 'الجهاز'}؟`)) return
    setState('sending')
    const { data, error } = await supabase.rpc('open_door', { p_device: device.id })
    if (error) { setState(errMsg(error)); return }
    const started = Date.now()
    const poll = async () => {
      const { data: c } = await supabase.from('bio_commands').select('status').eq('id', data.id).single()
      if (c?.status === 'ok') return setState('ok')
      if (c?.status === 'failed') return setState('failed')
      if (c?.status === 'expired' || Date.now() - started > 40000) return setState('timeout')
      setTimeout(poll, 1500)
    }
    setTimeout(poll, 1500)
  }
  const label = { sending: 'جاري الفتح…', ok: 'انفتح الباب ✓', failed: 'الجهاز رفض الأمر', timeout: 'الجهاز ما رد. تأكد إنه متصل' }
  return (
    <div className="form" style={{ gap: 6 }}>
      <button className="btn primary" style={{ minHeight: 48 }} disabled={state === 'sending'} onClick={open}>
        {state === 'sending' ? <span className="spinner" /> : <Icon name="door" />} فتح الباب
      </button>
      {state && state !== 'sending' && <div className={state === 'ok' ? 'notice' : 'error'} style={{ padding: '6px 10px' }}>{label[state] || state}</div>}
    </div>
  )
}

function DeviceSettings({ device, branches, onClose, onSaved }) {
  const [f, setF] = useState({ name: device.name || '', branch_id: device.branch_id || '', has_door: device.has_door, door_seconds: device.door_seconds })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    let error
    if (!device.approved) ({ error } = await supabase.rpc('approve_device', { p_device: device.id, p_branch: f.branch_id, p_name: f.name }))
    if (!error) ({ error } = await supabase.from('bio_devices').update({ name: f.name.trim() || null, branch_id: f.branch_id, has_door: f.has_door, door_seconds: Number(f.door_seconds) || 5 }).eq('id', device.id))
    setBusy(false)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{device.approved ? 'إعدادات الجهاز' : 'اعتماد جهاز جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="sub">الرقم التسلسلي: <span className="num">{device.serial}</span>{device.last_ip ? <> · IP <span className="num">{device.last_ip}</span></> : null}</div>
        {!device.approved && <div className="warn">بعد الاعتماد، البصمات الجديدة من هذا الجهاز تنحسب في الحضور. البصمات القديمة اللي كانت عليه ما تنحسب.</div>}
        <div className="field"><label htmlFor="dn">اسم الجهاز</label><input id="dn" className="input" placeholder="مثلاً: باب المطبخ" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="db">الفرع</label>
          <select id="db" className="input" value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })} required>
            <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <label className="check"><input type="checkbox" checked={f.has_door} onChange={(e) => setF({ ...f, has_door: e.target.checked })} /> الجهاز موصول بقفل باب</label>
        {f.has_door && <div className="field"><label htmlFor="ds">الباب يظل مفتوح (ثانية)</label>
          <input id="ds" type="number" min="1" max="60" className="input" value={f.door_seconds} onChange={(e) => setF({ ...f, door_seconds: e.target.value })} /></div>}
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : null} {device.approved ? 'حفظ' : 'اعتماد الجهاز'}</button>
      </form>
    </div>
  )
}

function KioskSetup({ branches, onClose }) {
  const nav = useNavigate()
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0].id : '')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const go = async (e) => {
    e.preventDefault(); setErr('')
    const { data, error } = await supabase.rpc('enable_kiosk', { p_branch: branch, p_name: name || null })
    if (error) { setErr(errMsg(error)); return }
    try { localStorage.setItem(KIOSK_KEY, data) } catch { setErr('المتصفح ما سمح بالحفظ. جرّب من Safari عادي مو الخاص.'); return }
    await supabase.auth.signOut()
    nav('/kiosk', { replace: true })
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={go}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>تحويل هذا الجهاز لآيباد بصمة</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="warn">سوّ هذي الخطوة من الآيباد أو الآيفون اللي بيظل في الفرع، مو من جوالك. حسابك بيطلع منه، والجهاز يصير يفتح على صفحة الحضور والانصراف بس.</div>
        <div className="field"><label htmlFor="kb">الفرع</label>
          <select id="kb" className="input" value={branch} onChange={(e) => setBranch(e.target.value)} required>
            <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="kn">اسم الجهاز (اختياري)</label><input id="kn" className="input" placeholder="مثلاً: آيباد الكاشير" value={name} onChange={(e) => setName(e.target.value)} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">تفعيل وفتح صفحة البصمة</button>
      </form>
    </div>
  )
}

export default function Devices() {
  const { can } = useAccess()
  const canManage = can('manage_devices')
  const [devices, setDevices] = useState(null)
  const [kiosks, setKiosks] = useState([])
  const [branches, setBranches] = useState([])
  const [lastPunch, setLastPunch] = useState({})
  const [editing, setEditing] = useState(null)
  const [kioskSetup, setKioskSetup] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    const { data } = await supabase.from('bio_devices').select('*').order('created_at')
    setDevices(data || [])
    supabase.from('kiosk_devices').select('*').order('created_at').then(({ data: k }) => setKiosks(k || []))
    const lp = {}
    await Promise.all((data || []).filter((d) => d.approved).map((d) =>
      supabase.from('bio_punches').select('punched_at').eq('device_id', d.id).order('punched_at', { ascending: false }).limit(1)
        .then(({ data: p }) => { lp[d.id] = p?.[0]?.punched_at })))
    setLastPunch(lp)
  }, [])
  useEffect(() => {
    load()
    supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || []))
    const t = setInterval(() => { load(); tick((x) => x + 1) }, 30000)
    return () => clearInterval(t)
  }, [load])

  const bName = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const pending = (devices || []).filter((d) => !d.approved)
  const approved = (devices || []).filter((d) => d.approved)

  const [codesMsg, setCodesMsg] = useState('')
  // make a code for everyone who doesn't have one, then download the list to hand out
  const codes = async () => {
    setCodesMsg('')
    const { data: n, error } = await supabase.rpc('fill_kiosk_codes')
    if (error) { setCodesMsg(errMsg(error)); return }
    const { data: list } = await supabase.from('kiosk_codes').select('code, employees(full_name, phone, branch_id, active)')
    const rows = (list || []).filter((r) => r.employees?.active).sort((a, b) => (bName[a.employees.branch_id] || '').localeCompare(bName[b.employees.branch_id] || '') || a.employees.full_name.localeCompare(b.employees.full_name))
    const csv = '\ufeff' + [['الفرع', 'الموظف', 'رقم الجوال', 'الكود'], ...rows.map((r) => [bName[r.employees.branch_id] || '', r.employees.full_name, r.employees.phone || '', r.code])]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'kiosk_codes.csv'; a.click()
    setCodesMsg(n > 0 ? `انعمل كود لـ ${n} موظف، ونزل ملف الأكواد.` : 'نزل ملف الأكواد.')
  }

  const toggleKiosk = async (k) => {
    if (k.active && !window.confirm('توقف هذا الآيباد؟ ما بيقدر أحد يبصم منه لين تفعّل جهاز جديد.')) return
    await supabase.from('kiosk_devices').update({ active: !k.active }).eq('id', k.id)
    load()
  }

  if (devices === null) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  return (
    <div>
      <div className="page-head">
        <div><h1>الأجهزة والأبواب</h1><div className="sub">أجهزة البصمة في الفروع وآيبادات الحضور</div></div>
        <Link to="/devices/log" className="btn"><Icon name="list" /> سجل الأبواب والأوامر</Link>
      </div>

      {canManage && pending.length > 0 && (
        <section className="card form" style={{ marginBottom: 16, borderColor: '#F3DDA8', background: '#FFFBEB' }}>
          <strong>أجهزة جديدة اتصلت وتنتظر اعتمادك</strong>
          {pending.map((d) => (
            <div key={d.id} className="row" style={{ flexWrap: 'wrap' }}>
              <span className="avatar"><Icon name="finger" /></span>
              <div className="grow"><div className="num" style={{ fontWeight: 600 }}>{d.serial}</div>
                <div className="sub">{d.info?.DeviceType || 'ZKTeco'} · أول اتصال {ago(d.created_at)}{d.last_ip ? ` · ${d.last_ip}` : ''}</div></div>
              <button className="btn primary" onClick={() => setEditing(d)}>اعتماد</button>
            </div>
          ))}
        </section>
      )}

      <h2 style={{ fontSize: 17, margin: '4px 0 10px' }}>أجهزة البصمة</h2>
      {approved.length === 0 ? (
        <div className="card empty">
          ما فيه أجهزة متصلة للحين.<br />أول ما تضبط عنوان السيرفر في الجهاز، بيظهر هنا وتعتمده.
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginBottom: 24 }}>
          {approved.map((d) => {
            const on = isOnline(d)
            return (
              <div key={d.id} className="card form" style={{ gap: 12 }}>
                <div className="row">
                  <span className="avatar" style={{ background: on ? 'var(--ok-bg)' : '#EEF1EC', color: on ? 'var(--ok)' : 'var(--muted)' }}><Icon name="finger" /></span>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{d.name || d.serial}</div><div className="sub">{bName[d.branch_id] || '—'}</div></div>
                  <span className={'pill ' + (on ? 'ok' : 'red')}>{on ? 'متصل' : 'غير متصل'}</span>
                </div>
                <div className="sub" style={{ lineHeight: 1.8 }}>
                  آخر اتصال: {ago(d.last_seen_at)}<br />
                  آخر بصمة: {lastPunch[d.id] ? `${fmtDate(lastPunch[d.id])} ${fmtTime(lastPunch[d.id])}` : '—'}
                </div>
                {d.has_door && can('open_doors') && <DoorButton device={d} />}
                {canManage && (
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <Link to={`/devices/${d.id}/names`} className="btn"><Icon name="users" /> الأسماء</Link>
                    <button className="btn" onClick={() => setEditing(d)}><Icon name="gear" /> الإعدادات</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(canManage || kiosks.length > 0) && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', margin: '4px 0 10px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 17 }}>آيبادات الحضور في الفروع</h2>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {can('manage_employees') && <button className="btn" onClick={codes}>أكواد الموظفين (Excel)</button>}
              {canManage && <button className="btn" onClick={() => setKioskSetup(true)}><Icon name="plus" /> اجعل هذا الجهاز آيباد بصمة</button>}
            </div>
          </div>
          {codesMsg && <div className="notice" style={{ marginBottom: 10 }}>{codesMsg}</div>}
          {kiosks.length === 0 ? <div className="card empty">ما فيه آيبادات مفعّلة. افتح النظام من آيباد الفرع واضغط الزر فوق.</div> : (
            <div className="card list">
              {kiosks.map((k) => (
                <div key={k.id} className="list-item">
                  <span className="avatar"><Icon name="tablet" /></span>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{k.name || 'آيباد الفرع'} · {bName[k.branch_id]}</div>
                    <div className="sub">آخر استخدام: {k.last_seen_at ? ago(k.last_seen_at) : 'ما استُخدم للحين'}</div></div>
                  {k.active ? <span className="pill ok">مفعّل</span> : <span className="pill gray">موقوف</span>}
                  {canManage && <button className={'btn' + (k.active ? ' danger' : '')} style={{ minHeight: 36 }} onClick={() => toggleKiosk(k)}>{k.active ? 'إيقاف' : 'تفعيل'}</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editing && <DeviceSettings device={editing} branches={branches} onClose={() => setEditing(null)} onSaved={load} />}
      {kioskSetup && <KioskSetup branches={branches} onClose={() => setKioskSetup(false)} />}
    </div>
  )
}
