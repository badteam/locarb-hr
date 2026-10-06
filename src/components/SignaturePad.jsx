import { useRef, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/i18n.jsx'

// Finger/mouse signature pad. Exposes upload() via ref-less callback pattern.
export default function SignaturePad({ onChange }) {
  const { t } = useLang()
  const canvas = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#16201A'
  }, [])

  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e) => {
    e.preventDefault()
    canvas.current.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current.getContext('2d'); const p = pos(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const move = (e) => {
    if (!drawing.current) return
    const ctx = canvas.current.getContext('2d'); const p = pos(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (empty) { setEmpty(false); onChange?.(false) }
  }
  const up = () => { drawing.current = false }
  const clear = () => {
    const c = canvas.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true); onChange?.(true)
  }

  SignaturePad.lastCanvas = canvas
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="lbl">{t('signature')}</span>
        <button type="button" className="sub" style={{ background: 'none', border: 0, color: 'var(--green)', cursor: 'pointer' }} onClick={clear}>{t('clear')}</button>
      </div>
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', height: 150, background: '#fff', border: '1.5px dashed #9AA79D', borderRadius: 14, touchAction: 'none', cursor: 'crosshair' }}
        aria-label={t('signature')} />
      {empty && <div className="sub">{t('sign_here')}</div>}
    </div>
  )
}

// uploads the current signature and returns its storage path
export async function uploadSignature(employeeId) {
  const c = SignaturePad.lastCanvas?.current
  if (!c) throw new Error('signature required')
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const path = `${employeeId}/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' })
  if (error) throw error
  return path
}

export function SignatureImage({ path, height = 60 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    supabase.storage.from('signatures').createSignedUrl(path, 600).then(({ data }) => setUrl(data?.signedUrl))
  }, [path])
  if (!path) return null
  return url ? <img src={url} alt="signature" style={{ height, background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }} /> : null
}
