import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import readXlsxFile from 'read-excel-file/browser'
import { supabase } from '../../lib/supabase'
import { kwd, qtyFmt, loadLookups, invErr } from '../../lib/inv'
import { parseSheet, parseDate, guessBranch, spellKey, normName, normUnit, unitFactor, bestMatches, kwDay, fileHash, contentUnits, contentFactor } from '../../lib/orderSheet'
import ProductImage from '../../components/ProductImage.jsx'
import Icon from '../../components/Icon.jsx'
import ItemSearchSheet from '../../components/ItemSearchSheet.jsx'

// Branch orders written in Excel (one sheet per branch) entered into stock on their own date.
// Names are linked to items (saved links first, then the AI, then the manager), and items counted
// after the order day are left alone so the count is not spoiled.
const r3 = (n) => Math.round(n * 1000) / 1000
const branchKey = (s) => `order-import-branch:${normName(s)}`
const lsGet = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const draftKey = (hash) => `order-import-draft:${hash}`
const fmtDay = (d) => (d ? d.split('-').reverse().join('/') : '—')
const AI_ERR = { not_configured: 'مفتاح الذكاء مش متسجل في الإعدادات', invalid_key: 'مفتاح الذكاء غلط', no_credit: 'رصيد الذكاء خلص' }
const CONF = { saved: ['ok', 'مربوط من قبل'], manual: ['ok', 'ربطته أنت'], high: ['ok', 'الذكاء: متأكد'], medium: ['amber', 'الذكاء: غالباً'], low: ['red', 'الذكاء: تخمين'], guess: ['amber', 'تشابه في الاسم'] }

export default function OrderImport() {
  const [lookups, setLookups] = useState(null)
  const [items, setItems] = useState([])
  const [aliases, setAliases] = useState({})
  const [files, setFiles] = useState([])         // [{ name, hash }]
  const [sheets, setSheets] = useState([])
  const [maps, setMaps] = useState({})            // name|unit -> { item_id, factor, src, note }
  const [ov, setOv] = useState({})                // line id -> { ignore, kitchen, branch }
  const [counts, setCounts] = useState({})        // branch id -> { item id -> counted_at }
  const [done, setDone] = useState({})            // sheet key -> import row
  const [active, setActive] = useState(0)
  const [filter, setFilter] = useState('todo')
  const [mode, setMode] = useState('branch')     // 'branch' = all days of a branch together, 'day' = one sheet at a time
  const [gsel, setGsel] = useState('')            // chosen branch group
  const [picking, setPicking] = useState(null)    // mkey
  const [ai, setAi] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [drag, setDrag] = useState(false)
  const [history, setHistory] = useState([])
  const [stick, setStick] = useState(() => new Set())   // rows being worked on stay in view until the filter changes
  const timers = useRef({})

  const loadHistory = useCallback(() => supabase.from('order_imports').select('*, branches(name)').order('created_at', { ascending: false }).limit(40)
    .then(({ data }) => setHistory(data || [])), [])
  useEffect(() => {
    loadLookups().then(setLookups)
    supabase.from('inv_stock').select('id,name_ar,name_en,unit,category,unit_grams,unit_pieces,unit_measure,avg_cost').eq('active', true).order('name_ar').then(({ data }) => setItems(data || []))
    supabase.from('order_aliases').select('alias,unit,item_id,factor,content_qty,content_unit').then(({ data }) => setAliases(Object.fromEntries((data || []).map((a) => [`${a.alias}|${a.unit}`, a]))))
    loadHistory()
  }, [loadHistory])
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const kitchen = lookups?.kitchen
  const branchOpts = (lookups?.branches || []).filter((b) => !b.is_central_kitchen)

  // ---------- reading the file
  const readFiles = async (list) => {
    const fl = [...(list || [])].filter(Boolean)
    if (!fl.length) return
    const bad = fl.filter((f) => !/\.xlsx$/i.test(f.name))
    if (bad.length === fl.length) { setErr('الملف لازم يكون إكسل (.xlsx)'); return }
    setErr(''); setMsg(bad.length ? `اتجاهلت ${bad.length} ملف مش إكسل.` : ''); setBusy('read'); setSheets([]); setMaps({}); setOv({}); setDone({}); setActive(0)
    try {
      const out = [], got = [], allOv = {}
      for (const f of fl.filter((x) => /\.xlsx$/i.test(x.name))) {
        const [wb, hash] = await Promise.all([readXlsxFile(f), fileHash(f)])
        if (got.some((g) => g.hash === hash)) continue // the same file chosen twice
        got.push({ name: f.name, hash })
        let draft = {}
        try { draft = JSON.parse(lsGet(draftKey(hash)) || '{}') } catch { draft = {} }
        Object.assign(allOv, draft.ov || {})
        for (const sh of wb) {
          const p = parseSheet(sh.data)
          const key = `${hash}::${sh.sheet}`
          const lines = p.blocks.flatMap((b, bi) => b.lines.map((l) => ({ ...l, id: `${key}#${bi}#${l.row}`, block: b.title || (bi ? 'طلب إضافي' : 'الطلب'), extra: bi > 0, mkey: `${normName(l.name)}|${normUnit(l.unit)}`, skey: spellKey(l.name, l.unit) })))
          if (!lines.length) continue
          const saved = lsGet(branchKey(sh.sheet))
          let branch = branchOpts.some((b) => b.id === saved) ? saved : guessBranch([sh.sheet, p.title, ...p.blocks.map((b) => b.title), f.name], branchOpts)
          let date = p.date || parseDate(sh.sheet) || parseDate(f.name.replace(/\.xlsx$/i, '')) || ''
          // same file opened again: bring back what was chosen last time (branch, date, skipped lines, ticks)
          const d = draft.sheets?.[sh.sheet] || draft.sheets?.[key]
          if (d?.branch && branchOpts.some((b) => b.id === d.branch)) branch = d.branch
          if (d?.date) date = d.date
          out.push({ key, sheet: sh.sheet, name: sh.sheet.trim(), fname: f.name, fhash: hash, title: p.title, date, branch, lines })
        }
      }
      if (!out.length) { setErr('ما لقيت أصناف في الملفات. لازم يكون فيه عمود اسم الصنف (ITEM NAME) وعمود الكمية (QTY).'); setBusy(''); return }
      // by branch, then by day, so the same branch's days sit next to each other
      const bname = (id) => branchOpts.find((b) => b.id === id)?.name || 'zzz'
      out.sort((a, b) => bname(a.branch).localeCompare(bname(b.branch), 'ar') || String(a.date).localeCompare(String(b.date)) || a.name.localeCompare(b.name))
      setFiles(got)
      setSheets(out)
      setOv(allOv)
      const { data: prev } = await supabase.from('order_imports').select('*').in('file_hash', got.map((g) => g.hash)).eq('status', 'posted')
      setDone(Object.fromEntries((prev || []).map((x) => [`${x.file_hash}::${x.sheet_name}`, x])))
      // links: saved ones first. A name is linked once for all files and days.
      const m = {}
      const todo = []
      // a saved link also counts for the same name spelled another way ("sabon" = "saboon")
      const bySpell = {}
      for (const a of Object.values(aliases)) bySpell[spellKey(a.alias, a.unit)] ||= a
      for (const l of out.flatMap((x) => x.lines)) {
        if (m[l.mkey] || todo.some((t) => t.mkey === l.mkey)) continue
        const a = aliases[l.mkey] || bySpell[l.skey]
        if (a && byId[a.item_id]) m[l.mkey] = { item_id: a.item_id, factor: a.content_qty != null ? String(a.content_qty) : a.factor != null ? String(a.factor) : null, fu: a.content_qty != null ? a.content_unit : null, src: 'saved' }
        else todo.push(l)
      }
      setMaps(m)
      setBusy('')
      if (todo.length) matchWithAi(todo, false, out.flatMap((x) => x.lines))
    } catch (e) { setErr('ما قدرت أقرا الملف: ' + (e.message || e)); setBusy('') }
  }

  const matchWithAi = async (allTodo, again = false, allLines = null) => {
    // one question per spelling group: "sabon", "saboon" and "sabun" are asked once
    const seenS = new Set()
    const todo = allTodo.filter((l) => !seenS.has(l.skey) && seenS.add(l.skey))
    setAi('running')
    const chunks = []
    for (let i = 0; i < todo.length; i += 40) chunks.push(todo.slice(i, i + 40))
    // a few at a time (many at once get refused), and a failed batch is tried once more
    const call = (c) => supabase.functions.invoke('match-order-items', { body: { lines: c.map((l) => ({ name: l.name, unit: l.unit })) } })
      .then(({ data, error }) => (error || !data?.ok ? { fail: data?.error || 'network' } : data)).catch(() => ({ fail: 'network' }))
    const res = new Array(chunks.length)
    let next = 0
    const worker = async () => {
      while (next < chunks.length) {
        const i = next++
        let r = await call(chunks[i])
        if (r.fail && !['not_configured', 'invalid_key', 'no_credit'].includes(r.fail)) r = await call(chunks[i])
        res[i] = r
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker))
    const found = {}
    let failed = ''
    res.forEach((r, ci) => {
      const chunk = chunks[ci]
      if (r.fail) failed = r.fail
      const got = Object.fromEntries((r.matches || []).map((x) => [x.line, x]))
      chunk.forEach((l, i) => {
        const x = got[i]
        if (x?.item_id) found[l.mkey] = { item_id: x.item_id, factor: null, src: x.confidence, note: x.note }
        else {
          // the AI found nothing (or couldn't run): offer the closest name if it is close enough
          const [best] = bestMatches(l.name, items, 1)
          if (best && best[1] >= 0.8) found[l.mkey] = { item_id: best[0].id, factor: null, src: 'guess', note: r.fail ? '' : x?.note }
        }
      })
    })
    // the answer for one spelling goes to every spelling of it
    const lines = allLines || sheets.flatMap((x) => x.lines)
    const bySkey = {}
    for (const l of todo) if (found[l.mkey]) bySkey[l.skey] = found[l.mkey]
    for (const l of [...allTodo, ...lines]) if (!found[l.mkey] && bySkey[l.skey]) found[l.mkey] = { ...bySkey[l.skey] }
    setMaps((m) => (again ? { ...m, ...Object.fromEntries(Object.entries(found).filter(([k]) => !['saved', 'manual'].includes(m[k]?.src))) } : { ...found, ...m }))
    setAi(failed ? 'error:' + failed : 'done')
  }

  // run the AI again for every line not already linked by hand or from before
  const retryAi = () => {
    const seen = new Set()
    const todo = sheets.flatMap((x) => x.lines).filter((l) => !['saved', 'manual'].includes(maps[l.mkey]?.src) && !seen.has(l.mkey) && seen.add(l.mkey))
    if (todo.length) matchWithAi(todo, true)
  }

  // ---------- counts: when was each item last counted, in the kitchen and in each branch
  const sheetBranches = sheets.map((s) => s.branch).filter(Boolean).join(',')
  const mappedIds = useMemo(() => [...new Set(Object.values(maps).map((m) => m.item_id).filter(Boolean))], [maps])
  useEffect(() => {
    if (!kitchen || !mappedIds.length) return
    const places = [...new Set([kitchen.id, ...sheetBranches.split(',').filter(Boolean)])]
    Promise.all(places.map((b) => supabase.rpc('last_counted', { p_branch: b, p_items: mappedIds }).then(({ data }) => [b, Object.fromEntries((data || []).map((x) => [x.item_id, x.counted_at]))])))
      .then((all) => setCounts(Object.fromEntries(all)))
  }, [kitchen, mappedIds, sheetBranches])

  // remember choices for this file in this browser, and warn before leaving with sheets not posted
  useEffect(() => {
    for (const f of files) {
      const mine = sheets.filter((x) => x.fhash === f.hash)
      lsSet(draftKey(f.hash), JSON.stringify({ ov: Object.fromEntries(Object.entries(ov).filter(([k]) => k.startsWith(f.hash + '::'))),
        sheets: Object.fromEntries(mine.map((x) => [x.sheet, { branch: x.branch, date: x.date }])) }))
    }
  }, [files, ov, sheets])
  const pending = files.length > 0 && sheets.some((s) => !done[s.key])
  useEffect(() => {
    if (!pending) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  // ---------- each line, worked out
  const work = (s, l) => {
    const m = maps[l.mkey]
    const item = m ? byId[m.item_id] : null
    const factor = item ? (m.factor != null && m.factor !== '' ? contentFactor(m.factor, m.fu || item.unit, item) : unitFactor(l.unit, item)) : null
    const o = ov[l.id] || {}
    const skipFor = (place) => {
      const day = kwDay(counts[place]?.[item?.id])
      if (!day || !s.date) return null
      if (day > s.date) return `اتجرد ${fmtDay(day)} بعد الطلبية`
      if (day === s.date) return `اتجرد نفس يوم الطلبية`
      return null
    }
    const kSkip = item && kitchen ? skipFor(kitchen.id) : null
    const bSkip = item && s.branch ? skipFor(s.branch) : null
    const k = o.kitchen ?? !kSkip
    const b = o.branch ?? !bSkip
    let state = 'ok'
    if (o.ignore) state = 'ignored'
    else if (!item) state = 'item'
    else if (factor == null || !(factor > 0)) state = 'factor'
    else if (['medium', 'low', 'guess'].includes(m.src)) state = 'review'
    return { m, item, factor, k, b, kSkip, bSkip, state, stock: factor > 0 ? r3(l.qty * factor) : null }
  }
  const sheet = sheets[active]
  // ---------- branch view: every day of one branch on one screen
  const gkey = (x) => x.branch || 'name:' + normName(x.name).replace(/[^a-z\u0600-\u06ff]+/g, ' ').trim()
  const groups = useMemo(() => {
    const g = {}
    for (const x of sheets) { const k = gkey(x); (g[k] ||= { key: k, branch: x.branch, label: x.branch ? branchOpts.find((b) => b.id === x.branch)?.name || x.name : x.name, sheets: [] }).sheets.push(x) }
    return Object.values(g).map((v) => ({ ...v, sheets: v.sheets.sort((a, b) => String(a.date).localeCompare(String(b.date))) }))
  }, [sheets, lookups]) // eslint-disable-line react-hooks/exhaustive-deps
  const grp = groups.find((x) => x.key === gsel) || groups[0]
  // same written name in all the open days of the branch, summed
  const grpRows = useMemo(() => {
    if (!grp) return []
    const by = {}
    for (const x of grp.sheets) {
      if (done[x.key]) continue
      for (const l of x.lines) {
        const w = work(x, l)
        const r = (by[l.skey] ||= { mkey: l.mkey, mkeys: [], names: [], name: l.name, units: new Set(), days: [], ids: [], w: null, qty: 0, stock: 0, skipK: 0, skipB: 0, ignored: 0 })
        if (!r.mkeys.includes(l.mkey)) r.mkeys.push(l.mkey)
        if (!r.names.includes(l.name.trim())) r.names.push(l.name.trim())
        r.units.add(l.unit || ''); r.ids.push(l.id)
        // the row shows the spelling that still needs work first
        if (!r.w || (['item', 'factor', 'review'].includes(w.state) && !['item', 'factor', 'review'].includes(r.w.state))) { r.w = w; r.mkey = l.mkey }
        if (w.state === 'ignored') { r.ignored++; continue }
        r.days.push({ date: x.date, qty: l.qty, unit: l.unit, extra: l.extra })
        r.qty += Number(l.qty) || 0; r.stock += w.stock || 0
        if (w.item && !w.k) r.skipK++
        if (w.item && !w.b) r.skipB++
      }
    }
    return Object.values(by).map((r) => ({ ...r, allIgnored: r.ignored === r.ids.length, state: r.ignored === r.ids.length ? 'ignored' : r.w.state }))
      .sort((a, b) => ({ item: 0, factor: 1, review: 2, ok: 3, ignored: 4 }[a.state] - { item: 0, factor: 1, review: 2, ok: 3, ignored: 4 }[b.state]) || a.name.localeCompare(b.name))
  }, [grp, maps, ov, counts, byId, done]) // eslint-disable-line react-hooks/exhaustive-deps
  const setGroupBranch = (g, branchId) => {
    setSheets((all) => all.map((x) => (g.sheets.some((y) => y.key === x.key) && !done[x.key] ? { ...x, branch: branchId } : x)))
    for (const x of g.sheets) lsSet(branchKey(x.sheet), branchId)
    if (branchId) setGsel(branchId)
  }
  const setSheetDate = (key, date) => setSheets((all) => all.map((x) => (x.key === key ? { ...x, date } : x)))
  const ignoreName = (r, on) => setOv((o) => ({ ...o, ...Object.fromEntries(r.ids.map((id) => [id, { ...(o[id] || {}), ignore: on }])) }))
  const postGroup = async (g) => {
    const list = g.sheets.filter((x) => readySheets.includes(x))
    setBusy('postall'); setErr(''); setMsg('')
    let ok = 0, n = 0, value = 0
    const bad = []
    for (const x of list) {
      try { const d = await postSheet(x, false); ok++; n += d.lines; value += Number(d.value) || 0 }
      catch (e) { bad.push(`${fmtDay(x.date)}: ${/already imported/.test(e.message) ? 'اترفع قبل كده' : postErr(e)}`) }
    }
    setBusy(''); setConfirm(null); loadHistory()
    setMsg(`${g.label}: اتسجل ${ok} يوم (${n} سطر بقيمة ${kwd(value)} د.ك)، كل يوم بتاريخه.`)
    if (bad.length) setErr('ما اتسجلش: ' + bad.join(' — '))
    const next = groups.find((x) => x.key !== g.key && x.sheets.some((y) => !done[y.key] && !list.includes(y)))
    if (next) setGsel(next.key)
  }
  const rows = useMemo(() => (sheet ? sheet.lines.map((l) => ({ l, w: work(sheet, l) })) : []), [sheet, maps, ov, counts, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const tally = (s) => {
    const t = { item: 0, factor: 0, review: 0, ok: 0, ignored: 0, skipK: 0, skipB: 0 }
    for (const l of s.lines) { const w = work(s, l); t[w.state]++; if (w.state !== 'ignored' && w.item) { if (!w.k) t.skipK++; if (!w.b) t.skipB++ } }
    return t
  }
  const shown = rows.filter(({ l, w }) => filter === 'all' || stick.has(l.id) || (filter === 'todo' ? ['item', 'factor', 'review'].includes(w.state) : filter === 'skip' ? w.item && (!w.k || !w.b) && w.state !== 'ignored' : w.state === filter))

  const setMap = (mkey, patch) => setMaps((m) => ({ ...m, [mkey]: { ...(m[mkey] || {}), ...patch } }))
  // every link the manager makes is saved right away, so closing the page loses nothing
  const saveLink = (mkey, m) => {
    const item = byId[m?.item_id]
    if (!item) return
    const [alias, unit] = mkey.split('|')
    const typed = m.factor != null && m.factor !== '' ? Number(m.factor) : null
    const factor = typed != null ? contentFactor(typed, m.fu || item.unit, item) : null
    supabase.rpc('save_order_alias', { p_alias: alias, p_unit: unit, p_item: item.id, p_factor: factor, p_content_qty: typed, p_content_unit: typed != null ? (m.fu || item.unit) : null })
      .then(({ error }) => { if (error) setErr('ما قدرت أحفظ الربط: ' + invErr(error)) })
    setAliases((a) => ({ ...a, [mkey]: { alias, unit, item_id: item.id, factor, content_qty: typed, content_unit: m.fu || null } }))
  }
  const linkChange = (mkey, patch) => {
    const m = { ...(maps[mkey] || {}), ...patch }
    setMaps((all) => ({ ...all, [mkey]: m }))
    saveLink(mkey, m)
  }
  const setLine = (id, patch) => setOv((o) => ({ ...o, [id]: { ...(o[id] || {}), ...patch } }))
  const setSheet = (patch) => setSheets((all) => all.map((s, i) => (i === active ? { ...s, ...patch } : s)))
  const okAllReview = () => {
    const next = {}
    for (const { l, w } of rows) if (w.state !== 'ignored' && ['medium', 'low', 'guess'].includes(w.m?.src)) next[l.mkey] = { ...maps[l.mkey], src: 'manual' }
    setMaps((m) => ({ ...m, ...next }))
    Object.entries(next).forEach(([k, m]) => saveLink(k, m))
  }

  // ---------- posting one sheet
  const linesFor = (s) => s.lines.map((l) => [l, work(s, l)]).filter(([, w]) => w.state !== 'ignored').map(([l, w]) => ({
    item_id: w.item.id, qty: w.stock, kitchen: w.k, branch: w.b,
    note: [l.extra ? l.block : '', `${l.name} ${qtyFmt(l.qty)} ${l.unit}`.trim(), !w.k ? 'ما انخصم من المطبخ: ' + (w.kSkip || 'باختيارك') : '', !w.b ? 'ما انضاف للفرع: ' + (w.bSkip || 'باختيارك') : ''].filter(Boolean).join(' · '),
    alias: normName(l.name), unit: normUnit(l.unit), factor: w.factor,
    content_qty: w.m?.factor != null && w.m.factor !== '' ? Number(w.m.factor) : null, content_unit: w.m?.factor != null && w.m.factor !== '' ? (w.m.fu || w.item.unit) : null,
  }))
  // one sheet into stock; returns the import row or throws
  const postSheet = async (s, force) => {
    const lines = linesFor(s)
    const { data, error } = await supabase.rpc('post_order_import', { p_branch: s.branch, p_date: s.date, p_file_name: s.fname, p_file_hash: s.fhash, p_sheet: s.sheet, p_lines: lines, p_force: force })
    if (error) throw error
    setDone((d) => ({ ...d, [s.key]: { ...data, id: data.id, request_id: data.request_id } }))
    // the links just saved count as saved links from now on
    setAliases((a) => ({ ...a, ...Object.fromEntries(lines.map((x) => [`${x.alias}|${x.unit}`, { alias: x.alias, unit: x.unit, item_id: x.item_id, factor: x.factor, content_qty: x.content_qty, content_unit: x.content_unit }])) }))
    setMaps((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, lines.some((x) => `${x.alias}|${x.unit}` === k) ? { ...v, src: 'saved' } : v])))
    return data
  }
  const postErr = (e) => (/future/.test(e.message) ? 'تاريخ الطلبية في المستقبل' : /not allowed to import/.test(e.message) ? 'ما عندك صلاحية' : invErr(e))
  const post = async (force = false) => {
    const s = sheet
    setBusy('post'); setErr('')
    try {
      const data = await postSheet(s, force)
      setConfirm(null)
      setMsg(`اتسجلت طلبية ${s.name} (${fmtDay(s.date)}): ${data.lines} صنف بقيمة ${kwd(data.value)} د.ك. انخصم من المطبخ ${data.kitchen} صنف، وانضاف للفرع ${data.branch} صنف.`)
      loadHistory()
      const nextOpen = sheets.findIndex((x, i) => i !== active && !done[x.key])
      if (nextOpen >= 0) { setActive(nextOpen); setFilter('todo') }
    } catch (e) {
      if (/already imported/.test(e.message)) setConfirm({ again: true })
      else { setErr(postErr(e)); setConfirm(null) }
    }
    setBusy('')
  }
  // every sheet that is ready (branch, date, nothing to review) in one go, oldest day first
  const readySheets = sheets.filter((x) => { if (done[x.key] || !x.branch || !x.date) return false; const tt = tally(x); return !(tt.item + tt.factor + tt.review) && tt.ok > 0 })
  const postAll = async () => {
    setBusy('postall'); setErr(''); setMsg('')
    const list = [...readySheets].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    let ok = 0, lines = 0, value = 0
    const skipped = [], failed = []
    for (const x of list) {
      try { const d = await postSheet(x, false); ok++; lines += d.lines; value += Number(d.value) || 0 }
      catch (e) { if (/already imported/.test(e.message)) skipped.push(`${x.name} ${fmtDay(x.date)}`); else failed.push(`${x.name} ${fmtDay(x.date)}: ${postErr(e)}`) }
    }
    setBusy(''); setConfirm(null); loadHistory()
    setMsg(`اتسجل ${ok} شيت (${lines} سطر بقيمة ${kwd(value)} د.ك).${skipped.length ? ` ما سجلتش ${skipped.length} عشان اترفعوا قبل كده: ${skipped.join('، ')}.` : ''}`)
    if (failed.length) setErr('ما اتسجلش: ' + failed.join(' — '))
    const nextOpen = sheets.findIndex((x) => !done[x.key] && !list.includes(x))
    if (nextOpen >= 0) { setActive(nextOpen); setFilter('todo') }
  }
  const undo = async (row) => {
    if (!window.confirm(`تتراجع عن طلبية ${row.branches?.name || ''} بتاريخ ${fmtDay(row.order_date)}؟ الكميات ترجع للمطبخ وتتشال من الفرع.`)) return
    setBusy('undo:' + row.id)
    const { error } = await supabase.rpc('undo_order_import', { p_id: row.id })
    setBusy('')
    if (error) { setErr(invErr(error)); return }
    setMsg('اتراجعت الطلبية، والكميات رجعت زي ما كانت.')
    setDone((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v.id !== row.id)))
    loadHistory()
  }

  if (!lookups || !items.length) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  const t = sheet ? tally(sheet) : null
  const isDone = sheet && done[sheet.key]
  const blocking = t ? t.item + t.factor + t.review : 0
  const canPost = sheet && !isDone && sheet.branch && sheet.date && !blocking && t.ok > 0
  const total = rows.reduce((a, { w }) => a + (w.state === 'ok' || w.state === 'review' ? (w.stock || 0) * Number(w.item?.avg_cost || 0) : 0), 0)

  return (
    <div style={{ paddingBottom: 100 }}>
      <div className="page-head">
        <div><Link to="/inventory/orders" className="sub" style={{ textDecoration: 'none' }}>→ طلبات الفروع</Link>
          <h1 style={{ marginTop: 4 }}>رفع طلبيات الفروع من إكسل</h1>
          <div className="sub">كل شيت = فرع. الطلبية تنسجّل بتاريخها، تنخصم من المطبخ وتنضاف للفرع، إلا الأصناف اللي اتجردت بعد التاريخ ده.</div></div>
      </div>

      <label className={'card drop' + (drag ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); readFiles(e.dataTransfer.files) }}>
        <input type="file" accept=".xlsx" multiple style={{ display: 'none' }} onChange={(e) => { readFiles(e.target.files); e.target.value = '' }} />
        {busy === 'read' ? <span className="spinner" /> : <Icon name="download" size={26} />}
        <div><strong>{files.length > 1 ? `${files.length} ملفات: ${files.map((f) => f.name).join('، ')}` : files.length ? files[0].name : 'اسحب ملفات الإكسل هنا (كل الأيام مرة واحدة)'}</strong>
          <div className="sub">{files.length ? 'اسحب ملفات تانية أو اضغط عشان تغيّرها' : 'أو اضغط واختار ملف أو أكتر من جهازك. أي اسم صنف تربطه مرة، بيتربط في كل الملفات والأيام.'}</div></div>
      </label>

      {ai === 'running' && <div className="notice row" style={{ gap: 10, marginTop: 12 }}><span className="spinner" /> الذكاء بيربط أسامي الأصناف بالمخزن… ممكن ياخد دقيقة.</div>}
      {ai.startsWith('error') && <div className="warn" style={{ marginTop: 12 }}><Icon name="warn" /> الذكاء ما اشتغلش ({AI_ERR[ai.slice(6)] || (ai.slice(6) === 'network' ? 'مشكلة اتصال' : ai.slice(6, 120))}). ربطت اللي أسماؤه قريبة، والباقي اختاره بإيدك. <button className="btn" style={{ minHeight: 34, marginInlineStart: 'auto' }} onClick={retryAi}>حاول تاني</button></div>}
      {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {sheets.length > 0 && (
        <div className="seg" style={{ maxWidth: 420, marginTop: 14 }}>
          {[['branch', 'كل أيام الفرع مع بعض'], ['day', 'يوم يوم']].map(([k, lb]) =>
            <a key={k} href={'#' + k} className={mode === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setMode(k) }}>{lb}</a>)}
        </div>)}

      {sheets.length > 0 && mode === 'branch' && grp && (() => {
        const gReady = grp.sheets.filter((x) => readySheets.includes(x))
        const gOpen = grp.sheets.filter((x) => !done[x.key])
        const need = grpRows.filter((r) => ['item', 'factor', 'review'].includes(r.state)).length
        const value = grpRows.reduce((a, r) => a + (r.state === 'ok' || r.state === 'review' ? r.stock * Number(r.w.item?.avg_cost || 0) : 0), 0)
        const shownRows = grpRows.filter((r) => filter === 'all' || stick.has(r.mkey) || (filter === 'todo' ? ['item', 'factor', 'review'].includes(r.state) : filter === 'ok' ? r.state === 'ok' : r.state === filter))
        return <>
          <div className="chips" style={{ margin: '12px 0' }}>
            {groups.map((g) => {
              const open = g.sheets.filter((x) => !done[x.key])
              const n = open.reduce((a, x) => { const t = tally(x); return a + t.item + t.factor + t.review }, 0)
              return <button key={g.key} className={'chip' + (g.key === grp.key ? ' on' : '')} onClick={() => { setGsel(g.key); setFilter('todo'); setStick(new Set()) }}>
                {g.label} <span className="sub" style={{ marginInlineStart: 4 }}>{g.sheets.length} يوم</span>
                {!open.length ? <span className="pill ok" style={{ marginInlineStart: 6 }}>اتسجل ✓</span>
                  : !g.branch ? <span className="pill red" style={{ marginInlineStart: 6 }}>بدون فرع</span>
                  : n ? <span className="badge" style={{ marginInlineStart: 6 }}>{n}</span> : <span className="pill ok" style={{ marginInlineStart: 6 }}>جاهز</span>}</button>
            })}
          </div>

          <div className="card form" style={{ gap: 10, marginBottom: 12 }}>
            <div className="field"><label htmlFor="gb">الفرع (لكل الأيام)</label>
              <select id="gb" className="input" value={grp.branch || ''} disabled={!gOpen.length} onChange={(e) => setGroupBranch(grp, e.target.value)}>
                <option value="">— اختار الفرع —</option>{branchOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {grp.sheets.map((x) => (
                <span key={x.key} className="row" style={{ gap: 4, border: '1px solid var(--line)', borderRadius: 10, padding: '4px 8px' }}>
                  <span className="sub" style={{ fontSize: 12 }}>{x.name}</span>
                  {done[x.key] ? <span className="pill ok">{fmtDay(x.date)} ✓</span>
                    : <input type="date" className="input" style={{ height: 34, width: 150 }} value={x.date} max={kwDay(Date.now())} onChange={(e) => setSheetDate(x.key, e.target.value)} aria-label="تاريخ اليوم" />}
                </span>))}
            </div>
            {!grp.branch && <div className="warn"><Icon name="warn" /> "{grp.label}" مش لاقي له فرع في السيستم. اختاره من فوق (بيتطبق على كل الأيام)، ولو الفرع مش موجود ضيفه من صفحة الفروع الأول.</div>}
            <div className="sub">كل اسم بيظهر مرة واحدة ومعاه كمية كل يوم والإجمالي. بتربطه مرة، وكل يوم بيتسجل بتاريخه.</div>
          </div>

          {gOpen.length > 0 && <>
            <div className="seg" style={{ maxWidth: 520 }}>
              {[['todo', `محتاج مراجعة (${need})`], ['ok', `جاهز (${grpRows.filter((r) => r.state === 'ok').length})`], ['all', `الكل (${grpRows.length})`]].map(([k, lb]) =>
                <a key={k} href={'#' + k} className={filter === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setFilter(k); setStick(new Set()) }}>{lb}</a>)}
            </div>
            {grpRows.some((r) => r.state === 'review') && filter !== 'ok' && <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <span className="sub">الأصفر: الذكاء مش متأكد. بص عليهم، غيّر الغلط، وبعدين أكّد الباقي.</span>
              <button className="btn" style={{ minHeight: 38 }} onClick={() => { const next = {}; for (const r of grpRows) if (r.state === 'review') for (const k of r.mkeys) if (maps[k]) next[k] = { ...maps[k], src: 'manual' }; setMaps((m) => ({ ...m, ...next })); Object.entries(next).forEach(([k, m]) => saveLink(k, m)) }}>
                <Icon name="check" size={16} /> أكّد كل الأصفر ({grpRows.filter((r) => r.state === 'review').length})</button></div>}

            <div className="order-list">
              {shownRows.map((r) => {
                const w = r.w, st = r.state
                const tone = st === 'ignored' ? 'gray' : st === 'item' || st === 'factor' ? 'red' : st === 'review' ? 'amber' : 'ok'
                const unit = r.units.size === 1 ? [...r.units][0] : ''
                return (
                  <div key={r.mkey} className={'order-row imp ' + tone} onPointerDownCapture={() => !stick.has(r.mkey) && setStick((x) => new Set(x).add(r.mkey))}>
                    <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 150, flex: '1 1 180px' }}>
                        <div style={{ fontWeight: 700, direction: 'ltr', textAlign: 'right' }}>{r.names[0]}</div>
                        {r.names.length > 1 && <div className="cell-sub" style={{ direction: 'ltr', textAlign: 'right' }}>مكتوب كمان: {r.names.slice(1).join(' · ')}</div>}
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {r.days.map((d, i) => <span key={i} className="pill gray" style={{ fontSize: 11 }}>{fmtDay(d.date).slice(0, 5)}: {qtyFmt(d.qty)}{r.units.size > 1 ? ` ${d.unit || ''}` : ''}{d.extra ? ' +' : ''}</span>)}
                        </div>
                        <div className="num" style={{ fontWeight: 700, marginTop: 4 }}>الإجمالي: {qtyFmt(r.qty)} {unit}</div>
                      </div>
                      <div className="grow" style={{ flex: '2 1 240px' }}>
                        {w.item ? (
                          <button type="button" className="pick" onClick={() => setPicking(r.mkeys)}>
                            <ProductImage itemId={w.item.id} size={40} />
                            <span className="grow" style={{ textAlign: 'start' }}><span style={{ fontWeight: 600 }}>{w.item.name_ar}</span>
                              <span className="cell-sub" style={{ display: 'block' }}>{w.item.name_en}{w.item.unit ? ` · ${w.item.unit}` : ''}</span></span>
                            <span className="sub" style={{ fontSize: 12 }}>تغيير</span>
                          </button>
                        ) : <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => setPicking(r.mkeys)} disabled={st === 'ignored'}><Icon name="search" size={16} /> اختار الصنف</button>}
                        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          {w.m?.src && CONF[w.m.src] && <span className={'pill ' + CONF[w.m.src][0]}>{CONF[w.m.src][1]}</span>}
                          {w.m?.note && st === 'review' && <span className="sub" style={{ fontSize: 12 }}>{w.m.note}</span>}
                          {st === 'review' && <button className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 13 }} onClick={() => r.mkeys.forEach((k) => linkChange(k, { src: 'manual' }))}>✓ صح</button>}
                        </div>
                      </div>
                    </div>
                    {w.item && st !== 'ignored' && (
                      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {(w.factor !== 1 || st === 'factor' || w.m?.factor != null) && (
                          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <span className="sub">1 {unit || 'وحدة'} =</span>
                            <input className="input num" style={{ width: 90, height: 40 }} inputMode="decimal" placeholder="؟" aria-label={`كم في الـ ${unit}`}
                              value={w.m?.factor ?? (w.factor ?? '')} onChange={(e) => {
                                const v = e.target.value.replace(/[^\d.]/g, '')
                                for (const k of r.mkeys) {
                                  const m = { ...(maps[k] || maps[r.mkey] || {}), factor: v === '' ? null : v }
                                  setMap(k, { ...m })
                                  clearTimeout(timers.current[k])
                                  timers.current[k] = setTimeout(() => saveLink(k, m), 800)
                                }
                              }} />
                            <select className="input" style={{ width: 'auto', height: 40, paddingInline: 10 }} aria-label="الوحدة" value={w.m?.fu || w.item.unit || ''}
                              onChange={(e) => r.mkeys.forEach((k) => linkChange(k, { ...(maps[r.mkey] || {}), fu: e.target.value, factor: w.m?.factor ?? null }))}>
                              {contentUnits(w.item).map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>)}
                        <span className="grow" />
                        <span style={{ fontWeight: 700 }} className="num">{st === 'factor' ? '—' : `${qtyFmt(r.stock)} ${w.item.unit || ''}`}</span>
                      </div>)}
                    {st === 'factor' && <div className="sub" style={{ color: 'var(--red)', fontSize: 13 }}>الشيت بالـ "{unit}" والصنف في المخزن بالـ "{w.item.unit}". اكتب الـ {unit} الواحد فيه كام. بيتحفظ للمرات الجاية.</div>}
                    {(r.skipK > 0 || r.skipB > 0) && st !== 'ignored' && <div className="sub" style={{ fontSize: 12, color: 'var(--amber)' }}>
                      {r.skipK ? `${r.skipK} يوم ما هيتخصمش من المطبخ (اتجرد بعدها) ` : ''}{r.skipB ? `· ${r.skipB} يوم ما هيتضافش للفرع (اتجرد بعدها)` : ''}</div>}
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 13 }} onClick={() => ignoreName(r, !r.allIgnored)}>
                        {r.allIgnored ? 'رجّع الصنف ده' : 'تجاهل الصنف ده في كل الأيام'}</button>
                    </div>
                  </div>)
              })}
              {shownRows.length === 0 && <div className="card empty">{filter === 'todo' ? 'كله تمام في الفرع ده ✓' : 'ما فيه حاجة هنا'}</div>}
            </div>
          </>}
          {gOpen.length > 0 && <div className="order-bar">
            <div className="grow"><strong>{grp.label}</strong> · {gOpen.length} يوم · <span className="num">{kwd(value)}</span> د.ك
              {need ? <span className="sub"> · باقي {need} صنف محتاج مراجعة</span> : gReady.length < gOpen.length ? <span className="sub"> · {gOpen.length - gReady.length} يوم ناقص فرع أو تاريخ</span> : null}</div>
            <button className="btn primary" disabled={!gReady.length || !!busy} onClick={() => setConfirm({ group: grp.key })}>اعتماد {grp.label} ({gReady.length} يوم)</button>
          </div>}
        </>
      })()}

      {sheets.length > 0 && mode === 'day' && (
        <>
          <div className="chips" style={{ margin: '16px 0 12px' }}>
            {sheets.map((s, i) => {
              const tt = tally(s)
              const n = tt.item + tt.factor + tt.review
              return <button key={s.key} className={'chip' + (i === active ? ' on' : '')} onClick={() => { setActive(i); setFilter('todo'); setStick(new Set()) }}>
                {s.name}{s.date ? <span className="sub" style={{ marginInlineStart: 4 }}>{fmtDay(s.date).slice(0, 5)}</span> : null} {done[s.key] ? <span className="pill ok" style={{ marginInlineStart: 6 }}>اتسجل ✓</span>
                  : !s.branch ? <span className="pill red" style={{ marginInlineStart: 6 }}>بدون فرع</span>
                  : n ? <span className="badge" style={{ marginInlineStart: 6 }}>{n}</span> : <span className="pill ok" style={{ marginInlineStart: 6 }}>جاهز</span>}</button>
            })}
          </div>

          {sheets.length > 1 && <div className="card row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="grow sub">{sheets.length} شيت · اتسجل {sheets.filter((x) => done[x.key]).length} · جاهز {readySheets.length} · محتاج مراجعة {sheets.filter((x) => !done[x.key] && !readySheets.includes(x)).length}</span>
            <button className="btn primary" disabled={!readySheets.length || !!busy} onClick={() => setConfirm({ all: true })}>{busy === 'postall' ? <span className="spinner" /> : <Icon name="check" size={16} />} اعتماد كل الجاهز ({readySheets.length})</button>
          </div>}

          <div className="card" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 12 }}>
            <div className="field"><label htmlFor="ib">الفرع</label>
              <select id="ib" className="input" value={sheet.branch} disabled={!!isDone} onChange={(e) => { setSheet({ branch: e.target.value }); lsSet(branchKey(sheet.sheet), e.target.value) }}>
                <option value="">— اختار الفرع —</option>{branchOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="id">تاريخ الطلبية</label>
              <input id="id" type="date" className="input" value={sheet.date} disabled={!!isDone} max={kwDay(Date.now())} onChange={(e) => setSheet({ date: e.target.value })} /></div>
            <div className="field"><span className="lbl">في الشيت</span>
              <div className="sub" style={{ lineHeight: 1.7 }}>{sheet.lines.length} سطر{sheet.lines.some((l) => l.extra) ? ` (منهم ${sheet.lines.filter((l) => l.extra).length} طلب إضافي)` : ''}<br />
                {t.skipK ? `${t.skipK} صنف ما هيتخصمش من المطبخ` : 'كله هيتخصم من المطبخ'} · {t.skipB ? `${t.skipB} صنف ما هيتضافش للفرع` : 'كله هيتضاف للفرع'}</div></div>
          </div>
          {!sheet.branch && !isDone && <div className="warn" style={{ marginBottom: 12 }}><Icon name="warn" /> الشيت "{sheet.name}" مش لاقي له فرع في السيستم. اختاره من فوق، ولو الفرع مش موجود ضيفه من صفحة الفروع الأول.</div>}
          {isDone && <div className="notice row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}><span className="grow">الشيت ده اتسجل قبل كده.</span>
            {isDone.request_id && <Link className="btn" to={`/inventory/orders/${isDone.request_id}`}>افتح الطلبية</Link>}</div>}

          {!isDone && <>
            <div className="seg" style={{ maxWidth: 640 }}>
              {[['todo', `محتاج مراجعة (${blocking})`], ['skip', `متخطّى بسبب الجرد (${rows.filter(({ w }) => w.item && (!w.k || !w.b) && w.state !== 'ignored').length})`], ['ok', `جاهز (${t.ok})`], ['all', `الكل (${sheet.lines.length})`]].map(([k, lb]) =>
                <a key={k} href={'#' + k} className={filter === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setFilter(k); setStick(new Set()) }}>{lb}</a>)}
            </div>
            {rows.some(({ w }) => w.state !== 'ignored' && ['medium', 'low', 'guess'].includes(w.m?.src)) && filter !== 'ok' && <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <span className="sub">الأصفر: الذكاء مش متأكد. بص عليهم، غيّر الغلط، وبعدين أكّد الباقي.</span>
              <button className="btn" style={{ minHeight: 38 }} onClick={okAllReview}><Icon name="check" size={16} /> أكّد كل الأصفر ({rows.filter(({ w }) => w.state !== 'ignored' && ['medium', 'low', 'guess'].includes(w.m?.src)).length})</button></div>}

            <div className="order-list">
              {shown.map(({ l, w }) => {
                const st = w.state
                const tone = st === 'ignored' ? 'gray' : st === 'item' || st === 'factor' ? 'red' : st === 'review' ? 'amber' : 'ok'
                return (
                  <div key={l.id} className={'order-row imp ' + tone} onFocusCapture={() => !stick.has(l.id) && setStick((x) => new Set(x).add(l.id))}
                    onPointerDownCapture={() => !stick.has(l.id) && setStick((x) => new Set(x).add(l.id))}>
                    <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 150, flex: '1 1 160px' }}>
                        <div className="cell-sub">مكتوب في الشيت {l.extra ? <span className="pill blue" style={{ fontSize: 11, padding: '1px 6px' }}>{l.block}</span> : null}</div>
                        <div style={{ fontWeight: 700, direction: 'ltr', textAlign: 'right' }}>{l.name}</div>
                        <div className="num sub">{qtyFmt(l.qty)} {l.unit || ''}</div>
                      </div>
                      <div className="grow" style={{ flex: '2 1 240px' }}>
                        {w.item ? (
                          <button type="button" className="pick" onClick={() => setPicking(l.mkey)}>
                            <ProductImage itemId={w.item.id} size={40} />
                            <span className="grow" style={{ textAlign: 'start' }}><span style={{ fontWeight: 600 }}>{w.item.name_ar}</span>
                              <span className="cell-sub" style={{ display: 'block' }}>{w.item.name_en}{w.item.unit ? ` · ${w.item.unit}` : ''}</span></span>
                            <span className="sub" style={{ fontSize: 12 }}>تغيير</span>
                          </button>
                        ) : <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => setPicking(l.mkey)} disabled={st === 'ignored'}><Icon name="search" size={16} /> اختار الصنف</button>}
                        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          {w.m?.src && CONF[w.m.src] && <span className={'pill ' + CONF[w.m.src][0]}>{CONF[w.m.src][1]}</span>}
                          {w.m?.note && st === 'review' && <span className="sub" style={{ fontSize: 12 }}>{w.m.note}</span>}
                          {st === 'review' && <button className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 13 }} onClick={() => linkChange(l.mkey, { src: 'manual' })}>✓ صح</button>}
                        </div>
                      </div>
                    </div>

                    {w.item && st !== 'ignored' && (
                      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {(w.factor !== 1 || st === 'factor' || w.m?.factor != null) && (
                          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <span className="sub">1 {l.unit || 'وحدة'} =</span>
                            <input className="input num" style={{ width: 90, height: 40 }} inputMode="decimal" placeholder="؟" aria-label={`كم في الـ ${l.unit}`}
                              value={w.m?.factor ?? (w.factor ?? '')} onChange={(e) => {
                                const v = e.target.value.replace(/[^\d.]/g, '')
                                const m = { ...(maps[l.mkey] || {}), factor: v === '' ? null : v }
                                setMap(l.mkey, { factor: m.factor })
                                clearTimeout(timers.current[l.mkey])
                                timers.current[l.mkey] = setTimeout(() => saveLink(l.mkey, m), 800)
                              }} />
                            <select className="input" style={{ width: 'auto', height: 40, paddingInline: 10 }} aria-label="الوحدة" value={w.m?.fu || w.item.unit || ''}
                              onChange={(e) => linkChange(l.mkey, { fu: e.target.value, factor: w.m?.factor ?? null })}>
                              {contentUnits(w.item).map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                            {w.m?.fu && w.m.fu !== w.item.unit && w.factor > 0 && <span className="sub">= {qtyFmt(w.factor)} {w.item.unit}</span>}
                          </div>
                        )}
                        <span className="grow" />
                        <span style={{ fontWeight: 700 }} className="num">{w.stock != null ? `${qtyFmt(w.stock)} ${w.item.unit || ''}` : '—'}</span>
                      </div>
                    )}
                    {st === 'factor' && <div className="sub" style={{ color: 'var(--red)', fontSize: 13 }}>الشيت بالـ "{l.unit}" والصنف في المخزن بالـ "{w.item.unit}". اكتب الـ {l.unit} الواحد فيه كام، واختار الوحدة جنبها (كيلو، حبة…). بيتحفظ للمرات الجاية.</div>}
                    {st === 'factor' && contentUnits(w.item).length === 1 && <div className="sub" style={{ fontSize: 12 }}>عشان تكتبه بالكيلو أو بالحبة، سجّل الـ {w.item.unit} فيه كام كيلو/حبة من بطاقة الصنف في المخزون.</div>}

                    {w.item && st !== 'ignored' && (
                      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                        <label className="check"><input type="checkbox" checked={w.k} onChange={(e) => setLine(l.id, { kitchen: e.target.checked })} /> يتخصم من المطبخ
                          {w.kSkip && <span className="pill amber" style={{ marginInlineStart: 6 }}>{w.kSkip}</span>}</label>
                        <label className="check"><input type="checkbox" checked={w.b} onChange={(e) => setLine(l.id, { branch: e.target.checked })} /> يتضاف للفرع
                          {w.bSkip && <span className="pill amber" style={{ marginInlineStart: 6 }}>{w.bSkip}</span>}</label>
                      </div>
                    )}
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 13 }} onClick={() => setLine(l.id, { ignore: !ov[l.id]?.ignore })}>
                        {st === 'ignored' ? 'رجّع السطر' : 'تجاهل السطر ده'}</button>
                    </div>
                  </div>
                )
              })}
              {shown.length === 0 && <div className="card empty">{filter === 'todo' ? 'كله تمام في الشيت ده ✓' : 'ما فيه حاجة هنا'}</div>}
            </div>
          </>}
        </>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>اللي اترفع قبل كده</h2>
          <div className="card list" style={{ padding: '2px 14px' }}>
            {history.map((h) => (
              <div key={h.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <span className="grow"><div style={{ fontWeight: 600 }}>{h.branches?.name} · {fmtDay(h.order_date)}</div>
                  <div className="sub">{h.lines_count} صنف · {kwd(h.value)} د.ك · {h.file_name} / {h.sheet_name}</div></span>
                {h.status === 'undone' ? <span className="pill gray">اتراجعت</span> : <>
                  {h.request_id && <Link className="btn" style={{ minHeight: 36 }} to={`/inventory/orders/${h.request_id}`}>عرض</Link>}
                  <button className="btn danger" style={{ minHeight: 36 }} disabled={!!busy} onClick={() => undo(h)}>{busy === 'undo:' + h.id ? <span className="spinner" /> : null} تراجع</button></>}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'day' && sheet && !isDone && (
        <div className="order-bar">
          <div className="grow"><strong>{sheet.name}</strong> · {t.ok + t.review} صنف · <span className="num">{kwd(total)}</span> د.ك
            {blocking ? <span className="sub"> · باقي {blocking} سطر محتاج مراجعة</span> : null}</div>
          <button className="btn primary" disabled={!canPost || !!busy} onClick={() => setConfirm({})}>اعتماد الشيت</button>
        </div>
      )}

      {confirm?.group && grp && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(null)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>اعتماد {grp.label}</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setConfirm(null)}><Icon name="x" /></button></div>
            <div className="sub">كل يوم بيتسجل بتاريخه (عشان التقارير تطلع يوم يوم)، بينخصم من المطبخ وبينضاف للفرع، إلا الأصناف اللي اتجردت بعد اليوم ده.</div>
            <div className="list">{grp.sheets.filter((x) => readySheets.includes(x)).map((x) => <div key={x.key} className="list-item"><span className="grow">{fmtDay(x.date)}</span><span className="sub">{tally(x).ok} صنف</span></div>)}</div>
            <button className="btn primary block" disabled={!!busy} onClick={() => postGroup(grp)}>{busy ? <span className="spinner" /> : null} اعتماد</button>
          </div>
        </div>
      )}

      {confirm?.all && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(null)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>اعتماد كل الشيتات الجاهزة</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setConfirm(null)}><Icon name="x" /></button></div>
            <div className="sub">كل شيت بيتسجل بتاريخه، من الأقدم للأحدث. بينخصم من المطبخ وبينضاف للفرع، إلا الأصناف اللي اتجردت بعد التاريخ ده.</div>
            <div className="list" style={{ maxHeight: 300, overflow: 'auto' }}>
              {[...readySheets].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => (
                <div key={x.key} className="list-item"><span className="grow">{branchOpts.find((b) => b.id === x.branch)?.name} · {fmtDay(x.date)}</span><span className="sub">{tally(x).ok} صنف</span></div>))}
            </div>
            <button className="btn primary block" disabled={!!busy} onClick={postAll}>{busy ? <span className="spinner" /> : null} اعتماد {readySheets.length} شيت</button>
          </div>
        </div>
      )}

      {confirm && !confirm.all && !confirm.group && sheet && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(null)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>اعتماد طلبية {branchOpts.find((b) => b.id === sheet.branch)?.name}</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setConfirm(null)}><Icon name="x" /></button></div>
            {confirm.again ? <>
              <div className="warn"><Icon name="warn" /> الشيت ده من نفس الملف اترفع قبل كده. لو سجّلته تاني الكميات هتتخصم مرتين.</div>
              <button className="btn danger block" disabled={!!busy} onClick={() => post(true)}>{busy ? <span className="spinner" /> : null} سجّله تاني برضه</button>
            </> : <>
              <div>بتاريخ <strong>{fmtDay(sheet.date)}</strong> · {t.ok} صنف بقيمة <strong className="num">{kwd(total)}</strong> د.ك</div>
              <div className="sub" style={{ lineHeight: 1.8 }}>
                • ينخصم من المطبخ المركزي: {t.ok - t.skipK} صنف{t.skipK ? ` (ومش هيتخصم ${t.skipK} صنف اتجردوا بعدها)` : ''}<br />
                • ينضاف لمخزن الفرع: {t.ok - t.skipB} صنف{t.skipB ? ` (ومش هيتضاف ${t.skipB} صنف اتجردوا بعدها)` : ''}<br />
                • الطلبية تظهر في طلبات الفروع وتقرير تكلفة الفرع بتاريخها، والربط بيتحفظ للمرات الجاية.
              </div>
              <button className="btn primary block" disabled={!!busy} onClick={() => post(false)}>{busy ? <span className="spinner" /> : null} اعتماد</button>
            </>}
          </div>
        </div>
      )}

      {picking && <ItemSearchSheet items={items} line={sheets.flatMap((s) => s.lines).find((l) => l.mkey === [].concat(picking)[0])} current={maps[[].concat(picking)[0]]?.item_id}
        onPick={(id) => { [].concat(picking).forEach((k) => linkChange(k, { item_id: id, factor: null, fu: null, src: 'manual', note: '' })); setPicking(null) }} onClose={() => setPicking(null)} />}
    </div>
  )
}
