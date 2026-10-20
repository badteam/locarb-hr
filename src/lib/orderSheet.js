// Reading branch order sheets (Excel) and helping link their free-typed names to inventory items.
// Pure functions only, so they can be tested outside the page.

export const normName = (s) => String(s ?? '').toLowerCase().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\s+/g, ' ').trim()
export const normUnit = (u) => {
  const s = String(u ?? '').toLowerCase().replace(/[^a-z؀-ۿ]/g, '')
  return s === '0' ? '' : s
}
const num = (v) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : null
}
const txt = (v) => (v == null ? '' : v instanceof Date ? '' : String(v)).trim()

// "DATE: 19/10/26", a real date cell, "19-10-2026" -> 'YYYY-MM-DD' (day first, as written in Kuwait)
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const m = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/)
  if (!m) return null
  let [, d, mo, y] = m.map(Number)
  if (y < 100) y += 2000
  if (mo > 12 && d <= 12) [d, mo] = [mo, d]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const isHead = (v, words) => { const s = normName(txt(v)); return words.some((w) => s === w || s.startsWith(w)) }
const NAME_H = ['item name', 'item', 'items', 'description', 'الصنف', 'اسم الصنف', 'المادة']
const QTY_H = ['qty', 'quantity', 'الكمية', 'كمية']
const UNIT_H = ['unit', 'uom', 'الوحدة', 'وحدة']

// One sheet -> { title, date, blocks: [{ title, lines: [{ row, name, unit, qty }] }] }
export function parseSheet(rows) {
  rows = rows || []
  let date = null, title = ''
  for (const r of rows.slice(0, 4)) for (const c of r || []) {
    if (!date) date = parseDate(c)
    const t = txt(c)
    if (!title && t && !/date/i.test(t) && !parseDate(t) && /order/i.test(t)) title = t
  }
  const heads = []
  rows.forEach((r, ri) => (r || []).forEach((c, ci) => { if (isHead(c, NAME_H)) heads.push([ri, ci]) }))
  const blocks = []
  for (const [ri, ci] of heads) {
    const hr = rows[ri]
    let qc = -1, uc = -1
    for (let k = ci + 1; k < Math.min(hr.length, ci + 7); k++) {
      if (qc < 0 && isHead(hr[k], QTY_H)) qc = k
      if (uc < 0 && isHead(hr[k], UNIT_H)) uc = k
    }
    if (qc < 0) continue
    // title of the block: text just above the header ("JABRIYA ADD ORDER")
    let bt = ''
    for (let k = Math.max(0, ci - 1); k <= ci + 2 && !bt; k++) { const t = txt(rows[ri - 1]?.[k]); if (t && !parseDate(t)) bt = t }
    const next = heads.filter(([r2, c2]) => c2 === ci && r2 > ri).map(([r2]) => r2)[0] ?? rows.length
    const lines = []
    for (let r = ri + 1; r < next; r++) {
      const row = rows[r] || []
      const name = txt(row[ci])
      const qty = num(row[qc])
      if (!name || /^\d+$/.test(name) || !qty || qty <= 0) continue
      lines.push({ row: r + 1, name: name.replace(/\s+/g, ' '), unit: uc >= 0 ? txt(row[uc]).replace(/^0$/, '') : '', qty })
    }
    blocks.push({ title: bt, lines })
  }
  // no header row: name in column B, unit in C, qty in D
  if (!blocks.length) {
    const lines = []
    rows.forEach((row, r) => { const name = txt(row?.[1]); const qty = num(row?.[3]); if (name && qty > 0) lines.push({ row: r + 1, name, unit: txt(row?.[2]), qty }) })
    if (lines.length) blocks.push({ title: '', lines })
  }
  return { title, date, blocks }
}

// latin consonant skeleton: "SABAH SALEM" ~ "Sabah Al-Salem", "MAHBOULA" ~ "Mahbula branch"
const skel = (s) => String(s || '').toLowerCase().replace(/\b(al|el|branch|order|add|evening|morning|locarb|kw)\b/g, ' ')
  .replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1')
export function guessBranch(texts, branches) {
  const want = texts.map(skel).filter((x) => x.length >= 3)
  for (const b of branches) {
    const names = [b.name_en, b.foodics_name].map(skel).filter((x) => x.length >= 3)
    if (want.some((w) => names.some((n) => n === w || n.includes(w) || w.includes(n)))) return b.id
  }
  for (const b of branches) if (texts.some((t) => String(t || '').includes(String(b.name || '').trim()))) return b.id
  return ''
}

// sheet unit words -> stock unit names used in the system
const UNIT_WORDS = {
  kg: ['كغ', 'كيلو'], kgs: ['كغ', 'كيلو'], kilo: ['كغ', 'كيلو'], كيلو: ['كغ', 'كيلو'], g: ['غرام'], gm: ['غرام'], gram: ['غرام'],
  pc: ['حبة'], pcs: ['حبة'], pce: ['حبة'], piece: ['حبة'], nos: ['حبة'], حبه: ['حبة'],
  pkt: ['باكيت'], pack: ['باكيت'], packet: ['باكيت'], باكيت: ['باكيت'],
  box: ['كرتون', 'علبة'], ctn: ['كرتون'], carton: ['كرتون'], كرتون: ['كرتون'],
  bag: ['كيس'], كيس: ['كيس'], gln: ['جالون'], gallon: ['جالون'], galon: ['جالون'], roll: ['رول'], ltr: ['لتر'], l: ['لتر'], litre: ['لتر'], liter: ['لتر'],
  btl: ['قنينة'], bottle: ['قنينة'], tray: ['صينية'], bunch: ['ربطة'], tin: ['تنكة'], bucket: ['سطل'], sack: ['شوال'], dozen: ['درزن'],
}
export const unitWords = (u) => UNIT_WORDS[normUnit(u)] || null

// How many stock units one sheet unit is. null = can't tell, ask the manager.
export function unitFactor(sheetUnit, item) {
  const u = normUnit(sheetUnit)
  const iu = item?.unit || ''
  if (!u) return 1
  const words = UNIT_WORDS[u]
  if (words && words.includes(iu)) return 1
  const grams = Number(item?.unit_grams) || 0
  if (['kg', 'kgs', 'kilo', 'كيلو'].includes(u)) {
    if (iu === 'غرام') return 1000
    if (grams > 0 && item?.unit_measure !== 'ml') return +(1000 / grams).toFixed(4)
  }
  if (['g', 'gm', 'gram'].includes(u)) {
    if (['كغ', 'كيلو'].includes(iu)) return 0.001
    if (grams > 0) return +(1 / grams).toFixed(6)
  }
  if (['ltr', 'l', 'litre', 'liter'].includes(u) && grams > 0 && item?.unit_measure === 'ml') return +(1000 / grams).toFixed(4)
  if (['pc', 'pcs', 'pce', 'piece', 'nos', 'حبه'].includes(u) && Number(item?.unit_pieces) > 1) return +(1 / Number(item.unit_pieces)).toFixed(6)
  return null
}

// rough text similarity for sorting the item picker and as a fallback when the AI can't be reached
const bigrams = (s) => { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a }
const dice = (a, b) => {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const x = bigrams(a), y = bigrams(b); let hit = 0; const pool = [...y]
  for (const g of x) { const k = pool.indexOf(g); if (k >= 0) { hit++; pool.splice(k, 1) } }
  return (2 * hit) / (x.length + y.length)
}
export function similarity(query, item) {
  const q = normName(query).replace(/\b\d+\s*(pce|pcs|pc|inch|ml|g|kg)\b/g, ' ').split(' ').filter((w) => w.length > 1)
  if (!q.length) return 0
  const names = [item.name_en, item.name_ar].map(normName).join(' ').split(' ').filter(Boolean)
  if (!names.length) return 0
  const per = q.map((w) => Math.max(...names.map((n) => (n.startsWith(w) || w.startsWith(n) && n.length > 3 ? 0.95 : dice(w, n)))))
  return per.reduce((a, b) => a + b, 0) / per.length
}
export function bestMatches(query, items, n = 8) {
  return items.map((i) => [i, similarity(query, i)]).sort((a, b) => b[1] - a[1]).slice(0, n)
}

// Kuwait calendar day of a timestamp
export const kwDay = (ts) => (ts ? new Date(new Date(ts).getTime() + 3 * 3600e3).toISOString().slice(0, 10) : null)

export async function fileHash(file) {
  const buf = await file.arrayBuffer()
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
