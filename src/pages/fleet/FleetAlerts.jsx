import { useMemo, useState } from 'react'
import { todayKuwait } from '../../lib/supabase'
import Icon from '../../components/Icon.jsx'
import { useFleet } from './useFleet'
import { KINDS, GROUPS, kindLabel, carName, kuwaitDay } from './fleetLib'
import { AlertRow, DemoBar } from './Fleet.jsx'

const RANGES = [['today', 'اليوم'], ['7', 'آخر ٧ أيام'], ['30', 'آخر ٣٠ يوم']]
const SCORE_KINDS = ['smoking', 'phone', 'fatigue', 'distraction', 'seatbelt', 'overspeed']

export default function FleetAlerts() {
  const [range, setRange] = useState('7')
  const since = useMemo(() => (range === 'today' ? kuwaitDay(todayKuwait())[0] : new Date(Date.now() - Number(range) * 86400000).toISOString()), [range])
  const { vehicles, events, personName, markSeen } = useFleet({ eventsSince: since })
  const [group, setGroup] = useState('alerts') // alerts = everything except engine on/off
  const [car, setCar] = useState('')
  const [unseen, setUnseen] = useState(false)
  const [tab, setTab] = useState('list')

  const carOf = (id) => (vehicles || []).find((v) => v.id === id)
  const list = events.filter((e) => {
    const g = KINDS[e.kind]?.group || 'car'
    if (group === 'alerts' ? g === 'engine' : group !== 'all' && g !== group) return false
    if (car && e.vehicle_id !== car) return false
    if (unseen && e.seen_at) return false
    return true
  })
  const unseenIds = list.filter((e) => !e.seen_at && KINDS[e.kind]?.group !== 'engine').map((e) => e.id)

  // per driver: how many of the serious behaviours in the chosen period
  const board = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (!SCORE_KINDS.includes(e.kind)) continue
      const key = e.driver_id || `car:${e.vehicle_id}`
      const r = m.get(key) || { key, name: personName(e.driver_id) || carName(carOf(e.vehicle_id)), total: 0 }
      r[e.kind] = (r[e.kind] || 0) + 1; r.total++
      m.set(key, r)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [events, personName, vehicles]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-head">
        <h1>تنبيهات السيارات</h1>
        {unseenIds.length > 0 && <button className="btn" onClick={() => markSeen(unseenIds)}><Icon name="check" /> تم الاطلاع على الكل ({unseenIds.length})</button>}
      </div>
      <DemoBar />
      <div className="seg" style={{ maxWidth: 420 }}>
        <a href="#list" className={tab === 'list' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab('list') }}>كل التنبيهات</a>
        <a href="#board" className={tab === 'board' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab('board') }}>ترتيب السواقين</a>
      </div>

      <div className="toolbar">
        <div className="chips">{RANGES.map(([k, l]) => <button key={k} className={'chip' + (range === k ? ' on' : '')} onClick={() => setRange(k)}>{l}</button>)}</div>
        {tab === 'list' && <select className="input" style={{ width: 200, height: 42 }} value={car} onChange={(e) => setCar(e.target.value)}>
          <option value="">كل السيارات</option>
          {(vehicles || []).filter((v) => v.approved).map((v) => <option key={v.id} value={v.id}>{carName(v)}{personName(v.driver_id) ? ` · ${personName(v.driver_id)}` : ''}</option>)}
        </select>}
      </div>

      {tab === 'list' ? (<>
        <div className="chips" style={{ marginBottom: 12 }}>
          {[['alerts', 'التنبيهات المهمة'], ...GROUPS.map((g) => [g.key, g.label]), ['all', 'الكل']].map(([k, l]) =>
            <button key={k} className={'chip' + (group === k ? ' on' : '')} onClick={() => setGroup(k)}>{l}</button>)}
          <label className="check" style={{ marginInlineStart: 8 }}><input type="checkbox" checked={unseen} onChange={(e) => setUnseen(e.target.checked)} /> اللي ما انشافت بس</label>
        </div>
        <div className="card" style={{ padding: '4px 12px' }}>
          {vehicles === null && <div className="empty"><span className="spinner" /></div>}
          {vehicles !== null && list.length === 0 && <div className="empty">ما فيه تنبيهات في هذي الفترة</div>}
          {list.slice(0, 300).map((e) => <AlertRow key={e.id} e={e} car={carOf(e.vehicle_id)} driver={personName(e.driver_id)} onSeen={markSeen} />)}
          {list.length > 300 && <div className="empty">يظهر أول ٣٠٠ تنبيه. اختار سيارة أو فترة أقصر.</div>}
        </div>
      </>) : (
        <div className="card table-wrap">
          {board.length === 0 ? <div className="empty">ما فيه مخالفات في هذي الفترة</div> : (
            <table>
              <thead><tr><th>السواق</th>{SCORE_KINDS.map((k) => <th key={k}>{kindLabel(k).replace('السواق ', '')}</th>)}<th>المجموع</th></tr></thead>
              <tbody>{board.map((r) => (
                <tr key={r.key}><td style={{ fontWeight: 600 }}>{r.name}</td>
                  {SCORE_KINDS.map((k) => <td key={k} className="num">{r[k] ? <span className={'pill ' + (k === 'smoking' || k === 'phone' || k === 'fatigue' ? 'red' : 'amber')}>{r[k]}</span> : <span className="sub">—</span>}</td>)}
                  <td className="num" style={{ fontWeight: 700 }}>{r.total}</td></tr>))}
              </tbody>
            </table>)}
        </div>
      )}
    </div>
  )
}
