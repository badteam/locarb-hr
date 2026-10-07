import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAccess } from '../../lib/access.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { ORDER_STATUS } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'

const TABS = [['submitted', 'جديدة'], ['dispatched', 'في الطريق'], ['received', 'انستلمت'], ['all', 'الكل']]

export default function Orders() {
  const { can } = useAccess()
  const { tr, tn, fmtDate, fmtTime } = useLang()
  const [tab, setTab] = useState('submitted')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const kitchen = can('approve_branch_requests')

  useEffect(() => {
    let q = supabase.from('branch_requests').select('id,status,created_at,note,branches:branch_id(name),employees:created_by(full_name),branch_request_lines(requested_qty)')
      .order('created_at', { ascending: false }).limit(150)
    if (tab !== 'all') q = q.eq('status', tab)
    q.then(({ data }) => setRows(data || []))
    supabase.from('branch_requests').select('status').in('status', ['submitted', 'dispatched']).then(({ data }) => {
      const c = {}
      for (const r of data || []) c[r.status] = (c[r.status] || 0) + 1
      setCounts(c)
    })
  }, [tab])

  return (
    <div>
      <div className="page-head"><div><h1>{tr('طلبات الفروع')}</h1>
        <div className="sub">{kitchen ? tr('الفروع تطلب، والمطبخ يوافق ويرسل، والفرع يأكد الاستلام') : tr('اطلب من المطبخ المركزي وأكد الاستلام لما يوصل')}</div></div>
        {(can('branch_orders') || kitchen || can('manage_inventory')) && <Link className="btn primary" to="/inventory/orders/new"><Icon name="plus" /> {tr('طلب جديد')}</Link>}</div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {TABS.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
          {tr(l)}{counts[k] ? <span className="badge" style={{ marginInlineStart: 6 }}>{counts[k]}</span> : null}</button>)}
      </div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {rows.length === 0 && <div className="empty">{tr('ما فيه طلبات هنا')}</div>}
        {rows.map((r) => (
          <Link key={r.id} to={`/inventory/orders/${r.id}`} className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="avatar"><Icon name="branch" /></span>
            <span className="grow"><div style={{ fontWeight: 600 }}>{tn(r.branches?.name)}</div>
              <div className="sub">{tr('{n} صنف', { n: (r.branch_request_lines || []).filter((l) => l.requested_qty > 0).length })} · {fmtDate(r.created_at)} {fmtTime(r.created_at)}{r.employees?.full_name ? ` · ${r.employees.full_name}` : ''}</div></span>
            <span className={'pill ' + ORDER_STATUS[r.status][0]}>{tr(ORDER_STATUS[r.status][1])}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
