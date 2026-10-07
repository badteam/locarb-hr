import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { qtyFmt, loadLookups, invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const num = (v) => (v === '' || v == null ? null : Number(v))

function Stepper({ value, onChange, label }) {
  const v = value === '' || value == null ? '' : value
  const step = (d) => onChange(String(Math.max(0, (Number(v) || 0) + d)))
  return (
    <div className="stepper">
      <button type="button" onClick={() => step(-1)} aria-label={`نقّص ${label}`}>−</button>
      <input className="num" inputMode="decimal" value={v} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} aria-label={label} />
      <button type="button" onClick={() => step(1)} aria-label={`زيد ${label}`}>+</button>
    </div>
  )
}

export default function NewOrder() {
  const nav = useNavigate()
  const { access, can } = useAccess()
  const [lookups, setLookups] = useState(null)
  const [branch, setBranch] = useState('')
  const [items, setItems] = useState([])
  const [favs, setFavs] = useState({})        // item_id -> par_qty
  const [stock, setStock] = useState({})      // branch stock item_id -> qty
  const [lines, setLines] = useState({})      // item_id -> { on_hand, qty, touched }
  const [tab, setTab] = useState('fav')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [editFav, setEditFav] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const anyBranch = access.is_owner || access.branch_scope === 'all' || can('approve_branch_requests') || can('manage_inventory')

  useEffect(() => {
    loadLookups().then((l) => {
      setLookups(l)
      const own = l.branches.find((b) => b.id === access.employee.branch_id && !b.is_central_kitchen)
      setBranch(own?.id || (anyBranch ? l.branches.find((b) => !b.is_central_kitchen)?.id : '') || '')
    })
    supabase.from('inv_stock').select('id,name_ar,name_en,unit,category_id,category,active').eq('active', true).order('name_ar').then(({ data }) => setItems(data || []))
  }, [access.employee.branch_id, anyBranch])

  const loadBranch = useCallback(() => {
    if (!branch) return
    supabase.from('branch_favorites').select('item_id,par_qty').eq('branch_id', branch).then(({ data }) => {
      const f = Object.fromEntries((data || []).map((x) => [x.item_id, x.par_qty]))
      setFavs(f)
      if (!(data || []).length) setTab('all')
    })
    supabase.from('stock_levels').select('item_id,qty').eq('branch_id', branch).then(({ data }) => setStock(Object.fromEntries((data || []).map((x) => [x.item_id, x.qty]))))
  }, [branch])
  useEffect(() => { setLines({}); loadBranch() }, [loadBranch])

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const favList = useMemo(() => Object.keys(favs).map((id) => byId[id]).filter(Boolean).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name_ar.localeCompare(b.name_ar)), [favs, byId])
  const allList = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s && !cat) return []
    return items.filter((i) => (!cat || i.category_id === cat) && (!s || i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s))).slice(0, 80)
  }, [items, q, cat])

  const setLine = (id, patch) => setLines((ls) => {
    const cur = ls[id] || {}
    const next = { ...cur, ...patch }
    // counted what's on hand and has a normal quantity: suggest the difference
    if ('on_hand' in patch && !cur.touched && favs[id] != null && num(patch.on_hand) != null) {
      next.qty = String(Math.max(0, Math.round((Number(favs[id]) - Number(patch.on_hand)) * 1000) / 1000))
    }
    if ('qty' in patch) next.touched = true
    return { ...ls, [id]: next }
  })

  const toggleFav = async (id) => {
    if (id in favs) {
      const { error } = await supabase.from('branch_favorites').delete().eq('branch_id', branch).eq('item_id', id)
      if (!error) setFavs((f) => { const n = { ...f }; delete n[id]; return n })
    } else {
      const { error } = await supabase.from('branch_favorites').insert({ branch_id: branch, item_id: id })
      if (!error) setFavs((f) => ({ ...f, [id]: null })); else setErr(invErr(error))
    }
  }
  const setPar = async (id, v) => {
    setFavs((f) => ({ ...f, [id]: v }))
  }
  const savePar = async (id) => {
    await supabase.from('branch_favorites').update({ par_qty: num(favs[id]) }).eq('branch_id', branch).eq('item_id', id)
  }

  const chosen = Object.entries(lines).filter(([, l]) => Number(l.qty) > 0 || num(l.on_hand) != null)
  const ordered = chosen.filter(([, l]) => Number(l.qty) > 0)

  const submit = async () => {
    setBusy(true); setErr('')
    const payload = chosen.map(([item_id, l]) => ({ item_id, qty: Number(l.qty) || 0, on_hand: num(l.on_hand) }))
    const { data, error } = await supabase.rpc('submit_branch_request', { p_branch: branch, p_lines: payload, p_note: note || null })
    setBusy(false)
    if (error) { setErr(invErr(error)); setConfirm(false) } else nav(`/inventory/orders/${data}`, { replace: true })
  }

  if (!lookups) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>

  // plain render function (not a component) so inputs keep focus while typing
  const renderRow = (i) => {
    const l = lines[i.id] || {}
    const isFav = i.id in favs
    const par = favs[i.id]
    const cur = stock[i.id]
    return (
      <div className="order-row" key={i.id}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <button type="button" className={'star' + (isFav ? ' on' : '')} onClick={() => toggleFav(i.id)} aria-label={isFav ? 'شيل من المفضلة' : 'أضف للمفضلة'} aria-pressed={isFav}>★</button>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{i.name_ar}</div>
            <div className="cell-sub">{i.unit || ''}{par != null && Number(par) > 0 ? ` · العادي عندكم ${qtyFmt(par)}` : ''}{cur != null ? ` · آخر رصيد ${qtyFmt(cur)}` : ''}</div>
          </div>
        </div>
        {editFav && isFav ? (
          <div className="row" style={{ gap: 8 }}>
            <label className="sub grow" htmlFor={`par-${i.id}`}>الكمية العادية اللي لازم تكون عندكم</label>
            <input id={`par-${i.id}`} className="input num" style={{ width: 110, height: 42 }} inputMode="decimal" value={par ?? ''} placeholder="—"
              onChange={(e) => setPar(i.id, e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => savePar(i.id)} />
          </div>
        ) : (
          <div className="order-inputs">
            <div className="field"><span className="lbl" style={{ fontSize: 12 }}>عندكم الحين</span>
              <input className="input num" style={{ height: 44 }} inputMode="decimal" placeholder="—" value={l.on_hand ?? ''}
                onChange={(e) => setLine(i.id, { on_hand: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`الموجود من ${i.name_ar}`} /></div>
            <div className="field"><span className="lbl" style={{ fontSize: 12 }}>تطلبون</span>
              <Stepper value={l.qty} onChange={(v) => setLine(i.id, { qty: v })} label={`كمية ${i.name_ar}`} /></div>
          </div>
        )}
      </div>
    )
  }

  const branchName = lookups.branches.find((b) => b.id === branch)?.name
  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="page-head">
        <div><h1>طلب توريد</h1><div className="sub">اكتب الموجود عندكم والكمية اللي تحتاجونها</div></div>
        {anyBranch ? (
          <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
            {lookups.branches.filter((b) => !b.is_central_kitchen).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : <span className="pill gray" style={{ fontSize: 14, padding: '6px 12px' }}>{branchName || 'ما لك فرع'}</span>}
      </div>
      {!branch && <div className="error">حسابك ما هو مربوط بفرع. كلم الإدارة يحددون فرعك.</div>}

      <div className="seg" style={{ maxWidth: 420 }}>
        <a href="#fav" className={tab === 'fav' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab('fav') }}>★ المفضلة ({favList.length})</a>
        <a href="#all" className={tab === 'all' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab('all') }}><Icon name="search" size={16} /> كل الأصناف</a>
      </div>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {tab === 'fav' && (
        <>
          {favList.length > 0 && <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="sub">{editFav ? 'حط الكمية العادية لكل صنف، والنظام يقترح الطلب لحاله' : 'اضغط ★ عشان تشيل صنف من القائمة'}</span>
            <button className="btn" style={{ minHeight: 38 }} onClick={() => setEditFav(!editFav)}>{editFav ? 'تم' : 'تعديل الكميات العادية'}</button></div>}
          {favList.length === 0 ? (
            <div className="card empty">القائمة المفضلة فاضية.<br />روح لـ "كل الأصناف"، دوّر على الصنف، واضغط ★ جنبه. المرة الجاية بتلقاه هنا على طول.</div>
          ) : <div className="order-list">{favList.map(renderRow)}</div>}
        </>
      )}

      {tab === 'all' && (
        <>
          <div className="toolbar">
            <div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر على صنف" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
            <select className="input" style={{ width: 'auto', flex: '0 1 220px' }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="التصنيف">
              <option value="">اختار تصنيف</option>
              {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {allList.length === 0 ? <div className="card empty">{q || cat ? 'ما لقينا شي' : 'اكتب اسم الصنف أو اختار تصنيف'}</div>
            : <div className="order-list">{allList.map(renderRow)}</div>}
        </>
      )}

      <div className="order-bar">
        <div className="grow"><strong>{ordered.length}</strong> صنف في الطلب{chosen.length > ordered.length ? <span className="sub"> · {chosen.length - ordered.length} انجرد بس</span> : null}</div>
        <button className="btn primary" disabled={!ordered.length || !branch} onClick={() => setConfirm(true)}>راجع وأرسل</button>
      </div>

      {confirm && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setConfirm(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>طلب {branchName}</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setConfirm(false)}><Icon name="x" /></button></div>
            <div className="card list" style={{ padding: '2px 12px' }}>
              {ordered.map(([id, l]) => <div key={id} className="list-item"><span className="grow">{byId[id]?.name_ar}</span>
                <span className="num" style={{ fontWeight: 600 }}>{qtyFmt(l.qty)}</span><span className="sub">{byId[id]?.unit}</span></div>)}
            </div>
            <div className="field"><label htmlFor="nt">ملاحظة للمطبخ (اختياري)</label><input id="nt" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <button className="btn primary block" disabled={busy} onClick={submit}>{busy ? <span className="spinner" /> : null} أرسل الطلب للمطبخ</button>
          </div>
        </div>
      )}
    </div>
  )
}
