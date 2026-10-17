import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Employee photo (or first letter). Signed links are cached and fetched in batches.
const cache = new Map()   // path -> url
const waiting = new Map() // path -> [resolve]
let timer = null
function signedUrl(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path))
  return new Promise((resolve) => {
    if (!waiting.has(path)) waiting.set(path, [])
    waiting.get(path).push(resolve)
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const batch = [...waiting.entries()]; waiting.clear()
      const { data } = await supabase.storage.from('profile-pics').createSignedUrls(batch.map(([p]) => p), 6 * 3600)
      const got = Object.fromEntries((data || []).map((x) => [x.path, x.signedUrl]))
      for (const [p, rs] of batch) { if (got[p]) cache.set(p, got[p]); rs.forEach((r) => r(got[p] || null)) }
    }, 30)
  })
}

export default function Avatar({ name, path, size = 40, style, onClick, title }) {
  const [url, setUrl] = useState(path ? cache.get(path) || null : null)
  useEffect(() => { let on = true; if (path) signedUrl(path).then((u) => on && setUrl(u)); else setUrl(null); return () => { on = false } }, [path])
  const box = { width: size, height: size, borderRadius: size / 2, flexShrink: 0, overflow: 'hidden', fontSize: Math.round(size * 0.42), cursor: onClick ? 'pointer' : undefined, ...style }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag className="avatar" style={{ ...box, padding: 0, border: onClick ? 0 : undefined }} onClick={onClick} title={title} type={onClick ? 'button' : undefined}>
      {url ? <img src={url} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (name || '?')[0]}
    </Tag>
  )
}

// square, small JPEG for upload
export async function squarePhoto(file, side = 512) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas'); c.width = side; c.height = side
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86))
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}
