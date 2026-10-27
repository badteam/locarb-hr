import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon.jsx'

// Owner's home: is the AI (Anthropic key) working, roughly how much credit is left, and a warning before it runs out.
// Anthropic does not give the balance to an API key, so "left" = last top-up the owner entered minus what the
// system's own AI calls cost since then (an estimate).
const BILLING = 'https://console.anthropic.com/settings/billing'
const usd = (n) => `$${Number(n || 0).toFixed(2)}`
const when = (ts) => (ts ? new Date(ts).toLocaleString('ar-KW', { timeZone: 'Asia/Kuwait', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default function AiBalanceCard() {
  const [o, setO] = useState(null)
  const [busy, setBusy] = useState('')
  const [check, setCheck] = useState(null)
  const [topup, setTopup] = useState(null)   // amount being typed
  const load = useCallback(() => supabase.rpc('ai_overview').then(({ data }) => setO(data || null)), [])
  useEffect(() => { load() }, [load])
  if (!o) return null

  const test = async () => {
    setBusy('test'); setCheck(null)
    const { data } = await supabase.functions.invoke('read-invoice', { body: { test: true } }).catch(() => ({ data: null }))
    setBusy('')
    setCheck(data?.ok ? { ok: true, t: 'شغال ✓ المفتاح فيه رصيد' }
      : { ok: false, t: data?.error === 'no_credit' ? 'الرصيد خلص' : data?.error === 'invalid_key' ? 'المفتاح غلط أو اتلغى' : data?.error === 'not_configured' ? 'مفيش مفتاح متسجل في الإعدادات' : 'ما قدرتش أوصل له: ' + (data?.error || 'مشكلة اتصال') })
    load()
  }
  const saveTopup = async () => {
    const a = Number(topup)
    if (!(a > 0)) return
    setBusy('topup')
    await supabase.from('ai_topups').insert({ amount_usd: a })
    setBusy(''); setTopup(null); load()
  }

  const left = o.left_usd != null ? Number(o.left_usd) : null
  const total = o.topup ? Number(o.topup.amount) : null
  const pct = left != null && total ? Math.max(0, Math.min(100, (left / total) * 100)) : null
  const dead = o.no_credit || o.bad_key || check?.ok === false
  const low = !dead && left != null && (left < 5 || pct < 20)
  const tone = dead ? 'var(--red)' : low || o.fails_24h ? 'var(--amber)' : 'var(--ok)'

  return (
    <div className="card form" style={{ gap: 10, borderColor: dead ? '#F2B8B5' : low ? '#F3DDA8' : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: tone, flex: 'none' }} />
        <strong className="grow">رصيد الذكاء (Claude)</strong>
        <a className="btn" style={{ minHeight: 34 }} href={BILLING} target="_blank" rel="noreferrer">اشحن الرصيد</a>
      </div>

      {dead && <div className="error">{o.bad_key ? 'المفتاح غلط أو اتلغى' : 'الرصيد خلص'}، فقراءة الفواتير والصور وربط الأصناف واقفة. اشحن الرصيد من زرار «اشحن الرصيد» وبعدين اضغط «افحص دلوقتي».</div>}
      {low && <div className="warn"><Icon name="warn" /> الرصيد قرّب يخلص: باقي حوالي {usd(left)}. اشحن قبل ما يقف.</div>}

      {left != null ? <>
        <div className="row"><span className="grow sub">باقي تقريبًا</span><span className="num" style={{ fontWeight: 700, fontSize: 20, color: tone }}>{usd(left)}</span><span className="sub" style={{ marginInlineStart: 6 }}>من {usd(total)}</span></div>
        <div style={{ height: 8, borderRadius: 4, background: '#EEF1EC', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: tone }} /></div>
      </> : <div className="sub">سجّل آخر مبلغ شحنته عشان أحسب لك الباقي وأنبهك قبل ما يخلص.</div>}

      <div className="row sub" style={{ gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <span>صرف الشهر ده: <b className="num">{usd(o.month_usd)}</b></span>
        <span>آخر مرة اشتغل: {when(o.last_ok)}</span>
        <span>آخر 24 ساعة: {o.calls_24h} طلب{o.fails_24h ? `، فشل ${o.fails_24h}` : ''}</span>
      </div>
      {o.last_error && !dead && o.fails_24h > 0 && <div className="sub" style={{ fontSize: 12 }}>آخر غلطة ({when(o.last_error.at)}): {String(o.last_error.error || o.last_error.status).slice(0, 120)}</div>}
      {check && <div className={check.ok ? 'notice' : 'error'}>{check.t}</div>}

      {topup != null ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="sub">شحنت كام دولار؟</span>
          <input className="input num" style={{ width: 110, height: 38 }} inputMode="decimal" autoFocus value={topup} onChange={(e) => setTopup(e.target.value.replace(/[^\d.]/g, ''))} aria-label="المبلغ بالدولار" />
          <button className="btn primary" style={{ minHeight: 38 }} disabled={!!busy || !(Number(topup) > 0)} onClick={saveTopup}>حفظ</button>
          <button className="btn" style={{ minHeight: 38 }} onClick={() => setTopup(null)}>إلغاء</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" style={{ minHeight: 36 }} disabled={!!busy} onClick={test}>{busy === 'test' ? <span className="spinner" /> : null} افحص دلوقتي</button>
          <button className="btn" style={{ minHeight: 36 }} onClick={() => setTopup('')}>سجّلت شحن رصيد</button>
        </div>
      )}
      <div className="sub" style={{ fontSize: 12 }}>الباقي تقديري: محسوب من آخر شحن ناقص اللي صرفه السيستم ده بس. عشان ما يقفش أبدًا، فعّل «الشحن التلقائي» (Auto-reload) من صفحة الشحن.</div>
    </div>
  )
}
