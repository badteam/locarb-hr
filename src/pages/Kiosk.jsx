import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Icon from '../components/Icon.jsx'
import { KIOSK_KEY } from './devices/Devices.jsx'

// Shared punch screen for a branch iPad/iPhone. No login session: the device keeps a
// secret from when a manager activated it, and each employee proves who they are
// with their phone number and personal 4-digit code.

const T = {
  phone: { ar: 'اكتب رقم جوالك', en: 'Enter your phone number', ne: 'आफ्नो फोन नम्बर लेख्नुहोस्', hi: 'अपना फ़ोन नंबर लिखें' },
  code: { ar: 'اكتب الكود الخاص فيك', en: 'Enter your code', ne: 'आफ्नो कोड लेख्नुहोस्', hi: 'अपना कोड लिखें' },
  next: { ar: 'التالي', en: 'Next', ne: 'अर्को', hi: 'आगे' },
  back: { ar: 'رجوع', en: 'Back', ne: 'पछाडि', hi: 'वापस' },
  hello: { ar: 'هلا', en: 'Hello', ne: 'नमस्ते', hi: 'नमस्ते' },
  in: { ar: 'تسجيل حضور', en: 'Check in', ne: 'हाजिरी (आगमन)', hi: 'चेक इन' },
  out: { ar: 'تسجيل انصراف', en: 'Check out', ne: 'प्रस्थान', hi: 'चेक आउट' },
  since: { ar: 'حاضر من', en: 'Checked in at', ne: 'आगमन समय', hi: 'चेक इन समय' },
  done_in: { ar: 'تم تسجيل حضورك', en: 'You are checked in', ne: 'तपाईंको हाजिरी भयो', hi: 'आपका चेक इन हो गया' },
  done_out: { ar: 'تم تسجيل انصرافك', en: 'You are checked out', ne: 'तपाईंको प्रस्थान दर्ता भयो', hi: 'आपका चेक आउट हो गया' },
  late: { ar: 'متأخر {n} دقيقة', en: '{n} min late', ne: '{n} मिनेट ढिलो', hi: '{n} मिनट देर' },
  wrong: { ar: 'الرقم أو الكود غلط', en: 'Wrong number or code', ne: 'नम्बर वा कोड गलत', hi: 'नंबर या कोड गलत' },
  locked: { ar: 'محاولات كثيرة. جرّب بعد {n} دقيقة', en: 'Too many tries. Try again in {n} min', ne: 'धेरै प्रयास। {n} मिनेट पछि', hi: 'बहुत कोशिशें। {n} मिनट बाद' },
  no_code: { ar: 'ما عندك كود. كلّم المدير', en: 'You have no code yet. Ask your manager', ne: 'तपाईंको कोड छैन। म्यानेजरलाई सोध्नुहोस्', hi: 'आपका कोड नहीं है। मैनेजर से पूछें' },
  mode_mobile: { ar: 'بصمتك من جوالك الشخصي، مو من هنا', en: 'You punch from your own phone, not here', ne: 'तपाईंको हाजिरी आफ्नै फोनबाट हुन्छ', hi: 'आपकी हाज़िरी अपने फ़ोन से होती है' },
  mode_device: { ar: 'بصمتك من جهاز البصمة، مو من هنا', en: 'You punch on the fingerprint device, not here', ne: 'तपाईंको हाजिरी फिंगरप्रिन्ट मेसिनबाट हुन्छ', hi: 'आपकी हाज़िरी फिंगरप्रिंट मशीन से होती है' },
  already_in: { ar: 'أنت مسجل حضور من قبل', en: 'You are already checked in', ne: 'तपाईंको हाजिरी पहिले नै छ', hi: 'आप पहले से चेक इन हैं' },
  not_in: { ar: 'ما سجلت حضور', en: 'You have not checked in', ne: 'तपाईंले हाजिरी गर्नुभएको छैन', hi: 'आपने चेक इन नहीं किया' },
  too_soon: { ar: 'توك مسجل حضور', en: 'You just checked in', ne: 'भर्खर हाजिरी गर्नुभयो', hi: 'आपने अभी चेक इन किया' },
  net: { ar: 'ما فيه اتصال. جرّب مرة ثانية', en: 'No connection. Try again', ne: 'इन्टरनेट छैन। फेरि प्रयास गर्नुहोस्', hi: 'कनेक्शन नहीं। फिर कोशिश करें' },
}
const tt = (k, lang, vars = {}) => {
  let s = (T[k] && (T[k][lang] || T[k].ar)) || k
  for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b)
  return s
}
const both = (k) => <>{T[k].ar}<span className="kiosk-en">{T[k].en}</span></>
const clock = (d = new Date(), withDate) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuwait', ...(withDate ? { weekday: 'long', day: 'numeric', month: 'long' } : {}) }).format(d)

function Keypad({ onKey }) {
  return (
    <div className="kiosk-pad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
        <button key={k} type="button" className={'kiosk-key' + (k === 'ok' ? ' ok' : '')} onClick={() => onKey(k)} aria-label={k === 'del' ? 'مسح' : k === 'ok' ? 'التالي' : k}>
          {k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}
        </button>
      ))}
    </div>
  )
}

export default function Kiosk() {
  const token = (() => { try { return localStorage.getItem(KIOSK_KEY) } catch { return null } })()
  const [info, setInfo] = useState(undefined)
  const [step, setStep] = useState('phone') // phone | code | me | done
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [me, setMe] = useState(null)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(new Date())
  const idle = useRef(null)

  const reset = useCallback(() => { setStep('phone'); setPhone(''); setCode(''); setMe(null); setDone(null); setErr(''); setBusy(false) }, [])

  useEffect(() => {
    if (!token) { setInfo(null); return }
    supabase.rpc('kiosk_info', { p_token: token }).then(({ data }) => setInfo(data?.ok ? data : null))
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [token])

  // go back to the start if nobody touches the screen for a while
  useEffect(() => {
    clearTimeout(idle.current)
    if (step !== 'phone' || phone) idle.current = setTimeout(reset, step === 'done' ? 5000 : 30000)
    return () => clearTimeout(idle.current)
  }, [step, phone, code, reset])

  const lang = me?.lang || 'ar'
  const errText = (r) => r.error === 'locked' ? tt('locked', lang, { n: r.minutes || 10 }) : r.error === 'mode' ? tt(r.mode === 'device' ? 'mode_device' : 'mode_mobile', lang) : tt(r.error, lang)

  const login = async (c) => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('kiosk_login', { p_token: token, p_phone: phone, p_code: c })
    setBusy(false)
    if (error) { setErr(tt('net', 'ar')); return }
    if (!data.ok) {
      if (data.error === 'inactive') { setInfo(null); return }
      setErr(errText(data)); setCode('')
      if (data.error !== 'wrong') setStep('phone')
      return
    }
    setMe(data); setStep('me')
  }

  const punch = async () => {
    const action = me.open_since ? 'out' : 'in'
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('kiosk_punch', { p_token: token, p_phone: phone, p_code: code, p_action: action })
    setBusy(false)
    if (error) { setErr(tt('net', lang)); return }
    if (!data.ok) { setErr(errText(data)); return }
    setDone(data); setStep('done')
  }

  const key = (k) => {
    setErr('')
    if (step === 'phone') {
      if (k === 'del') setPhone((p) => p.slice(0, -1))
      else if (k === 'ok') { if (phone.replace(/\D/g, '').length >= 8) setStep('code') }
      else if (phone.length < 15) setPhone((p) => p + k)
    } else if (step === 'code') {
      if (k === 'del') setCode((c) => c.slice(0, -1))
      else if (k === 'ok') { if (code.length === 4) login(code) }
      else if (code.length < 4) {
        const c = code + k
        setCode(c)
        if (c.length === 4) login(c)
      }
    }
  }

  if (info === undefined) return <div className="kiosk center"><span className="spinner" /></div>
  if (info === null) return (
    <div className="kiosk center">
      <div className="kiosk-card" style={{ textAlign: 'center', gap: 16 }}>
        <Icon name="tablet" size={48} />
        <h1 style={{ fontSize: 22 }}>هذا الجهاز مو مفعّل كآيباد بصمة</h1>
        <p className="sub" style={{ fontSize: 15, lineHeight: 1.8 }}>المدير يدخل النظام من هذا الجهاز، ويروح لصفحة "الأجهزة والأبواب"، ويضغط "اجعل هذا الجهاز آيباد بصمة".</p>
        <Link to="/" className="btn primary block">دخول المدير</Link>
      </div>
    </div>
  )

  return (
    <div className="kiosk">
      <header className="kiosk-head">
        <div><strong>LoCarb</strong> · {info.branch}</div>
        <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{clock(now)}</div>
      </header>

      <main className="kiosk-body">
        {step === 'phone' && (
          <div className="kiosk-card">
            <h1>{both('phone')}</h1>
            <div className="kiosk-display num">{phone || <span style={{ opacity: .3 }}>9xxxxxxx</span>}</div>
            {err && <div className="error" style={{ fontSize: 17 }}>{err}</div>}
            <Keypad onKey={key} />
          </div>
        )}

        {step === 'code' && (
          <div className="kiosk-card">
            <h1>{both('code')}</h1>
            <div className="kiosk-dots" aria-label={`${code.length} من 4`}>{[0, 1, 2, 3].map((i) => <span key={i} className={i < code.length ? 'on' : ''} />)}</div>
            {busy && <div className="center" style={{ minHeight: 0 }}><span className="spinner" /></div>}
            {err && <div className="error" style={{ fontSize: 17 }}>{err}</div>}
            <Keypad onKey={key} />
            <button type="button" className="btn block" onClick={reset}>{both('back')}</button>
          </div>
        )}

        {step === 'me' && me && (
          <div className="kiosk-card" style={{ textAlign: 'center' }}>
            <div className="sub" style={{ fontSize: 18 }}>{tt('hello', lang)}</div>
            <h1 style={{ fontSize: 30 }}>{me.name}</h1>
            {me.job && <div className="sub" style={{ fontSize: 16 }}>{me.job}</div>}
            {me.open_since && <div className="notice" style={{ fontSize: 17 }}>{tt('since', lang)} <span className="num">{clock(new Date(me.open_since))}</span></div>}
            <button type="button" className={'checkin' + (me.open_since ? ' out' : '')} style={{ width: 240, height: 240, borderRadius: 120, fontSize: 24 }} disabled={busy} onClick={punch}>
              {busy ? <span className="spinner" /> : <Icon name="finger" size={64} stroke={1.5} />}
              {tt(me.open_since ? 'out' : 'in', lang)}
            </button>
            {err && <div className="error" style={{ fontSize: 17 }}>{err}</div>}
            <button type="button" className="btn block" onClick={reset}>{tt('back', lang)}</button>
          </div>
        )}

        {step === 'done' && done && (
          <div className="kiosk-card kiosk-done" style={{ textAlign: 'center' }}>
            <div className="kiosk-tick"><Icon name="check" size={72} stroke={2.5} /></div>
            <h1 style={{ fontSize: 30 }}>{tt(done.action === 'in' ? 'done_in' : 'done_out', lang)}</h1>
            <div className="num" style={{ fontSize: 44, fontWeight: 700 }}>{clock(new Date(done.at))}</div>
            <div style={{ fontSize: 20 }}>{me?.name}</div>
            {done.late > 0 && <div className="warn" style={{ justifyContent: 'center', fontSize: 17 }}>{tt('late', lang, { n: done.late })}</div>}
          </div>
        )}
      </main>
    </div>
  )
}
