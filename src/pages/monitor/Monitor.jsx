import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg, fmtDate, fmtTime } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import Icon from '../../components/Icon.jsx'

// سند: live state of every LoCarb system the monitor checks every 5 minutes.
const ago = (ts) => {
  if (!ts) return '—'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'الحين'
  if (m < 60) return `قبل ${m} د`
  if (m < 1440) return `قبل ${Math.floor(m / 60)} س`
  return `${fmtDate(ts)} ${fmtTime(ts)}`
}
const dur = (a, b) => {
  const m = Math.max(1, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000))
  return m < 60 ? `${m} دقيقة` : `${Math.floor(m / 60)} س ${m % 60 ? `${m % 60} د` : ''}`.trim()
}

function stateOf(t) {
  if (!t.active) return { label: 'موقوف', tone: 'gray', color: '#9AA79D' }
  if (t.last_ok == null) return { label: 'ما انفحص بعد', tone: 'gray', color: '#9AA79D' }
  if (t.last_at && Date.now() - new Date(t.last_at).getTime() > 20 * 60000) return { label: 'سند ما فحصه من مدة', tone: 'amber', color: '#D97706' }
  if (!t.last_ok && t.fail_count >= 2) return { label: 'عطلان', tone: 'red', color: '#B91C1C' }
  if (!t.last_ok) return { label: 'يتأكد…', tone: 'amber', color: '#D97706' }
  return { label: 'شغال', tone: 'ok', color: '#1F8A4C' }
}

function Emails() {
  const [s, setS] = useState(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('monitor_settings').select('*').eq('id', 1).single().then(({ data }) => { setS(data); setText((data?.alert_emails || []).join('\n')) })
  }, [])
  if (!s) return null
  const save = async () => {
    const list = text.split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean)
    if (list.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) { setMsg('فيه إيميل مكتوب غلط'); return }
    const { error } = await supabase.from('monitor_settings').update({ alert_emails: list, updated_at: new Date().toISOString() }).eq('id', 1)
    setMsg(error ? errMsg(error) : 'تم الحفظ'); setTimeout(() => setMsg(''), 2500)
  }
  return (
    <div className="card form" style={{ gap: 10, marginTop: 16 }}>
      <h2 style={{ fontSize: 18 }}>إيميلات التحذير</h2>
      <div className="sub">لما يطيح أي نظام أو يرجع، يرسل سند إيميل لهذي العناوين. اكتب كل إيميل في سطر.</div>
      <textarea className="input" dir="ltr" rows={3} style={{ height: 'auto', padding: 10 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row"><button className="btn primary" onClick={save}>حفظ</button>{msg && <span className="sub">{msg}</span>}</div>
    </div>
  )
}

export default function Monitor() {
  const { can } = useAccess()
  const [targets, setTargets] = useState(null)
  const [sum, setSum] = useState({})
  const [incidents, setIncidents] = useState([])
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)

  const load = useCallback(async () => {
    const [t, s, i] = await Promise.all([
      supabase.from('monitor_targets').select('*').order('sort_order'),
      supabase.rpc('monitor_summary'),
      supabase.from('monitor_incidents').select('*').order('started_at', { ascending: false }).limit(30),
    ])
    if (t.error) { setError(errMsg(t.error)); setTargets([]); return }
    setError('')
    setTargets(t.data || [])
    setSum(Object.fromEntries((s.data || []).map((x) => [x.target_id, x])))
    setIncidents(i.data || [])
    setLoadedAt(new Date())
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener('focus', load)
    return () => { clearInterval(id); window.removeEventListener('focus', load) }
  }, [load])

  if (targets === null) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  const active = targets.filter((t) => t.active)
  const down = active.filter((t) => !t.last_ok && t.fail_count >= 2)
  const nameOf = (id) => targets.find((t) => t.id === id)?.name || ''
  const open = incidents.filter((x) => !x.resolved_at)

  return (
    <div>
      <div className="page-head">
        <div><h1>سند · مراقبة الأنظمة</h1><div className="sub">يفحص كل الأنظمة كل 5 دقايق{loadedAt ? ` · آخر تحديث للصفحة ${fmtTime(loadedAt)}` : ''}</div></div>
        <button className="btn" onClick={load}><Icon name="arrows" /> تحديث</button>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, padding: 18, background: down.length ? 'var(--red-bg)' : 'var(--ok-bg)' }}>
        <span className="alert-ico" style={{ width: 46, height: 46, borderRadius: 23, background: '#fff', color: down.length ? 'var(--red)' : 'var(--ok)' }}><Icon name={down.length ? 'warn' : 'check'} size={24} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{down.length ? `${down.length} نظام عطلان الحين` : 'كل الأنظمة شغالة'}</div>
          <div className="sub">{down.length ? down.map((t) => t.name).join('، ') : `${active.length} نظام تحت المراقبة`}</div>
        </div>
      </div>

      <div className="card" style={{ padding: '4px 12px' }}>
        {targets.map((t) => {
          const st = stateOf(t)
          const s = sum[t.id]
          return (
            <div key={t.id} className="alert-row" style={{ alignItems: 'center' }}>
              <span className="car-dot" style={{ background: st.color, width: 14, height: 14, borderRadius: 7 }} />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="sub" dir="ltr" style={{ textAlign: 'start', wordBreak: 'break-all' }}>{t.url.replace(/^https?:\/\//, '')}</div>
                {!t.last_ok && t.last_error && <div className="sub" style={{ color: 'var(--red)' }}>{t.last_error}</div>}
              </div>
              <div style={{ textAlign: 'end', minWidth: 96 }}>
                <span className={'pill ' + st.tone}>{st.label}</span>
                <div className="sub">{t.last_ms != null ? <><span className="num">{(t.last_ms / 1000).toFixed(1)}</span> ث</> : '—'} · {ago(t.last_at)}</div>
                {s?.up_24h != null && <div className="sub">يشتغل <span className="num">{Number(s.up_24h)}%</span> آخر 24 س</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 6 }}>الأعطال {open.length ? <span className="pill red">{open.length} مفتوح</span> : null}</h2>
        {incidents.length === 0 && <div className="empty">ما صار أي عطل للحين</div>}
        {incidents.map((x) => (
          <div key={x.id} className="alert-row">
            <span className={'alert-ico ' + (x.resolved_at ? 'ok' : 'red')}><Icon name={x.resolved_at ? 'check' : 'warn'} size={18} /></span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{nameOf(x.target_id)}</div>
              <div className="sub">{x.last_error || 'ما يرد'}</div>
              <div className="sub">{fmtDate(x.started_at)} {fmtTime(x.started_at)} · {x.resolved_at ? `رجع بعد ${dur(x.started_at, x.resolved_at)}` : `عطلان من ${dur(x.started_at)}`}</div>
            </div>
          </div>
        ))}
      </div>

      {can('monitor_manage') && <Emails />}
    </div>
  )
}
