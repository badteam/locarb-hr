import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { readDocument, ext } from '../lib/docs'
import Icon from './Icon.jsx'
import { useT } from '../lib/i18n.jsx'

function Upload({ label, file, onPick }) {
  const preview = file && file.type !== 'application/pdf' ? URL.createObjectURL(file) : null
  return (
    <label className="upload">
      {preview ? <img src={preview} alt="" /> : null}
      {!file && <Icon name="camera" size={26} stroke={1.6} />}
      {!file && label}
      {file?.type === 'application/pdf' && <span>PDF ✓</span>}
      <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => onPick(e.target.files?.[0] || null)} />
    </label>
  )
}

// Upload an employee document: photo only, the AI reads the dates, HR approves.
// doc = the document being renewed (approved) or re-sent (pending / rejected). onRead(id) is called for admins to open the review.
export default function DocumentForm({ employeeId, doc, onClose, onSaved, onRead, admin }) {
  const { t, tn, dir } = useT(admin)
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState(doc?.document_type_id || '')
  const [front, setFront] = useState(null)
  const [back, setBack] = useState(null)
  const [err, setErr] = useState('')
  const [step, setStep] = useState('form') // form | saving | reading | sent
  const resend = doc && doc.review_status !== 'approved'

  useEffect(() => {
    supabase.from('document_types').select('*').eq('scope', 'employee').order('sort_order').then(({ data }) => setTypes(data || []))
  }, [])

  const upload = async (file, side) => {
    if (!file) return null
    const path = `${employeeId}/${crypto.randomUUID()}-${side}.${ext(file)}`
    const { error } = await supabase.storage.from('employee-docs').upload(path, file, { contentType: file.type })
    if (error) throw error
    return path
  }

  const save = async (e) => {
    e.preventDefault()
    if (!front) { setErr(t('need_photo')); return }
    setStep('saving'); setErr('')
    try {
      const frontPath = await upload(front, 'front')
      const backPath = await upload(back, 'back')
      const type = types.find((x) => x.id === typeId)
      const files = { front_image_path: frontPath, back_image_path: backPath }
      let id = doc?.id
      if (resend) {
        const { error } = await supabase.from('employee_documents').update({ ...files, document_type_id: typeId || null, review_status: 'pending', review_note: null, ai_status: null }).eq('id', doc.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('employee_documents').insert({
          employee_id: employeeId, document_type_id: typeId || null, ...files, review_status: 'pending',
          remind_days_before: type?.default_remind_days || doc?.remind_days_before || 30, replaces_id: doc?.id || null,
        }).select('id').single()
        if (error) throw error
        id = data.id
      }
      setStep('reading')
      await readDocument('employee', id)
      onSaved?.()
      if (onRead) { onRead(id); onClose(); return }
      setStep('sent')
    } catch (e2) { setErr(errMsg(e2)); setStep('form') }
  }

  if (step === 'sent') return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form" dir={dir} style={{ textAlign: 'center' }}>
        <div className="notice">{t('sent_review')}</div>
        <button className="btn primary block" onClick={onClose}>{t('close')}</button>
      </div>
    </div>
  )

  const busy = step !== 'form'
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet form" onSubmit={save} dir={dir}>
        <div className="sheet-head">
          <h2 style={{ fontSize: 20 }}>{doc && !resend ? t('renew_doc') : resend ? t('reupload') : t('upload_doc')}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose} disabled={busy}><Icon name="x" /></button>
        </div>
        <div className="sub">{t('upload_hint')}</div>
        {doc?.review_status === 'rejected' && doc.review_note && <div className="error">{t('review_reason', { note: doc.review_note })}</div>}

        <div className="field">
          <span className="lbl">{t('doc_type_optional')}</span>
          <div className="chips">
            {types.map((x) => (
              <button type="button" key={x.id} className={'chip' + (typeId === x.id ? ' on' : '')} onClick={() => setTypeId(typeId === x.id ? '' : x.id)}>{tn(x.name)}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="lbl">{t('doc_photo')}</span>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Upload label={t('front')} file={front} onPick={setFront} />
            <Upload label={t('back')} file={back} onPick={setBack} />
          </div>
        </div>

        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? <><span className="spinner" /> {step === 'reading' ? t('reading_doc') : t('saving')}</> : t('upload_doc')}
        </button>
      </form>
    </div>
  )
}
