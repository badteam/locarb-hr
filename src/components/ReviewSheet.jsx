import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, fmtDate } from '../lib/supabase'
import { readDocument, aiMessage, FIELD_LABEL, statusPill } from '../lib/docs'
import Icon from './Icon.jsx'

const CFG = {
  employee: { view: 'employee_documents_status', table: 'employee_documents', bucket: 'employee-docs', files: (d) => [d.front_image_path, d.back_image_path].filter(Boolean), owner: (d) => d.employee_name, ownerKey: 'employee_id' },
  branch: { view: 'branch_documents_status', table: 'branch_documents', bucket: 'branch-docs', files: (d) => d.file_paths || [], owner: (d) => d.branch_name, ownerKey: 'branch_id' },
}

// Admin sheet (Arabic): check what the AI read against the photo, fix, then approve / reject. Also edits approved documents.
export default function ReviewSheet({ kind, docId, onClose, onSaved, onRenew, readOnly }) {
  const c = CFG[kind]
  const [d, setD] = useState(null)
  const [types, setTypes] = useState([])
  const [urls, setUrls] = useState([])
  const [f, setF] = useState({})
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [rejecting, setRejecting] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from(c.view).select('*').eq('id', docId).maybeSingle()
    if (!data) { setMsg({ ok: false, t: 'المستند مو موجود' }); return }
    setD(data)
    setF({ document_type_id: data.document_type_id || '', document_number: data.document_number || '', holder_name: data.holder_name || '',
      issue_date: data.issue_date || '', expiry_date: data.expiry_date || '', remind_days_before: data.remind_days_before || 30, notes: data.notes || '' })
    const paths = c.files(data)
    if (paths.length) supabase.storage.from(c.bucket).createSignedUrls(paths, 1800).then(({ data: s }) => setUrls((s || []).map((x) => ({ path: x.path, url: x.signedUrl }))))
    if (data.document_type_id) {
      supabase.from(c.table).select('id,document_number,issue_date,expiry_date,reviewed_at,created_at').eq(c.ownerKey, data[c.ownerKey]).eq('document_type_id', data.document_type_id).eq('archived', true).order('expiry_date', { ascending: false })
        .then(({ data: h }) => setHistory(h || []))
    }
  }, [c, docId])
  useEffect(() => { load(); supabase.from('document_types').select('*').eq('scope', kind).order('sort_order').then(({ data }) => setTypes(data || [])) }, [load, kind])

  if (!d) return <div className="overlay"><div className="sheet center" style={{ minHeight: 200 }}>{msg ? <div className="error">{msg.t}</div> : <span className="spinner" />}</div></div>

  const pending = d.review_status !== 'approved'
  const flagged = new Set(d.review_fields || [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const warn = (k) => (flagged.has(k) ? { borderColor: 'var(--amber)', background: 'var(--amber-bg)' } : null)
  const dates = d.ai_data?.dates_found || []

  const row = () => ({
    document_type_id: f.document_type_id || null, document_number: f.document_number || null, holder_name: f.holder_name || null,
    issue_date: f.issue_date || null, expiry_date: f.expiry_date || null, remind_days_before: Number(f.remind_days_before) || 30,
    ...(kind === 'branch' ? { notes: f.notes || null } : {}),
  })
  const save = async (status) => {
    setMsg(null)
    if (status === 'approved' && !f.document_type_id) { setMsg({ ok: false, t: 'اختار نوع المستند' }); return }
    if (status === 'approved' && !f.expiry_date && !window.confirm('ما فيه تاريخ انتهاء، يعني ما بيجي تنبيه لهالمستند. تعتمده كذا؟')) return
    if (f.issue_date && f.expiry_date && f.issue_date > f.expiry_date) { setMsg({ ok: false, t: 'تاريخ الإصدار بعد تاريخ الانتهاء! تأكد منهم.' }); return }
    setBusy(status || 'save')
    const { error } = await supabase.from(c.table).update({ ...row(), ...(status ? { review_status: status, review_note: null } : {}) }).eq('id', d.id)
    setBusy('')
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    onSaved?.(); onClose()
  }
  const reject = async () => {
    if (!rejecting?.trim()) { setMsg({ ok: false, t: 'اكتب سبب الرفض عشان يوصل للموظف' }); return }
    setBusy('reject')
    const { error } = await supabase.from(c.table).update({ review_status: 'rejected', review_note: rejecting.trim() }).eq('id', d.id)
    setBusy('')
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    onSaved?.(); onClose()
  }
  const remove = async () => {
    if (!window.confirm('تحذف هالمستند؟')) return
    setBusy('del')
    const { error } = await supabase.from(c.table).delete().eq('id', d.id)
    setBusy('')
    if (error) { setMsg({ ok: false, t: errMsg(error) }); return }
    onSaved?.(); onClose()
  }
  const reread = async () => {
    setBusy('read'); setMsg(null)
    const r = await readDocument(kind, d.id)
    setBusy('')
    await load()
    setMsg(r.ok ? { ok: true, t: 'تمت القراءة. راجع الخانات الملوّنة.' } : { ok: false, t: aiMessage(r.error) })
  }

  const pill = statusPill(d.status, d.days_left)
  const aiNote = d.ai_status === 'reading' ? 'جاري القراءة…' : (d.ai_status && d.ai_status !== 'done') ? aiMessage(d.ai_error || d.ai_status) : null

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet form" style={{ maxWidth: 980, width: '100%' }} dir="rtl">
        <div className="sheet-head">
          <div><h2 style={{ fontSize: 20 }}>{pending ? 'مراجعة مستند' : 'بيانات المستند'}</h2>
            <div className="sub">{c.owner(d)}{d.document_type_name ? ' · ' + d.document_type_name : ''}</div></div>
          <span className={'pill ' + pill.cls}>{pill.text}</span>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose} disabled={!!busy}><Icon name="x" /></button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {urls.length === 0 && <div className="empty">ما فيه صورة</div>}
            {urls.map((u) => u.path.endsWith('.pdf')
              ? <iframe key={u.path} title="PDF" src={u.url} style={{ width: '100%', height: 460, border: '1px solid var(--line)', borderRadius: 12 }} />
              : <a key={u.path} href={u.url} target="_blank" rel="noreferrer"><img src={u.url} alt="صورة المستند" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} /></a>)}
            {urls.length > 0 && <div className="sub">اضغط على الصورة عشان تكبّرها</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {d.review_status === 'rejected' && d.review_note && <div className="error">سبب الرفض: {d.review_note}</div>}
            {aiNote && <div className="warn">{aiNote}</div>}
            {pending && d.ai_status === 'done' && (flagged.size
              ? <div className="warn">الذكاء الاصطناعي مو متأكد من: {[...flagged].map((k) => FIELD_LABEL[k] || k).join('، ')}. تأكد منها من الصورة.</div>
              : <div className="notice">القراءة واضحة. طابقها مع الصورة واعتمد.</div>)}
            {d.ai_data?.summary_ar && <div className="sub">📄 {d.ai_data.summary_ar}</div>}

            <div className="field"><label htmlFor="rt">نوع المستند</label>
              <select id="rt" className="input" style={warn('document_type')} value={f.document_type_id} onChange={set('document_type_id')} disabled={readOnly}>
                <option value="">اختار…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {flagged.has('document_type') && d.ai_data?.document_type && <div className="sub">قراه كـ: {d.ai_data.document_type}</div>}</div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label htmlFor="rn">رقم المستند</label><input id="rn" className="input ltr" style={warn('document_number')} value={f.document_number} onChange={set('document_number')} disabled={readOnly} /></div>
              <div className="field"><label htmlFor="rh">الاسم في المستند</label><input id="rh" className="input" style={warn(kind === 'branch' ? 'branch' : 'holder_name')} value={f.holder_name} onChange={set('holder_name')} disabled={readOnly} /></div>
              <div className="field"><label htmlFor="ri">تاريخ الإصدار</label><input id="ri" type="date" className="input" style={warn('issue_date')} value={f.issue_date} onChange={set('issue_date')} disabled={readOnly} /></div>
              <div className="field"><label htmlFor="re">تاريخ الانتهاء</label><input id="re" type="date" className="input" style={warn('expiry_date')} value={f.expiry_date} onChange={set('expiry_date')} disabled={readOnly} /></div>
            </div>
            {dates.length > 1 && !readOnly && (
              <div className="card" style={{ padding: 10 }}>
                <div className="sub" style={{ marginBottom: 6 }}>التواريخ اللي لقاها في المستند (اضغط عشان تخليه تاريخ الانتهاء):</div>
                <div className="chips">{dates.map((x, i) => (
                  <button type="button" key={i} className={'chip' + (x.date === f.expiry_date ? ' on' : '')} onClick={() => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && setF({ ...f, expiry_date: x.date })}>
                    {x.label || '—'}: <span className="ltr">{x.date}</span>{x.calendar === 'hijri' ? ' (هجري)' : ''}</button>))}</div>
              </div>)}
            <div className="field"><label htmlFor="rr">التنبيه قبل الانتهاء بـ (يوم)</label>
              <input id="rr" type="number" min="1" max="365" className="input" style={{ maxWidth: 140 }} value={f.remind_days_before} onChange={set('remind_days_before')} disabled={readOnly} /></div>
            {kind === 'branch' && <div className="field"><label htmlFor="rno">ملاحظات</label><input id="rno" className="input" value={f.notes} onChange={set('notes')} disabled={readOnly} /></div>}

            {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}

            {!readOnly && (pending ? (
              <>
                <button className="btn primary block" disabled={!!busy} onClick={() => save('approved')}>{busy === 'approved' ? <span className="spinner" /> : <Icon name="check" />} اعتماد المستند</button>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn" disabled={!!busy} onClick={() => save(null)}>حفظ بدون اعتماد</button>
                  <button className="btn" disabled={!!busy} onClick={reread}>{busy === 'read' ? <span className="spinner" /> : null} اقرا من جديد</button>
                  {kind === 'employee' && d.uploaded_by === d.employee_id && rejecting === null && <button className="btn danger" disabled={!!busy} onClick={() => setRejecting('')}>رفض</button>}
                  {!(kind === 'employee' && d.uploaded_by === d.employee_id) && <button className="btn danger" disabled={!!busy} onClick={remove}>حذف (رفعته غلط)</button>}
                </div>
                {rejecting !== null && (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <input className="input grow" placeholder="سبب الرفض (يوصل للموظف) مثل: الصورة مو واضحة" value={rejecting} onChange={(e) => setRejecting(e.target.value)} />
                    <button className="btn danger" disabled={!!busy} onClick={reject}>تأكيد الرفض</button>
                  </div>)}
              </>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn primary" disabled={!!busy} onClick={() => save(null)}>{busy === 'save' ? <span className="spinner" /> : null} حفظ التعديل</button>
                {onRenew && <button className="btn" disabled={!!busy} onClick={() => onRenew(d)}><Icon name="plus" /> تجديد (رفع النسخة الجديدة)</button>}
              </div>
            ))}

            {d.extracted_text && (
              <details><summary className="sub" style={{ cursor: 'pointer' }}>النص المقروء من المستند</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: '#F7F9F5', padding: 10, borderRadius: 10, maxHeight: 240, overflow: 'auto' }}>{d.extracted_text}</pre></details>)}
            {history.length > 0 && (
              <div><div className="sub" style={{ marginBottom: 4 }}>النسخ السابقة</div>
                {history.map((h) => <div key={h.id} className="sub">• {h.document_number || '—'} · انتهت {fmtDate(h.expiry_date)}</div>)}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
