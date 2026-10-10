import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate, todayKuwait } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { statusPill, ext, compressImage } from '../lib/docs'
import Icon from '../components/Icon.jsx'

const money = (n) => Number(n || 0).toFixed(3)
const every = (m) => (m === 1 ? 'كل شهر' : m === 12 ? 'كل سنة' : m === 6 ? 'كل ٦ شهور' : `كل ${m} شهور`)

function DoneSheet({ item, onClose, onSaved }) {
  const [date, setDate] = useState(todayKuwait())
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const paths = []
      for (const raw of files) {
        const f = await compressImage(raw)
        const path = `${item.branch_id}/maintenance/${crypto.randomUUID()}.${ext(f)}`
        const { error } = await supabase.storage.from('branch-docs').upload(path, f, { contentType: f.type })
        if (error) throw error
        paths.push(path)
      }
      const { error } = await supabase.from('maintenance_logs').insert({ item_id: item.id, done_date: date, vendor: vendor || null, cost: cost === '' ? null : Number(cost), notes: notes || null, invoice_paths: paths })
      if (error) throw error
      onSaved(); onClose()
    } catch (e2) { setErr(errMsg(e2)) }
    setBusy(false)
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><div><h2 style={{ fontSize: 20 }}>تمت الصيانة</h2><div className="sub">{item.name} · {item.branch_name}</div></div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="dd">التاريخ</label><input id="dd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor="dc">التكلفة (د.ك)</label><input id="dc" type="number" step="0.001" min="0" className="input" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="dv">الشركة / الفني</label><input id="dv" className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
        <div className="field"><label htmlFor="dn">ملاحظات</label><input id="dn" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <label className="upload" style={{ height: 90 }}>
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...files, ...e.target.files])} />
          {files.length ? <span>{files.length} ملف ✓</span> : <><Icon name="camera" /> الفاتورة أو التقرير (اختياري)</>}
        </label>
        <div className="sub">الموعد الجاي ينحسب بروحه: {every(item.interval_months)} من هالتاريخ.</div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : null} حفظ</button>
      </form>
    </div>
  )
}

function ItemSheet({ item, branches, branchId, onClose, onSaved }) {
  const [f, setF] = useState({ branch_id: item?.branch_id || branchId || '', name: item?.name || '', interval_months: item?.interval_months || 3,
    remind_days_before: item?.remind_days_before || 7, last_done: item?.last_done || '', next_due: item?.next_due || '', notes: item?.notes || '', active: item?.active ?? true })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault(); setErr('')
    const row = { ...f, interval_months: Number(f.interval_months), remind_days_before: Number(f.remind_days_before), last_done: f.last_done || null, next_due: f.next_due || null, notes: f.notes || null }
    if (item && row.last_done === item.last_done && row.interval_months === item.interval_months) { /* keep manual next_due */ } else if (row.last_done) delete row.next_due
    const q = item ? supabase.from('maintenance_items').update(row).eq('id', item.id) : supabase.from('maintenance_items').insert(row)
    const { error } = await q
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{item ? 'تعديل بند صيانة' : 'بند صيانة جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="ib">الفرع</label>
          <select id="ib" className="input" value={f.branch_id} onChange={set('branch_id')} required disabled={!!item}>
            <option value="">اختار…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div className="field"><label htmlFor="in">البند</label><input id="in" className="input" value={f.name} onChange={set('name')} required placeholder="مثل: صيانة المولد" /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="ii">يتكرر كل (شهر)</label><input id="ii" type="number" min="1" max="60" className="input" value={f.interval_months} onChange={set('interval_months')} required /></div>
          <div className="field"><label htmlFor="ir">التنبيه قبلها بـ (يوم)</label><input id="ir" type="number" min="1" max="90" className="input" value={f.remind_days_before} onChange={set('remind_days_before')} /></div>
          <div className="field"><label htmlFor="il">آخر مرة انعملت</label><input id="il" type="date" className="input" value={f.last_done} onChange={set('last_done')} /></div>
          <div className="field"><label htmlFor="ix">الموعد الجاي</label><input id="ix" type="date" className="input" value={f.next_due} onChange={set('next_due')} />
            <div className="sub">ينحسب بروحه من آخر مرة. غيّره بس لو تبي موعد معيّن.</div></div>
        </div>
        <div className="field"><label htmlFor="io">ملاحظات</label><input id="io" className="input" value={f.notes} onChange={set('notes')} /></div>
        {item && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> البند شغال (شيل العلامة لو ما عاد له داعي)</label>}
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

function History({ item }) {
  const [logs, setLogs] = useState(null)
  useEffect(() => { supabase.from('maintenance_logs').select('*,employees:done_by(full_name)').eq('item_id', item.id).order('done_date', { ascending: false }).limit(20).then(({ data }) => setLogs(data || [])) }, [item.id])
  const openFile = async (p) => { const { data } = await supabase.storage.from('branch-docs').createSignedUrl(p, 600); if (data) window.open(data.signedUrl, '_blank') }
  if (!logs) return <div className="sub">…</div>
  if (!logs.length) return <div className="sub">ما فيه سجل لين الحين</div>
  return (
    <div style={{ padding: '4px 0 8px' }}>
      {logs.map((l) => (
        <div key={l.id} className="sub" style={{ padding: '3px 0' }}>
          • {fmtDate(l.done_date)}{l.vendor ? ` · ${l.vendor}` : ''}{l.cost != null ? ` · ${money(l.cost)} د.ك` : ''}{l.notes ? ` · ${l.notes}` : ''}{l.employees?.full_name ? ` · سجّلها ${l.employees.full_name}` : ''}
          {l.invoice_paths?.map((p, i) => <button key={p} className="chip" style={{ minHeight: 26, fontSize: 12, marginInlineStart: 6 }} onClick={() => openFile(p)}>الفاتورة {i + 1}</button>)}
        </div>))}
    </div>
  )
}

export default function Maintenance() {
  const { can } = useAccess()
  const manage = can('manage_branch_docs')
  const [items, setItems] = useState([])
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState('')
  const [f, setF] = useState('attention')
  const [done, setDone] = useState(null)
  const [edit, setEdit] = useState(undefined)
  const [hist, setHist] = useState(null)

  const load = useCallback(() => {
    supabase.from('maintenance_status').select('*').order('next_due', { ascending: true, nullsFirst: false }).then(({ data }) => setItems(data || []))
  }, [])
  useEffect(() => { load(); supabase.from('branches').select('id,name').eq('active', true).order('name').then(({ data }) => setBranches(data || [])) }, [load])

  const active = items.filter((i) => i.active)
  const shown = (f === 'inactive' ? items.filter((i) => !i.active) : active).filter((i) => (!branch || i.branch_id === branch) && (f !== 'attention' || ['overdue', 'due', 'unknown'].includes(i.status)))
  const yearCost = active.filter((i) => !branch || i.branch_id === branch).reduce((s, i) => s + Number(i.cost_this_year || 0), 0)
  const c = (s) => active.filter((i) => (!branch || i.branch_id === branch) && i.status === s).length

  return (
    <div>
      <div className="page-head">
        <div><h1>الصيانة الدورية</h1><div className="sub">لما تخلص الصيانة اضغط "تمت" والموعد الجاي ينحسب بروحه</div></div>
        {manage && <button className="btn primary" onClick={() => setEdit(null)}><Icon name="plus" /> بند جديد</button>}
      </div>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">متأخرة</div><div className="value" style={{ color: 'var(--red)' }}>{c('overdue')}</div></div>
        <div className="card stat"><div className="label">موعدها قريب</div><div className="value" style={{ color: 'var(--amber)' }}>{c('due')}</div></div>
        <div className="card stat"><div className="label">ما انعرف آخر مرة</div><div className="value">{c('unknown')}</div></div>
        <div className="card stat"><div className="label">تكلفة الصيانة هالسنة</div><div className="value">{money(yearCost)} <span style={{ fontSize: 14 }}>د.ك</span></div></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="input" style={{ maxWidth: 200, height: 42 }} value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <div className="chips">{[['attention', 'تحتاج انتباه'], ['all', 'الكل'], ['inactive', 'الموقوفة']].map(([k, t]) => <button key={k} className={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>{t}</button>)}</div>
      </div>
      {c('unknown') > 0 && f === 'attention' && <div className="sub" style={{ marginBottom: 8 }}>البنود اللي "ما انعرف آخر مرة": اضغط تعديل وحط تاريخ آخر صيانة، أو اضغط "تمت" لو انعملت اليوم.</div>}

      <div className="card table-wrap">
        {shown.length === 0 ? <div className="empty">ما فيه شي يحتاج انتباه ✓</div> : (
          <table>
            <thead><tr><th>البند</th><th>الفرع</th><th>التكرار</th><th>آخر مرة</th><th>الموعد الجاي</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {shown.map((i) => {
                const p = statusPill(i.status, i.days_left)
                return [
                  <tr key={i.id}>
                    <td style={{ fontWeight: 500 }}>{i.name}{i.notes ? <div className="cell-sub">{i.notes}</div> : null}</td>
                    <td>{i.branch_name}</td>
                    <td>{every(i.interval_months)}</td>
                    <td>{i.last_done ? fmtDate(i.last_done) : '—'}</td>
                    <td>{i.next_due ? fmtDate(i.next_due) : '—'}</td>
                    <td><span className={'pill ' + p.cls}>{p.text}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn primary" style={{ minHeight: 34 }} onClick={() => setDone(i)}><Icon name="check" /> تمت</button>{' '}
                      <button className="btn" style={{ minHeight: 34 }} onClick={() => setHist(hist === i.id ? null : i.id)}>السجل</button>{' '}
                      {manage && <button className="btn" style={{ minHeight: 34 }} onClick={() => setEdit(i)}>تعديل</button>}
                    </td>
                  </tr>,
                  hist === i.id && <tr key={i.id + 'h'}><td colSpan={7}><History item={i} /></td></tr>,
                ]
              })}
            </tbody>
          </table>)}
      </div>
      {done && <DoneSheet item={done} onClose={() => setDone(null)} onSaved={load} />}
      {edit !== undefined && <ItemSheet item={edit} branches={branches} branchId={branch} onClose={() => setEdit(undefined)} onSaved={load} />}
    </div>
  )
}
