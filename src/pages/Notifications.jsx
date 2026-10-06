import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import Icon from '../components/Icon.jsx'

export default function Notifications() {
  const [items, setItems] = useState([])
  const nav = useNavigate()
  const load = useCallback(() => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => setItems(data || []))
  }, [])
  useEffect(() => { load() }, [load])

  const markAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    window.dispatchEvent(new Event('notifications-changed')); load()
  }
  const open = async (n) => {
    if (!n.read_at) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); window.dispatchEvent(new Event('notifications-changed')) }
    if (n.link) nav(n.link)
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-head"><h1>التنبيهات</h1>{items.some((n) => !n.read_at) && <button className="btn" onClick={markAll}>تعليم الكل كمقروء</button>}</div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {items.length === 0 && <div className="empty">ما فيه تنبيهات</div>}
        {items.map((n) => (
          <button key={n.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'right' }} onClick={() => open(n)}>
            <span className="avatar" style={{ background: n.read_at ? '#EEF1EC' : 'var(--amber-bg)', color: n.read_at ? 'var(--muted)' : 'var(--amber)' }}><Icon name="bell" /></span>
            <span className="grow">
              <div style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</div>
              <div className="sub">{n.body}</div>
              <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{fmtDate(n.created_at)}</div>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
