import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import readXlsxFile from 'read-excel-file/browser'
import { supabase } from '../../lib/supabase'
import { kwd, qtyFmt, loadLookups, invErr } from '../../lib/inv'
import { parseSheet, guessBranch, normName, normUnit, unitFactor, bestMatches, kwDay, fileHash, contentUnits, contentFactor } from '../../lib/orderSheet'
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
  const [file, setFile] = useState(null)          // { name, hash }
  const [sheets, setSheets] = useState([])
  const [maps, setMaps] = useState({})            // name|unit -> { item_id, factor, src, note }
  const [ov, setOv] = useState({})                // line id -> { ignore, kitchen, branch }
  const [counts, setCounts] = useState({})        // branch id -> { item id -> counted_at }
  const [done, setDone] = useState({})            // sheet key -> import row
  const [active, setActive] = useState(0)
  const [filter, setFilter] = useState('todo')
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
  const readFile = async (f) => {
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) { setErr('الملف لازم يكون إكسل (.xlsx)'); return }
    setErr(''); setMsg(''); setBusy('read'); setSheets([]); setMaps({}); setOv({}); setDone({}); setActive(0)
    try {
      const [wb, hash] = await Promise.all([readXlsxFile(f), fileHash(f)])
      const out = []
      for (const s of wb) {
        const p = parseSheet(s.data)
        const lines = p.blocks.flatMap((b, bi) => b.lines.map((l) => ({ ...l, id: `${s.sheet}#${bi}#${l.row}`, block: b.title || (bi ? 'طلب إضافي' : 'الطلب'), extra: bi > 0, mkey: `${normName(l.name)}|${normUnit(l.unit)}` })))
        if (!lines.length) continue
        const saved = lsGet(branchKey(s.sheet))
        const branch = branchOpts.some((b) => b.id === saved) ? saved : guessBranch([s.sheet, p.title, ...p.blocks.map((b) => b.title)], branchOpts)
        out.push({ key: s.sheet, name: s.sheet.trim(), title: p.title, date: p.date || '', branch, lines })
      }
      // same file opened again: bring back what was chosen last time (branch, date, skipped lines, ticks)
      let draft = {}
      try { draft = JSON.parse(lsGet(draftKey(hash)) || '{}') } catch { draft = {} }
      for (const s of out) {
        const d = draft.sheets?.[s.key]
        if (d?.branch && branchOpts.some((b) => b.id === d.branch)) s.branch = d.branch
        if (d?.date) s.date = d.date
      }
      if (!out.length) { setErr('ما لقيت أصناف في الملف. لازم يكون فيه عمود اسم الصنف (ITEM NAME) وعمود الكمية (QTY).'); setBusy(''); return }
      setFile({ name: f.name, hash })
      setSheets(out)
      setOv(draft.ov || {})
      const { data: prev } = await supabase.from('order_imports').select('*').eq('file_hash', hash).eq('status', 'posted')
      setDone(Object.fromEntries((prev || []).map((x) => [x.sheet_name, x])))
      // links: saved ones first
      const m = {}
      const todo = []
      for (const l of out.flatMap((s) => s.lines)) {
        if (m[l.mkey] || todo.some((t) => t.mkey === l.mkey)) continue
        const a = aliases[l.mkey]
        if (a && byId[a.item_id]) m[l.mkey] = { item_id: a.item_id, factor: a.content_qty != null ? String(a.content_qty) : a.factor != null ? String(a.factor) : null, fu: a.content_qty != null ? a.content_unit : null, src: 'saved' }
        else todo.push(l)
      }
      setMaps(m)
      setBusy('')
      if (todo.length) matchWithAi(todo)
    } catch (e) { setErr('ما قدرت أقرا الملف: ' + (e.message || e)); setBusy('') }
  }

  const matchWithAi = async (todo, again = false) => {
    setAi('running')
    const chunks = []
    for (let i = 0; i < todo.length; i += 40) chunks.push(todo.slice(i, i + 40))
    const res = await Promise.all(chunks.map((c) => supabase.functions.invoke('match-order-items', { body: { lines: c.map((l) => ({ name: l.name, unit: l.unit })) } })
      .then(({ data, error }) => (error || !data?.ok ? { fail: data?.error || 'network' } : data)).catch(() => ({ fail: 'network' }))))
    const next = {}
    let failed = ''
    res.forEach((r, ci) => {
      const chunk = chunks[ci]
      if (r.fail) failed = r.fail
      const got = Object.fromEntries((r.matches || []).map((x) => [x.line, x]))
      chunk.forEach((l, i) => {
        const x = got[i]
        if (x?.item_id) next[l.mkey] = { item_id: x.item_id, factor: null, src: x.confidence, note: x.note }
        else {
          // the AI found nothing (or couldn't run): offer the closest name if it is close enough
          const [best] = bestMatches(l.name, items, 1)
          if (best && best[1] >= 0.8) next[l.mkey] = { item_id: best[0].id, factor: null, src: 'guess', note: r.fail ? '' : x?.note }
        }
      })
    })
    setMaps((m) => (again ? { ...m, ...Object.fromEntries(Object.entries(next).filter(([k]) => !['saved', 'manual'].includes(m[k]?.src))) } : { ...next, ...m }))
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
    if (!file) return
    lsSet(draftKey(file.hash), JSON.stringify({ ov, sheets: Object.fromEntries(sheets.map((s) => [s.key, { branch: s.branch, date: s.date }])) }))
  }, [file, ov, sheets])
  const pending = !!file && sheets.some((s) => !done[s.key])
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
  const post = async (force = false) => {
    const s = sheet
    setBusy('post'); setErr('')
    const lines = s.lines.map((l) => [l, work(s, l)]).filter(([, w]) => w.state !== 'ignored').map(([l, w]) => ({
      item_id: w.item.id, qty: w.stock, kitchen: w.k, branch: w.b,
      note: [l.extra ? l.block : '', `${l.name} ${qtyFmt(l.qty)} ${l.unit}`.trim(), !w.k ? 'ما انخصم من المطبخ: ' + (w.kSkip || 'باختيارك') : '', !w.b ? 'ما انضاف للفرع: ' + (w.bSkip || 'باختيارك') : ''].filter(Boolean).join(' · '),
      alias: normName(l.name), unit: normUnit(l.unit), factor: w.factor,
      content_qty: w.m?.factor != null && w.m.factor !== '' ? Number(w.m.factor) : null, content_unit: w.m?.factor != null && w.m.factor !== '' ? (w.m.fu || w.item.unit) : null,
    }))
    const { data, error } = await supabase.rpc('post_order_import', { p_branch: s.branch, p_date: s.date, p_file_name: file.name, p_file_hash: file.hash, p_sheet: s.key, p_lines: lines, p_force: force })
    setBusy('')
    if (error) {
      if (/already imported/.test(error.message)) { setConfirm({ again: true }); return }
      setErr(/future/.test(error.message) ? 'تاريخ الطلبية في المستقبل' : /not allowed to import/.test(error.message) ? 'ما عندك صلاحية' : invErr(error)); setConfirm(null); return
    }
    setConfirm(null)
    setDone((d) => ({ ...d, [s.key]: { ...data, id: data.id, request_id: data.request_id } }))
    setMsg(`اتسجلت طلبية ${s.name}: ${data.lines} صنف بقيمة ${kwd(data.value)} د.ك. انخصم من المطبخ ${data.kitchen} صنف، وانضاف للفرع ${data.branch} صنف.`)
    // the links just saved count as saved links from now on
    setAliases((a) => ({ ...a, ...Object.fromEntries(lines.map((x) => [`${x.alias}|${x.unit}`, { alias: x.alias, unit: x.unit, item_id: x.item_id, factor: x.factor, content_qty: x.content_qty, content_unit: x.content_unit }])) }))
    setMaps((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, lines.some((x) => `${x.alias}|${x.unit}` === k) ? { ...v, src: 'saved' } : v])))
    loadHistory()
    const nextOpen = sheets.findIndex((x, i) => i !== active && !done[x.key])
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
        onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]) }}>
        <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { readFile(e.target.files[0]); e.target.value = '' }} />
        {busy === 'read' ? <span className="spinner" /> : <Icon name="download" size={26} />}
        <div><strong>{file ? file.name : 'اسحب ملف الإكسل هنا'}</strong>
          <div className="sub">{file ? 'اسحب ملف تاني أو اضغط عشان تغيّره' : 'أو اضغط واختار الملف من جهازك'}</div></div>
      </label>

      {ai === 'running' && <div className="notice row" style={{ gap: 10, marginTop: 12 }}><span className="spinner" /> الذكاء بيربط أسامي الأصناف بالمخزن… ممكن ياخد دقيقة.</div>}
      {ai.startsWith('error') && <div className="warn" style={{ marginTop: 12 }}><Icon name="warn" /> الذكاء ما اشتغلش ({AI_ERR[ai.slice(6)] || (ai.slice(6) === 'network' ? 'مشكلة اتصال' : ai.slice(6, 120))}). ربطت اللي أسماؤه قريبة، والباقي اختاره بإيدك. <button className="btn" style={{ minHeight: 34, marginInlineStart: 'auto' }} onClick={retryAi}>حاول تاني</button></div>}
      {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {sheets.length > 0 && (
        <>
          <div className="chips" style={{ margin: '16px 0 12px' }}>
            {sheets.map((s, i) => {
              const tt = tally(s)
              const n = tt.item + tt.factor + tt.review
              return <button key={s.key} className={'chip' + (i === active ? ' on' : '')} onClick={() => { setActive(i); setFilter('todo'); setStick(new Set()) }}>
                {s.name} {done[s.key] ? <span className="pill ok" style={{ marginInlineStart: 6 }}>اتسجل ✓</span>
                  : !s.branch ? <span className="pill red" style={{ marginInlineStart: 6 }}>بدون فرع</span>
                  : n ? <span className="badge" style={{ marginInlineStart: 6 }}>{n}</span> : <span className="pill ok" style={{ marginInlineStart: 6 }}>جاهز</span>}</button>
            })}
          </div>

          <div className="card" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 12 }}>
            <div className="field"><label htmlFor="ib">الفرع</label>
              <select id="ib" className="input" value={sheet.branch} disabled={!!isDone} onChange={(e) => { setSheet({ branch: e.target.value }); lsSet(branchKey(sheet.key), e.target.value) }}>
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

      {sheet && !isDone && (
        <div className="order-bar">
          <div className="grow"><strong>{sheet.name}</strong> · {t.ok + t.review} صنف · <span className="num">{kwd(total)}</span> د.ك
            {blocking ? <span className="sub"> · باقي {blocking} سطر محتاج مراجعة</span> : null}</div>
          <button className="btn primary" disabled={!canPost || !!busy} onClick={() => setConfirm({})}>اعتماد الشيت</button>
        </div>
      )}

      {confirm && sheet && (
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

      {picking && <ItemSearchSheet items={items} line={sheets.flatMap((s) => s.lines).find((l) => l.mkey === picking)} current={maps[picking]?.item_id}
        onPick={(id) => { linkChange(picking, { item_id: id, factor: null, fu: null, src: 'manual', note: '' }); setPicking(null) }} onClose={() => setPicking(null)} />}
    </div>
  )
}
