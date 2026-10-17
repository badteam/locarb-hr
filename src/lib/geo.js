// Coordinates typed or pasted on a phone: Arabic digits, Arabic decimal comma, "lat, lng" together, or a Google Maps link.
const toLatin = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/٫/g, '.').replace(/[٬،]/g, ',')

export function parseCoord(s) {
  const t = toLatin(s).trim()
  if (!t) return null
  const n = Number(t.replace(/\s/g, ''))
  return Number.isFinite(n) ? n : NaN
}

// finds "lat,lng" anywhere in the text (also inside Google Maps / Apple Maps links)
export function parsePair(s) {
  const t = decodeURIComponent(toLatin(s))
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || t.match(/[?&](?:q|ll|query|daddr|destination)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/) || t.match(/(-?\d{1,3}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return validPair(lat, lng) ? { lat, lng } : null
}

export const validPair = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

export const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`

// metres between two points
export function distance(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

// current phone position with a clear reason when it fails
export function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'الجهاز أو المتصفح ما يدعم تحديد الموقع.' })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }),
      (e) => resolve({ error: e.code === 1
        ? 'الموقع مقفول لهالموقع. في الآيفون: الإعدادات ← الخصوصية ← خدمات الموقع ← Safari ← "أثناء الاستخدام". في الأندرويد: اضغط القفل جنب الرابط فوق ← الأذونات ← الموقع ← سماح. بعدها حدّث الصفحة.'
        : e.code === 3 ? 'تأخر تحديد الموقع. تأكد إن الـGPS شغال، واطلع لمكان مفتوح داخل الفرع، وجرّب مرة ثانية.'
        : 'ما قدرنا نحدد الموقع. تأكد إن خدمات الموقع شغالة في الجوال وجرّب مرة ثانية.' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
