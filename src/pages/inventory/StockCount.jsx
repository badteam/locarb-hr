import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { qtyFmt, kwd, invErr, itemNames } from '../../lib/inv'
import { useLang } from '../../lib/i18n.jsx'
import { useBranchChoice, BranchPicker } from './BranchStock.jsx'
import Icon from '../../components/Icon.jsx'

const SCOPES = [['fav', 'المفضلة'], ['critical', 'الجرد اليومي'], ['stock', 'اللي لها رصيد'], ['cat', 'تصنيف'], ['all', 'كل الأصناف']]
const draftKey = (b) => `count-draft-${b}`
const readDraft = (b) => { try { return JSON.parse(localStorage.getItem(draftKey(b)) || '{}') } catch { return {} } }
const writeDraft = (b, v) => { try { localStorage.setItem(draftKey(b), JSON.stringify(v)) } catch { /* private mode */ } }

export default function StockCount() {
  const [params] = useSearchParams()
  const bc = useBranchChoice()
  const { tr, lang } = useLang()
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

  useEffect(() => { const b = params.get('branch'); if (b && bc.options.some((o) => o.id === b)) setBranch(b) }, [params, bc.options, setBranch])
  useEffect(() => { supabase.from('inv_stock').select('id,name_ar,name_en,unit,category_id,category,is_critical,avg_cost').eq('active', true).order('name_ar').then(({ data }) => setItems(data || [])) }, [])
  useEffect(() => {
    if (!branch) return
    setCounts(readDraft(branch)); setResult(null)
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data }) => setLevels(Object.fromEntries((data || []).map((x) => [x.item_id, Number(x.qty)]))))
    supabase.from('branch_favorites').select('item_id').eq('branch_id', branch).then(({ data }) => {
      const s = new Set((data || []).map((x) => x.item_id)); setFavs(s)
      const isKitchen = lookups?.branches.find((b) => b.id === branch)?.is_central_kitchen
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

  const setCount = (id, v) => setCounts((c) => { const n = { ...c, [id]: v }; if (v === '') delete n[id]; writeDraft(branch, n); return n })
  const entered = Object.entries(counts).filter(([, v]) => v !== '' && v != null)
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const diffs = entered.map(([id, v]) => ({ id, item: byId[id], exp: levels[id] || 0, got: Number(v) })).filter((d) => d.item && d.got !== d.exp)
  const shortVal = diffs.filter((d) => d.got < d.exp).reduce((a, d) => a + (d.exp - d.got) * Number(d.item.avg_cost || 0), 0)

  const submit = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('finish_stock_count', { p_branch: branch, p_lines: entered.map(([item_id, v]) => ({ item_id, counted: Number(v) })), p_scope: scope, p_note: null })
    setBusy(false); setConfirm(false)
    if (error) { setErr(tr(invErr(error))); return }
    writeDraft(branch, {}); setCounts({}); setResult(data)
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
      <div className="toolbar">
        {scope === 'cat' && <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tr('التصنيف')}>
          <option value="">{tr('اختار تصنيف')}</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}</select>}
        <div className="search"><Icon name="search" size={18} /><input className="input" placeholder={tr('دوّر على صنف')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="order-list">
        {shown.length === 0 && <div className="card empty">{scope === 'fav' ? tr('ما فيه مفضلة لهالفرع. اختار "اللي لها رصيد" أو "تصنيف".') : scope === 'cat' && !cat ? tr('اختار التصنيف') : tr('ما فيه أصناف هنا')}</div>}
        {shown.map((i) => {
          const v = counts[i.id] ?? ''
          const exp = levels[i.id] || 0
          const d = v === '' ? null : Number(v) - exp
          return (
            <div key={i.id} className="order-row" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>{itemNames(i, lang)[0]}</div>
                <div className="cell-sub">{tr(i.unit || '')}{d != null ? <> · {tr('المتوقع {n}', { n: qtyFmt(exp) })} · {d === 0 ? <span style={{ color: 'var(--ok)' }}>{tr('مطابق ✓')}</span>
                  : <span style={{ color: d < 0 ? 'var(--red)' : 'var(--amber)', fontWeight: 600 }}>{d < 0 ? tr('ناقص') : tr('زايد')} {qtyFmt(Math.abs(d))}</span>}</> : null}</div></div>
              <input className="input num" style={{ width: 110, height: 46, fontSize: 17, fontWeight: 600 }} inputMode="decimal" placeholder="—" value={v}
                onChange={(e) => setCount(i.id, e.target.value.replace(/[^\d.]/g, ''))} aria-label={`${tr('العدد الفعلي')}: ${itemNames(i, lang)[0]}`} />
            </div>
          )
        })}
      </div>

      <div className="order-bar">
        <div className="grow">{tr('{n} صنف انعدّ', { n: entered.length })}{diffs.length ? <span className="sub"> · {tr('{n} فيهم فرق', { n: diffs.length })}</span> : null}</div>
        <button className="btn primary" disabled={!entered.length || !branch} onClick={() => setConfirm(true)}>{tr('خلّص الجرد')}</button>
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
            <button className="btn primary block" disabled={busy} onClick={submit}>{busy ? <span className="spinner" /> : null} {tr('حفظ الجرد')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
