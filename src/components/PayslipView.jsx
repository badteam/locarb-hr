import { fmtDate } from '../lib/supabase'

const money = (n) => Number(n || 0).toFixed(3)
const monthName = (p) => new Intl.DateTimeFormat('ar-KW', { month: 'long', year: 'numeric', numberingSystem: 'latn' }).format(new Date(p))

// Printable payslip
export default function PayslipView({ slip, employee, branchName }) {
  const earn = [
    ['الراتب الأساسي', slip.basic_salary],
    ...(slip.allowances || []).map((a) => [a.name, a.amount]),
    ...(Number(slip.overtime_total) ? [['الإضافي', slip.overtime_total]] : []),
    ...(slip.extra_items || []).filter((x) => x.amount > 0).map((x) => [x.name, x.amount]),
  ]
  const ded = [
    ...(Number(slip.late_deduction) ? [[`تأخير (${slip.late_minutes} دقيقة)`, slip.late_deduction]] : []),
    ...(Number(slip.absence_deduction) ? [[`غياب (${slip.absence_days} يوم)`, slip.absence_deduction]] : []),
    ...(Number(slip.unpaid_leave_deduction) ? [[`إجازة بدون راتب (${slip.unpaid_leave_days} يوم)`, slip.unpaid_leave_deduction]] : []),
    ...(slip.extra_items || []).filter((x) => x.amount < 0).map((x) => [x.name, -x.amount]),
  ]
  const sum = (l) => l.reduce((s, [, v]) => s + Number(v || 0), 0)

  return (
    <div className="payslip card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>LoCarb</div>
          <div className="sub">كشف راتب · {monthName(slip.period)}</div>
        </div>
        <span className={'pill ' + (slip.status === 'approved' ? 'ok' : 'amber')}>{slip.status === 'approved' ? 'معتمد' : 'مسودة'}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', fontSize: 14 }}>
        <div><div className="sub">الموظف</div><strong>{employee?.full_name}</strong></div>
        <div><div className="sub">الوظيفة</div><strong>{employee?.job_title || '—'}</strong></div>
        <div><div className="sub">الفرع</div><strong>{branchName || '—'}</strong></div>
        {slip.approved_at && <div><div className="sub">تاريخ الاعتماد</div><strong>{fmtDate(slip.approved_at)}</strong></div>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16 }}>
        <div>
          <strong style={{ fontSize: 15 }}>المستحقات</strong>
          <table style={{ minWidth: 0, marginTop: 6 }}><tbody>
            {earn.map(([k, v], i) => <tr key={i}><td>{k}</td><td style={{ textAlign: 'left' }} className="ltr">{money(v)}</td></tr>)}
            <tr><td><strong>المجموع</strong></td><td style={{ textAlign: 'left' }}><strong>{money(sum(earn))}</strong></td></tr>
          </tbody></table>
        </div>
        <div>
          <strong style={{ fontSize: 15 }}>الخصومات</strong>
          <table style={{ minWidth: 0, marginTop: 6 }}><tbody>
            {ded.length === 0 && <tr><td className="sub">ما فيه خصومات</td><td /></tr>}
            {ded.map(([k, v], i) => <tr key={i}><td>{k}</td><td style={{ textAlign: 'left', color: 'var(--red)' }}>{money(v)}</td></tr>)}
            <tr><td><strong>المجموع</strong></td><td style={{ textAlign: 'left', color: 'var(--red)' }}><strong>{money(sum(ded))}</strong></td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', background: 'var(--green)', color: '#fff', borderRadius: 12, padding: '14px 18px' }}>
        <strong style={{ fontSize: 16 }}>صافي الراتب</strong>
        <strong style={{ fontSize: 24 }}>{money(slip.net_salary)} د.ك</strong>
      </div>
    </div>
  )
}
