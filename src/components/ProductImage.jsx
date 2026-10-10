import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Product photos (from the photo stock-take) shown next to item names.
// Photos of all items are looked up once and signed in one request per batch.
const urlCache = new Map()      // image_path -> signed url
let itemPaths = null            // item id -> image_path
let itemPathsPromise = null
const listeners = new Set()

async function loadItemPaths() {
  if (itemPaths) return itemPaths
  if (!itemPathsPromise) {
    itemPathsPromise = supabase.from('inv_items').select('id,image_path').not('image_path', 'is', null).then(async ({ data }) => {
      const map = Object.fromEntries((data || []).map((x) => [x.id, x.image_path]))
      const paths = [...new Set(Object.values(map))].filter((p) => !urlCache.has(p))
      for (let i = 0; i < paths.length; i += 100) {
        const { data: s } = await supabase.storage.from('product-photos').createSignedUrls(paths.slice(i, i + 100), 60 * 60 * 6)
        for (const x of s || []) if (x.signedUrl) urlCache.set(x.path, x.signedUrl)
      }
      itemPaths = map
      listeners.forEach((f) => f())
      return map
    })
  }
  return itemPathsPromise
}
export const refreshProductImages = () => { itemPaths = null; itemPathsPromise = null; return loadItemPaths() }

export function useProductImages() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    listeners.add(f)
    loadItemPaths()
    return () => listeners.delete(f)
  }, [])
  return (itemId) => {
    const p = itemPaths?.[itemId]
    return p ? urlCache.get(p) : null
  }
}

export default function ProductImage({ itemId, size = 44, imgOf, round = 10, onClick }) {
  const own = useProductImages()
  const url = (imgOf || own)(itemId)
  const box = { width: size, height: size, borderRadius: round, flexShrink: 0, background: '#EEF1EC', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }
  if (!url) return (
    <span style={box} aria-hidden="true">
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="#9AA79D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>
    </span>)
  return (
    <span style={{ ...box, cursor: onClick ? 'zoom-in' : undefined }} onClick={onClick}>
      <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  )
}

export function ProductPhotoLarge({ itemId }) {
  const imgOf = useProductImages()
  const url = imgOf(itemId)
  if (!url) return null
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 14, background: '#fff', border: '1px solid var(--line)' }} /></a>
}
