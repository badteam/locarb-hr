import { useState } from 'react'
import { supabase, loginEmail, errMsg } from '../lib/supabase'

export default function Login() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const id = phone.includes('@') ? phone.trim() : loginEmail(phone)
    const { error } = await supabase.auth.signInWithPassword({ email: id, password })
    if (error) setErr(errMsg(error))
    setBusy(false)
  }

  return (
    <div className="center">
      <form className="card form" style={{ width: '100%', maxWidth: 400, padding: 28 }} onSubmit={submit}>
        <div>
          <div className="brand" style={{ padding: 0, fontSize: 26 }}>LoCarb HR</div>
          <div className="sub">سجّل دخولك برقم هاتفك</div>
        </div>
        <div className="field">
          <label htmlFor="phone">رقم الهاتف</label>
          <input id="phone" className="input ltr" style={{ textAlign: 'right' }} inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">كلمة السر</label>
          <input id="pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'جاري الدخول…' : 'دخول'}</button>
      </form>
    </div>
  )
}
