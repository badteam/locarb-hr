import { useState } from 'react'
import { supabase, loginEmail } from '../lib/supabase'
import { useLang, LangPicker } from '../lib/i18n.jsx'

export default function Login() {
  const { t } = useLang()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = () => supabase.auth.signInWithPassword({ email: phone.includes('@') ? phone.trim() : loginEmail(phone), password })

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    let { error } = await signIn()
    // first sign-in (password = phone): create the account, then sign in
    if (error && !phone.includes('@')) {
      const { data } = await supabase.functions.invoke('activate-account', { body: { phone, password } }).catch(() => ({}))
      if (data?.ok) ({ error } = await signIn())
    }
    if (error) setErr(t('err_login'))
    setBusy(false)
  }

  return (
    <div className="center" style={{ flexDirection: 'column', gap: 16 }}>
      <LangPicker />
      <form className="card form" style={{ width: '100%', maxWidth: 400, padding: 28 }} onSubmit={submit}>
        <div>
          <div className="brand" style={{ padding: 0, fontSize: 26 }}>LoCarb HR</div>
          <div className="sub">{t('login_sub')}</div>
        </div>
        <div className="field">
          <label htmlFor="phone">{t('phone')}</label>
          <input id="phone" className="input ltr" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">{t('password')}</label>
          <input id="pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="sub">{t('first_login_hint')}</div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? t('wait') : t('sign_in')}</button>
      </form>
    </div>
  )
}
