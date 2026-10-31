// A PDF with several pages may hold several separate papers (ID + passport + health card, or many invoices scanned together).
// splitPdf asks the AI where each paper starts and ends, then cuts the PDF into one PDF per paper.
// Anything that is not a multi-page PDF comes back as it is: [{ file }].
import { PDFDocument } from 'pdf-lib'
import { supabase } from './supabase'
import { isPdf } from './pdfPages'

const SMALL = 6 * 1024 * 1024 // above this the pages are re-drawn as JPEGs (scans of 20-100 MB)
const PER_ASK = 100           // the reader takes at most 100 pages at a time

let pdfjsP = null
async function pdfjs() {
  if (!pdfjsP) pdfjsP = (async () => {
    const lib = await import('pdfjs-dist')
    lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    return lib
  })()
  return pdfjsP
}
async function pageJpeg(doc, n, maxSide, quality) {
  const page = await doc.getPage(n)
  const v1 = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: Math.min(3, maxSide / Math.max(v1.width, v1.height)) })
  const c = document.createElement('canvas')
  c.width = Math.round(vp.width); c.height = Math.round(vp.height)
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality))
  page.cleanup()
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height }
}
// pages [from..to] (1-based) as a new PDF: copied as they are for normal files, re-drawn as JPEG for huge scans
async function cut(src, jsDoc, from, to, { maxSide = 1800, quality = 0.82 } = {}) {
  const out = await PDFDocument.create()
  if (src) {
    const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))
    pages.forEach((p) => out.addPage(p))
  } else {
    for (let n = from; n <= to; n++) {
      const j = await pageJpeg(jsDoc, n, maxSide, quality)
      const img = await out.embedJpg(j.bytes)
      out.addPage([j.w, j.h]).drawImage(img, { x: 0, y: 0, width: j.w, height: j.h })
    }
  }
  return new Uint8Array(await out.save())
}

async function ask(path, kind, pages) {
  const { data, error } = await supabase.functions.invoke('read-file', { body: { purpose: 'split', bucket: 'attachments', paths: [path], kind, pages } })
  if (error) { let b = {}; try { b = await error.context?.json() } catch { /* ignore */ } return { ok: false, error: b?.error || error.message } }
  return data
}

// clean the AI's ranges: inside the pages, in order, no overlap, every page covered
function ranges(papers, count) {
  const list = (papers || []).map((p) => ({ from: Math.max(1, Math.min(count, +p.first_page || 0)), to: Math.max(1, Math.min(count, +p.last_page || 0)), title: p.title_ar || '' }))
    .filter((p) => p.from && p.to >= p.from).sort((a, b) => a.from - b.from)
  const out = []
  let next = 1
  for (const p of list) {
    if (p.to < next) continue
    if (p.from > next) out.push({ from: next, to: p.from - 1, title: '' })
    out.push({ from: Math.max(p.from, next), to: p.to, title: p.title })
    next = p.to + 1
  }
  if (next <= count) out.push({ from: next, to: count, title: '' })
  return out
}

/**
 * @param file      the uploaded file
 * @param kind      'papers' (smart upload) or 'invoices' (price fill)
 * @param employeeId  for the temporary upload path
 * @param onState   progress text for the screen
 * @returns [{ file, from, to, title, pages }]  (one entry when there is nothing to split)
 */
export async function splitPdf(file, { kind = 'papers', employeeId, onState } = {}) {
  if (!isPdf(file)) return [{ file }]
  const small = file.size <= SMALL
  const bytes = new Uint8Array(await file.arrayBuffer())
  let src = null, jsDoc = null, count = 0
  try {
    if (small) { src = await PDFDocument.load(bytes, { ignoreEncryption: true }); count = src.getPageCount() }
  } catch { src = null }
  if (!src) {
    const lib = await pdfjs()
    jsDoc = await lib.getDocument({ data: bytes.slice() }).promise
    count = jsDoc.numPages
  }
  if (count <= 1) return [{ file, pages: count }]

  // 1. ask where each paper is (light copy of the pages, 100 at a time)
  const all = []
  for (let start = 1; start <= count; start += PER_ASK) {
    const end = Math.min(count, start + PER_ASK - 1)
    onState?.(`بشوف كم ورقة في الملف (${end} من ${count} صفحة)…`)
    const probe = await cut(src, jsDoc, start, end, { maxSide: 1100, quality: 0.6 })
    const path = `u/${employeeId || 'x'}/${crypto.randomUUID()}.pdf`
    const up = await supabase.storage.from('attachments').upload(path, new Blob([probe], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    if (up.error) throw up.error
    const r = await ask(path, kind, end - start + 1)
    supabase.storage.from('attachments').remove([path])
    if (!r?.ok) {
      if (['no_credit', 'invalid_key', 'not_configured'].includes(r?.error)) throw new Error(r.error)
      all.push({ from: start, to: end, title: '' }) // could not split this part: keep it together
      continue
    }
    for (const p of ranges(r.papers, end - start + 1)) all.push({ from: p.from + start - 1, to: p.to + start - 1, title: p.title })
  }
  if (all.length === 1 && small) return [{ file, from: 1, to: count, title: all[0].title, pages: count }]

  // 2. cut one PDF per paper
  const base = (file.name || 'file').replace(/\.pdf$/i, '')
  const out = []
  for (let i = 0; i < all.length; i++) {
    const p = all[i]
    onState?.(`بفصل الورقة ${i + 1} من ${all.length}…`)
    const data = await cut(src, jsDoc, p.from, p.to)
    const label = p.from === p.to ? `ص ${p.from}` : `ص ${p.from}-${p.to}`
    out.push({ file: new File([data], `${base} (${label}).pdf`, { type: 'application/pdf' }), from: p.from, to: p.to, title: p.title, pages: count })
  }
  if (jsDoc) await jsDoc.destroy()
  return out
}
