import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Icon from '../components/Icon.jsx'
import { KIOSK_KEY } from './devices/Devices.jsx'

// First time on a branch iPad/phone: choose the branch and type the branch punch-screen password (set by HR).
// No manager login needed; the device then only shows the punch screen.
export default function KioskSetup({ onDone }) {
  const [branches, setBranches] = useState(null)
  const [branch, setBranch] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('kiosk_branches').then(({ data }) => setBranches(data || [])) }, [])

  const go = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc('enable_kiosk_with_password', { p_branch: branch, p_password: pw, p_name: null })
    setBusy(false)
    if (error) { setErr('ما فيه اتصال. جرّب مرة ثانية · No connection'); return }
    if (!data.ok) {
      setErr(data.error === 'locked' ? `محاولات كثيرة، جرّب بعد ${data.minutes} دقيقة · Too many tries` : 'الرقم السري غلط · Wrong password'); setPw(''); return
    }
    try { localStorage.setItem(KIOSK_KEY, data.token) } catch { setErr('المتصفح ما يسمح بالحفظ. طلّع وضع التصفح الخاص.'); return }
    onDone()
  }

  return (
    <div className="kiosk center">
      <form className="kiosk-card" style={{ gap: 14 }} onSubmit={go}>
        <div style={{ textAlign: 'center' }}><Icon name="finger" size={48} /></div>
        <h1 style={{ fontSize: 22, textAlign: 'center' }}>صفحة البصمة للفرع<span className="kiosk-en">Branch punch screen</span></h1>
        {branches === null ? <div className="center"><span className="spinner" /></div>
          : branches.length === 0 ? <div className="warn">ما فيه فرع له رقم سري. HR يحطه من صفحة الفروع.</div> : <>
            <div className="field"><label htmlFor="kb">الفرع · Branch</label>
              <select id="kb" className="input" value={branch} onChange={(e) => setBranch(e.target.value)} required>
                <option value="">اختار… · Choose…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.name_en ? ` · ${b.name_en}` : ''}</option>)}</select></div>
            <div className="field"><label htmlFor="kp">الرقم السري للفرع · Branch password</label>
              <input id="kp" className="input" type="password" inputMode="numeric" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
            {err && <div className="error">{err}</div>}
            <button className="btn primary block" disabled={busy || !branch || !pw}>{busy ? <span className="spinner" /> : null} افتح صفحة البصمة · Open</button>
          </>}
        <Link to="/" className="sub" style={{ textAlign: 'center' }}>دخول الإدارة</Link>
      </form>
    </div>
  )
}
