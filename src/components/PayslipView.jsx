import { useT } from '../lib/i18n.jsx'

const money = (n) => Number(n || 0).toFixed(3)

// Printable payslip. admin = Arabic (payroll screen); otherwise the employee's language.
export default function PayslipView({ slip, employee, branchName, admin }) {
  const { t, tn, fmtDate, lang, dir } = useT(admin)
  const locale = { ar: 'ar-KW', en: 'en-GB', ne: 'ne-NP', hi: 'hi-IN' }[lang] || 'ar-KW'
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', numberingSystem: 'latn' }).format(new Date(slip.period))
  const item = (name) => {
    const [head, ...rest] = String(name).split(': ')
    return rest.length ? `${tn(head)}: ${rest.join(': ')}` : tn(name)
  }
  const earn = [
    [t('basic_salary'), slip.basic_salary],
    ...(slip.allowances || []).map((a) => [item(a.name), a.amount]),
    ...(Number(slip.overtime_total) ? [[t('overtime'), slip.overtime_total]] : []),
    ...(slip.extra_items || []).filter((x) => x.amount > 0).map((x) => [item(x.name), x.amount]),
  ]
  const ded = [
    ...(Number(slip.late_deduction) ? [[t('late_ded', { n: slip.late_minutes }), slip.late_deduction]] : []),
    ...(Number(slip.absence_deduction) ? [[t('absence_ded', { n: slip.absence_days }), slip.absence_deduction]] : []),
    ...(Number(slip.unpaid_leave_deduction) ? [[t('unpaid_ded', { n: slip.unpaid_leave_days }), slip.unpaid_leave_deduction]] : []),
    ...(slip.extra_items || []).filter((x) => x.amount < 0).map((x) => [item(x.name), -x.amount]),
  ]
  const sum = (l) => l.reduce((s, [, v]) => s + Number(v || 0), 0)
  const end = dir === 'rtl' ? 'left' : 'right'

  return (
    <div className="payslip card" dir={dir} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>LoCarb</div>
          <div className="sub">{t('payslip')} · {monthName}</div>
        </div>
        <span className={'pill ' + (slip.status === 'approved' ? 'ok' : 'amber')}>{slip.status === 'approved' ? t('approved_ps') : t('draft')}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', fontSize: 14 }}>
        <div><div className="sub">{t('employee')}</div><strong>{employee?.full_name}</strong></div>
        <div><div className="sub">{t('job')}</div><strong>{tn(employee?.job_title) || '—'}</strong></div>
        <div><div className="sub">{t('branch')}</div><strong>{tn(branchName) || '—'}</strong></div>
        {slip.approved_at && <div><div className="sub">{t('approved_on')}</div><strong>{fmtDate(slip.approved_at)}</strong></div>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16 }}>
        <div>
          <strong style={{ fontSize: 15 }}>{t('earnings')}</strong>
          <table style={{ minWidth: 0, marginTop: 6 }}><tbody>
            {earn.map(([k, v], i) => <tr key={i}><td style={{ textAlign: 'start' }}>{k}</td><td style={{ textAlign: end }} className="ltr">{money(v)}</td></tr>)}
            <tr><td style={{ textAlign: 'start' }}><strong>{t('total')}</strong></td><td style={{ textAlign: end }}><strong>{money(sum(earn))}</strong></td></tr>
          </tbody></table>
        </div>
        <div>
          <strong style={{ fontSize: 15 }}>{t('deductions')}</strong>
          <table style={{ minWidth: 0, marginTop: 6 }}><tbody>
            {ded.length === 0 && <tr><td className="sub" style={{ textAlign: 'start' }}>{t('no_deductions')}</td><td /></tr>}
            {ded.map(([k, v], i) => <tr key={i}><td style={{ textAlign: 'start' }}>{k}</td><td style={{ textAlign: end, color: 'var(--red)' }}>{money(v)}</td></tr>)}
            <tr><td style={{ textAlign: 'start' }}><strong>{t('total')}</strong></td><td style={{ textAlign: end, color: 'var(--red)' }}><strong>{money(sum(ded))}</strong></td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', background: 'var(--green)', color: '#fff', borderRadius: 12, padding: '14px 18px' }}>
        <strong style={{ fontSize: 16 }}>{t('net_salary')}</strong>
        <strong style={{ fontSize: 24 }}>{money(slip.net_salary)} {t('kwd')}</strong>
      </div>
    </div>
  )
}
