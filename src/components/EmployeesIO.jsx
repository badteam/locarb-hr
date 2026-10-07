import { useState } from 'react'
import writeXlsxFile from 'write-excel-file/browser'
import readXlsxFile from 'read-excel-file/browser'
import { supabase, errMsg } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import Icon from './Icon.jsx'

const DAYS_AR = { saturday: 'السبت', sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة' }
const DAYS_EN = Object.fromEntries(Object.entries(DAYS_AR).map(([k, v]) => [v, k]))

// column key -> Arabic header. pay = only for payroll permission
const COLS = [
  { k: 'id', h: 'المعرّف (لا تعدّله)' },
  { k: 'full_name', h: 'الاسم' },
  { k: 'phone', h: 'رقم الهاتف' },
  { k: 'email', h: 'الإيميل' },
  { k: 'job_title', h: 'الوظيفة' },
  { k: 'branch', h: 'الفرع' },
  { k: 'shift', h: 'الشفت' },
  { k: 'role', h: 'الدور' },
  { k: 'hire_date', h: 'تاريخ التعيين' },
  { k: 'working_hours', h: 'ساعات العمل باليوم' },
  { k: 'annual_leave_days', h: 'الإجازة السنوية (يوم)' },
  { k: 'weekly_holidays', h: 'أيام العطلة' },
  { k: 'active', h: 'على رأس عمله' },
  { k: 'leave_balance', h: 'رصيد الإجازات', pay: true },
  { k: 'basic_salary', h: 'الراتب الأساسي', pay: true },
  { k: 'allowances', h: 'البدلات', pay: true },
  { k: 'ot_rate', h: 'سعر الإضافي الخاص (د.ك/ساعة)', pay: true },
  { k: 'ot_multiplier', h: 'نسبة الإضافي الخاصة (× أجر الساعة)', pay: true },
]

const s = (v) => (v === null || v === undefined ? '' : String(v).trim())
const num = (v) => (s(v) === '' ? null : Number(String(v).replace(',', '.')))
const dateStr = (v) => {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const m = s(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return m[1].length === 4 ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
// "بدل سكن=50; بدل مواصلات=20"
const parseAllow = (v) => s(v).split(/[;؛\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const [n, a] = x.split(/[=:]/)
  return { name: s(n), amount: num(a) }
}).filter((x) => x.name && x.amount > 0)

export default function EmployeesIO({ branches, shifts, roles, onDone }) {
  const { access, can } = useAccess()
  const pay = can('manage_payroll')
  const cols = COLS.filter((c) => !c.pay || pay)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)
  const [progress, setProgress] = useState('')

  const bById = Object.fromEntries(branches.map((b) => [b.id, b.name]))
  const sById = Object.fromEntries(shifts.map((x) => [x.id, x.name]))
  const rById = Object.fromEntries(roles.map((r) => [r.id, r.name]))

  const exportFile = async (template) => {
    setBusy(true); setMsg(null)
    try {
      let rows = []
      if (!template) {
        const { data: emps } = await supabase.from('employees').select('*').order('full_name')
        let sal = {}, allow = {}
        if (pay) {
          const [a, b] = await Promise.all([
            supabase.from('employee_salaries').select('employee_id,basic_salary'),
            supabase.from('employee_allowances').select('employee_id,name,amount').eq('active', true),
          ])
          sal = Object.fromEntries((a.data || []).map((x) => [x.employee_id, x.basic_salary]))
          for (const x of b.data || []) (allow[x.employee_id] ||= []).push(`${x.name}=${Number(x.amount)}`)
        }
        rows = (emps || []).map((e) => ({
          id: e.id, full_name: e.full_name, phone: e.phone || '', email: e.email || '', job_title: e.job_title || '',
          branch: bById[e.branch_id] || '', shift: sById[e.shift_id] || '', role: e.app_role === 'admin' ? 'المالك' : rById[e.role_id] || '',
          hire_date: e.hire_date || '', working_hours: e.working_hours ?? '', annual_leave_days: e.annual_leave_days ?? '',
          weekly_holidays: (e.weekly_holidays || []).map((d) => DAYS_AR[d] || d).join('، '), active: e.active ? 'نعم' : 'لا',
          leave_balance: Number(e.leave_balance ?? 0), basic_salary: sal[e.id] !== undefined ? Number(sal[e.id]) : '',
          allowances: (allow[e.id] || []).join('; '),
          ot_rate: e.ot_mode === 'fixed' ? Number(e.ot_rate ?? 0) : '', ot_multiplier: e.ot_mode === 'multiplier' ? Number(e.ot_multiplier ?? 0) : '',
        }))
      } else {
        rows = [{ id: '', full_name: 'مثال: أحمد محمد', phone: '99999999', email: '', job_title: 'شيف', branch: branches[0]?.name || '', shift: shifts[0]?.name || '', role: 'موظف', hire_date: '2026-01-15', working_hours: 8, annual_leave_days: 30, weekly_holidays: 'الجمعة', active: 'نعم', leave_balance: 0, basic_salary: 250, allowances: 'بدل سكن=50; بدل مواصلات=20', ot_rate: '', ot_multiplier: '' }]
      }
      const header = cols.map((c) => ({ value: c.h, fontWeight: 'bold' }))
      const data = [header, ...rows.map((r) => cols.map((c) => ({ value: r[c.k] === '' || r[c.k] === null ? null : r[c.k], type: typeof r[c.k] === 'number' ? Number : String })))]
      const blob = await writeXlsxFile(data, { rightToLeft: true, columns: cols.map((c) => ({ width: c.k === 'id' ? 38 : c.k === 'allowances' ? 40 : 18 })) }).toBlob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = template ? 'employees_template.xlsx' : `employees_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
    } catch (e) { setMsg({ ok: false, t: errMsg(e) }) }
    setBusy(false)
  }

  const readFile = async (file) => {
    setMsg(null); setPreview(null)
    if (!file) return
    try {
      const sheets = await readXlsxFile(file)
      const data = sheets[0]?.data || []
      const head = (data[0] || []).map((h) => s(h))
      const idx = Object.fromEntries(cols.map((c) => [c.k, head.indexOf(c.h)]))
      if (idx.full_name < 0) throw new Error('ما لقيت عمود "الاسم". استخدم ملف التصدير أو النموذج.')
      const { data: existing } = await supabase.from('employees').select('id,full_name,phone,app_role')
      const byId = Object.fromEntries((existing || []).map((e) => [e.id, e]))
      const byPhone = Object.fromEntries((existing || []).filter((e) => e.phone).map((e) => [e.phone, e]))
      const byName = Object.fromEntries((existing || []).map((e) => [e.full_name.trim().toLowerCase(), e]))
      const bByName = Object.fromEntries(branches.map((b) => [b.name.trim(), b.id]))
      const shByName = Object.fromEntries(shifts.map((x) => [x.name.trim(), x.id]))
      const rByName = Object.fromEntries(roles.map((r) => [r.name.trim(), r.id]))
      const seenPhones = new Set()

      const rows = data.slice(1).filter((r) => r.some((c) => s(c) !== '')).map((r, i) => {
        const g = (k) => (idx[k] >= 0 ? r[idx[k]] : undefined)
        const errors = []
        const name = s(g('full_name'))
        if (!name) errors.push('الاسم فاضي')
        const phoneRaw = s(g('phone')).replace(/\D/g, '')
        const phone = phoneRaw && !/^0+$/.test(phoneRaw) ? phoneRaw : null
        if (phone && phone.length < 8) errors.push('رقم الهاتف قصير')
        if (phone && seenPhones.has(phone)) errors.push('رقم مكرر في الملف')
        if (phone) seenPhones.add(phone)
        const match = byId[s(g('id'))] || (phone && byPhone[phone]) || byName[name.toLowerCase()]
        if (match && phone && byPhone[phone] && byPhone[phone].id !== match.id) errors.push('الرقم مستخدم لموظف ثاني')
        const branchName = s(g('branch')); const shiftName = s(g('shift')); const roleName = s(g('role'))
        if (branchName && !bByName[branchName]) errors.push(`فرع غير موجود: ${branchName}`)
        if (shiftName && !shByName[shiftName]) errors.push(`شفت غير موجود: ${shiftName}`)
        if (roleName && roleName !== 'المالك' && !rByName[roleName]) errors.push(`دور غير موجود: ${roleName}`)
        const days = s(g('weekly_holidays')).split(/[،,\s]+/).filter(Boolean).map((d) => DAYS_EN[d] || d.toLowerCase())
        const activeRaw = s(g('active'))
        const row = {
          full_name: name, phone, email: s(g('email')) || null, job_title: s(g('job_title')) || null,
          branch_id: branchName ? bByName[branchName] || null : null, shift_id: shiftName ? shByName[shiftName] || null : null,
          hire_date: dateStr(g('hire_date')), working_hours: num(g('working_hours')), annual_leave_days: num(g('annual_leave_days')) ?? 30,
          weekly_holidays: days, active: activeRaw ? !['لا', 'no', 'false', '0'].includes(activeRaw.toLowerCase()) : true,
        }
        if (access.is_owner && roleName && roleName !== 'المالك') row.role_id = rByName[roleName] || null
        const extra = {}
        if (pay) {
          if (idx.leave_balance >= 0 && s(g('leave_balance')) !== '') row.leave_balance = num(g('leave_balance'))
          extra.basic_salary = num(g('basic_salary'))
          extra.allowances = idx.allowances >= 0 ? parseAllow(g('allowances')) : null
          const rate = num(g('ot_rate')); const mult = num(g('ot_multiplier'))
          if (rate) { row.ot_mode = 'fixed'; row.ot_rate = rate; row.ot_multiplier = null }
          else if (mult) { row.ot_mode = 'multiplier'; row.ot_multiplier = mult; row.ot_rate = null }
          else if (idx.ot_rate >= 0 || idx.ot_multiplier >= 0) { row.ot_mode = null; row.ot_rate = null; row.ot_multiplier = null }
        }
        if (match?.app_role === 'admin') { delete row.role_id; delete row.active }
        return { line: i + 2, action: errors.length ? 'error' : match ? 'update' : 'new', id: match?.id, row, extra, errors }
      })
      setPreview(rows)
    } catch (e) { setMsg({ ok: false, t: e.message || errMsg(e) }) }
  }

  const apply = async () => {
    setBusy(true); setMsg(null)
    const ok = preview.filter((r) => r.action !== 'error')
    let done = 0; const fails = []
    for (const r of ok) {
      setProgress(`${done + 1} / ${ok.length}`)
      try {
        let id = r.id
        if (id) {
          const { error } = await supabase.from('employees').update(r.row).eq('id', id); if (error) throw error
        } else {
          const ins = { ...r.row }
          if (!ins.role_id) ins.role_id = roles.find((x) => x.name === 'موظف')?.id || null
          const { data, error } = await supabase.from('employees').insert(ins).select('id').single(); if (error) throw error
          id = data.id
        }
        if (pay) {
          if (r.extra.basic_salary !== null && r.extra.basic_salary !== undefined) {
            const { error } = await supabase.from('employee_salaries').upsert({ employee_id: id, basic_salary: r.extra.basic_salary, updated_at: new Date().toISOString() }); if (error) throw error
          }
          if (r.extra.allowances) {
            await supabase.from('employee_allowances').update({ active: false }).eq('employee_id', id).eq('active', true)
            if (r.extra.allowances.length) {
              const { error } = await supabase.from('employee_allowances').insert(r.extra.allowances.map((a) => ({ employee_id: id, name: a.name, amount: a.amount }))); if (error) throw error
            }
          }
        }
        done++
      } catch (e) { fails.push(`سطر ${r.line} (${r.row.full_name}): ${errMsg(e)}`) }
    }
    setProgress('')
    setBusy(false)
    setPreview(null)
    setMsg({ ok: fails.length === 0, t: `تم استيراد ${done} موظف${fails.length ? `. ما انحفظ ${fails.length}: ${fails.slice(0, 5).join(' · ')}` : '.'}` })
    onDone?.()
  }

  const counts = preview ? { new: preview.filter((r) => r.action === 'new').length, update: preview.filter((r) => r.action === 'update').length, error: preview.filter((r) => r.action === 'error').length } : null

  return (
    <div className="card form" style={{ gap: 12, marginBottom: 14 }}>
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <strong>استيراد وتصدير الموظفين (Excel)</strong>
          <div className="sub">التصدير ينزّل كل الموظفين ببياناتهم. الاستيراد يضيف الموظفين الجدد ويحدّث الموجودين (يتعرف عليهم بالمعرّف أو رقم الهاتف أو الاسم).</div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={() => exportFile(false)}>تصدير Excel</button>
          <button className="btn" disabled={busy} onClick={() => exportFile(true)}>تنزيل نموذج فاضي</button>
          {can('manage_employees') && (
            <label className="btn primary" style={{ cursor: 'pointer' }}>
              استيراد Excel
              <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
        </div>
      </div>
      {!pay && <div className="sub">الراتب والبدلات ورصيد الإجازات ما تطلع في الملف لأنها تحتاج صلاحية الرواتب.</div>}
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}

      {preview && (
        <div className="form" style={{ gap: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="pill ok">جديد: {counts.new}</span>
            <span className="pill amber">تحديث: {counts.update}</span>
            <span className="pill red">أخطاء: {counts.error}</span>
            <span className="sub">راجع القائمة. الأسطر اللي فيها أخطاء ما بتنحفظ.</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>سطر</th><th>الاسم</th><th>الهاتف</th><th>الفرع</th><th>الإجراء</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.row.full_name}</td>
                    <td className="ltr">{r.row.phone || '—'}</td>
                    <td>{bById[r.row.branch_id] || '—'}</td>
                    <td>{r.action === 'error' ? <span className="pill red">{r.errors.join('، ')}</span> : r.action === 'new' ? <span className="pill ok">موظف جديد</span> : <span className="pill amber">تحديث</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || counts.new + counts.update === 0} onClick={apply}>
              {busy ? `جاري الاستيراد… ${progress}` : `تأكيد استيراد ${counts.new + counts.update} موظف`}
            </button>
            <button className="btn" disabled={busy} onClick={() => setPreview(null)}><Icon name="x" /> إلغاء</button>
          </div>
        </div>
      )}
    </div>
  )
}
