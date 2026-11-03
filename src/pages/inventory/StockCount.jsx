import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase, selectAll } from '../../lib/supabase'
import { qtyFmt, kwd, invErr, itemNames, packPieces, packTotal, branchPieces, toPieces } from '../../lib/inv'
import { useLang } from '../../lib/i18n.jsx'
import { useAccess } from '../../lib/access.jsx'
import { useBranchChoice, BranchPicker } from './BranchStock.jsx'
import Icon from '../../components/Icon.jsx'
import ProductImage from '../../components/ProductImage.jsx'
import { fmtContent, isMeasureUnit } from '../../components/UnitContent.jsx'

const SCOPES = [['fav', 'المفضلة'], ['critical', 'الجرد اليومي'], ['stock', 'الأصناف الموجودة'], ['cat', 'تصنيف'], ['all', 'كل الأصناف']]
const SCOPE_HINT = {
  fav: 'الأصناف اللي في القائمة المفضلة لهالمكان',
  critical: 'الأصناف الغالية واللي تخرب بسرعة، تنجرد كل يوم',
  stock: 'الأصناف اللي النظام يقول إنها موجودة عندكم (رصيدها مو صفر)',
  cat: 'اختار تصنيف وعدّ كل أصنافه',
  all: 'كل الأصناف، للجرد الكامل',
}
// a count far above what the system expects is usually a typo or the wrong unit (grams for kilos, pieces for cartons):
// more than 5x the expected quantity, or 100+ when 5 or less was expected. The line then needs an explicit tick.
const isLarge = (got, exp) => (Number(exp) > 5 ? Number(got) > 5 * Number(exp) : Number(got) >= 100)
const draftKey = (b) => `count-draft-${b}`
const readDraft = (b) => { try { return JSON.parse(localStorage.getItem(draftKey(b)) || '{}') } catch { return {} } }
const writeDraft = (b, v) => { try { localStorage.setItem(draftKey(b), JSON.stringify(v)) } catch { /* private mode */ } }

export default function StockCount() {
  const [params] = useSearchParams()
  const bc = useBranchChoice()
  const { tr, lang, tn } = useLang()
  const { can } = useAccess()
  const { branch, setBranch, lookups } = bc
  const [items, setItems] = useState([])
  const [levels, setLevels] = useState({})
  const [favs, setFavs] = useState(new Set())
  const [scope, setScope] = useState('fav')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState({})
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [okLarge, setOkLarge] = useState(new Set())   // lines whose large count the user ticked as correct

  useEffect(() => { const b = params.get('branch'); if (b && bc.options.some((o) => o.id === b)) setBranch(b) }, [params, bc.options, setBranch])
  useEffect(() => { selectAll(() => supabase.from('inv_stock').select('id,name_ar,name_en,unit,unit_pieces,unit_grams,unit_measure,branch_by_piece,category_id,category,is_critical,avg_cost').eq('active', true).order('name_ar').order('id')).then((data) => setItems(data || [])) }, [])
  useEffect(() => {
    if (!branch) return
    setCounts(readDraft(branch)); setResult(null); setOkLarge(new Set())
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data }) => setLevels(Object.fromEntries((data || []).map((x) => [x.item_id, Number(x.qty)]))))
    supabase.from('branch_favorites').select('item_id').eq('branch_id', branch).then(({ data }) => {
      const s = new Set((data || []).map((x) => x.item_id)); setFavs(s)
      const isKitchen = lookups?.stockBranches.find((b) => b.id === branch)?.is_central_kitchen
      setScope(s.size ? 'fav' : isKitchen ? 'critical' : 'stock')
    })
  }, [branch, lookups])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) => {
      if (s && !(i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s))) return false
      if (scope === 'fav') return favs.has(i.id)
      if (scope === 'critical') return i.is_critical
      if (scope === 'stock') return levels[i.id] != null && levels[i.id] !== 0
      if (scope === 'cat') return !!cat && i.category_id === cat
      return true
    }).slice(0, 600)
  }, [items, scope, favs, levels, cat, q])

  const setCount = (id, v) => {
    // a changed number needs a fresh confirmation
    const base = id.replace(/:p$/, '')
    setOkLarge((s) => { if (!s.has(base)) return s; const n = new Set(s); n.delete(base); return n })
    setCounts((c) => { const n = { ...c, [id]: v }; if (v === '') delete n[id]; writeDraft(branch, n); return n })
  }
  const toggleOk = (id, on) => setOkLarge((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  // counts[id] = whole units; counts[id + ':p'] = loose pieces (carton items only)
  const isKitchen = !!lookups?.stockBranches.find((b) => b.id === branch)?.is_central_kitchen
  // branches count carton drinks in pieces (one box); the kitchen in cartons + loose pieces
  const counted = (id) => {
    const bp = branchPieces(byId[id], isKitchen)
    if (bp) { const v = counts[id] ?? ''; return v === '' ? null : Math.round(Number(v) / bp * 1000) / 1000 }
    return packTotal(counts[id] ?? '', counts[id + ':p'] ?? '', packPieces(byId[id]))
  }
  const entered = [...new Set(Object.keys(counts).map((k) => k.replace(/:p$/, '')))].map((id) => [id, counted(id)]).filter(([, v]) => v != null)
  const diffs = entered.map(([id, v]) => {
    const bp = branchPieces(byId[id], isKitchen)
    return { id, item: byId[id], exp: bp ? toPieces(levels[id] || 0, bp) : levels[id] || 0, got: bp ? toPieces(v, bp) : Number(v), val: v, raw: levels[id] || 0 }
  }).filter((d) => d.item && d.got !== d.exp)
  const shortVal = diffs.filter((d) => d.got < d.exp).reduce((a, d) => a + (d.raw - d.val) * Number(d.item.avg_cost || 0), 0)
  // large in the units the person typed (pieces for branch drinks) or in stock units, which is what the server checks
  const largeOf = (id, v) => {
    const it = byId[id]
    if (!it || v == null) return false
    const bp = branchPieces(it, isKitchen)
    return isLarge(v, levels[id] || 0) || (bp ? isLarge(toPieces(v, bp), toPieces(levels[id] || 0, bp)) : false)
  }
  const large = new Set(entered.filter(([id, v]) => largeOf(id, v)).map(([id]) => id))
  const unconfirmed = [...large].filter((id) => !okLarge.has(id))
  // "1 carton = 24 pcs · 10 kg" next to the count box
  const packInfo = (i, bp) => {
    const parts = []
    if (Number(i.unit_pieces) > 1) parts.push(tr('{n} حبة', { n: Number(i.unit_pieces) }))
    if (Number(i.unit_grams) > 0 && !isMeasureUnit(i.unit)) parts.push(fmtContent(i.unit_grams, i.unit_measure, tr))
    if (!parts.length) return ''
    return tr(bp ? 'الـ{u} فيه {v}' : '١ {u} = {v}', { u: tn(i.unit || ''), v: parts.join(' · ') })
  }

  const submit = async () => {
    if (unconfirmed.length) { setConfirm(false); setErr(tr('فيه {n} صنف رقمه كبير وايد. تأكد منه وعلّم "الرقم صحيح" قبل الحفظ.', { n: unconfirmed.length })); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('finish_stock_count', { p_branch: branch, p_lines: entered.map(([item_id, v]) => ({ item_id, counted: v, ...(large.has(item_id) ? { confirmed_large: true } : {}) })), p_scope: scope, p_note: null })
    setBusy(false); setConfirm(false)
    if (error) { setErr(/confirmed_large|large count/i.test(error.message || '') ? tr('فيه {n} صنف رقمه كبير وايد. تأكد منه وعلّم "الرقم صحيح" قبل الحفظ.', { n: large.size || 1 }) : tr(invErr(error))); return }
    writeDraft(branch, {}); setCounts({}); setOkLarge(new Set()); setResult(data)
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data: d }) => setLevels(Object.fromEntries((d || []).map((x) => [x.item_id, Number(x.qty)]))))
  }

  if (!lookups) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="page-head">
        <div><Link to="/inventory/stock" className="sub" style={{ textDecoration: 'none' }}>{tr('→ رصيد الفرع')}</Link><h1 style={{ marginTop: 4 }}>{tr('جرد')}</h1>
          <div className="sub">{tr('عدّ الموجود فعلاً واكتبه. اللي تتركه فاضي ما ينحسب.')}</div></div>
        <BranchPicker {...bc} />
      </div>
      {result && <div className="notice" style={{ marginBottom: 14 }}>{tr('انحفظ الجرد: {n} صنف، {d} فيهم فرق.', { n: result.lines, d: result.differences })}
        {Number(result.short_value) > 0 ? ' ' + tr('قيمة النقص {v} د.ك.', { v: kwd(result.short_value) }) : ''}{Number(result.over_value) > 0 ? ' ' + tr('الزيادة {v} د.ك.', { v: kwd(result.over_value) }) : ''}</div>}
      {err && <div className="error" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="chips" style={{ marginBottom: 10 }}>
        {SCOPES.map(([k, l]) => <button key={k} className={'chip' + (scope === k ? ' on' : '')} onClick={() => setScope(k)}>{k === 'fav' ? '★ ' : ''}{tr(l)}</button>)}
      </div>
      <div className="sub" style={{ marginBottom: 10 }}>{tr(SCOPE_HINT[scope])}</div>
      {can('manage_inventory') && <div className="sub" style={{ marginBottom: 10 }}>{tr('أول مرة تدخل المخزون بالأسعار؟')} <Link to="/inventory/opening">{tr('رصيد أول المدة')}</Link></div>}
      <div className="toolbar">
        {scope === 'cat' && <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tr('التصنيف')}>
          <option value="">{tr('اختار تصنيف')}</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{tn(c.name)}</option>)}</select>}
        <div className="search"><Icon name="search" size={18} /><input className="input" placeholder={tr('دوّر على صنف')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="order-list">
        {shown.length === 0 && <div className="card empty">{scope === 'fav' ? tr('ما فيه مفضلة لهالفرع. اختار "الأصناف الموجودة" أو "تصنيف".') : scope === 'cat' && !cat ? tr('اختار التصنيف') : tr('ما فيه أصناف هنا')}</div>}
        {shown.map((i) => {
          const v = counts[i.id] ?? ''
          const bp = branchPieces(i, isKitchen)
          const n = bp ? 0 : packPieces(i)
          const tot = counted(i.id)
          const exp = bp ? toPieces(levels[i.id] || 0, bp) : levels[i.id] || 0
          const d = tot == null ? null : Math.round(((bp ? toPieces(tot, bp) : tot) - exp) * 1000) / 1000
          const big = large.has(i.id)
          const pack = packInfo(i, bp)
          const unitWord = bp ? tr('حبة') : tn(i.unit || '')
          return (
            <div key={i.id} className="order-row" style={{ gap: 8, ...(big ? { borderColor: 'var(--amber)' } : {}) }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ProductImage itemId={i.id} size={48} />
              <div className="grow"><div style={{ fontWeight: 600 }}>{itemNames(i, lang)[0]}</div>
                <div className="cell-sub">{unitWord}{d != null ? <> · {tr('المتوقع {n}', { n: qtyFmt(exp) })} · {d === 0 ? <span style={{ color: 'var(--ok)' }}>{tr('مطابق ✓')}</span>
                  : <span style={{ color: d < 0 ? 'var(--red)' : 'var(--amber)', fontWeight: 600 }}>{d < 0 ? tr('ناقص') : tr('زايد')} {qtyFmt(Math.abs(d))}</span>}</> : null}</div></div>
              {n ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <label className="field" style={{ gap: 2 }}><span className="cell-sub" style={{ marginTop: 0 }}>{tn(i.unit || '')}</span>
                      <input className="input num" style={{ width: 72, height: 44, fontSize: 16, fontWeight: 600 }} inputMode="decimal" placeholder="0" value={v}
                        onChange={(e) => setCount(i.id, e.target.value.replace(/[^\d.]/g, ''))} aria-label={`${tr('العدد الفعلي')} (${tn(i.unit || '')}): ${itemNames(i, lang)[0]}`} /></label>
                    <label className="field" style={{ gap: 2 }}><span className="cell-sub" style={{ marginTop: 0 }}>{tr('حبة')}</span>
                      <input className="input num" style={{ width: 72, height: 44, fontSize: 16, fontWeight: 600 }} inputMode="decimal" placeholder="0" value={counts[i.id + ':p'] ?? ''}
                        onChange={(e) => setCount(i.id + ':p', e.target.value.replace(/[^\d.]/g, ''))} aria-label={`${tr('حبة')}: ${itemNames(i, lang)[0]}`} /></label>
                  </div>
                  <span className="cell-sub" style={{ marginTop: 0 }}>{tr('الـ{u} فيه {n} حبة', { u: tn(i.unit || ''), n })}{tot != null ? ` · = ${qtyFmt(tot)} ${tn(i.unit || '')}` : ''}</span>
                </div>
              ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                <label className="field" style={{ gap: 2 }}><span className="cell-sub" style={{ marginTop: 0, fontWeight: 600 }}>{unitWord}</span>
                  <input className="input num" style={{ width: 110, height: 46, fontSize: 17, fontWeight: 600 }} inputMode="decimal" placeholder="—" value={v}
                    onChange={(e) => setCount(i.id, e.target.value.replace(/[^\d.]/g, ''))} aria-label={`${tr('العدد الفعلي')} (${unitWord}): ${itemNames(i, lang)[0]}`} /></label>
                {pack && <span className="cell-sub" style={{ marginTop: 0 }}>{pack}</span>}
              </div>)}
            </div>
            {big && (
              <div className="warn" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span><Icon name="warn" /> {tr('الرقم هذا أكبر وايد من المتوقع: كتبت {got} {u} والمتوقع {exp}. تأكد إنك عادّ بالـ{u}، مو بالحبة أو بالجرام.', { got: qtyFmt(bp ? toPieces(tot, bp) : tot), u: unitWord, exp: qtyFmt(exp) })}</span>
                <label className="check" style={{ fontWeight: 600 }}><input type="checkbox" checked={okLarge.has(i.id)} onChange={(e) => toggleOk(i.id, e.target.checked)} /> {tr('الرقم صحيح، أكّده')}</label>
              </div>)}
            </div>
          )
        })}
      </div>

      <div className="order-bar">
        <div className="grow">{tr('{n} صنف انعدّ', { n: entered.length })}{diffs.length ? <span className="sub"> · {tr('{n} فيهم فرق', { n: diffs.length })}</span> : null}</div>
        {unconfirmed.length > 0 && <span className="sub" style={{ color: 'var(--amber)', fontWeight: 600 }}>{tr('{n} رقم يحتاج تأكيد', { n: unconfirmed.length })}</span>}
        <button className="btn primary" disabled={!entered.length || !branch || unconfirmed.length > 0} onClick={() => setConfirm(true)}>{tr('خلّص الجرد')}</button>
      </div>

      {confirm && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{tr('تأكيد الجرد')}</h2>
              <button type="button" className="icon-btn" aria-label={tr('إغلاق')} onClick={() => setConfirm(false)}><Icon name="x" /></button></div>
            <div className="sub">{tr('{n} صنف انعدّ. الرصيد بيتعدّل حسب اللي كتبته.', { n: entered.length })}</div>
            {diffs.length === 0 ? <div className="notice">{tr('كل الأصناف مطابقة ✓')}</div> : (
              <div className="card list" style={{ padding: '2px 12px', maxHeight: 320, overflowY: 'auto' }}>
                {diffs.map((d) => <div key={d.id} className="list-item"><span className="grow">{itemNames(d.item, lang)[0]}<div className="cell-sub">{tr('المتوقع {n}', { n: qtyFmt(d.exp) })} · {tr('انعدّ {n}', { n: qtyFmt(d.got) })}</div></span>
                  <span className="num" style={{ fontWeight: 600, color: d.got < d.exp ? 'var(--red)' : 'var(--amber)' }}>{d.got > d.exp ? '+' : ''}{qtyFmt(d.got - d.exp)}</span></div>)}
              </div>)}
            {shortVal > 0 && <div className="warn">{tr('قيمة النقص التقريبية {v} د.ك', { v: kwd(shortVal) })}</div>}
            {large.size > 0 && <div className="sub">{tr('{n} صنف رقمه كبير وأكدته إنه صحيح.', { n: large.size })}</div>}
            <button className="btn primary block" disabled={busy || unconfirmed.length > 0} onClick={submit}>{busy ? <span className="spinner" /> : null} {tr('حفظ الجرد')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
