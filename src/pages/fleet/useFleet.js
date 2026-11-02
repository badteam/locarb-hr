import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { makeDemo, stepDemo } from './fleetLib'

const DEMO_KEY = 'fleet_demo'
const readDemo = () => { try { return sessionStorage.getItem(DEMO_KEY) === '1' } catch { return false } }

// demo on/off is shared by all fleet pages for this browser tab
export function useDemo() {
  const [demo, setDemo] = useState(readDemo)
  useEffect(() => {
    const f = () => setDemo(readDemo())
    window.addEventListener('fleet-demo', f)
    return () => window.removeEventListener('fleet-demo', f)
  }, [])
  const set = useCallback((on) => {
    try { if (on) sessionStorage.setItem(DEMO_KEY, '1'); else sessionStorage.removeItem(DEMO_KEY) } catch { /* private mode */ }
    setDemo(on); window.dispatchEvent(new Event('fleet-demo'))
  }, [])
  return [demo, set]
}

let demoCache = null

// Cars, drivers and recent alerts. Live data refreshes every 15 s; demo cars move every 4 s.
export function useFleet({ eventsSince } = {}) {
  const [demo] = useDemo()
  const [vehicles, setVehicles] = useState(null)
  const [people, setPeople] = useState([])
  const [events, setEvents] = useState([])
  const [loadedAt, setLoadedAt] = useState(null)
  const [error, setError] = useState('')
  // default: last 7 days, fixed when the page opens (a fresh value every render would reload forever)
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString())
  const since = eventsSince || weekAgo
  const sinceRef = useRef(since)
  useEffect(() => { sinceRef.current = since }, [since])

  const load = useCallback(async () => {
    if (demo) {
      if (!demoCache) demoCache = makeDemo()
      setVehicles(demoCache.vehicles); setPeople(demoCache.people)
      setEvents(demoCache.events.filter((e) => e.at >= sinceRef.current)); setLoadedAt(new Date()); return
    }
    const [v, p, e] = await Promise.all([
      supabase.from('fleet_vehicles').select('*').order('name', { nullsFirst: false }),
      supabase.rpc('fleet_people'),
      supabase.from('fleet_events').select('*').gte('at', sinceRef.current).order('at', { ascending: false }).limit(1000),
    ])
    if (v.error) { setError(v.error.message); setVehicles([]); return }
    setError('')
    setVehicles(v.data || []); setPeople(p.data || []); setEvents(e.data || []); setLoadedAt(new Date())
  }, [demo])

  useEffect(() => {
    setVehicles(null)
    load()
    const t = setInterval(load, 15000)
    window.addEventListener('focus', load)
    return () => { clearInterval(t); window.removeEventListener('focus', load) }
  }, [load, since])

  useEffect(() => {
    if (!demo) return
    const t = setInterval(() => {
      if (!demoCache) return
      demoCache = { ...demoCache, vehicles: stepDemo(demoCache.vehicles) }
      setVehicles(demoCache.vehicles)
    }, 4000)
    return () => clearInterval(t)
  }, [demo])

  const markSeen = useCallback(async (ids) => {
    if (demo) {
      const now = new Date().toISOString()
      demoCache.events = demoCache.events.map((e) => (!ids || ids.includes(e.id) ? { ...e, seen_at: e.seen_at || now } : e))
      load(); return
    }
    await supabase.rpc('fleet_mark_seen', { p_ids: ids || null })
    window.dispatchEvent(new Event('badges-changed'))
    load()
  }, [demo, load])

  const personName = useCallback((id) => people.find((x) => x.id === id)?.full_name || '', [people])
  return { demo, vehicles, people, events, loadedAt, error, reload: load, markSeen, personName }
}
