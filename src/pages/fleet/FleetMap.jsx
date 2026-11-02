import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { statusOf, carName, kindLabel, kindTone } from './fleetLib'
import { fmtTime } from '../../lib/supabase'

const KUWAIT = [29.31, 47.98]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const TONE = { red: '#B91C1C', amber: '#D97706', ok: '#1F8A4C', gray: '#6B7A70', blue: '#2B5C9E' }

function carIcon(v, selected) {
  const s = statusOf(v)
  const moving = s.key === 'moving'
  const arrow = moving
    ? `<div class="fm-arrow" style="transform:rotate(${Number(v.last_heading) || 0}deg)"><span style="border-bottom-color:${s.color}"></span></div>`
    : ''
  return L.divIcon({
    className: 'fm-car',
    iconSize: [0, 0],
    html: `<div class="fm-wrap${selected ? ' sel' : ''}">${arrow}<div class="fm-dot" style="background:${s.color}">${moving ? Math.round(v.last_speed) : ''}</div><div class="fm-label">${esc(carName(v))}</div></div>`,
  })
}

// Live map of the cars, plus (optionally) one car's route for a day with its alerts on it.
export default function FleetMap({ vehicles = [], selectedId, onSelect, track, trackEvents, height = 460, fitKey }) {
  const el = useRef(null)
  const map = useRef(null)
  const layers = useRef({ cars: null, track: null })
  const markers = useRef(new Map())
  const fitted = useRef(null)

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(KUWAIT, 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(m)
    layers.current.cars = L.layerGroup().addTo(m)
    layers.current.track = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null; markers.current.clear() }
  }, [])

  // car markers: update in place so the map doesn't flicker on every refresh
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set()
    for (const v of vehicles) {
      if (v.last_lat == null || v.last_lng == null) continue
      seen.add(v.id)
      let mk = markers.current.get(v.id)
      const icon = carIcon(v, v.id === selectedId)
      if (!mk) {
        mk = L.marker([v.last_lat, v.last_lng], { icon, riseOnHover: true }).addTo(layers.current.cars)
        mk.on('click', () => onSelect?.(v.id))
        markers.current.set(v.id, mk)
      } else {
        mk.setLatLng([v.last_lat, v.last_lng]); mk.setIcon(icon)
        mk.off('click'); mk.on('click', () => onSelect?.(v.id))
      }
      mk.setZIndexOffset(v.id === selectedId ? 1000 : 0)
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) { layers.current.cars.removeLayer(mk); markers.current.delete(id) }
    // first time there are cars (or the list changes on purpose), fit them all in view
    if (fitKey !== fitted.current && seen.size && !track?.length) {
      const pts = vehicles.filter((v) => v.last_lat != null).map((v) => [v.last_lat, v.last_lng])
      if (pts.length === 1) m.setView(pts[0], 14); else m.fitBounds(pts, { padding: [40, 40], maxZoom: 14 })
      fitted.current = fitKey
    }
  }, [vehicles, selectedId, onSelect, fitKey, track])

  // follow the selected car when no route is shown
  useEffect(() => {
    const m = map.current
    const v = vehicles.find((x) => x.id === selectedId)
    if (m && v?.last_lat != null && !track?.length) m.panTo([v.last_lat, v.last_lng], { animate: true })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // route of the day + where each alert happened
  useEffect(() => {
    const g = layers.current.track
    if (!g) return
    g.clearLayers()
    if (!track?.length) return
    const pts = track.map((p) => [p.lat, p.lng])
    L.polyline(pts, { color: '#1F6B45', weight: 5, opacity: 0.85 }).addTo(g)
    L.circleMarker(pts[0], { radius: 8, color: '#fff', weight: 3, fillColor: '#1F6B45', fillOpacity: 1 }).bindTooltip(`البداية ${fmtTime(track[0].at)}`).addTo(g)
    L.circleMarker(pts[pts.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: '#B91C1C', fillOpacity: 1 }).bindTooltip(`آخر نقطة ${fmtTime(track[track.length - 1].at)}`).addTo(g)
    for (const e of trackEvents || []) {
      if (e.lat == null) continue
      L.circleMarker([e.lat, e.lng], { radius: 7, color: '#fff', weight: 2, fillColor: TONE[kindTone(e.kind)], fillOpacity: 1 })
        .bindTooltip(`${esc(kindLabel(e.kind))} · ${fmtTime(e.at)}`).addTo(g)
    }
    map.current.fitBounds(pts, { padding: [30, 30], maxZoom: 15 })
  }, [track, trackEvents])

  return <div ref={el} dir="ltr" className="fleet-map" style={{ height }} />
}
