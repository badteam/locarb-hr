import { useEffect, useState } from 'react'
import { supabase, fmtDate, errMsg } from '../lib/supabase'
import Icon from '../components/Icon.jsx'

const TEST_MSG = {
  invalid_key: 'المفتاح غلط أو انمسح. انسخه من جديد من صفحة Anthropic.',
  no_credit: 'المفتاح صحيح، بس الحساب ما فيه رصيد. اشحن رصيد من صفحة Billing في Anthropic.',
  not_configured: 'ما فيه مفتاح محفوظ.',
}

export default function Settings() {
  const [status, setStatus] = useState(undefined)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)

  useEffect(() => { supabase.rpc('app_settings_status').then(({ data }) => setStatus(data)) }, [])
  const ai = status?.anthropic_api_key

  const test = async () => {
    const { data, error } = await supabase.functions.invoke('read-invoice', { body: { test: true } })
    if (error) return { ok: false, t: 'ما قدرنا نتأكد من المفتاح. جرّب بعد شوي.' }
    return data.ok ? { ok: true, t: 'المفتاح شغال ✓ قراءة الفواتير والمستندات مفعّلة.' } : { ok: false, t: TEST_MSG[data.error] || `فيه مشكلة في المفتاح (${data.error})` }
  }

  const save = async (e) => {
    e.preventDefault(); setMsg(null)
    if (!key.trim().startsWith('sk-')) { setMsg({ ok: false, t: 'المفتاح لازم يبدأ بـ sk-ant- . تأكد إنك نسخته كامل.' }); return }
    setBusy('save')
    const { data, error } = await supabase.rpc('set_app_secret', { p_key: 'anthropic_api_key', p_value: key })
    if (error) { setMsg({ ok: false, t: errMsg(error) }); setBusy(''); return }
    setStatus(data); setKey('')
    setMsg(await test())
    setBusy('')
  }
  const runTest = async () => { setBusy('test'); setMsg(await test()); setBusy('') }
  const remove = async () => {
    if (!window.confirm('تمسح المفتاح؟ قراءة الفواتير والمستندات بتوقف لين تحط مفتاح جديد.')) return
    setBusy('del')
    const { data } = await supabase.rpc('set_app_secret', { p_key: 'anthropic_api_key', p_value: '' })
    setStatus(data); setMsg(null); setBusy('')
  }

  if (status === undefined) return <div className="center sub" style={{ minHeight: 300 }}><span className="spinner" /></div>
  if (status === null) return <div className="card empty">الإعدادات للمالك بس</div>

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-head"><div><h1>الإعدادات</h1><div className="sub">تظهر للمالك بس</div></div></div>

      <div className="card form">
        <div className="row"><span className="avatar"><Icon name="camera" /></span>
          <div className="grow"><h2 style={{ fontSize: 18 }}>القراءة بالذكاء الاصطناعي</h2>
            <div className="sub">مفتاح واحد لكل شي: فواتير الموردين، ومستندات الموظفين، وتراخيص الفروع</div></div>
          {ai ? <span className="pill ok">مفعّل</span> : <span className="pill gray">مو مفعّل</span>}</div>

        {ai && <div className="row" style={{ background: '#F7F9F5', borderRadius: 12, padding: '10px 12px', flexWrap: 'wrap' }}>
          <span className="grow">المفتاح المحفوظ: <span className="ltr num">sk-ant-••••{ai.last4}</span>
            <div className="cell-sub">{fmtDate(ai.updated_at)}{ai.updated_by ? ` · ${ai.updated_by}` : ''}</div></span>
          <button className="btn" style={{ minHeight: 38 }} disabled={!!busy} onClick={runTest}>{busy === 'test' ? <span className="spinner" /> : null} تأكد إنه شغال</button>
          <button className="btn danger" style={{ minHeight: 38 }} disabled={!!busy} onClick={remove}>مسح</button></div>}

        <form className="form" style={{ gap: 10 }} onSubmit={save}>
          <div className="field"><label htmlFor="k">{ai ? 'تغيير المفتاح' : 'الصق المفتاح هنا'}</label>
            <input id="k" className="input ltr" style={{ textAlign: 'left' }} type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} /></div>
          <button className="btn primary block" disabled={!key.trim() || !!busy}>{busy === 'save' ? <span className="spinner" /> : null} حفظ المفتاح</button>
        </form>
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.t}</div>}

        <div className="sub" style={{ lineHeight: 1.8 }}>
          تجيب المفتاح من <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> ← API Keys ← Create Key.
          المفتاح ينحفظ في السيرفر بس، وما أحد يقدر يشوفه بعد الحفظ، حتى أنت. يبين بس آخر ٤ حروف منه عشان تعرفه.
        </div>
      </div>
    </div>
  )
}
