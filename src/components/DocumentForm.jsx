import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import Icon from './Icon.jsx'
import { useAccess } from '../lib/access.jsx'
import { useT } from '../lib/i18n.jsx'

const REMIND = [{ d: 7, k: 'week' }, { d: 14, k: 'two_weeks' }, { d: 30, k: 'month' }, { d: 60, k: 'two_months' }]

function Upload({ label, file, existingUrl, onPick }) {
  const preview = file ? URL.createObjectURL(file) : existingUrl
  return (
    <label className="upload">
      {preview && file?.type !== 'application/pdf' ? <img src={preview} alt="" /> : null}
      {!preview && <Icon name="camera" size={26} stroke={1.6} />}
      {!preview && label}
      {file?.type === 'application/pdf' && <span>PDF ✓</span>}
      <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => onPick(e.target.files?.[0] || null)} />
    </label>
  )
}

// employeeId: whose document. doc: existing document (edit/renew) or null
export default function DocumentForm({ employeeId, doc, onClose, onSaved, admin }) {
  const { can } = useAccess()
  const { t, tn, dir } = useT(admin)
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState(doc?.document_type_id || '')
  const [expiry, setExpiry] = useState(doc?.expiry_date || '')
  const [number, setNumber] = useState(doc?.document_number || '')
  const [remind, setRemind] = useState(doc?.remind_days_before || 30)
  const [inApp, setInApp] = useState(doc?.notify_in_app ?? true)
  const [email, setEmail] = useState(doc?.notify_email ?? true)
  const [front, setFront] = useState(null)
  const [back, setBack] = useState(null)
  const [urls, setUrls] = useState({})
  const [newType, setNewType] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('document_types').select('*').order('sort_order').then(({ data }) => {
      setTypes(data || [])
      if (!doc && data?.[0]) setTypeId(data[0].id)
    })
    if (doc) {
      const paths = [doc.front_image_path, doc.back_image_path].filter(Boolean)
      if (paths.length) supabase.storage.from('employee-docs').createSignedUrls(paths, 600).then(({ data }) => {
        const m = {}; (data || []).forEach((x) => { m[x.path] = x.signedUrl }); setUrls(m)
      })
    }
  }, [doc])

  const upload = async (file, side) => {
    if (!file) return null
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${employeeId}/${crypto.randomUUID()}-${side}.${ext}`
    const { error } = await supabase.storage.from('employee-docs').upload(path, file, { contentType: file.type })
    if (error) throw error
    return path
  }

  const addType = async () => {
    if (!newType?.trim()) return
    const { data, error } = await supabase.from('document_types').insert({ name: newType.trim(), sort_order: 99 }).select().single()
    if (error) { setErr(errMsg(error)); return }
    setTypes((x) => [...x, data]); setTypeId(data.id); setNewType(null)
  }

  const save = async (e) => {
    e.preventDefault()
    if (!typeId || !expiry) { setErr(t('pick_type_date')); return }
    setBusy(true); setErr('')
    try {
      const frontPath = await upload(front, 'front')
      const backPath = await upload(back, 'back')
      const row = {
        employee_id: employeeId, document_type_id: typeId, expiry_date: expiry, document_number: number || null,
        remind_days_before: remind, notify_in_app: inApp, notify_email: email,
        ...(frontPath ? { front_image_path: frontPath } : {}), ...(backPath ? { back_image_path: backPath } : {}),
      }
      const q = doc ? supabase.from('employee_documents').update(row).eq('id', doc.id) : supabase.from('employee_documents').insert(row)
      const { error } = await q
      if (error) throw error
      onSaved?.()
      onClose()
    } catch (e2) { setErr(errMsg(e2)) }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save} dir={dir}>
        <div className="sheet-head">
          <h2 style={{ fontSize: 20 }}>{doc ? t('update_document') : t('add_document')}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="field">
          <span className="lbl">{t('doc_type')}</span>
          <div className="chips">
            {types.map((x) => (
              <button type="button" key={x.id} className={'chip' + (typeId === x.id ? ' on' : '')} onClick={() => { setTypeId(x.id); if (!doc) setRemind(x.default_remind_days) }}>{tn(x.name)}</button>
            ))}
            {!can('manage_employees') ? null : newType === null
              ? <button type="button" className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setNewType('')}>+ نوع آخر</button>
              : <span className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ height: 40, width: 150 }} placeholder="اسم النوع" value={newType} onChange={(e) => setNewType(e.target.value)} />
                  <button type="button" className="btn" style={{ minHeight: 40 }} onClick={addType}>إضافة</button>
                </span>}
          </div>
        </div>

        <div className="field">
          <span className="lbl">{t('doc_photo')}</span>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Upload label={t('front')} file={front} existingUrl={urls[doc?.front_image_path]} onPick={setFront} />
            <Upload label={t('back')} file={back} existingUrl={urls[doc?.back_image_path]} onPick={setBack} />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label htmlFor="exp">{t('expiry_date')}</label>
            <input id="exp" type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="num">{t('doc_number')}</label>
            <input id="num" className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <span className="lbl">{t('remind_before')}</span>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {REMIND.map((r) => <button type="button" key={r.d} className={'chip' + (remind === r.d ? ' on' : '')} style={{ borderRadius: 12 }} onClick={() => setRemind(r.d)}>{t(r.k)}</button>)}
          </div>
          <div className="row sub" style={{ gap: 8 }}>
            {t('or_days')}
            <input type="number" min="1" max="365" className="input" style={{ height: 38, width: 90 }} value={remind} onChange={(e) => setRemind(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lbl" style={{ fontWeight: 600, fontSize: 14 }}>{t('notify_via')}</span>
          <label className="check"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> {t('in_app')}</label>
          <label className="check"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> {t('email_mgmt')}</label>
        </div>

        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? t('saving') : t('save_document')}</button>
      </form>
    </div>
  )
}
