import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import PayslipView from '../components/PayslipView.jsx'

export default function Payslips() {
  const { access } = useAccess()
  const [slips, setSlips] = useState([])
  const [sel, setSel] = useState(null)
  useEffect(() => {
    supabase.from('payslips').select('*').eq('employee_id', access.employee.id).eq('status', 'approved').order('period', { ascending: false })
      .then(({ data }) => { setSlips(data || []); setSel((data || [])[0] || null) })
  }, [access.employee.id])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-head no-print">
        <h1>كشوف راتبي</h1>
        {sel && <button className="btn" onClick={() => window.print()}>طباعة / PDF</button>}
      </div>
      {slips.length === 0 ? <div className="card empty">ما فيه كشوف رواتب معتمدة للحين</div> : (
        <>
          <div className="chips no-print" style={{ marginBottom: 14 }}>
            {slips.map((s) => <button key={s.id} className={'chip' + (sel?.id === s.id ? ' on' : '')} onClick={() => setSel(s)}>{s.period.slice(0, 7)}</button>)}
          </div>
          {sel && <PayslipView slip={sel} employee={access.employee} branchName={access.branch_name} />}
        </>
      )}
    </div>
  )
}
