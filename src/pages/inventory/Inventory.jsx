import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, qtyFmt, loadLookups, clearLookups, invErr, MOVE_KIND } from '../../lib/inv'
import { fmtDate } from '../../lib/supabase'
import Icon from '../../components/Icon.jsx'

const PAGE = 100

export function ItemForm({ item, lookups, onClose, onSaved, presetName }) {
  const [f, setF] = useState({
    name_ar: item?.name_ar || presetName || '', name_en: item?.name_en || '',
    category_id: item?.category_id || lookups.categories[0]?.id || '', unit_id: item?.unit_id || '',
    min_qty: item?.min_qty ?? 0, is_critical: item?.is_critical || false, active: item?.active ?? true, notes: item?.notes || '',
  })
  const [newCat, setNewCat] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    let category_id = f.category_id || null
    if (category_id === '__new') {
      const r = await supabase.from('inv_categories').insert({ name: newCat.trim() }).select('id').single()
      if (r.error) { setErr(invErr(r.error)); setBusy(false); return }
      category_id = r.data.id; clearLookups()
    }
    const row = { ...f, category_id, unit_id: f.unit_id || null, min_qty: Number(f.min_qty) || 0, name_en: f.name_en || null, notes: f.notes || null }
    const r = item ? await supabase.from('inv_items').update(row).eq('id', item.id).select().single() : await supabase.from('inv_items').insert(row).select().single()
    setBusy(false)
    if (r.error) setErr(invErr(r.error)); else { onSaved?.(r.data); onClose() }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{item ? 'تعديل الصنف' : 'صنف جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="na">الاسم بالعربي</label><input id="na" className="input" value={f.name_ar} onChange={set('name_ar')} required /></div>
        <div className="field"><label htmlFor="ne">الاسم بالإنجليزي</label><input id="ne" className="input ltr" style={{ textAlign: 'left' }} value={f.name_en} onChange={set('name_en')} /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="ca">التصنيف</label>
            <select id="ca" className="input" value={f.category_id} onChange={set('category_id')}>
              {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new">+ تصنيف جديد…</option>
            </select></div>
          <div className="field"><label htmlFor="un">الوحدة</label>
            <select id="un" className="input" value={f.unit_id} onChange={set('unit_id')}>
              <option value="">—</option>
              {lookups.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
        </div>
        {f.category_id === '__new' && <div className="field"><label htmlFor="nc">اسم التصنيف الجديد</label><input id="nc" className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} required /></div>}
        <div className="field"><label htmlFor="mq">الحد الأدنى في المطبخ</label>
          <input id="mq" type="number" step="any" min="0" className="input" value={f.min_qty} onChange={set('min_qty')} />
          <div className="sub">لما الكمية تنزل تحت هالرقم، الصنف يطلع لك باللون الأصفر.</div></div>
        <label className="check"><input type="checkbox" checked={f.is_critical} onChange={set('is_critical')} /> صنف غالي أو يخرب بسرعة (يدخل في الجرد اليومي)</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> الصنف مستخدم</label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>حفظ</button>
      </form>
    </div>
  )
}

function AdjustForm({ item, lookups, onClose, onSaved }) {
  const { access } = useAccess()
  const [kind, setKind] = useState('waste')
  const [branch, setBranch] = useState(lookups.kitchen?.id || '')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault(); setErr('')
    const n = Number(qty)
    if (!n) { setErr('اكتب الكمية'); return }
    const signed = kind === 'waste' ? -Math.abs(n) : n
    const { error } = await supabase.from('stock_movements').insert({ branch_id: branch, item_id: item.id, qty: signed, kind, note: note || null, unit_cost: item.avg_cost, created_by: access.employee.id })
    if (error) setErr(invErr(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{item.name_ar}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="chips">
          <button type="button" className={'chip' + (kind === 'waste' ? ' on' : '')} onClick={() => setKind('waste')}>تسجيل تالف</button>
          <button type="button" className={'chip' + (kind === 'opening' ? ' on' : '')} onClick={() => setKind('opening')}>رصيد افتتاحي</button>
          <button type="button" className={'chip' + (kind === 'manual' ? ' on' : '')} onClick={() => setKind('manual')}>تعديل يدوي (+ أو −)</button>
        </div>
        <div className="field"><label htmlFor="br">المكان</label>
          <select id="br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="q">الكمية {item.unit ? `(${item.unit})` : ''}</label>
          <input id="q" type="number" step="any" className="input" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
          {kind === 'manual' && <div className="sub">اكتب رقم بالسالب للخصم، مثلاً −2</div>}</div>
        <div className="field"><label htmlFor="nt">ملاحظة</label><input id="nt" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'waste' ? 'مثلاً: خربان، انتهت صلاحيته' : ''} /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

function ItemSheet({ item, lookups, canEdit, onClose, onChanged }) {
  const [levels, setLevels] = useState([])
  const [moves, setMoves] = useState([])
  const [prices, setPrices] = useState([])
  const [edit, setEdit] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const load = useCallback(() => {
    supabase.from('stock_levels').select('qty, branch_id, branches(name)').eq('item_id', item.id).then(({ data }) => setLevels(data || []))
    supabase.from('stock_movements').select('id,qty,kind,note,created_at,unit_cost,branches(name),employees:created_by(full_name)').eq('item_id', item.id).order('created_at', { ascending: false }).limit(20).then(({ data }) => setMoves(data || []))
    supabase.from('supplier_items').select('last_price,last_date,suppliers(name)').eq('item_id', item.id).order('last_date', { ascending: false }).then(({ data }) => setPrices(data || []))
  }, [item.id])
  useEffect(() => { load() }, [load])

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><div><h2 style={{ fontSize: 20 }}>{item.name_ar}</h2><div className="sub ltr">{item.name_en}</div></div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="grid stats">
          <div className="card stat"><div className="label">في المطبخ</div><div className="value num">{qtyFmt(item.kitchen_qty)}</div><div className="sub">{item.unit}</div></div>
          <div className="card stat"><div className="label">آخر سعر</div><div className="value num" style={{ fontSize: 22 }}>{kwd(item.last_price)}</div><div className="sub">د.ك</div></div>
          <div className="card stat"><div className="label">متوسط التكلفة</div><div className="value num" style={{ fontSize: 22 }}>{kwd(item.avg_cost)}</div><div className="sub">د.ك</div></div>
        </div>
        {canEdit && <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={() => setEdit(true)}>تعديل الصنف</button>
          <button className="btn" onClick={() => setAdjust(true)}>تالف أو تعديل كمية</button>
        </div>}
        {levels.length > 0 && <div className="card"><strong style={{ fontSize: 14 }}>الكمية في كل مكان</strong>
          <div className="list">{levels.map((l) => <div key={l.branch_id} className="list-item"><span className="grow">{l.branches?.name}</span><span className="num">{qtyFmt(l.qty)}</span></div>)}</div></div>}
        <div className="card"><strong style={{ fontSize: 14 }}>أسعار الموردين</strong>
          {prices.length === 0 ? <div className="empty">ما انشرى من أي مورد في النظام الجديد للحين</div> :
            <div className="list">{prices.map((p, i) => <div key={i} className="list-item"><span className="grow">{p.suppliers?.name}<div className="sub">{fmtDate(p.last_date)}</div></span><span className="num">{kwd(p.last_price)}</span></div>)}</div>}</div>
        <div className="card"><strong style={{ fontSize: 14 }}>آخر الحركات</strong>
          {moves.length === 0 ? <div className="empty">ما فيه حركات</div> :
            <div className="list">{moves.map((m) => <div key={m.id} className="list-item">
              <span className={'pill ' + (MOVE_KIND[m.kind]?.[0] || 'gray')}>{MOVE_KIND[m.kind]?.[1] || m.kind}</span>
              <span className="grow"><div className="sub">{m.branches?.name} · {fmtDate(m.created_at)}{m.employees?.full_name ? ` · ${m.employees.full_name}` : ''}</div>{m.note && <div className="sub">{m.note}</div>}</span>
              <span className="num" style={{ fontWeight: 600, color: m.qty < 0 ? 'var(--red)' : 'var(--ok)' }}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</span></div>)}</div>}</div>
      </div>
      {edit && <ItemForm item={item} lookups={lookups} onClose={() => setEdit(false)} onSaved={() => { onChanged(); onClose() }} />}
      {adjust && <AdjustForm item={item} lookups={lookups} onClose={() => setAdjust(false)} onSaved={() => { load(); onChanged() }} />}
    </div>
  )
}

export default function Inventory() {
  const { can } = useAccess()
  const [items, setItems] = useState([])
  const [lookups, setLookups] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState(0)

  const load = useCallback(() => {
    supabase.from('inv_stock').select('*').order('name_ar').then(({ data }) => setItems(data || []))
    supabase.from('purchase_invoices').select('id', { count: 'exact', head: true }).eq('status', 'review').then(({ count }) => setPending(count || 0))
  }, [])
  useEffect(() => { load(); loadLookups(true).then(setLookups) }, [load])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) =>
      (filter === 'inactive' ? !i.active : i.active) &&
      (!cat || i.category_id === cat) &&
      (filter !== 'low' || Number(i.kitchen_qty) < Number(i.min_qty)) &&
      (filter !== 'critical' || i.is_critical) &&
      (!s || i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s)))
  }, [items, q, cat, filter])

  const active = items.filter((i) => i.active)
  const low = active.filter((i) => Number(i.min_qty) > 0 && Number(i.kitchen_qty) < Number(i.min_qty)).length
  const value = active.reduce((a, i) => a + Math.max(Number(i.kitchen_qty), 0) * Number(i.avg_cost || 0), 0)
  const canEdit = can('manage_inventory')

  return (
    <div>
      <div className="page-head">
        <div><h1>المخزون</h1><div className="sub">المطبخ المركزي والفروع</div></div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {canEdit && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> صنف جديد</button>}
          {(can('manage_suppliers') || can('approve_purchases')) && <Link className="btn primary" to="/inventory/invoices?new=1"><Icon name="camera" /> فاتورة مورد</Link>}
        </div>
      </div>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">الأصناف</div><div className="value num">{active.length}</div></div>
        <button className="card stat" style={{ textAlign: 'right', cursor: 'pointer', borderColor: low ? '#F3DDA8' : undefined }} onClick={() => setFilter('low')}>
          <div className="label">تحت الحد الأدنى</div><div className="value num" style={{ color: low ? 'var(--amber)' : undefined }}>{low}</div></button>
        <Link className="card stat" to="/inventory/invoices" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="label">فواتير تنتظر الموافقة</div><div className="value num">{pending}</div></Link>
        <div className="card stat"><div className="label">قيمة مخزون المطبخ</div><div className="value num" style={{ fontSize: 24 }}>{kwd(value)}</div><div className="sub">د.ك</div></div>
      </div>

      <div className="toolbar">
        <div className="search"><Icon name="search" size={18} /><input className="input" placeholder="دوّر على صنف بالعربي أو الإنجليزي" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} /></div>
        <select className="input" style={{ width: 'auto', flex: '0 1 200px' }} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE) }} aria-label="التصنيف">
          <option value="">كل التصنيفات</option>
          {lookups?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {[['all', 'الكل'], ['low', 'تحت الحد الأدنى'], ['critical', 'الجرد اليومي'], ['inactive', 'موقوفة']].map(([k, l]) =>
          <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => { setFilter(k); setLimit(PAGE) }}>{l}</button>)}
      </div>

      <div className="card table-wrap" style={{ padding: '4px 10px' }}>
        <table>
          <thead><tr><th>الصنف</th><th>التصنيف</th><th>في المطبخ</th><th>الحد الأدنى</th><th>آخر سعر</th><th></th></tr></thead>
          <tbody>
            {shown.slice(0, limit).map((i) => {
              const isLow = Number(i.min_qty) > 0 && Number(i.kitchen_qty) < Number(i.min_qty)
              return (
                <tr key={i.id} className="row-btn" onClick={() => setOpen(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
                  <td><div style={{ fontWeight: 500 }}>{i.name_ar}</div><div className="cell-sub ltr">{i.name_en}</div></td>
                  <td className="sub">{i.category}</td>
                  <td><span className="num" style={{ fontWeight: 600 }}>{qtyFmt(i.kitchen_qty)}</span> <span className="sub">{i.unit}</span></td>
                  <td className="num sub">{Number(i.min_qty) ? qtyFmt(i.min_qty) : '—'}</td>
                  <td className="num">{kwd(i.last_price)}</td>
                  <td>{isLow ? <span className="pill amber">ناقص</span> : i.is_critical ? <span className="pill gray">يومي</span> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div className="empty">ما فيه أصناف بهالبحث</div>}
        {shown.length > limit && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + PAGE)}>عرض المزيد ({shown.length - limit})</button></div>}
      </div>

      {open && lookups && <ItemSheet item={open} lookups={lookups} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={load} />}
      {adding && lookups && <ItemForm lookups={lookups} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  )
}
