import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { kwd, qtyFmt, loadLookups, clearLookups, invErr, MOVE_KIND, nutSource, branchPieces, toPieces } from '../../lib/inv'
import { fmtDate, selectAll } from '../../lib/supabase'
import Icon from '../../components/Icon.jsx'
import ProductImage, { ProductPhotoLarge, refreshProductImages } from '../../components/ProductImage.jsx'
import { loginEmail } from '../../lib/supabase'
import { compress } from './Invoices.jsx'
import UnitContent, { isMeasureUnit, NONFOOD_CATS, MEASURE_UNITS, fmtContent } from '../../components/UnitContent.jsx'

// a food item counted in cartons/bags/packs whose weight is unknown cannot be costed per gram
const needsContent = (i) => i.active && !i.nonfood && i.unit && !isMeasureUnit(i.unit) && i.unit !== 'حبة' && !Number(i.unit_grams) && !(Number(i.unit_pieces) > 1)

const PAGE = 100

export function ItemForm({ item, lookups, onClose, onSaved, presetName }) {
  const [f, setF] = useState({
    name_ar: item?.name_ar || presetName || '', name_en: item?.name_en || '',
    category_id: item?.category_id || lookups.categories[0]?.id || '', unit_id: item?.unit_id || '',
    min_qty: item?.min_qty ?? 0, is_critical: item?.is_critical || false, branch_by_piece: item?.branch_by_piece || false, active: item?.active ?? true, notes: item?.notes || '',
    kcal_100: item?.kcal_100 ?? '', protein_100: item?.protein_100 ?? '', carbs_100: item?.carbs_100 ?? '', fat_100: item?.fat_100 ?? '',
  })
  const [prot, setProt] = useState({ groups: [], value: '' })
  const [content, setContent] = useState({ grams: null, pieces: null, measure: 'g' })
  useEffect(() => {
    supabase.from('protein_groups').select('key,name_ar').order('sort_order').then(({ data }) => setProt((p) => ({ ...p, groups: data || [] })))
    if (item?.id) supabase.from('inv_items').select('protein_group,unit_grams,unit_pieces,unit_measure').eq('id', item.id).single().then(({ data }) => {
      setProt((p) => ({ ...p, value: data?.protein_group || '' }))
      setContent({ grams: data?.unit_grams ?? null, pieces: data?.unit_pieces ?? null, measure: data?.unit_measure || 'g' })
    })
  }, [item?.id])
  const [newCat, setNewCat] = useState({ name: '', name_en: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async (e) => {
    e.preventDefault(); setErr('')
    if (!f.name_ar.trim() || !f.name_en.trim()) { setErr('لازم تكتب اسم الصنف بالعربي وبالإنجليزي'); return }
    const unitName = lookups.units.find((u) => u.id === f.unit_id)?.name
    const catName = lookups.categories.find((c) => c.id === f.category_id)?.name
    const needContent = f.unit_id && !isMeasureUnit(unitName) && unitName !== 'حبة' && !NONFOOD_CATS.includes(catName) && f.active
    if (needContent && !Number(content.grams) && !(Number(content.pieces) > 1)) { setErr(`اكتب الـ${unitName} فيه كام حبة، أو وزنه بالكيلو أو الجرام أو اللتر، عشان السيستم يحسب الكوست`); return }
    setBusy(true)
    let category_id = f.category_id || null
    if (category_id === '__new') {
      const r = await supabase.from('inv_categories').insert({ name: newCat.name.trim(), name_en: newCat.name_en.trim() || null }).select('id').single()
      if (r.error) { setErr(invErr(r.error)); setBusy(false); return }
      category_id = r.data.id; clearLookups()
    }
    const nv = (v) => (v === '' || v == null ? null : Number(v))
    const nut = { kcal_100: nv(f.kcal_100), protein_100: nv(f.protein_100), carbs_100: nv(f.carbs_100), fat_100: nv(f.fat_100) }
    const nutChanged = ['kcal_100', 'protein_100', 'carbs_100', 'fat_100'].some((k) => nut[k] !== (item?.[k] == null ? null : Number(item[k])))
    const mu = MEASURE_UNITS[lookups.units.find((u) => u.id === f.unit_id)?.name || '']
    const protRow = { ...(prot.value || item?.id ? { protein_group: prot.value || null } : {}),
      unit_grams: mu ? mu[0] : Number(content.grams) || null, unit_measure: mu ? mu[1] : content.measure || 'g',
      unit_pieces: content.pieces == null || content.pieces === '' ? null : Number(content.pieces) }
    const row = { ...f, ...nut, ...protRow, category_id, unit_id: f.unit_id || null, min_qty: Number(f.min_qty) || 0, name_ar: f.name_ar.trim(), name_en: f.name_en.trim(), notes: f.notes || null,
      ...(nutChanged ? { nutrition_source: 'إدخال يدوي', nutrition_updated_at: new Date().toISOString() } : {}) }
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
        <div className="field"><label htmlFor="ne">الاسم بالإنجليزي</label><input id="ne" className="input ltr" style={{ textAlign: 'left' }} value={f.name_en} onChange={set('name_en')} required /></div>
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
        {f.category_id === '__new' && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="nc">التصنيف الجديد بالعربي</label><input id="nc" className="input" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required /></div>
          <div className="field"><label htmlFor="nce">التصنيف الجديد بالإنجليزي</label><input id="nce" className="input ltr" style={{ textAlign: 'left' }} value={newCat.name_en} onChange={(e) => setNewCat({ ...newCat, name_en: e.target.value })} /></div>
        </div>}
        <div className="field"><label htmlFor="mq">الحد الأدنى في المطبخ</label>
          <input id="mq" type="number" step="any" min="0" className="input" value={f.min_qty} onChange={set('min_qty')} />
          <div className="sub">لما الكمية تنزل تحت هالرقم، الصنف يطلع لك باللون الأصفر.</div></div>
        {(() => {
          const un = lookups.units.find((u) => u.id === f.unit_id)?.name
          if (!f.unit_id || isMeasureUnit(un)) return null
          const cn = lookups.categories.find((c) => c.id === f.category_id)?.name
          return <UnitContent unit={un} grams={content.grams} pieces={content.pieces} measure={content.measure}
            required={un !== 'حبة' && !NONFOOD_CATS.includes(cn)} onChange={setContent} />
        })()}
        <div className="field"><label htmlFor="pg">بروتين يراقبه النظام</label>
          <select id="pg" className="input" value={prot.value} onChange={(e) => setProt({ ...prot, value: e.target.value })}>
            <option value="">{item?.id ? 'لا' : 'يتحدد تلقائي من الاسم'}</option>
            {prot.groups.map((g) => <option key={g.key} value={g.key}>{g.name_ar}</option>)}
          </select></div>
        <div className="field"><span className="lbl">القيمة الغذائية لكل ١٠٠ جرام</span>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[['kcal_100', 'سعرات'], ['protein_100', 'بروتين'], ['carbs_100', 'كارب'], ['fat_100', 'دهون']].map(([k, l]) => (
              <div key={k}><div className="sub" style={{ fontSize: 12 }}>{l}</div>
                <input type="number" step="any" min="0" className="input num" value={f[k]} onChange={set(k)} aria-label={l} /></div>))}
          </div>
          <div className="sub">تقدر تخليها فاضية وتعبيها من كرت الصنف: من الملصق أو قيم تقديرية.</div></div>
        {(() => {
          const un = lookups.units.find((u) => u.id === f.unit_id)?.name
          if (!un || un === 'حبة' || !(Number(content.pieces) > 1)) return null
          return <label className="check"><input type="checkbox" checked={f.branch_by_piece} onChange={set('branch_by_piece')} /> الفروع تعدّ بالحبة ({un} = {Number(content.pieces)} حبة). المطبخ والطلبات بالـ{un}</label>
        })()}
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
            {lookups.stockBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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

const ALLERGEN_AR = { gluten: 'جلوتين', dairy: 'ألبان', egg: 'بيض', tree_nuts: 'مكسرات', peanut: 'فول سوداني', sesame: 'سمسم', soy: 'صويا', fish: 'سمك', shellfish: 'قشريات', mustard: 'خردل', celery: 'كرفس' }

export async function fillNutrition(itemId, mode, paths) {
  const { data, error } = await supabase.functions.invoke('item-nutrition', { body: { item_id: itemId, mode, paths } })
  if (error) {
    let b = {}
    try { b = await error.context?.json() } catch { /* ignore */ }
    return { ok: false, error: b?.error || error.message }
  }
  return data
}
export const nutritionErr = (e) => ({
  not_configured: 'قراءة الذكاء الاصطناعي ما تفعّلت. المالك يحط المفتاح من صفحة الإعدادات.',
  invalid_key: 'مفتاح الذكاء الاصطناعي غلط. غيّره من الإعدادات.', no_credit: 'رصيد حساب Anthropic خلص.',
  no_photo: 'ما فيه صورة ملصق محفوظة. صوّر الملصق.', no_table: 'ما قدرنا نقرا جدول السعرات من الصورة. صوّر الملصق من قريب وفي نور كويس.',
  not_food: 'هذا مو أكل (تغليف أو تنظيف)، ما له سعرات.', 'not allowed': 'ما عندك صلاحية',
}[e] || 'صار خطأ: ' + e)

function NutritionCard({ itemId, canEdit, onChanged }) {
  const [n, setN] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [showIngr, setShowIngr] = useState(false)
  const load = useCallback(() => {
    supabase.from('inv_items').select('kcal_100,protein_100,carbs_100,fat_100,nutrition_source,nutrition_label_path,image_path,allergens,ingredients_text,nutrition_updated_at').eq('id', itemId).single().then(({ data }) => setN(data))
  }, [itemId])
  useEffect(() => { load() }, [load])
  const run = async (mode, files) => {
    setBusy(mode); setErr('')
    let paths
    if (files?.length) {
      paths = []
      for (const f of files) {
        const x = await compress(f)
        const path = `labels/${itemId}/${Date.now()}-${paths.length}.jpg`
        const up = await supabase.storage.from('product-photos').upload(path, x, { contentType: x.type || 'image/jpeg' })
        if (up.error) { setErr('ما قدرنا نرفع الصورة: ' + up.error.message); setBusy(''); return }
        paths.push(path)
      }
    }
    const r = await fillNutrition(itemId, mode, paths)
    setBusy('')
    if (!r?.ok) setErr(nutritionErr(r?.error)); else { load(); onChanged?.() }
  }
  if (!n) return null
  const has = n.kcal_100 != null
  const est = (n.nutrition_source || '').startsWith('تقدير')
  return (
    <div className="card form" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><strong style={{ fontSize: 14 }}>القيمة الغذائية لكل ١٠٠ جرام</strong>
        {has && nutSource(n.nutrition_source) && <span className={'pill ' + nutSource(n.nutrition_source).cls}>{nutSource(n.nutrition_source).label}</span>}</div>
      {has ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center' }}>
          {[['kcal_100', 'سعرة'], ['protein_100', 'بروتين'], ['carbs_100', 'كارب'], ['fat_100', 'دهون']].map(([k, l]) => (
            <div key={k} style={{ background: '#F7F9F5', borderRadius: 10, padding: '8px 4px' }}>
              <div className="num" style={{ fontWeight: 700, fontSize: k === 'kcal_100' ? 20 : 17 }}>{n[k] == null ? '—' : Number(n[k]).toLocaleString('en', { maximumFractionDigits: 1 })}</div>
              <div className="sub">{l}{k !== 'kcal_100' ? ' (غ)' : ''}</div></div>))}
        </div>) : <div className="empty" style={{ padding: 8 }}>ما فيه قيم غذائية للحين</div>}
      {n.nutrition_source && (est || n.nutrition_source.startsWith('ورقة')) && <div className="sub">{n.nutrition_source}</div>}
      {n.allergens?.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="sub">يحتوي:</span>{n.allergens.map((a) => <span key={a} className="pill red">{ALLERGEN_AR[a] || a}</span>)}</div>}
      {n.ingredients_text && <div><button type="button" className="chip" style={{ minHeight: 28 }} onClick={() => setShowIngr(!showIngr)}>المكونات</button>
        {showIngr && <div className="sub" style={{ marginTop: 6, lineHeight: 1.7 }}>{n.ingredients_text}</div>}</div>}
      {canEdit && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(n.nutrition_label_path || n.image_path) && <button className="btn" disabled={!!busy} onClick={() => run('label')}>{busy === 'label' ? <span className="spinner" /> : <Icon name="refresh" />} اقرا الملصق المحفوظ</button>}
          <label className="btn" style={{ position: 'relative', overflow: 'hidden' }}>
            <input type="file" accept="image/*" multiple style={{ position: 'absolute', inset: 0, opacity: 0 }} disabled={!!busy}
              onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) run('label', f) }} />
            <Icon name="camera" /> صوّر الملصق</label>
          <button className="btn" disabled={!!busy} onClick={() => run('estimate')}>{busy === 'estimate' ? <span className="spinner" /> : null} قيم تقديرية</button>
        </div>)}
      {err && <div className="error">{err}</div>}
    </div>
  )
}

// how the meal cost sees this item: price of a kilo / litre, 100 g and one piece
function PriceBreakdown({ item, onFix }) {
  const mu = MEASURE_UNITS[item.unit || '']
  const grams = mu ? mu[0] : Number(item.unit_grams) || 0
  const ml = (mu ? mu[1] : item.unit_measure) === 'ml'
  const price = Number(item.last_price) || 0
  const pcs = Number(item.unit_pieces) || 0
  const big = ml ? 'اللتر' : 'الكيلو', small = ml ? '100 مل' : '100 جرام'
  const row = (l, v, strong) => <div className="row"><span className="grow sub">{l}</span><span className="num" style={{ fontWeight: strong ? 700 : 500 }}>{v}</span></div>
  return (
    <div className="card form" style={{ gap: 6 }}>
      <div style={{ fontWeight: 600 }}>حساب السعر (اللي بيستخدمه كوست الوجبات)</div>
      {row(`الـ${item.unit || 'وحدة'} فيه`, grams ? `${fmtContent(grams, ml ? 'ml' : 'g')}${pcs > 1 ? ` · ${pcs} حبة` : ''}` : pcs ? `${pcs} حبة` : '—')}
      {row(`سعر الـ${item.unit || 'وحدة'}`, price ? `${kwd(price)} د.ك` : 'ما لوش سعر')}
      {grams > 0 && price > 0 && <>
        {row(`سعر ${big}`, `${kwd(price / grams * 1000)} د.ك`, true)}
        {row(`سعر ${small}`, `${kwd(price / grams * 100)} د.ك`, true)}
        {row(`سعر الجرام`, `${(price / grams).toFixed(4)} د.ك`)}
      </>}
      {pcs > 1 && price > 0 && row('سعر الحبة', `${kwd(price / pcs)} د.ك`)}
      {pcs > 1 && grams > 0 && row('وزن الحبة', fmtContent(grams / pcs, ml ? 'ml' : 'g'))}
      {Number(item.avg_cost) > 0 && grams > 0 && Math.abs(Number(item.avg_cost) - price) > 0.0005 && row(`متوسط التكلفة لـ${big}`, `${kwd(Number(item.avg_cost) / grams * 1000)} د.ك`)}
      {!grams && !(pcs > 1) && item.unit !== 'حبة' && <div className="warn"><Icon name="warn" /> الـ{item.unit} فيه كام كيلو أو لتر؟ مش متسجل، فكوست الوجبات ما يقدرش يحسب سعر الكيلو.
        {onFix && <button className="chip" style={{ minHeight: 28, marginInlineStart: 6 }} onClick={onFix}>اكتبها</button>}</div>}
      {!price && <div className="warn"><Icon name="warn" /> الصنف ما لوش سعر. ارفع فاتورة قديمة من «تسعير من فواتير قديمة».</div>}
    </div>
  )
}

function ItemSheet({ item, lookups, canEdit, onClose, onChanged }) {
  const [levels, setLevels] = useState([])
  const [moves, setMoves] = useState([])
  const [prices, setPrices] = useState([])
  const [edit, setEdit] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [rmErr, setRmErr] = useState('')
  // never-used items are deleted; items with history (movements, invoices, orders, counts) are stopped so the history stays
  const remove = async () => {
    setRmErr('')
    const del = await supabase.from('inv_items').delete().eq('id', item.id)
    if (!del.error) { onChanged(); onClose(); return }
    if (del.error.code === '23503' || /foreign key/i.test(del.error.message)) {
      const up = await supabase.from('inv_items').update({ active: false, is_critical: false }).eq('id', item.id)
      if (up.error) { setRmErr(invErr(up.error)); return }
      onChanged(); onClose(); return
    }
    setRmErr(invErr(del.error))
  }
  const load = useCallback(() => {
    supabase.from('stock_levels').select('qty, branch_id, branches(name,is_central_kitchen)').eq('item_id', item.id).then(({ data }) => setLevels(data || []))
    supabase.from('stock_movements').select('id,qty,kind,note,created_at,unit_cost,branches(name),employees:created_by(full_name)').eq('item_id', item.id).order('created_at', { ascending: false }).limit(20).then(({ data }) => setMoves(data || []))
    supabase.from('supplier_items').select('last_price,last_date,suppliers(name)').eq('item_id', item.id).order('last_date', { ascending: false }).then(({ data }) => setPrices(data || []))
  }, [item.id])
  useEffect(() => { load() }, [load])

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><div className="row" style={{ gap: 12 }}><ProductImage itemId={item.id} size={56} />
          <div><h2 style={{ fontSize: 20 }}>{item.name_ar}</h2><div className="sub ltr">{item.name_en}{item.brand ? ` · ${item.brand}` : ''}</div></div></div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <ProductPhotoLarge itemId={item.id} />
        <div className="grid stats">
          <div className="card stat"><div className="label">في المطبخ</div><div className="value num">{qtyFmt(item.kitchen_qty)}</div><div className="sub">{item.unit}</div></div>
          <div className="card stat"><div className="label">آخر سعر</div><div className="value num" style={{ fontSize: 22 }}>{kwd(item.last_price)}</div><div className="sub">د.ك / {item.unit || 'وحدة'}</div></div>
          <div className="card stat"><div className="label">متوسط التكلفة</div><div className="value num" style={{ fontSize: 22 }}>{kwd(item.avg_cost)}</div><div className="sub">د.ك</div></div>
        </div>
        <PriceBreakdown item={item} onFix={canEdit ? () => setEdit(true) : null} />
        {canEdit && <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={() => setEdit(true)}>تعديل الصنف</button>
          {item.active ? <button className="btn danger" onClick={() => setRemoving(true)}><Icon name="trash" /> حذف الصنف</button>
            : <button className="btn" onClick={async () => { await supabase.from('inv_items').update({ active: true }).eq('id', item.id); onChanged(); onClose() }}>رجّع الصنف</button>}
          <button className="btn" onClick={() => setAdjust(true)}>تالف أو تعديل كمية</button>
        </div>}
        <NutritionCard itemId={item.id} canEdit={canEdit} onChanged={onChanged} />
        {levels.length > 0 && <div className="card"><strong style={{ fontSize: 14 }}>الكمية في كل مكان</strong>
          <div className="list">{levels.map((l) => { const n = branchPieces(item, l.branches?.is_central_kitchen); return <div key={l.branch_id} className="list-item"><span className="grow">{l.branches?.name}</span><span className="num">{n ? `${qtyFmt(toPieces(l.qty, n))} حبة` : `${qtyFmt(l.qty)} ${item.unit || ''}`}</span></div> })}</div></div>}
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
      {removing && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRemoving(false)}>
          <div className="sheet form">
            <div className="sheet-head"><h2 style={{ fontSize: 20 }}>حذف {item.name_ar}؟</h2>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setRemoving(false)}><Icon name="x" /></button></div>
            {moves.length > 0 || Number(item.total_qty) !== 0
              ? <div className="warn"><Icon name="warn" /> الصنف هذا له حركات أو فواتير أو طلبات. عشان ما يخرب التاريخ والتقارير، ينشال من القائمة ويروح لـ "موقوفة"، وتقدر ترجعه وقت ما تبي.</div>
              : <div className="sub">الصنف ما انستخدم في أي حركة، فبينمسح نهائياً.</div>}
            {rmErr && <div className="error">{rmErr}</div>}
            <button className="btn danger block" onClick={remove}><Icon name="trash" /> حذف</button>
          </div>
        </div>)}
    </div>
  )
}

// shared add / edit sheet for lookup tables that have an Arabic name (name) and an English name (name_en)
function NamesSheet({ table, refCol, title, singular, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [used, setUsed] = useState({})
  const [edit, setEdit] = useState({})
  const [nw, setNw] = useState({ name: '', name_en: '' })
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    supabase.from(table).select('*').order(table === 'inv_categories' ? 'sort_order' : 'name').order('name').then(({ data }) => setRows(data || []))
    selectAll(() => supabase.from('inv_items').select(refCol).order('id')).then((data) => {
      const m = {}; (data || []).forEach((r) => { if (r[refCol]) m[r[refCol]] = (m[r[refCol]] || 0) + 1 }); setUsed(m)
    })
  }, [table, refCol])
  useEffect(() => { load() }, [load])
  const done = () => { clearLookups(); load(); onChanged() }
  const val = (r, k) => (edit[r.id]?.[k] ?? r[k] ?? '')
  const change = (r, k) => (e) => setEdit({ ...edit, [r.id]: { ...edit[r.id], [k]: e.target.value } })
  const save = async (r) => {
    const name = val(r, 'name').trim()
    const name_en = val(r, 'name_en').trim()
    if (!name) { setErr('الاسم بالعربي مطلوب'); return }
    if (name === r.name && name_en === (r.name_en || '')) return
    setErr('')
    const { error } = await supabase.from(table).update({ name, name_en: name_en || null }).eq('id', r.id)
    if (error) setErr(invErr(error)); else { setEdit((x) => { const y = { ...x }; delete y[r.id]; return y }); done() }
  }
  const remove = async (r) => {
    if (!window.confirm(`تمسح ${singular} "${r.name}"؟`)) return
    const { error } = await supabase.from(table).delete().eq('id', r.id)
    if (error) setErr(invErr(error)); else done()
  }
  const add = async (e) => {
    e.preventDefault(); setErr('')
    if (!nw.name.trim()) return
    const row = { name: nw.name.trim(), name_en: nw.name_en.trim() || null, ...(table === 'inv_categories' ? { sort_order: 50 } : {}) }
    const { error } = await supabase.from(table).insert(row)
    if (error) setErr(invErr(error)); else { setNw({ name: '', name_en: '' }); done() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="sub">غيّر الاسم بالعربي أو بالإنجليزي واضغط برا الخانة عشان ينحفظ. {singular === 'تصنيف' ? 'التصنيف' : 'الوحدة'} اللي ما عليها أصناف بس اللي تنمسح.</div>
        <div className="card list" style={{ padding: '2px 12px' }}>
          {rows.map((r) => {
            const n = used[r.id] || 0
            return (
              <div key={r.id} className="list-item" style={{ gap: 8 }}>
                <div className="grid grow" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <input className="input" style={{ height: 40 }} value={val(r, 'name')} placeholder="بالعربي" aria-label="الاسم بالعربي"
                    onChange={change(r, 'name')} onBlur={() => save(r)} />
                  <input className="input ltr" style={{ height: 40, textAlign: 'left' }} value={val(r, 'name_en')} placeholder="English" aria-label="الاسم بالإنجليزي"
                    onChange={change(r, 'name_en')} onBlur={() => save(r)} />
                </div>
                <span className="pill gray num">{n}</span>
                <button className="icon-btn" style={{ width: 38, height: 38 }} disabled={n > 0} title={n > 0 ? 'فيه أصناف، انقلها أول' : 'مسح'}
                  aria-label={`مسح ${r.name}`} onClick={() => remove(r)}><Icon name="trash" size={16} /></button>
              </div>
            )
          })}
        </div>
        <form className="form" style={{ gap: 8 }} onSubmit={add}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" placeholder={`${singular} جديد بالعربي`} aria-label="الاسم بالعربي" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
            <input className="input ltr" style={{ textAlign: 'left' }} placeholder="Name in English" aria-label="الاسم بالإنجليزي" value={nw.name_en} onChange={(e) => setNw({ ...nw, name_en: e.target.value })} />
          </div>
          <button className="btn" disabled={!nw.name.trim()}><Icon name="plus" /> إضافة</button>
        </form>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  )
}

function ResetStock({ lookups, onClose, onDone }) {
  const { access } = useAccess()
  const [mode, setMode] = useState('qty')        // qty = quantities only, items = quantities + all items
  const [keepPhoto, setKeepPhoto] = useState(true)
  const [place, setPlace] = useState('')
  const [pw, setPw] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const all = mode === 'items'
  const placeName = all || !place ? 'كل الأماكن (المطبخ وكل الفروع)' : lookups.branches.find((b) => b.id === place)?.name
  const run = async (e) => {
    e.preventDefault(); setErr('')
    if (!sure) { setErr('علّم على التأكيد أول'); return }
    setBusy(true)
    // check the owner's own password again before wiping
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: loginEmail(access.employee.phone), password: pw })
    if (authErr) { setBusy(false); setErr('كلمة السر غلط'); return }
    const r1 = await supabase.rpc('reset_stock', { p_branch: all ? null : place || null, p_confirm: 'RESET' })
    if (r1.error) { setBusy(false); setErr(invErr(r1.error)); return }
    let msg = `تم تصفير ${r1.data.lines} رصيد في ${placeName}.`
    if (all) {
      const r2 = await supabase.rpc('archive_all_items', { p_confirm: 'ARCHIVE', p_keep_photo: keepPhoto })
      if (r2.error) { setBusy(false); setErr(invErr(r2.error)); return }
      msg += ` وانمسح ${r2.data.archived} صنف من القائمة${r2.data.kept ? `، وبقى ${r2.data.kept} صنف من الجرد بالصورة` : ''}. القائمة جاهزة تبدأها من جديد.`
    }
    setBusy(false)
    onDone(msg + ' الفواتير والطلبات والحركات القديمة محفوظة.')
    onClose()
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet form" onSubmit={run} autoComplete="off">
        <div className="sheet-head"><h2 style={{ fontSize: 20, color: 'var(--red)' }}>مسح المخزون</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><span className="lbl">إيش تبي تمسح؟</span>
          <label className="check"><input type="radio" name="m" checked={!all} onChange={() => { setMode('qty'); setSure(false) }} /> الكميات بس (الأصناف تبقى)</label>
          <label className="check"><input type="radio" name="m" checked={all} onChange={() => { setMode('items'); setSure(false) }} /> الكميات وكل الأصناف (أبدأ القائمة من جديد)</label></div>
        {all ? <div className="error">كل الأصناف بتختفي من المخزون والطلبات والجرد وقراءة الفواتير، وكل الكميات بترجع صفر. الفواتير والطلبات القديمة تبقى محفوظة بأسماء أصنافها. بعدها تضيف الأصناف من جديد بالجرد بالصورة أو "صنف جديد".</div>
          : <div className="error">كل الكميات بترجع صفر. الأصناف والأسعار والفواتير ما تنمسح، وسجل الحركات يفضل محفوظ.</div>}
        {all ? <label className="check"><input type="checkbox" checked={keepPhoto} onChange={(e) => setKeepPhoto(e.target.checked)} /> خلّي الأصناف اللي دخلت بالجرد بالصورة (أسماءها جديدة وصحيحة)</label>
          : <div className="field"><label htmlFor="rp">المكان</label>
            <select id="rp" className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">كل الأماكن (المطبخ وكل الفروع)</option>
              {lookups.stockBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>}
        <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> {all ? 'متأكد إني أبي أمسح كل الأصناف وأبدأ من جديد' : `متأكد إني أبي أمسح مخزون: ${placeName}`}</label>
        <div className="field"><label htmlFor="rpw">كلمة السر حقتك</label>
          <input id="rpw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn block" style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff', fontWeight: 600 }} disabled={busy || !pw || !sure}>
          {busy ? <span className="spinner" /> : <Icon name="trash" />} تأكيد المسح</button>
      </form>
    </div>
  )
}

export default function Inventory() {
  const { can, access } = useAccess()
  const [items, setItems] = useState([])
  const [resetOpen, setResetOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [lookups, setLookups] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [unitsOpen, setUnitsOpen] = useState(false)
  const [pending, setPending] = useState(0)
  const [filling, setFilling] = useState(null)

  const load = useCallback(() => {
    selectAll(() => supabase.from('inv_stock').select('*').order('name_ar').order('id')).then(setItems).catch(() => {})
    supabase.from('purchase_invoices').select('id', { count: 'exact', head: true }).eq('price_only', false).in('status', ['draft', 'reading', 'review', 'failed']).then(({ count }) => setPending(count || 0))
  }, [])
  useEffect(() => { load(); loadLookups(true).then(setLookups); refreshProductImages() }, [load])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) =>
      (filter === 'inactive' ? !i.active : i.active) &&
      (!cat || i.category_id === cat) &&
      (filter !== 'low' || Number(i.kitchen_qty) < Number(i.min_qty)) &&
      (filter !== 'critical' || i.is_critical) &&
      (filter !== 'content' || needsContent(i)) &&
      (!s || i.name_ar.toLowerCase().includes(s) || (i.name_en || '').toLowerCase().includes(s)))
  }, [items, q, cat, filter])

  const active = items.filter((i) => i.active)
  const low = active.filter((i) => Number(i.min_qty) > 0 && Number(i.kitchen_qty) < Number(i.min_qty)).length
  const value = active.reduce((a, i) => a + Math.max(Number(i.kitchen_qty), 0) * Number(i.avg_cost || 0), 0)
  const canEdit = can('manage_inventory')
  const noNut = active.filter((i) => i.kcal_100 == null)
  const noContent = active.filter(needsContent).length
  const fillAll = async () => {
    const { data: rows } = await supabase.from('inv_items').select('id,nutrition_label_path').in('id', noNut.map((i) => i.id))
    const withLabel = new Set((rows || []).filter((r) => r.nutrition_label_path).map((r) => r.id))
    let done = 0, fromLabel = 0, est = 0, skipped = 0
    setFilling({ done, total: noNut.length })
    for (const i of noNut) {
      let r = withLabel.has(i.id) ? await fillNutrition(i.id, 'label') : null
      if (r?.ok) fromLabel++
      else {
        if (r && ['not_configured', 'invalid_key', 'no_credit'].includes(r.error)) { setFilling(null); setNotice(nutritionErr(r.error)); return }
        r = await fillNutrition(i.id, 'estimate')
        if (r?.ok) est++; else if (['not_configured', 'invalid_key', 'no_credit'].includes(r?.error)) { setFilling(null); setNotice(nutritionErr(r.error)); return } else skipped++
      }
      setFilling({ done: ++done, total: noNut.length })
    }
    setFilling(null)
    setNotice(`تعبّت السعرات: ${fromLabel} من الملصق، ${est} تقدير${skipped ? `، و${skipped} مو أكل` : ''}. القيم التقديرية عليها علامة "تقديري" وتقدر تصححها.`)
    load()
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>المخزون</h1><div className="sub">المطبخ المركزي والفروع</div></div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {access.is_owner && <button className="btn danger" onClick={() => setResetOpen(true)}><Icon name="trash" /> مسح المخزون</button>}
          {canEdit && <Link className="btn" to="/inventory/price-fill"><Icon name="receipt" /> تسعير من فواتير قديمة</Link>}
          {canEdit && <Link className="btn" to="/inventory/opening"><Icon name="doc" /> رصيد أول المدة</Link>}
          {canEdit && noNut.length > 0 && <button className="btn" disabled={!!filling} onClick={fillAll}>{filling ? <><span className="spinner" /> {filling.done}/{filling.total}</> : <>تعبئة السعرات الناقصة ({noNut.length})</>}</button>}
          {canEdit && <button className="btn" onClick={() => setCatsOpen(true)}><Icon name="list" /> التصنيفات</button>}
          {canEdit && <button className="btn" onClick={() => setUnitsOpen(true)}><Icon name="list" /> الوحدات</button>}
          {canEdit && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> صنف جديد</button>}
          {(can('manage_suppliers') || can('approve_purchases') || can('receive_goods')) && <Link className="btn primary" to="/inventory/invoices?new=1"><Icon name="camera" /> استلام بضاعة</Link>}
        </div>
      </div>

      {notice && <div className="notice" style={{ marginBottom: 14 }}>{notice}</div>}
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">الأصناف</div><div className="value num">{active.length}</div></div>
        <button className="card stat" style={{ textAlign: 'right', cursor: 'pointer', borderColor: low ? '#F3DDA8' : undefined }} onClick={() => setFilter('low')}>
          <div className="label">تحت الحد الأدنى</div><div className="value num" style={{ color: low ? 'var(--amber)' : undefined }}>{low}</div></button>
        <Link className="card stat" to="/inventory/invoices" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="label">فواتير مفتوحة (استلام أو مراجعة)</div><div className="value num">{pending}</div></Link>
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
        {[['all', 'الكل'], ['low', 'تحت الحد الأدنى'], ['critical', 'الجرد اليومي'], ...(noContent ? [['content', `ناقص وزن الكرتونة/الكيس (${noContent})`]] : []), ['inactive', 'موقوفة']].map(([k, l]) =>
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
                  <td><div className="row" style={{ gap: 10 }}><ProductImage itemId={i.id} size={42} />
                    <div><div style={{ fontWeight: 500 }}>{i.name_ar}</div><div className="cell-sub ltr">{i.name_en}</div>
                      {i.kcal_100 != null ? <div className="cell-sub">{Math.round(i.kcal_100)} سعرة/١٠٠غ · ب {Number(i.protein_100 ?? 0).toFixed(0)} · ك {Number(i.carbs_100 ?? 0).toFixed(0)} · د {Number(i.fat_100 ?? 0).toFixed(0)}{nutSource(i.nutrition_source) ? <> · <span className={'pill ' + nutSource(i.nutrition_source).cls} style={{ fontSize: 11, padding: '0 6px' }}>{nutSource(i.nutrition_source).label}</span></> : null}</div>
                        : <div className="cell-sub" style={{ color: 'var(--amber)' }}>بدون سعرات</div>}
                      {needsContent(i) ? <div className="cell-sub" style={{ color: 'var(--amber)' }}>الـ{i.unit} فيه كام حبة أو كيلو؟ ناقص</div>
                        : (i.unit_grams || Number(i.unit_pieces) > 1) && !isMeasureUnit(i.unit) ? <div className="cell-sub">الـ{i.unit} = {[Number(i.unit_pieces) > 1 && `${Number(i.unit_pieces)} حبة`, i.unit_grams && fmtContent(i.unit_grams, i.unit_measure)].filter(Boolean).join(' · ')}</div> : null}</div></div></td>
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
      {resetOpen && lookups && <ResetStock lookups={lookups} onClose={() => setResetOpen(false)} onDone={(m) => { setNotice(m); load() }} />}
      {catsOpen && <NamesSheet table="inv_categories" refCol="category_id" title="التصنيفات" singular="تصنيف" onClose={() => setCatsOpen(false)} onChanged={() => { load(); loadLookups(true).then(setLookups) }} />}
      {unitsOpen && <NamesSheet table="inv_units" refCol="unit_id" title="الوحدات" singular="وحدة" onClose={() => setUnitsOpen(false)} onChanged={() => { load(); loadLookups(true).then(setLookups) }} />}
    </div>
  )
}
