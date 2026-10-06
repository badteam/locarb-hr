import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccess } from '../lib/access.jsx'
import { useLang, LangPicker } from '../lib/i18n.jsx'

// Shown on first sign-in (password = phone) until the employee picks a new password
export default function ChangePassword() {
  const { access, reload } = useAccess()
  const { t } = useLang()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    const phone = access.employee.phone || ''
    if (pw.length < 6 || pw.replace(/\D/g, '') === phone) { setErr(t('pw_not_phone')); return }
    if (pw !== pw2) { setErr(t('pw_mismatch')); return }
    setBusy(true); setErr('')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) { setErr(error.message); setBusy(false); return }
    await supabase.rpc('password_changed')
    await reload()
    setBusy(false)
  }

  return (
    <div className="center" style={{ flexDirection: 'column', gap: 16 }}>
      <LangPicker />
      <form className="card form" style={{ width: '100%', maxWidth: 400, padding: 28 }} onSubmit={save}>
        <div>
          <h1 style={{ fontSize: 22 }}>{t('change_pw_title')}</h1>
          <div className="sub">{t('change_pw_sub')}</div>
        </div>
        <div className="field">
          <label htmlFor="np">{t('new_password')}</label>
          <input id="np" type="password" className="input" autoComplete="new-password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="np2">{t('confirm_password')}</label>
          <input id="np2" type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? t('saving') : t('save_continue')}</button>
        <button type="button" className="btn" style={{ border: 0, background: 'none' }} onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
      </form>
    </div>
  )
}
