import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/i18n.jsx'
import Icon from '../components/Icon.jsx'

export default function Notifications() {
  const { t, tn, fmtDate } = useLang()
  const [items, setItems] = useState([])
  const nav = useNavigate()
  const load = useCallback(() => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => setItems(data || []))
  }, [])
  useEffect(() => { load() }, [load])

  // employee notifications carry a kind + params so they show in the employee's language
  const text = (n) => {
    if (!n.kind) return [n.title, n.body]
    const p = { ...n.params, doc: tn(n.params?.doc), type: tn(n.params?.type) }
    const title = t('nk_' + n.kind)
    const bodyKey = { doc_expiring: 'nk_doc_expiring_b', doc_expired: 'nk_doc_expired_b', missed_no_punch: 'nk_missed_no_punch_b', missed_no_checkout: 'nk_missed_no_checkout_b', leave_approved: 'nk_leave_b', leave_rejected: 'nk_leave_b', notice_issued: 'nk_notice_issued_b', payslip_ready: 'nk_payslip_ready_b', doc_approved: 'nk_doc_review_b', doc_rejected: 'nk_doc_review_b' }[n.kind]
    let body = bodyKey ? t(bodyKey, p) : (n.params?.text || n.body)
    if (n.params?.note) body += ' — ' + n.params.note
    return [title, body]
  }

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
      <div className="page-head"><h1>{t('notif_title')}</h1>{items.some((n) => !n.read_at) && <button className="btn" onClick={markAll}>{t('mark_all')}</button>}</div>
      <div className="card list" style={{ padding: '4px 14px' }}>
        {items.length === 0 && <div className="empty">{t('no_notifs')}</div>}
        {items.map((n) => {
          const [title, body] = text(n)
          return (
            <button key={n.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => open(n)} dir={n.kind ? undefined : 'rtl'}>
              <span className="avatar" style={{ background: n.read_at ? '#EEF1EC' : 'var(--amber-bg)', color: n.read_at ? 'var(--muted)' : 'var(--amber)' }}><Icon name="bell" /></span>
              <span className="grow">
                <div style={{ fontWeight: n.read_at ? 500 : 700 }}>{title}</div>
                <div className="sub">{body}</div>
                <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{fmtDate(n.created_at)}</div>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
