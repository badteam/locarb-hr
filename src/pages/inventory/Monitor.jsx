import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const KINDS = {
  consumption: 'الاستهلاك', count: 'الجرد', waste: 'الهدر', odd_hours: 'أوقات غريبة', manual: 'تعديل يدوي',
  invoice: 'الفواتير', price: 'الأسعار', payment: 'الدفعات', sales: 'المبيعات',
}
const SEV = { high: ['red', 'مهم جداً'], warn: ['amber', 'انتبه'], info: ['gray', 'للعلم'] }

export default function Monitor() {
  const { access } = useAccess()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('new')
  const [kind, setKind] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    let q = supabase.from('monitor_alerts').select('*, branches(name)').order('created_at', { ascending: false }).limit(300)
    if (filter === 'new') q = q.is('seen_at', null)
    if (kind) q = q.eq('kind', kind)
    q.then(({ data, error }) => { if (error) setErr(invErr(error)); else setRows(data || []) })
  }, [filter, kind])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.rpc('monitor_weekly_summary').then(({ data }) => setSummary(data || '')) }, [])

  const runNow = async () => {
    setBusy(true); setMsg(''); setErr('')
    const { data, error } = await supabase.rpc('run_monitor')
    setBusy(false)
    if (error) setErr(invErr(error)); else { setMsg(data.new_alerts ? `طلع ${data.new_alerts} تنبيه جديد` : 'ما فيه شي جديد. كل شي طبيعي.'); load() }
  }
  const seen = async (ids) => {
    await supabase.from('monitor_alerts').update({ seen_at: new Date().toISOString(), seen_by: access.employee.id }).in('id', ids)
    load()
  }

  return (
    <div>
      <div className="page-head"><div><h1>المراقب</h1>
        <div className="sub">يفحص كل يوم الصبح: الاستهلاك مقارنة بالمبيعات والفروع الثانية، الجرد، الهدر، الأسعار، الفواتير، الدفعات، والحركات بأوقات غريبة</div></div>
        <button className="btn" disabled={busy} onClick={runNow}>{busy ? <span className="spinner" /> : <Icon name="refresh" />} افحص الحين</button></div>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {summary && <div className="card" style={{ marginBottom: 14 }}>
        <strong>آخر ٧ أيام</strong>
        <div style={{ whiteSpace: 'pre-line', marginTop: 6, lineHeight: 1.9 }}>{summary}</div>
        <div className="sub">الأرقام بالدينار. يوصلك هالملخص كل أحد الصبح.</div>
      </div>}

      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={'chip' + (filter === 'new' ? ' on' : '')} onClick={() => setFilter('new')}>الجديدة</button>
        <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>الكل</button>
        <span style={{ width: 10 }} />
        <button className={'chip' + (!kind ? ' on' : '')} onClick={() => setKind('')}>كل الأنواع</button>
        {Object.entries(KINDS).map(([k, l]) => <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {filter === 'new' && rows?.length > 1 && <button className="btn" style={{ marginBottom: 10 }} onClick={() => seen(rows.map((r) => r.id))}><Icon name="check" /> شفتها كلها</button>}

      <div className="card list" style={{ padding: '4px 14px' }}>
        {!rows ? <div className="center" style={{ minHeight: 120 }}><span className="spinner" /></div>
          : rows.length === 0 ? <div className="empty">{filter === 'new' ? 'ما فيه تنبيهات جديدة' : 'ما فيه تنبيهات'}</div>
          : rows.map((r) => (
            <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', opacity: r.seen_at ? 0.65 : 1 }}>
              <span className={'pill ' + SEV[r.severity][0]} style={{ flexShrink: 0 }}>{SEV[r.severity][1]}</span>
              <span className="grow">
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                {r.body && <div className="sub" style={{ lineHeight: 1.7 }}>{r.body}</div>}
                <div className="sub">{KINDS[r.kind] || r.kind} · {fmtDate(r.created_at)}{r.link ? <> · <Link to={r.link}>افتح</Link></> : null}</div>
              </span>
              {!r.seen_at && <button className="chip" style={{ minHeight: 30 }} onClick={() => seen([r.id])}>شفته</button>}
            </div>))}
      </div>
    </div>
  )
}
