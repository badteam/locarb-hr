import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { useLang } from '../lib/i18n.jsx'
import PayslipView from '../components/PayslipView.jsx'

export default function Payslips() {
  const { access } = useAccess()
  const { t } = useLang()
  const [slips, setSlips] = useState([])
  const [sel, setSel] = useState(null)
  useEffect(() => {
    supabase.from('payslips').select('*').eq('employee_id', access.employee.id).eq('status', 'approved').order('period', { ascending: false })
      .then(({ data }) => { setSlips(data || []); setSel((data || [])[0] || null) })
  }, [access.employee.id])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-head no-print">
        <h1>{t('payslips_title')}</h1>
        {sel && <button className="btn" onClick={() => window.print()}>{t('print')}</button>}
      </div>
      {slips.length === 0 ? <div className="card empty">{t('no_payslips')}</div> : (
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
