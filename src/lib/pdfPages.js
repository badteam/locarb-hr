// Big PDFs (scanned invoices are often 20-100 MB) are turned into one light JPEG per page before upload,
// so any size works: storage takes it and the AI reader gets clear pages instead of a file it can't accept.
const BIG = 6 * 1024 * 1024
const MAX_SIDE = 1800

export const isPdf = (f) => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '')

// -> File[] : the same file when it is small (or not a PDF), otherwise one JPEG per page
export async function pdfToPages(file, onProgress) {
  if (!isPdf(file) || file.size <= BIG) return [file]
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out = []
  const base = (file.name || 'invoice').replace(/\.pdf$/i, '')
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress?.(n, doc.numPages)
    const page = await doc.getPage(n)
    const v1 = page.getViewport({ scale: 1 })
    const scale = Math.min(3, MAX_SIDE / Math.max(v1.width, v1.height))
    const vp = page.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = Math.round(vp.width); c.height = Math.round(vp.height)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
    page.cleanup()
    if (blob) out.push(new File([blob], `${base}-p${n}.jpg`, { type: 'image/jpeg' }))
  }
  await doc.destroy()
  return out.length ? out : [file]
}
