import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from '../components/Icon.jsx'
import DocumentForm from '../components/DocumentForm.jsx'

const DAYS = [['saturday','السبت'],['sunday','الأحد'],['monday','الاثنين'],['tuesday','الثلاثاء'],['wednesday','الأربعاء'],['thursday','الخميس'],['friday','الجمعة']]

function EmployeeForm({ emp, branches, shifts, roles, onClose, onSaved }) {
  const { access, can } = useAccess()
  const [f, setF] = useState({
    full_name: emp?.full_name || '', phone: emp?.phone || '', email: emp?.email || '', job_title: emp?.job_title || '',
    branch_id: emp?.branch_id || '', shift_id: emp?.shift_id || '', role_id: emp?.role_id || roles.find((r) => r.name === 'موظف')?.id || '',
    hire_date: emp?.hire_date || '', active: emp?.active ?? true,
    working_hours: emp?.working_hours ?? '', annual_leave_days: emp?.annual_leave_days ?? 30,
    weekly_holidays: emp?.weekly_holidays || [], leave_balance: emp?.leave_balance ?? 0,
  })
  const canPay = can('manage_payroll')
  const [salary, setSalary] = useState('')
  const [allowances, setAllowances] = useState([])
  const [newAllow, setNewAllow] = useState({ name: '', amount: '' })
  useEffect(() => {
    if (!emp || !canPay) return
    supabase.from('employee_salaries').select('basic_salary').eq('employee_id', emp.id).maybeSingle().then(({ data }) => setSalary(data?.basic_salary ?? ''))
    supabase.from('employee_allowances').select('*').eq('employee_id', emp.id).eq('active', true).then(({ data }) => setAllowances(data || []))
  }, [emp, canPay])
  const toggleDay = (d) => setF((x) => ({ ...x, weekly_holidays: x.weekly_holidays.includes(d) ? x.weekly_holidays.filter((y) => y !== d) : [...x.weekly_holidays, d] }))
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const editable = can('manage_employees')
  const isOwnerRow = emp?.app_role === 'admin'

  const genCode = async () => {
    setErr(''); setOk('')
    if (!emp?.phone) { setErr('احفظ رقم هاتف الموظف أول'); return }
    const { data, error } = await supabase.rpc('generate_setup_code', { p_employee_id: emp.id })
    if (error) setErr(errMsg(error))
    else setOk(`رمز التفعيل: ${data} — أرسله للموظف. يفتح التطبيق، يضغط "أول مرة؟ فعّل حسابك"، ويكتب رقمه ${emp.phone} والرمز ويختار كلمة سره. الرمز صالح ٧ أيام.`)
  }

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try {
      const row = { ...f, branch_id: f.branch_id || null, shift_id: f.shift_id || null, role_id: f.role_id || null, hire_date: f.hire_date || null, phone: f.phone.replace(/\D/g, '') || null,
        working_hours: f.working_hours === '' ? null : Number(f.working_hours), annual_leave_days: Number(f.annual_leave_days) || 0, leave_balance: Number(f.leave_balance) || 0 }
      if (!access.is_owner) delete row.role_id
      if (!canPay) delete row.leave_balance
      let id = emp?.id
      if (emp) {
        const { error } = await supabase.from('employees').update(row).eq('id', emp.id); if (error) throw error
      } else {
        if (!access.is_owner) row.role_id = roles.find((r) => r.name === 'موظف')?.id || null
        const { data, error } = await supabase.from('employees').insert(row).select('id').single(); if (error) throw error
        id = data.id
      }
      if (canPay) {
        if (salary !== '') {
          const { error } = await supabase.from('employee_salaries').upsert({ employee_id: id, basic_salary: Number(salary), updated_at: new Date().toISOString() }); if (error) throw error
        }
        if (newAllow.name && newAllow.amount) {
          const { error } = await supabase.from('employee_allowances').insert({ employee_id: id, name: newAllow.name, amount: Number(newAllow.amount) }); if (error) throw error
        }
      }
      if (password) {
        const { data, error } = await supabase.functions.invoke('employee-account', { body: { action: emp?.user_id ? 'update' : 'create', employee_id: id, phone: row.phone, password } })
        if (error || data?.error) throw new Error(data?.error || (await error?.context?.json?.())?.error || error.message)
        setOk(`تم. يدخل الموظف برقم ${data.login} وكلمة السر اللي حطيتها`)
      }
      onSaved()
      if (!password) onClose()
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
          <div className="field"><label htmlFor="n">الاسم الكامل</label><input id="n" className="input" value={f.full_name} onChange={set('full_name')} required /></div>
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
              <span className="lbl" style={{ fontSize: 14, fontWeight: 600 }}>البدلات الشهرية</span>
              {allowances.map((a) => (
                <div key={a.id} className="row"><span className="grow">{a.name}</span><strong>{Number(a.amount).toFixed(3)}</strong>
                  <button type="button" className="btn danger" style={{ minHeight: 34 }} onClick={async () => { await supabase.from('employee_allowances').update({ active: false }).eq('id', a.id); setAllowances(allowances.filter((x) => x.id !== a.id)) }}>إزالة</button></div>
              ))}
              <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
                <input className="input" placeholder="اسم البدل (سكن، مواصلات…)" value={newAllow.name} onChange={(e) => setNewAllow({ ...newAllow, name: e.target.value })} />
                <input className="input" type="number" step="0.001" placeholder="المبلغ" value={newAllow.amount} onChange={(e) => setNewAllow({ ...newAllow, amount: e.target.value })} />
              </div>
            </div>
          )}
          <div className="field"><label htmlFor="em">الإيميل (اختياري، للتنبيهات)</label><input id="em" type="email" className="input ltr" style={{ textAlign: 'right' }} value={f.email} onChange={set('email')} /></div>
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> الموظف على رأس عمله</label>

          <div className="card form" style={{ gap: 10 }}>
            <strong style={{ fontSize: 14 }}>{emp?.user_id ? 'تغيير كلمة السر' : 'تفعيل دخول التطبيق'}</strong>
            <div className="sub">{emp?.user_id ? `الموظف يدخل برقم ${emp.phone}. اكتب كلمة سر جديدة لو نسيها.` : 'اكتب كلمة سر، والموظف يدخل برقم هاتفه وهذي الكلمة.'}</div>
            <input className="input" type="text" placeholder="كلمة السر (٦ أحرف على الأقل)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="new-password" />
            {emp && <button type="button" className="btn" onClick={genCode}>أو أرسل له رمز تفعيل يختار فيه كلمة سره بنفسه</button>}
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
  const shown = emps.filter((e) => (showInactive || e.active) && (!branch || e.branch_id === branch) &&
    (!search || e.full_name.includes(search) || (e.phone || '').includes(search) || (e.job_title || '').includes(search)))

  return (
    <div>
      <div className="page-head">
        <div><h1>الموظفين</h1><div className="sub">{emps.filter((e) => e.active).length} موظف فعّال</div></div>
        {can('manage_employees') && <button className="btn primary" onClick={() => setEditing(null)}><Icon name="plus" /> موظف جديد</button>}
      </div>
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
              <div className="sub">{[e.job_title, bName[e.branch_id], e.app_role === 'admin' ? 'المالك' : rName[e.role_id]].filter(Boolean).join(' · ')}</div>
            </button>
            {!e.user_id && <span className="pill gray">بدون دخول</span>}
            {can('manage_documents') && <button className="btn" style={{ minHeight: 38 }} onClick={() => setDocFor(e)}>+ مستند</button>}
          </div>
        ))}
      </div>
      {editing !== undefined && <EmployeeForm emp={editing} branches={branches} shifts={shifts} roles={roles} onClose={() => setEditing(undefined)} onSaved={load} />}
      {docFor && <DocumentForm employeeId={docFor.id} doc={null} onClose={() => setDocFor(null)} />}
    </div>
  )
}
