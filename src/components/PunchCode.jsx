import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/i18n.jsx'

// Employee picks the 4-digit code they type on the branch punch screen.
export default function PunchCode() {
  const { t } = useLang()
  const [code, setCode] = useState(undefined)
  const [show, setShow] = useState(false)
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => { supabase.rpc('my_kiosk_code').then(({ data }) => setCode(data || null)) }, [])

  const save = async () => {
    setMsg(null)
    if (!/^\d{4}$/.test(edit)) { setMsg({ ok: false, t: t('code_4') }); return }
    const { error } = await supabase.rpc('set_my_kiosk_code', { p_code: edit })
    if (error) { setMsg({ ok: false, t: error.message.includes('easy') ? t('code_easy') : t('code_4') }); return }
    setCode(edit); setEdit(null); setShow(true); setMsg({ ok: true, t: t('code_saved') })
  }
  if (code === undefined) return null
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>{t('punch_code')}</strong>
        {code && edit === null && <button type="button" className="chip" style={{ minHeight: 32 }} onClick={() => setShow(!show)}><span className="ltr num">{show ? code : '••••'}</span></button>}
      </div>
      <div className="sub">{t('punch_code_hint')}</div>
      {edit === null
        ? <button type="button" className="btn" onClick={() => { setEdit(''); setMsg(null) }}>{code ? t('change_code') : t('set_code')}</button>
        : <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input ltr num" style={{ maxWidth: 140, letterSpacing: 6, textAlign: 'center' }} inputMode="numeric" maxLength={4} autoFocus value={edit} onChange={(e) => setEdit(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label={t('punch_code')} />
            <button type="button" className="btn primary" onClick={save}>{t('save')}</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
          </div>}
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}
    </div>
  )
}
