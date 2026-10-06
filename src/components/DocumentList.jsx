import { useEffect, useState } from 'react'
import { supabase, fmtDate, docStatusPill } from '../lib/supabase'
import Icon from './Icon.jsx'

// shows documents with thumbnails; showEmployee for the HR view
export default function DocumentList({ docs, showEmployee, onOpen }) {
  const [thumbs, setThumbs] = useState({})

  useEffect(() => {
    const paths = docs.map((d) => d.front_image_path).filter(Boolean)
    if (!paths.length) return
    supabase.storage.from('employee-docs').createSignedUrls(paths, 600).then(({ data }) => {
      const m = {}; (data || []).forEach((x) => { m[x.path] = x.signedUrl }); setThumbs(m)
    })
  }, [docs])

  if (!docs.length) return <div className="empty">ما فيه مستندات</div>

  return (
    <div className="card list" style={{ padding: '4px 14px' }}>
      {docs.map((d) => {
        const p = docStatusPill(d.status, d.days_left)
        const thumb = thumbs[d.front_image_path]
        return (
          <button key={d.id} className="list-item" style={{ width: '100%', background: 'none', border: 0, borderTop: undefined, cursor: 'pointer', textAlign: 'right' }} onClick={() => onOpen?.(d)}>
            {thumb && !d.front_image_path.endsWith('.pdf') ? <img className="thumb" src={thumb} alt="" /> : <span className="thumb"><Icon name="doc" /></span>}
            <span className="grow">
              <div style={{ fontWeight: 600 }}>{showEmployee ? `${d.employee_name}${d.job_title ? ' · ' + d.job_title : ''}` : d.document_type_name}</div>
              <div className="sub">{showEmployee ? d.document_type_name + ' · ' : ''}{d.status === 'expired' ? 'انتهى' : 'ينتهي'} {fmtDate(d.expiry_date)}</div>
            </span>
            <span className={'pill ' + p.cls}>{p.text}</span>
          </button>
        )
      })}
    </div>
  )
}
