import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { qtyFmt, kwd, MOVE_KIND, loadLookups } from '../../lib/inv'
import { useLang } from '../../lib/i18n.jsx'

export default function Movements() {
  const { tr, fmtDate, fmtTime, tn } = useLang()
  const [rows, setRows] = useState([])
  const [lookups, setLookups] = useState(null)
  const [branch, setBranch] = useState('')
  const [kind, setKind] = useState('')
  const [limit, setLimit] = useState(100)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadLookups().then(setLookups) }, [])
  useEffect(() => {
    setLoading(true)
    let qy = supabase.from('stock_movements')
      .select('id,qty,kind,note,unit_cost,created_at,branches(name),inv_items(name_ar,inv_units(name)),employees:created_by(full_name)')
      .order('created_at', { ascending: false }).limit(limit)
    if (branch) qy = qy.eq('branch_id', branch)
    if (kind) qy = qy.eq('kind', kind)
    qy.then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [branch, kind, limit])

  return (
    <div>
      <div className="page-head"><div><h1>{tr('حركة المخزون')}</h1><div className="sub">{tr('كل إضافة أو خصم، ومين سواه')}</div></div></div>
      <div className="toolbar">
        <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={tr('المكان')}>
          <option value="">{tr('كل الأماكن')}</option>
          {lookups?.branches.map((b) => <option key={b.id} value={b.id}>{tn(b.name)}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tr('النوع')}>
          <option value="">{tr('كل الأنواع')}</option>
          {Object.entries(MOVE_KIND).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}
        </select>
      </div>
      <div className="card table-wrap" style={{ padding: '4px 10px' }}>
        <table>
          <thead><tr><th>{tr('الوقت')}</th><th>{tr('الصنف')}</th><th>{tr('النوع')}</th><th>{tr('المكان')}</th><th>{tr('الكمية')}</th><th>{tr('التكلفة')}</th><th>{tr('بواسطة')}</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td className="sub">{fmtDate(m.created_at)}<div>{fmtTime(m.created_at)}</div></td>
              <td>{m.inv_items?.name_ar}{m.note && <div className="cell-sub">{m.note}</div>}</td>
              <td><span className={'pill ' + (MOVE_KIND[m.kind]?.[0] || 'gray')}>{tr(MOVE_KIND[m.kind]?.[1] || m.kind)}</span></td>
              <td className="sub">{tn(m.branches?.name)}</td>
              <td><span className="num" style={{ fontWeight: 600, color: m.qty < 0 ? 'var(--red)' : 'var(--ok)' }}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</span> <span className="sub">{tn(m.inv_items?.inv_units?.name)}</span></td>
              <td className="num">{m.unit_cost != null ? kwd(Math.abs(m.qty) * m.unit_cost) : '—'}</td>
              <td className="sub">{m.employees?.full_name || '—'}</td>
            </tr>))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <div className="empty">{tr('ما فيه حركات للحين. أول ما تعتمد فاتورة مورد أو تسجل تالف، بتبين هنا.')}</div>}
        {rows.length === limit && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 100)}>{tr('عرض المزيد')}</button></div>}
      </div>
    </div>
  )
}
