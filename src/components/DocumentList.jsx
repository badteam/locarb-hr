import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

// shows documents with thumbnails; showEmployee + admin for the HR view (Arabic)
export default function DocumentList({ docs, showEmployee, onOpen, admin }) {
  const { t, tn, fmtDate } = useT(admin)
  const [thumbs, setThumbs] = useState({})

  useEffect(() => {
    const paths = docs.map((d) => d.front_image_path).filter(Boolean)
    if (!paths.length) return
    supabase.storage.from('employee-docs').createSignedUrls(paths, 600).then(({ data }) => {
      const m = {}; (data || []).forEach((x) => { m[x.path] = x.signedUrl }); setThumbs(m)
    })
  }, [docs])

  if (!docs.length) return <div className="empty">{t('no_docs')}</div>

  const pill = (d) => {
    if (d.status === 'review') return ['amber', t('in_review')]
    if (d.status === 'rejected') return ['red', t('rejected_doc')]
    if (d.status === 'expired') return ['red', d.days_left === 0 ? t('expired') : t('expired_ago', { n: Math.abs(d.days_left) })]
    if (d.status === 'expiring') return ['amber', d.days_left === 0 ? t('today_exp') : t('in_days', { n: d.days_left })]
    return ['ok', t('valid')]
  }

  return (
    <div className="card list" style={{ padding: '4px 14px' }}>
      {docs.map((d) => {
        const [cls, txt] = pill(d)
        const thumb = thumbs[d.front_image_path]
        return (
          <button key={d.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => onOpen?.(d)}>
            {thumb && !d.front_image_path?.endsWith('.pdf') ? <img className="thumb" src={thumb} alt="" /> : <span className="thumb"><Icon name="doc" /></span>}
            <span className="grow">
              <div style={{ fontWeight: 600 }}>{showEmployee ? `${d.employee_name}${d.job_title ? ' · ' + d.job_title : ''}` : (d.document_type_name ? tn(d.document_type_name) : t('new_doc'))}</div>
              <div className="sub">{showEmployee ? (d.document_type_name ? tn(d.document_type_name) : t('new_doc')) + ' · ' : ''}{d.status === 'rejected' && d.review_note ? t('review_reason', { note: d.review_note }) : !d.expiry_date ? (d.status === 'review' ? t('doc_pending_note') : t('no_expiry')) : d.status === 'expired' ? t('expired_on', { d: fmtDate(d.expiry_date) }) : t('expires_on', { d: fmtDate(d.expiry_date) })}</div>
            </span>
            <span className={'pill ' + cls}>{txt}</span>
          </button>
        )
      })}
    </div>
  )
}
