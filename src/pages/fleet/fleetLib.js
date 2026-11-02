import { fmtDate, fmtTime } from '../../lib/supabase'

// What each dashcam / GPS alert is called and how loud it is.
// group: engine (on/off) · driver (in-cab AI camera) · road (front AI camera) · car
export const KINDS = {
  ignition_on: { label: 'السيارة اشتغلت', group: 'engine', tone: 'ok' },
  ignition_off: { label: 'السيارة وقفت', group: 'engine', tone: 'gray' },
  smoking: { label: 'السواق يدخن', group: 'driver', tone: 'red' },
  phone: { label: 'السواق يستخدم الجوال', group: 'driver', tone: 'red' },
  fatigue: { label: 'السواق نعسان (عيونه مسكرة)', group: 'driver', tone: 'red' },
  yawn: { label: 'السواق يتثاوب', group: 'driver', tone: 'amber' },
  distraction: { label: 'السواق مو منتبه للطريق', group: 'driver', tone: 'amber' },
  seatbelt: { label: 'السواق مو لابس الحزام', group: 'driver', tone: 'amber' },
  camera_cover: { label: 'كاميرا السواق مغطاة', group: 'driver', tone: 'red' },
  driver_absent: { label: 'السواق مو في الكرسي', group: 'driver', tone: 'amber' },
  fcw: { label: 'خطر اصطدام أمامي', group: 'road', tone: 'amber' },
  hmw: { label: 'مسافة قريبة من السيارة اللي قدام', group: 'road', tone: 'amber' },
  pcw: { label: 'خطر صدم مشاة', group: 'road', tone: 'amber' },
  ldw: { label: 'خروج عن المسار', group: 'road', tone: 'amber' },
  overspeed: { label: 'سرعة زايدة', group: 'car', tone: 'amber' },
  panic: { label: 'زر الطوارئ', group: 'car', tone: 'red' },
  collision: { label: 'اصطدام', group: 'car', tone: 'red' },
  rollover: { label: 'انقلاب', group: 'car', tone: 'red' },
  power_cut: { label: 'انقطاع كهرباء الجهاز', group: 'car', tone: 'red' },
}
export const GROUPS = [
  { key: 'driver', label: 'تصرفات السواق' },
  { key: 'car', label: 'السيارة والسرعة' },
  { key: 'road', label: 'الطريق' },
  { key: 'engine', label: 'تشغيل وإيقاف' },
]
export const kindLabel = (k) => KINDS[k]?.label || k
export const kindTone = (k) => KINDS[k]?.tone || 'gray'

// no message for 15 minutes = the dashcam is off, out of coverage or unplugged
export const OFFLINE_MIN = 15
export function statusOf(v, now = Date.now()) {
  if (!v.last_at) return { key: 'never', label: 'ما اتصل بعد', tone: 'gray', color: '#9AA79D' }
  if (now - new Date(v.last_at).getTime() > OFFLINE_MIN * 60000) return { key: 'offline', label: 'غير متصل', tone: 'gray', color: '#9AA79D' }
  if (v.ignition === false) return { key: 'parked', label: 'واقفة · المحرك طافي', tone: 'blue', color: '#2B5C9E' }
  if (Number(v.last_speed) > 3) return { key: 'moving', label: 'تمشي', tone: 'ok', color: '#1F8A4C' }
  return { key: 'idle', label: 'المحرك شغال وهي واقفة', tone: 'amber', color: '#D97706' }
}

export const ago = (ts, now = Date.now()) => {
  if (!ts) return '—'
  const m = Math.round((now - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'الحين'
  if (m < 60) return `قبل ${m} د`
  if (m < 1440) return `قبل ${Math.floor(m / 60)} س ${m % 60 ? `${m % 60} د` : ''}`.trim()
  return `${fmtDate(ts)} ${fmtTime(ts)}`
}

export const carName = (v) => v?.name || v?.plate || (v ? `جهاز ${v.device_id}` : 'سيارة')

// Kuwait day [start, end) for a yyyy-mm-dd date
export const kuwaitDay = (d) => [new Date(`${d}T00:00:00+03:00`).toISOString(), new Date(new Date(`${d}T00:00:00+03:00`).getTime() + 86400000).toISOString()]

export function distanceKm(points) {
  let km = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    const d = 2 * R * Math.asin(Math.sqrt(x))
    if (d < 5) km += d // ignore GPS jumps
  }
  return km
}

// ───────── demo data: 18 cars driving around Kuwait, so the pages can be seen before the first car is connected ─────────
const DEMO_DRIVERS = ['محمد رفيق', 'أنور حسين', 'راجو كومار', 'سانجاي', 'عبدالله نور', 'بيجو', 'فيصل أحمد', 'كريشنا', 'نديم خان', 'سوريش', 'علي رضا', 'جمال', 'رام', 'بابو', 'إسماعيل', 'سنيل', 'حمزة', 'ديباك']
const BOX = { lat: [29.19, 29.34], lng: [47.87, 48.03] } // Kuwait City – Hawalli – Farwaniya – Jabriya, on land
const rnd = (a, b) => a + Math.random() * (b - a)

export function makeDemo() {
  const now = Date.now()
  const vehicles = DEMO_DRIVERS.map((d, i) => {
    const state = i < 11 ? 'moving' : i < 14 ? 'parked' : i < 16 ? 'idle' : 'offline'
    return {
      id: `demo-${i}`, device_id: `0130${(5540100 + i * 37).toString()}`, name: `سيارة ${i + 1}`, plate: `${10 + i}/${30000 + i * 913}`,
      driver_id: `d${i}`, approved: true, speed_limit: 100,
      last_lat: rnd(...BOX.lat), last_lng: rnd(...BOX.lng), last_heading: rnd(0, 360),
      last_speed: state === 'moving' ? Math.round(rnd(25, 85)) : 0,
      ignition: state === 'moving' || state === 'idle',
      ignition_at: new Date(now - rnd(5, 240) * 60000).toISOString(),
      last_at: new Date(now - (state === 'offline' ? rnd(40, 300) : rnd(0, 1)) * 60000).toISOString(),
    }
  })
  const people = DEMO_DRIVERS.map((n, i) => ({ id: `d${i}`, full_name: n, is_driver: true }))
  const kinds = ['smoking', 'phone', 'overspeed', 'fatigue', 'seatbelt', 'ignition_on', 'ignition_off', 'distraction', 'yawn', 'fcw', 'ldw', 'ignition_on', 'smoking', 'overspeed']
  const events = Array.from({ length: 34 }, (_, i) => {
    const v = vehicles[Math.floor(Math.random() * 16)]
    const kind = kinds[i % kinds.length]
    return {
      id: `e${i}`, vehicle_id: v.id, driver_id: v.driver_id, kind,
      at: new Date(now - (i * 17 + rnd(0, 15)) * 60000).toISOString(),
      lat: v.last_lat + rnd(-0.02, 0.02), lng: v.last_lng + rnd(-0.02, 0.02),
      speed: kind === 'overspeed' ? Math.round(rnd(105, 135)) : Math.round(rnd(0, 70)),
      seen_at: i > 6 ? new Date(now).toISOString() : null,
    }
  }).sort((a, b) => b.at.localeCompare(a.at))
  return { vehicles, people, events }
}

// moves the moving demo cars a little (called every few seconds)
export function stepDemo(vehicles) {
  const now = new Date().toISOString()
  return vehicles.map((v) => {
    if (!(v.ignition && Number(v.last_speed) > 3)) return v
    let h = (Number(v.last_heading) + rnd(-25, 25) + 360) % 360
    const km = (Number(v.last_speed) / 3600) * 4
    let lat = v.last_lat + (km / 111) * Math.cos(h * Math.PI / 180)
    let lng = v.last_lng + (km / 97) * Math.sin(h * Math.PI / 180)
    if (lat < BOX.lat[0] || lat > BOX.lat[1] || lng < BOX.lng[0] || lng > BOX.lng[1]) { h = (h + 180) % 360; lat = v.last_lat; lng = v.last_lng }
    return { ...v, last_lat: lat, last_lng: lng, last_heading: h, last_speed: Math.max(15, Math.min(95, Number(v.last_speed) + Math.round(rnd(-8, 8)))), last_at: now }
  })
}

// a believable day's route for the demo car history
export function demoTrack(v) {
  const pts = []
  let lat = v.last_lat, lng = v.last_lng, h = rnd(0, 360)
  const start = Date.now() - 6 * 3600000
  for (let i = 0; i < 180; i++) {
    if (i % 12 === 0) h = (h + (Math.random() < 0.5 ? 90 : -90) + 360) % 360 // turn at a junction now and then
    lat += (0.6 / 111) * Math.cos(h * Math.PI / 180)
    lng += (0.6 / 97) * Math.sin(h * Math.PI / 180)
    if (lat < BOX.lat[0] || lat > BOX.lat[1] || lng < BOX.lng[0] || lng > BOX.lng[1]) { h = (h + 180) % 360; lat = Math.min(Math.max(lat, BOX.lat[0]), BOX.lat[1]); lng = Math.min(Math.max(lng, BOX.lng[0]), BOX.lng[1]) }
    pts.push({ at: new Date(start + i * 120000).toISOString(), lat, lng, speed: Math.round(rnd(20, 80)), ignition: true })
  }
  return pts
}
