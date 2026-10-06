import { useState } from 'react'
import { supabase, loginEmail, errMsg } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('login') // login | activate
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (ph, pw) => {
    const id = ph.includes('@') ? ph.trim() : loginEmail(ph)
    const { error } = await supabase.auth.signInWithPassword({ email: id, password: pw })
    if (error) throw error
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (mode === 'activate') {
        const { data, error } = await supabase.functions.invoke('activate-account', { body: { phone, code, password } })
        const body = data || (await error?.context?.json?.().catch(() => null))
        if (!body?.ok) throw new Error(body?.error || error?.message || 'صار خطأ')
      }
      await signIn(phone, password)
    } catch (e2) { setErr(errMsg(e2)) }
    setBusy(false)
  }

  const activate = mode === 'activate'
  return (
    <div className="center">
      <form className="card form" style={{ width: '100%', maxWidth: 400, padding: 28 }} onSubmit={submit}>
        <div>
          <div className="brand" style={{ padding: 0, fontSize: 26 }}>LoCarb HR</div>
          <div className="sub">{activate ? 'فعّل حسابك بالرمز اللي وصلك من الإدارة' : 'سجّل دخولك برقم هاتفك'}</div>
        </div>
        <div className="field">
          <label htmlFor="phone">رقم الهاتف</label>
          <input id="phone" className="input ltr" style={{ textAlign: 'right' }} inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        {activate && (
          <div className="field">
            <label htmlFor="code">رمز التفعيل (٦ أرقام)</label>
            <input id="code" className="input ltr" style={{ textAlign: 'right', letterSpacing: 4 }} inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="pw">{activate ? 'اختار كلمة سر' : 'كلمة السر'}</label>
          <input id="pw" type="password" className="input" minLength={activate ? 6 : undefined} autoComplete={activate ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'لحظة…' : activate ? 'تفعيل ودخول' : 'دخول'}</button>
        <button type="button" className="btn" style={{ border: 0, background: 'none', color: 'var(--green)' }} onClick={() => { setMode(activate ? 'login' : 'activate'); setErr('') }}>
          {activate ? 'عندي حساب، أبي أدخل' : 'أول مرة؟ فعّل حسابك'}
        </button>
      </form>
    </div>
  )
}
