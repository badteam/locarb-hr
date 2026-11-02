import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import Icon from '../../components/Icon.jsx'
import { useFleet } from './useFleet'
import { KINDS, GROUPS, statusOf, ago, carName } from './fleetLib'
import { DemoBar } from './Fleet.jsx'

function CarForm({ v, people, branches, onClose, onSaved }) {
  const isNew = !v.id
  const [f, setF] = useState({
    device_id: v.device_id || '', name: v.name || '', plate: v.plate || '', driver_id: v.driver_id || '',
    branch_id: v.branch_id || '', speed_limit: v.speed_limit || 100, notes: v.notes || '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const drivers = people.filter((p) => p.is_driver)
  const others = people.filter((p) => !p.is_driver)

  const save = async (e) => {
    e.preventDefault(); setErr('')
    if (!f.name.trim()) { setErr('اكتب اسم للسيارة، مثلاً: سيارة 1'); return }
    if (!f.device_id.trim()) { setErr('اكتب رقم الجهاز (مكتوب على ملصق الكاميرا أو في تطبيق Howen itool)'); return }
    setBusy(true)
    const row = {
      device_id: f.device_id.trim(), name: f.name.trim(), plate: f.plate.trim() || null, driver_id: f.driver_id || null,
      branch_id: f.branch_id || null, speed_limit: Math.min(200, Math.max(20, Number(f.speed_limit) || 100)), notes: f.notes.trim() || null, approved: true,
    }
    const { error } = isNew ? await supabase.from('fleet_vehicles').insert(row) : await supabase.from('fleet_vehicles').update(row).eq('id', v.id)
    setBusy(false)
    if (error) setErr(error.message.includes('duplicate') ? 'هذا الجهاز مسجل على سيارة ثانية' : errMsg(error))
    else { onSaved(); onClose() }
  }
  const remove = async () => {
    if (!window.confirm(`تحذف ${carName(v)}؟ مسارها وتنبيهاتها القديمة بتنحذف معها.`)) return
    const { error } = await supabase.from('fleet_vehicles').delete().eq('id', v.id)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{isNew ? 'إضافة سيارة' : v.approved ? 'تعديل السيارة' : 'جهاز جديد اتصل'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        {!isNew && !v.approved && <div className="warn">هذا الجهاز بدأ يرسل موقعه. حدد اسم السيارة والسواق عشان تبدأ تنبيهاته.</div>}
        <div className="field"><label htmlFor="cn">اسم السيارة</label><input id="cn" className="input" placeholder="مثلاً: سيارة 1" value={f.name} onChange={set('name')} /></div>
        <div className="field"><label htmlFor="cp">رقم اللوحة (اختياري)</label><input id="cp" className="input" value={f.plate} onChange={set('plate')} /></div>
        <div className="field"><label htmlFor="cd">السواق</label>
          <select id="cd" className="input" value={f.driver_id} onChange={set('driver_id')}>
            <option value="">بدون سواق محدد</option>
            {drivers.length > 0 && <optgroup label="السواقين">{drivers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>}
            <optgroup label="باقي الموظفين">{others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</optgroup>
          </select></div>
        <div className="field"><label htmlFor="cb">الفرع (اختياري)</label>
          <select id="cb" className="input" value={f.branch_id} onChange={set('branch_id')}>
            <option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="cs">تنبيه السرعة فوق (كم/س)</label><input id="cs" type="number" min="20" max="200" className="input" value={f.speed_limit} onChange={set('speed_limit')} /></div>
        <div className="field"><label htmlFor="ci">رقم الجهاز</label><input id="ci" className="input num" style={{ textAlign: 'start' }} value={f.device_id} onChange={set('device_id')} disabled={!isNew} />
          {isNew && <span className="sub">مكتوب على ملصق الكاميرا أو في تطبيق Howen itool. لو تركت السيارة تتصل أول، بتظهر هنا لحالها.</span>}</div>
        <div className="field"><label htmlFor="cnt">ملاحظات (اختياري)</label><input id="cnt" className="input" value={f.notes} onChange={set('notes')} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : null} {!isNew && !v.approved ? 'اعتماد السيارة' : 'حفظ'}</button>
        {!isNew && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> حذف السيارة</button>}
      </form>
    </div>
  )
}

function AlertSettings() {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { supabase.from('fleet_settings').select('*').eq('id', 1).single().then(({ data }) => setS(data)) }, [])
  if (!s) return null
  const toggle = (k) => setS({ ...s, notify_kinds: s.notify_kinds.includes(k) ? s.notify_kinds.filter((x) => x !== k) : [...s.notify_kinds, k] })
  const save = async () => {
    const { error } = await supabase.from('fleet_settings').update({ notify_kinds: s.notify_kinds, keep_days: Number(s.keep_days) || 60, updated_at: new Date().toISOString() }).eq('id', 1)
    setMsg(error ? errMsg(error) : 'تم الحفظ'); setTimeout(() => setMsg(''), 2500)
  }
  return (
    <div className="card form" style={{ gap: 12 }}>
      <h2 style={{ fontSize: 18 }}>أي تنبيهات توصلك على الجرس؟</h2>
      <div className="sub">كل التنبيهات تنحفظ في صفحة التنبيهات. اللي تختاره هنا يوصلك كمان إشعار على جرس البورتال.</div>
      {GROUPS.map((g) => (
        <div key={g.key}><b style={{ fontSize: 14 }}>{g.label}</b>
          <div className="chips" style={{ marginTop: 6 }}>
            {Object.entries(KINDS).filter(([, x]) => x.group === g.key).map(([k, x]) =>
              <button key={k} type="button" className={'chip' + (s.notify_kinds.includes(k) ? ' on' : '')} onClick={() => toggle(k)}>{s.notify_kinds.includes(k) ? '✓ ' : ''}{x.label}</button>)}
          </div></div>))}
      <div className="field" style={{ maxWidth: 260 }}><label htmlFor="kd">احفظ مسار السيارات لمدة (يوم)</label><input id="kd" type="number" min="7" max="365" className="input" value={s.keep_days} onChange={(e) => setS({ ...s, keep_days: e.target.value })} /></div>
      <div className="row"><button className="btn primary" onClick={save}>حفظ الإعدادات</button>{msg && <span className="sub">{msg}</span>}</div>
    </div>
  )
}

export default function FleetVehicles() {
  const { can } = useAccess()
  const manage = can('fleet_manage')
  const { demo, vehicles, people, personName, reload } = useFleet()
  const [branches, setBranches] = useState([])
  const [edit, setEdit] = useState(null)
  useEffect(() => { supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || [])) }, [])

  const pending = (vehicles || []).filter((v) => !v.approved)
  const cars = (vehicles || []).filter((v) => v.approved)
  return (
    <div>
      <div className="page-head"><h1>السيارات والأجهزة</h1>
        {manage && !demo && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" /> إضافة سيارة</button>}</div>
      <DemoBar />

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: '#F3DDA8' }}>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>أجهزة جديدة اتصلت ({pending.length})</h2>
          {pending.map((v) => (
            <div key={v.id} className="list-item">
              <span className="grow"><b className="num">{v.device_id}</b><div className="sub">آخر اتصال {ago(v.last_at)}</div></span>
              {manage && <button className="btn primary" onClick={() => setEdit(v)}>حدد السيارة</button>}
            </div>))}
        </div>)}

      <div className="card table-wrap" style={{ marginBottom: 16 }}>
        {vehicles === null ? <div className="empty"><span className="spinner" /></div> : cars.length === 0 ? (
          <div className="empty">ما فيه سيارات للحين. {manage ? 'اضغط «إضافة سيارة»، أو خلّ الكاميرا تتصل وبتظهر فوق لحالها.' : ''}</div>
        ) : (
          <table>
            <thead><tr><th>السيارة</th><th>السواق</th><th>الحالة</th><th>آخر اتصال</th><th>حد السرعة</th><th>رقم الجهاز</th>{manage && !demo && <th />}</tr></thead>
            <tbody>{cars.map((v) => { const s = statusOf(v); return (
              <tr key={v.id}>
                <td><b>{carName(v)}</b>{v.plate ? <div className="cell-sub num">{v.plate}</div> : null}</td>
                <td>{personName(v.driver_id) || <span className="sub">—</span>}</td>
                <td><span className={'pill ' + s.tone}>{s.label}</span></td>
                <td className="sub">{ago(v.last_at)}</td>
                <td className="num">{v.speed_limit}</td>
                <td className="num sub">{v.device_id}</td>
                {manage && !demo && <td><button className="btn" style={{ minHeight: 36 }} onClick={() => setEdit(v)}>تعديل</button></td>}
              </tr>) })}</tbody>
          </table>)}
      </div>

      {manage && !demo && <AlertSettings />}
      {edit && <CarForm v={edit} people={people} branches={branches} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  )
}
