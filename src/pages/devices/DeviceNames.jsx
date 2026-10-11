import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, errMsg } from '../../lib/supabase'
import Icon from '../../components/Icon.jsx'
import { ago, isOnline } from './Devices.jsx'

// same cleanup the database does before writing a name to the device (English letters only, 24 chars)
const deviceName = (t) => String(t || '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
const same = (a, b) => deviceName(a).toLowerCase() === deviceName(b).toLowerCase()

export default function DeviceNames() {
  const { id } = useParams()
  const [device, setDevice] = useState(null)
  const [users, setUsers] = useState([])
  const [emps, setEmps] = useState([])
  const [pendingCmds, setPendingCmds] = useState([])
  const [unknownPunches, setUnknownPunches] = useState({})
  const [link, setLink] = useState({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data: d } = await supabase.from('bio_devices').select('*').eq('id', id).single()
    setDevice(d)
    supabase.from('bio_device_users').select('*').eq('device_id', id).eq('removed', false).order('pin').then(({ data }) => setUsers(data || []))
    supabase.from('employees').select('id,full_name,branch_id,bio_pin,punch_mode,job_title').eq('active', true).order('full_name').then(({ data }) => setEmps(data || []))
    supabase.from('bio_commands').select('id,kind,pin,status,created_at').eq('device_id', id).in('status', ['pending', 'sent']).neq('kind', 'open_door')
      .then(({ data }) => setPendingCmds(data || []))
    supabase.from('bio_punches').select('pin').eq('device_id', id).eq('result', 'unknown_pin').limit(2000).then(({ data }) => {
      const m = {}; (data || []).forEach((p) => { m[p.pin] = (m[p.pin] || 0) + 1 }); setUnknownPunches(m)
    })
  }, [id])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const cmd = async (kind, pin, name) => {
    const { error } = await supabase.rpc('device_command', { p_device: id, p_kind: kind, p_pin: pin ?? null, p_name: name ?? null })
    if (error) throw error
  }
  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null)
    try { await fn(); if (okText) setMsg({ ok: true, t: okText }) } catch (e) { setMsg({ ok: false, t: errMsg(e) }) }
    setBusy(''); load()
  }

  if (!device) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  const byPin = Object.fromEntries(emps.filter((e) => e.bio_pin).map((e) => [e.bio_pin, e]))
  const onDevice = new Set(users.map((u) => u.pin))
  const queued = (kind, pin) => pendingCmds.some((c) => c.kind === kind && c.pin === pin)

  const linked = users.filter((u) => byPin[u.pin])
  const renames = linked.filter((u) => !same(u.name, byPin[u.pin].full_name))
  const unlinked = users.filter((u) => !byPin[u.pin])
  // employees of this branch who should punch here but aren't on the device yet
  const missing = emps.filter((e) => e.branch_id === device.branch_id && ['any', 'device'].includes(e.punch_mode) && !(e.bio_pin && onDevice.has(e.bio_pin)))
  const freeEmps = emps.filter((e) => !e.bio_pin)
  const usedPins = new Set([...users.map((u) => u.pin), ...emps.filter((e) => e.bio_pin).map((e) => e.bio_pin)])
  const nextPin = () => { let n = 1; while (usedPins.has(String(n))) n++; usedPins.add(String(n)); return String(n) }

  const linkUser = (u) => run('link' + u.pin, async () => {
    const empId = link[u.pin]; if (!empId) throw new Error('اختار الموظف أول')
    const { error } = await supabase.from('employees').update({ bio_pin: u.pin }).eq('id', empId); if (error) throw error
  }, 'انربط. بصماته اللي على الجهاز بتنحسب له من الحين.')

  const removeUser = (u) => {
    if (!window.confirm(`تمسح "${u.name || u.pin}" (رقم ${u.pin}) من الجهاز؟ بصمته بتنمسح معه وما ترجع.`)) return
    run('del' + u.pin, () => cmd('delete_user', u.pin), 'انرسل أمر المسح. بيتنفذ أول ما الجهاز يتصل.')
  }
  const removeAllUnlinked = () => {
    const list = unlinked.filter((u) => !queued('delete_user', u.pin))
    if (!list.length) return
    if (!window.confirm(`تمسح ${list.length} اسم غير مربوط من الجهاز؟\n\n${list.map((u) => `${u.pin} - ${u.name || 'بدون اسم'}`).join('\n')}\n\nبصماتهم بتنمسح معهم وما ترجع.`)) return
    run('delall', async () => { for (const u of list) await cmd('delete_user', u.pin) }, `انرسل أمر مسح ${list.length} اسم.`)
  }
  const renameAll = () => run('renall', async () => {
    for (const u of renames) if (!queued('set_user', u.pin)) await cmd('set_user', u.pin, byPin[u.pin].full_name)
  }, 'انرسلت الأسماء الجديدة للجهاز.')
  const addEmp = (e) => run('add' + e.id, async () => {
    let pin = e.bio_pin
    if (!pin) {
      pin = nextPin()
      const { error } = await supabase.from('employees').update({ bio_pin: pin }).eq('id', e.id); if (error) throw error
    }
    await cmd('set_user', pin, e.full_name)
  }, `انضاف ${e.full_name} للجهاز. خلّه يسجّل بصمة إصبعه على الجهاز مرة وحدة.`)

  const empSelect = (u) => (
    <div className="row" style={{ gap: 6 }}>
      <select className="input" style={{ height: 38, minWidth: 160 }} aria-label="اربطه بموظف" value={link[u.pin] || ''} onChange={(e) => setLink({ ...link, [u.pin]: e.target.value })}>
        <option value="">اربطه بموظف…</option>
        {freeEmps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
      </select>
      <button className="btn" style={{ minHeight: 38 }} disabled={!link[u.pin] || busy === 'link' + u.pin} onClick={() => linkUser(u)}>ربط</button>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div><Link to="/devices" className="sub" style={{ color: 'var(--green)' }}>الأجهزة ←</Link>
          <h1>أسماء {device.name || device.serial}</h1>
          <div className="sub">{isOnline(device) ? 'الجهاز متصل' : `الجهاز غير متصل · آخر اتصال ${ago(device.last_seen_at)}`}</div></div>
        <button className="btn" disabled={busy === 'q'} onClick={() => run('q', () => cmd('query_users'), 'طلبنا القائمة من الجهاز. بتظهر هنا خلال دقيقة.')}>
          {busy === 'q' ? <span className="spinner" /> : <Icon name="refresh" />} سحب الأسماء من الجهاز</button>
      </div>

      {msg && <div className={msg.ok ? 'notice' : 'error'} style={{ marginBottom: 12 }}>{msg.t}</div>}
      {pendingCmds.length > 0 && <div className="warn" style={{ marginBottom: 12 }}><span className="spinner" /> {pendingCmds.length} أمر ينتظر الجهاز ينفذه</div>}

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">على الجهاز</div><div className="value">{users.length}</div></div>
        <div className="card stat"><div className="label">مربوطين بموظف</div><div className="value" style={{ color: 'var(--ok)' }}>{linked.length}</div></div>
        <div className="card stat"><div className="label">غير مربوطين</div><div className="value" style={{ color: 'var(--red)' }}>{unlinked.length}</div></div>
        <div className="card stat"><div className="label">موظفين مو على الجهاز</div><div className="value" style={{ color: 'var(--amber)' }}>{missing.length}</div></div>
      </div>

      {users.length === 0 && <div className="card empty" style={{ marginBottom: 16 }}>ما وصلتنا قائمة الأسماء من الجهاز للحين. اضغط "سحب الأسماء من الجهاز".</div>}

      {unlinked.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6 }}>
            <div><h2 style={{ fontSize: 17 }}>أسماء على الجهاز مو مربوطة بأي موظف</h2>
              <div className="sub">لو هو موظف حالي اربطه وتظل بصمته. لو ترك الشغل امسحه.</div></div>
            <button className="btn danger" disabled={busy === 'delall'} onClick={removeAllUnlinked}><Icon name="trash" /> مسح الكل ({unlinked.length})</button>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>رقم الجهاز</th><th>الاسم على الجهاز</th><th>بصمة إصبع</th><th>بصم مؤخراً</th><th></th><th></th></tr></thead>
            <tbody>{unlinked.map((u) => (
              <tr key={u.pin}>
                <td className="num">{u.pin}</td>
                <td style={{ fontWeight: 500 }}>{u.name || '—'}</td>
                <td>{u.fp_count > 0 ? <span className="pill ok">مسجلة</span> : <span className="pill gray">لا</span>}</td>
                <td>{unknownPunches[u.pin] ? <span className="pill amber">{unknownPunches[u.pin]} بصمة</span> : '—'}</td>
                <td>{empSelect(u)}</td>
                <td>{queued('delete_user', u.pin) ? <span className="pill gray">ينتظر المسح</span>
                  : <button className="btn danger" style={{ minHeight: 38 }} disabled={busy === 'del' + u.pin} onClick={() => removeUser(u)}>مسح</button>}</td>
              </tr>))}</tbody>
          </table></div>
        </section>
      )}

      {missing.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 17 }}>موظفين الفرع اللي مو على الجهاز</h2>
          <div className="sub" style={{ marginBottom: 6 }}>بعد الإضافة، الموظف يسجّل بصمة إصبعه على الجهاز مرة وحدة.</div>
          <div className="list">{missing.map((e) => (
            <div key={e.id} className="list-item">
              <div className="grow"><div style={{ fontWeight: 500 }}>{e.full_name}</div><div className="sub">{e.job_title || ''}{e.bio_pin ? ` · رقمه ${e.bio_pin}` : ''}</div></div>
              {queued('set_user', e.bio_pin) ? <span className="pill gray">ينتظر الجهاز</span>
                : <button className="btn" style={{ minHeight: 38 }} disabled={busy === 'add' + e.id} onClick={() => addEmp(e)}><Icon name="plus" /> إضافة للجهاز</button>}
            </div>))}</div>
        </section>
      )}

      {linked.length > 0 && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6 }}>
            <h2 style={{ fontSize: 17 }}>مربوطين</h2>
            {renames.length > 0 && <button className="btn" disabled={busy === 'renall'} onClick={renameAll}>تحديث {renames.length} اسم على الجهاز</button>}
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>رقم الجهاز</th><th>الاسم على الجهاز</th><th>الموظف في النظام</th><th>بصمة إصبع</th></tr></thead>
            <tbody>{linked.map((u) => (
              <tr key={u.pin}>
                <td className="num">{u.pin}</td>
                <td>{u.name || '—'}{!same(u.name, byPin[u.pin].full_name) && <span className="pill amber" style={{ marginInlineStart: 6 }}>يختلف</span>}</td>
                <td style={{ fontWeight: 500 }}>{byPin[u.pin].full_name}</td>
                <td>{u.fp_count > 0 ? <span className="pill ok">مسجلة</span> : <span className="pill amber">يحتاج يسجّل</span>}</td>
              </tr>))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  )
}
