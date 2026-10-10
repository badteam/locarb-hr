import { supabase } from '../lib/supabase'
import { uploadAttachment, readFile, openFile, ACCEPT } from '../lib/ai'
import { useLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

// Employee side: optional medical report on a sick-leave / "I was sick" request.
export function MedicalPicker({ file, onPick }) {
  const { t } = useLang()
  return (
    <label className="upload" style={{ height: 84 }}>
      <input type="file" accept={ACCEPT} onChange={(e) => onPick(e.target.files?.[0] || null)} />
      {file ? <span>{t('medical_attached')} · {file.name}</span> : <><Icon name="camera" /> {t('medical_report')}</>}
    </label>
  )
}

// After the request is saved: upload, link it to the request, and let the AI compare it (runs in the background).
export async function attachMedical(file, employeeId, kind, id) {
  if (!file) return
  const path = await uploadAttachment(file, employeeId)
  const { error } = await supabase.rpc('attach_medical', { p_kind: kind, p_id: id, p_path: path })
  if (error) throw error
  readFile('medical', [path], { target: { kind, id } })
}

// Manager side (Arabic): the report and what the AI found.
export function MedicalCheck({ path, check }) {
  if (!path) return null
  const r = check?.read || {}
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="chip" style={{ minHeight: 30 }} onClick={() => openFile('attachments', path)}>📄 التقرير الطبي</button>
        {!check && <span className="sub">النظام يفحص التقرير…</span>}
        {check?.ok && <span className="pill ok">التقرير مطابق للطلب</span>}
        {check && !check.ok && <span className="pill red">انتبه</span>}
      </div>
      {check && <div className="sub">{[r.facility, r.patient_name, r.sick_from && r.sick_to ? `من ${r.sick_from} إلى ${r.sick_to}` : r.issue_date, r.days ? `${r.days} يوم` : null].filter(Boolean).join(' · ')}</div>}
      {check?.warnings?.map((w, i) => <div key={i} className="sub" style={{ color: 'var(--red)' }}>• {w}</div>)}
    </div>
  )
}
