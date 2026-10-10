import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'
import DocumentForm from '../components/DocumentForm.jsx'
import ReviewSheet from '../components/ReviewSheet.jsx'
import { uploadAttachment, readFile, readError, copyFile, ACCEPT } from '../lib/ai'
import EmployeesIO from '../components/EmployeesIO.jsx'

const DAYS = [['saturday','السبت'],['sunday','الأحد'],['monday','الاثنين'],['tuesday','الثلاثاء'],['wednesday','الأربعاء'],['thursday','الخميس'],['friday','الجمعة']]

function EmployeeForm({ emp, branches, shifts, roles, onClose, onSaved }) {
  const { access, can } = useAccess()
  const [f, setF] = useState({
    full_name: emp?.full_name || '', phone: emp?.phone || '', email: emp?.email || '', job_title: emp?.job_title || '',
    branch_id: emp?.branch_id || '', shift_id: emp?.shift_id || '', role_id: emp?.role_id || roles.find((r) => r.name === 'موظف')?.id || '',
    hire_date: emp?.hire_date || '', active: emp?.active ?? true,
    working_hours: emp?.working_hours ?? '', annual_leave_days: emp?.annual_leave_days ?? 30,
    weekly_holidays: emp?.weekly_holidays || [], leave_balance: emp?.leave_balance ?? 0,
    ot_mode: emp?.ot_mode || '', ot_rate: emp?.ot_rate ?? '', ot_multiplier: emp?.ot_multiplier ?? '',
    civil_id: emp?.civil_id || '', nationality: emp?.nationality || '',
  })
  // civil ID photo read by the AI: fills the form, and is saved as the employee's document
  const [idScan, setIdScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState(null)
  const scanId = async (file) => {
    if (!file) return
    setScanning(true); setScanMsg(null)
    try {
      const path = await uploadAttachment(file, access.employee.id)
      const r = await readFile('civil_id', [path])
      if (!r.ok) { setScanMsg({ ok: false, t: readError(r) }); setScanning(false); return }
      const d = r.data
      setIdScan({ path, data: d })
      setF((x) => ({ ...x, full_name: x.full_name || d.full_name_en || d.full_name_ar || '', civil_id: d.civil_id || x.civil_id, nationality: d.nationality || x.nationality }))
      const other = r.match?.employee && r.match.employee.id !== emp?.id ? r.match.employee : null
      setScanMsg(other ? { ok: false, t: `انتبه: هالبطاقة شكلها لموظف موجود (${other.name}).` }
        : { ok: true, t: `قرا البطاقة: ${[d.full_name_en, d.full_name_ar].filter(Boolean).join(' / ')}${d.expiry_date ? ` · تنتهي ${d.expiry_date}` : ''}. البطاقة بتنحفظ في مستنداته مع تنبيه الانتهاء.` })
    } catch (e2) { setScanMsg({ ok: false, t: errMsg(e2) }) }
    setScanning(false)
  }
  const canPay = can('manage_payroll')
  const [salary, setSalary] = useState('')
  // allowances being edited: existing rows keep their id; new rows have none; removed rows are flagged
  const [allowances, setAllowances] = useState([])
  const addAllow = (name = '') => setAllowances((a) => [...a, { key: Math.random(), name, amount: '' }])
  const editAllow = (i, k, v) => setAllowances((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const removeAllow = (i) => setAllowances((a) => a.map((x, j) => (j === i ? { ...x, removed: true } : x)))
  useEffect(() => {
    if (!emp || !canPay) return
    supabase.from('employee_salaries').select('basic_salary').eq('employee_id', emp.id).maybeSingle().then(({ data }) => setSalary(data?.basic_salary ?? ''))
    supabase.from('employee_allowances').select('*').eq('employee_id', emp.id).eq('active', true).then(({ data }) => setAllowances(data || []))
  }, [emp, canPay])
  const toggleDay = (d) => setF((x) => ({ ...x, weekly_holidays: x.weekly_holidays.includes(d) ? x.weekly_holidays.filter((y) => y !== d) : [...x.weekly_holidays, d] }))
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const editable = can('manage_employees')
  const isOwnerRow = emp?.app_role === 'admin'

  const resetPw = async () => {
    setErr(''); setOk('')
    const { data, error } = await supabase.functions.invoke('employee-account', { body: { employee_id: emp.id } })
    const body = data || (await error?.context?.json?.().catch(() => null))
    if (!body?.ok) setErr(body?.error || error?.message || 'صار خطأ')
    else { setOk(`تم. يدخل برقم ${body.login} وكلمة السر نفس الرقم، وبيطلب منه يغيّرها أول ما يدخل.`); onSaved() }
  }

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try {
      const row = { ...f, branch_id: f.branch_id || null, shift_id: f.shift_id || null, role_id: f.role_id || null, hire_date: f.hire_date || null, phone: f.phone.replace(/\D/g, '') || null,
        working_hours: f.working_hours === '' ? null : Number(f.working_hours), annual_leave_days: Number(f.annual_leave_days) || 0, leave_balance: Number(f.leave_balance) || 0,
        ot_mode: f.ot_mode || null, ot_rate: f.ot_mode === 'fixed' && f.ot_rate !== '' ? Number(f.ot_rate) : null, ot_multiplier: f.ot_mode === 'multiplier' && f.ot_multiplier !== '' ? Number(f.ot_multiplier) : null,
        civil_id: f.civil_id.replace(/\D/g, '') || null, nationality: f.nationality || null }
      if (!access.is_owner) delete row.role_id
      if (!canPay) { delete row.leave_balance; delete row.ot_mode; delete row.ot_rate; delete row.ot_multiplier }
      let id = emp?.id
      if (emp) {
        const { error } = await supabase.from('employees').update(row).eq('id', emp.id); if (error) throw error
      } else {
        if (!access.is_owner) row.role_id = roles.find((r) => r.name === 'موظف')?.id || null
        const { data, error } = await supabase.from('employees').insert(row).select('id').single(); if (error) throw error
        id = data.id
      }
      if (idScan) {
        const d = idScan.data
        const { data: types } = await supabase.from('document_types').select('id,name').eq('scope', 'employee')
        const want = d.document_type && d.document_type !== 'other' ? d.document_type : 'البطاقة المدنية'
        const type = (types || []).find((t) => t.name === want)
        const e2 = idScan.path.endsWith('.pdf') ? 'pdf' : 'jpg'
        const front = await copyFile('attachments', idScan.path, 'employee-docs', `${id}/${crypto.randomUUID()}-front.${e2}`)
        const sure = d.expiry_date && type && !(d.uncertain_fields || []).includes('expiry_date')
        const { error } = await supabase.from('employee_documents').insert({ employee_id: id, document_type_id: type?.id || null, document_number: d.civil_id || null,
          expiry_date: d.expiry_date || null, front_image_path: front, review_status: sure ? 'approved' : 'pending', ai_status: 'done', ai_data: d,
          holder_name: d.full_name_en || d.full_name_ar || null, review_fields: sure ? [] : ['expiry_date'] })
        if (error) throw error
      }
      if (canPay) {
        if (salary !== '') {
          const { error } = await supabase.from('employee_salaries').upsert({ employee_id: id, basic_salary: Number(salary), updated_at: new Date().toISOString() }); if (error) throw error
        }
        for (const a of allowances) {
          const name = String(a.name || '').trim()
          if (a.id && (a.removed || !name)) {
            const { error } = await supabase.from('employee_allowances').update({ active: false }).eq('id', a.id); if (error) throw error
          } else if (a.id) {
            const { error } = await supabase.from('employee_allowances').update({ name, amount: Number(a.amount) || 0 }).eq('id', a.id); if (error) throw error
          } else if (!a.removed && name && Number(a.amount) > 0) {
            const { error } = await supabase.from('employee_allowances').insert({ employee_id: id, name, amount: Number(a.amount) }); if (error) throw error
          }
        }
      }
      onSaved()
      onClose()
    } catch (e2) { setErr(errMsg(e2)) }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head">
          <h2 style={{ fontSize: 20 }}>{emp ? emp.full_name : 'موظف جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button>
        </div>
        <fieldset disabled={!editable || (isOwnerRow && !access.is_owner)} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editable && (
            <label className="upload" style={{ height: 76 }}>
              <input type="file" accept={ACCEPT} onChange={(e) => { scanId(e.target.files?.[0]); e.target.value = '' }} />
              {scanning ? <><span className="spinner" /> جاري قراءة البطاقة…</> : <><Icon name="camera" /> {emp ? 'تحديث من صورة البطاقة المدنية' : 'عبّي البيانات من صورة البطاقة المدنية'}</>}
            </label>)}
          {scanMsg && <div className={scanMsg.ok ? 'notice' : 'warn'}>{scanMsg.t}</div>}
          <div className="field"><label htmlFor="n">الاسم الكامل</label><input id="n" className="input" value={f.full_name} onChange={set('full_name')} required /></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="cid">الرقم المدني</label><input id="cid" className="input ltr" style={{ textAlign: 'right' }} inputMode="numeric" value={f.civil_id} onChange={set('civil_id')} /></div>
            <div className="field"><label htmlFor="nat">الجنسية</label><input id="nat" className="input" value={f.nationality} onChange={set('nationality')} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="p">رقم الهاتف</label><input id="p" className="input ltr" style={{ textAlign: 'right' }} inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
            <div className="field"><label htmlFor="j">الوظيفة</label><input id="j" className="input" placeholder="شيف، كاشير، سايق…" value={f.job_title} onChange={set('job_title')} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="b">الفرع</label>
              <select id="b" className="input" value={f.branch_id} onChange={set('branch_id')}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div className="field"><label htmlFor="s">الشفت</label>
              <select id="s" className="input" value={f.shift_id} onChange={set('shift_id')}><option value="">—</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})</option>)}</select></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="r">الدور والصلاحيات</label>
              <select id="r" className="input" value={f.role_id} onChange={set('role_id')} disabled={!access.is_owner || isOwnerRow}>
                {isOwnerRow ? <option>المالك</option> : roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="h">تاريخ التعيين</label><input id="h" type="date" className="input" value={f.hire_date} onChange={set('hire_date')} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label htmlFor="wh">ساعات العمل باليوم</label><input id="wh" type="number" step="0.5" className="input" value={f.working_hours} onChange={set('working_hours')} /></div>
            <div className="field"><label htmlFor="al">الإجازة السنوية (يوم)</label><input id="al" type="number" className="input" value={f.annual_leave_days} onChange={set('annual_leave_days')} /></div>
          </div>
          <div className="field"><span className="lbl">أيام العطلة الأسبوعية</span>
            <div className="chips">{DAYS.map(([k, t]) => <button type="button" key={k} className={'chip' + (f.weekly_holidays.includes(k) ? ' on' : '')} onClick={() => toggleDay(k)}>{t}</button>)}</div>
          </div>
          {canPay && (
            <div className="card form" style={{ gap: 10 }}>
              <strong style={{ fontSize: 14 }}>الراتب والإجازات</strong>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field"><label htmlFor="bs">الراتب الأساسي (د.ك)</label><input id="bs" type="number" step="0.001" className="input" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
                <div className="field"><label htmlFor="lb">رصيد الإجازات (يوم)</label><input id="lb" type="number" step="0.25" className="input" value={f.leave_balance} onChange={set('leave_balance')} /></div>
              </div>
              <span className="lbl" style={{ fontSize: 14, fontWeight: 600 }}>سعر الإضافي لهذا الموظف</span>
              <div className="chips">
                <button type="button" className={'chip' + (!f.ot_mode ? ' on' : '')} onClick={() => setF({ ...f, ot_mode: '' })}>السعر العام</button>
                <button type="button" className={'chip' + (f.ot_mode === 'fixed' ? ' on' : '')} onClick={() => setF({ ...f, ot_mode: 'fixed' })}>مبلغ ثابت</button>
                <button type="button" className={'chip' + (f.ot_mode === 'multiplier' ? ' on' : '')} onClick={() => setF({ ...f, ot_mode: 'multiplier' })}>نسبة من أجره</button>
              </div>
              {f.ot_mode === 'fixed' && <input className="input" type="number" step="0.001" min="0" aria-label="سعر الساعة" placeholder="سعر الساعة (د.ك)" value={f.ot_rate} onChange={set('ot_rate')} />}
              {f.ot_mode === 'multiplier' && <input className="input" type="number" step="0.05" min="1" aria-label="النسبة" placeholder="مثلاً 1.25" value={f.ot_multiplier} onChange={set('ot_multiplier')} />}
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="lbl" style={{ fontSize: 14, fontWeight: 600 }}>البدلات الشهرية</span>
                <span className="sub">المجموع: {allowances.filter((a) => !a.removed).reduce((t, a) => t + (Number(a.amount) || 0), 0).toFixed(3)} د.ك</span>
              </div>
              {allowances.map((a, i) => a.removed ? null : (
                <div key={a.id || a.key} className="grid" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'center' }}>
                  <input className="input" aria-label="اسم البدل" placeholder="اسم البدل" value={a.name} onChange={(e) => editAllow(i, 'name', e.target.value)} />
                  <input className="input ltr" aria-label="المبلغ" type="number" step="0.001" min="0" placeholder="المبلغ" value={a.amount} onChange={(e) => editAllow(i, 'amount', e.target.value)} />
                  <button type="button" className="icon-btn" aria-label="إزالة البدل" onClick={() => removeAllow(i)}><Icon name="x" /></button>
                </div>
              ))}
              <div className="chips">
                <button type="button" className="chip" onClick={() => addAllow()}>+ إضافة بدل</button>
                {['بدل سكن', 'بدل مواصلات', 'بدل عدوى', 'بدل طعام', 'بدل هاتف']
                  .filter((n) => !allowances.some((a) => !a.removed && a.name === n))
                  .map((n) => <button type="button" key={n} className="chip" style={{ borderStyle: 'dashed' }} onClick={() => addAllow(n)}>+ {n}</button>)}
              </div>
            </div>
          )}
          <div className="field"><label htmlFor="em">الإيميل (اختياري، للتنبيهات)</label><input id="em" type="email" className="input ltr" style={{ textAlign: 'right' }} value={f.email} onChange={set('email')} /></div>
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> الموظف على رأس عمله</label>

          <div className="card form" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>دخول التطبيق</strong>
            <div className="sub">الموظف يدخل برقم هاتفه، وكلمة السر أول مرة هي نفس الرقم. وأول ما يدخل يطلب منه يغيّرها.</div>
            {emp?.user_id && <div className="sub">✓ الموظف فعّل حسابه{emp.must_change_password ? ' (ما غيّر كلمة السر للحين)' : ''}</div>}
            {emp?.user_id && <button type="button" className="btn" onClick={resetPw}>نسى كلمة السر؟ رجّعها لرقم الهاتف</button>}
          </div>
        </fieldset>
        {err && <div className="error">{err}</div>}
        {ok && <div className="notice">{ok}</div>}
        {editable && <button className="btn primary block" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ'}</button>}
      </form>
    </div>
  )
}

export default function Employees() {
  const { can } = useAccess()
  const [emps, setEmps] = useState([])
  const [branches, setBranches] = useState([])
  const [shifts, setShifts] = useState([])
  const [roles, setRoles] = useState([])
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(undefined)
  const [docFor, setDocFor] = useState(null)
  const [reviewId, setReviewId] = useState(null)

  const load = useCallback(() => {
    supabase.from('employees').select('*').order('full_name').then(({ data }) => setEmps(data || []))
  }, [])
  useEffect(() => {
    load()
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data || []))
    supabase.from('shifts').select('*').order('start_time').then(({ data }) => setShifts(data || []))
    supabase.from('roles').select('*').order('name').then(({ data }) => setRoles(data || []))
  }, [load])

  const bName = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const rName = Object.fromEntries(roles.map((r) => [r.id, r.name]))
  const q = search.trim().toLowerCase()
  const shown = emps.filter((e) => (showInactive || e.active) && (!branch || e.branch_id === branch) &&
    (!q || e.full_name.toLowerCase().includes(q) || (e.phone || '').includes(q) || (e.job_title || '').toLowerCase().includes(q)))

  return (
    <div>
      <div className="page-head">
        <div><h1>الموظفين</h1><div className="sub">{emps.filter((e) => e.active).length} موظف فعّال</div></div>
        {can('manage_employees') && <button className="btn primary" onClick={() => setEditing(null)}><Icon name="plus" /> موظف جديد</button>}
      </div>
      <EmployeesIO branches={branches} shifts={shifts} roles={roles} onDone={load} />
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 280, height: 42 }} placeholder="بحث بالاسم أو الرقم أو الوظيفة…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" style={{ maxWidth: 200, height: 42 }} value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> عرض الموقوفين</label>
      </div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {shown.length === 0 && <div className="empty">ما فيه موظفين</div>}
        {shown.map((e) => (
          <div key={e.id} className="list-item">
            <div className="avatar">{e.full_name[0]}</div>
            <button className="grow" style={{ background: 'none', border: 0, textAlign: 'right', cursor: 'pointer', padding: 0 }} onClick={() => setEditing(e)}>
              <div style={{ fontWeight: 600 }}>{e.full_name} {!e.active && <span className="pill gray">موقوف</span>}</div>
              <div className="sub">{[e.job_title, bName[e.branch_id], e.app_role === 'admin' ? 'المالك' : rName[e.role_id], `رصيد الإجازات: ${Number(e.leave_balance)} يوم`].filter(Boolean).join(' · ')}</div>
            </button>
            {!e.user_id && <span className="pill gray">بدون دخول</span>}
            {can('manage_documents') && <button className="btn" style={{ minHeight: 38 }} onClick={() => setDocFor(e)}>+ مستند</button>}
          </div>
        ))}
      </div>
      {editing !== undefined && <EmployeeForm emp={editing} branches={branches} shifts={shifts} roles={roles} onClose={() => setEditing(undefined)} onSaved={load} />}
      {docFor && <DocumentForm employeeId={docFor.id} doc={null} onClose={() => setDocFor(null)} onRead={setReviewId} admin />}
      {reviewId && <ReviewSheet kind="employee" docId={reviewId} onClose={() => setReviewId(null)} />}
    </div>
  )
}
