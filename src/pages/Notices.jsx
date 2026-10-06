import { useEffect, useState, useCallback } from 'react'
import { supabase, fmtDate, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'
import SignaturePad, { uploadSignature, SignatureImage } from '../components/SignaturePad.jsx'
import { useLang } from '../lib/i18n.jsx'

const TYPES = { warning: 'إنذار', final_warning: 'إنذار نهائي', deduction: 'خصم', other: 'إشعار' }
const STATUS = { pending: ['amber', 'بانتظار التوقيع', 'ns_pending'], signed: ['ok', 'تم التوقيع', 'ns_signed'], refused: ['red', 'رفض التوقيع', 'ns_refused'] }

function IssueForm({ employees, onClose, onSaved }) {
  const [emp, setEmp] = useState('')
  const [type, setType] = useState('warning')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [amount, setAmount] = useState('')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    const { error } = await supabase.rpc('issue_notice', {
      p_employee: emp, p_type: type, p_title: title, p_details: details || null,
      p_amount: amount ? Number(amount) : null, p_period: amount ? `${month}-01` : null,
    })
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save} dir="rtl" lang="ar">
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>إصدار عقوبة / إنذار</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="ne">الموظف</label>
          <select id="ne" className="input" value={emp} onChange={(e) => setEmp(e.target.value)} required>
            <option value="">اختار الموظف…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></div>
        <div className="field"><span className="lbl">النوع</span>
          <div className="chips">{Object.entries(TYPES).map(([k, t]) => <button type="button" key={k} className={'chip' + (type === k ? ' on' : '')} onClick={() => setType(k)}>{t}</button>)}</div></div>
        <div className="field"><label htmlFor="nt">العنوان</label><input id="nt" className="input" placeholder="مثلاً: تأخير متكرر" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div className="field"><label htmlFor="nd">التفاصيل</label><textarea id="nd" className="input" style={{ height: 100, paddingTop: 10 }} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <div className="card form" style={{ gap: 10 }}>
          <strong style={{ fontSize: 14 }}>خصم من الراتب (اختياري)</strong>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="na">المبلغ (د.ك)</label><input id="na" type="number" step="0.001" min="0" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label htmlFor="nm">ينخصم في شهر</label><input id="nm" type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          </div>
          <div className="sub">الخصم ينطبق على هالشهر بس، ويطلع في كشف راتبه.</div>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">إرسال للموظف</button>
      </form>
    </div>
  )
}

function SignSheet({ notice, empId, onClose, onSaved }) {
  const { t, fmtDate: fd, dir } = useLang()
  const [signed, setSigned] = useState(false)
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const respond = async (sign) => {
    if (sign && !signed) { setErr(t('sign_first')); return }
    setBusy(true); setErr('')
    try {
      const path = sign ? await uploadSignature(empId) : null
      const { error } = await supabase.rpc('respond_notice', { p_notice: notice.id, p_sign: sign, p_signature_path: path, p_comment: comment || null })
      if (error) throw error
      onSaved(); onClose()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet form" dir={dir}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{t('n_' + notice.notice_type)}: {notice.title}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="sub">{t('issued_on', { d: fd(notice.issued_at) })}</div>
        {notice.details && <div className="card" style={{ whiteSpace: 'pre-line' }}>{notice.details}</div>}
        {notice.deduction_amount && <div className="warn">{t('deduct_from', { a: notice.deduction_amount, m: notice.deduction_period?.slice(0, 7) })}</div>}
        <div className="field"><label htmlFor="sc">{t('your_comment')}</label><textarea id="sc" className="input" style={{ height: 70, paddingTop: 10 }} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <SignaturePad onChange={(empty) => setSigned(!empty)} />
        <div className="sub">{t('sign_means')}</div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy} onClick={() => respond(true)}>{t('sign_receive')}</button>
        <button className="btn danger" disabled={busy} onClick={() => respond(false)}>{t('refuse_sign')}</button>
      </div>
    </div>
  )
}

export default function Notices() {
  const { access, can } = useAccess()
  const emp = access.employee
  const isIssuer = can('issue_notices')
  const { t, fmtDate: fd, dir } = useLang()
  const [mine, setMine] = useState([])
  const [all, setAll] = useState([])
  const [employees, setEmployees] = useState([])
  const [issuing, setIssuing] = useState(false)
  const [signing, setSigning] = useState(null)

  const load = useCallback(() => {
    supabase.from('disciplinary_notices').select('*').eq('employee_id', emp.id).order('issued_at', { ascending: false }).then(({ data }) => setMine(data || []))
    if (isIssuer) {
      supabase.from('disciplinary_notices').select('*').neq('employee_id', emp.id).order('issued_at', { ascending: false }).limit(200).then(({ data }) => setAll(data || []))
      supabase.from('employees').select('id,full_name').eq('active', true).order('full_name').then(({ data }) => setEmployees(data || []))
    }
  }, [emp.id, isIssuer])
  useEffect(() => { load() }, [load])
  const name = Object.fromEntries(employees.map((e) => [e.id, e.full_name]))

  const Row = ({ n, manager }) => {
    const [cls, txtAr, key] = STATUS[n.status]
    const txt = manager ? txtAr : t(key)
    return (
      <div className="list-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>{manager ? `${name[n.employee_id] || ''} · ${TYPES[n.notice_type]}` : t('n_' + n.notice_type)}: {n.title}</div>
          <div className="sub">{manager ? fmtDate(n.issued_at) : fd(n.issued_at)}{n.deduction_amount ? (manager ? ` · خصم ${n.deduction_amount} د.ك (${n.deduction_period?.slice(0, 7)})` : ` · ${t('deduct_from', { a: n.deduction_amount, m: n.deduction_period?.slice(0, 7) })}`) : ''}</div>
          {n.employee_comment && <div className="sub">{manager ? 'تعليق الموظف' : t('emp_comment')}: {n.employee_comment}</div>}
          {manager && n.signature_path && <div style={{ marginTop: 6 }}><SignatureImage path={n.signature_path} /></div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={'pill ' + cls}>{txt}</span>
          {!manager && n.status === 'pending' && <button className="btn primary" style={{ minHeight: 38 }} onClick={() => setSigning(n)}>{t('read_sign')}</button>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }} dir={dir}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>{t('notices_title')}</h1>
        {isIssuer && <button className="btn primary" lang="ar" onClick={() => setIssuing(true)}><Icon name="plus" /> إصدار جديد</button>}
      </div>
      {(mine.length > 0 || !isIssuer) && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>{t('notices_for_you')}</h2>
          <div className="card list" style={{ padding: '4px 14px' }}>{mine.length === 0 ? <div className="empty">{t('nothing')}</div> : mine.map((n) => <Row key={n.id} n={n} />)}</div>
        </section>
      )}
      {isIssuer && (
        <section dir="rtl" lang="ar">
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>كل الإشعارات الصادرة</h2>
          <div className="card list" style={{ padding: '4px 14px' }}>{all.length === 0 ? <div className="empty">ما فيه إشعارات</div> : all.map((n) => <Row key={n.id} n={n} manager />)}</div>
        </section>
      )}
      {issuing && <IssueForm employees={employees} onClose={() => setIssuing(false)} onSaved={load} />}
      {signing && <SignSheet notice={signing} empId={emp.id} onClose={() => setSigning(null)} onSaved={load} />}
    </div>
  )
}
