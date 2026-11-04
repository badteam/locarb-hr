import { useEffect, useRef, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/i18n.jsx'
import { itemNames, qtyFmt } from '../lib/inv'
import ProductImage from './ProductImage.jsx'
import ItemSearchSheet from './ItemSearchSheet.jsx'
import Icon from './Icon.jsx'

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const SPEECH_LANG = { ar: 'ar-KW', en: 'en-US', hi: 'hi-IN', ne: 'ne-NP' }

// Order by voice: the employee says what the branch needs, the AI picks the items from our own list,
// and the employee checks each line (swap for another kind, change the quantity, remove) before adding them to the order.
export default function VoiceOrder({ items, favs, onAdd, onClose }) {
  const { tr, tn, lang } = useLang()
  const [text, setText] = useState('')
  const [live, setLive] = useState('')
  const [listening, setListening] = useState(false)
  const [speechLang, setSpeechLang] = useState(SPEECH_LANG[lang] || 'ar-KW')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [lines, setLines] = useState(null)
  const [swap, setSwap] = useState(null) // index of the line being changed
  const rec = useRef(null)
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])

  useEffect(() => () => { try { rec.current?.stop() } catch { /* ignore */ } }, [])

  const start = () => {
    setErr('')
    if (!SR) { setErr(tr('الجهاز هذا ما يدعم الكلام. اكتب طلبك تحت.')); return }
    const r = new SR()
    r.lang = speechLang; r.continuous = true; r.interimResults = true
    r.onresult = (e) => {
      let fin = '', mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript + ' ') : (mid += e.results[i][0].transcript))
      if (fin) setText((t) => (t ? t + ' ' : '') + fin.trim())
      setLive(mid)
    }
    r.onerror = (e) => { setErr(e.error === 'not-allowed' ? tr('اسمح للمتصفح يستخدم المايك وجرّب مرة ثانية') : tr('ما قدرت أسمع، جرّب مرة ثانية أو اكتب')); setListening(false) }
    r.onend = () => { setListening(false); setLive('') }
    rec.current = r
    try { r.start(); setListening(true) } catch { setListening(false) }
  }
  const stop = () => { try { rec.current?.stop() } catch { /* ignore */ } setListening(false) }

  const understand = async () => {
    stop()
    const said = (text + ' ' + live).trim()
    if (!said) { setErr(tr('قول أو اكتب اللي تحتاجه أول')); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('voice-order', { body: { text: said, fav_ids: Object.keys(favs || {}) } })
    setBusy(false)
    if (error || !data?.ok) {
      const e = data?.error || ''
      setErr(e === 'no_credit' ? tr('رصيد الذكاء الاصطناعي خلص. كلم الإدارة.') : e === 'not_configured' ? tr('الذكاء الاصطناعي مو متفعّل. كلم الإدارة.') : tr('ما قدرت أفهم الطلب، جرّب مرة ثانية'))
      return
    }
    setLines(data.lines.map((l) => ({ ...l, qty: String(l.qty), keep: true })))
  }

  const setL = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const ready = (lines || []).filter((l) => l.keep && l.item_id && Number(l.qty) > 0)

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet form" style={{ maxWidth: 640 }}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>🎤 {tr('اطلب بالصوت')}</h2>
          <button type="button" className="icon-btn" aria-label={tr('إغلاق')} onClick={onClose}><Icon name="x" /></button></div>

        {!lines ? (<>
          <div className="sub">{tr('اضغط المايك وقول اللي تحتاجونه، مثلاً: خمسة كيلو صدر دجاج، ثلاث كراتين حليب، كيسين رز.')}</div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className={'btn ' + (listening ? 'danger' : 'primary')} style={{ minHeight: 64, fontSize: 18, flex: '1 1 220px' }} onClick={listening ? stop : start}>
              {listening ? <>⏹ {tr('وقّف')}</> : <>🎤 {tr('اضغط وتكلم')}</>}</button>
            <select className="input" style={{ width: 'auto', height: 48 }} value={speechLang} onChange={(e) => setSpeechLang(e.target.value)} aria-label={tr('لغة الكلام')} disabled={listening}>
              <option value="ar-KW">العربي</option><option value="en-US">English</option><option value="hi-IN">हिन्दी</option><option value="ne-NP">नेपाली</option>
            </select>
          </div>
          {listening && <div className="notice">{tr('أسمعك…')} {live && <span className="sub">{live}</span>}</div>}
          <div className="field"><label htmlFor="vt">{tr('اللي قلته (تقدر تعدله أو تكتب بدل الكلام)')}</label>
            <textarea id="vt" className="input" style={{ minHeight: 110, paddingTop: 10 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('مثلاً: 5 كيلو صدر دجاج، 3 كرتون حليب')} /></div>
          {err && <div className="error">{err}</div>}
          <button type="button" className="btn primary block" disabled={busy || (!text.trim() && !live)} onClick={understand}>{busy ? <><span className="spinner" /> {tr('يختار الأصناف…')}</> : <><Icon name="check" /> {tr('طلّع الأصناف')}</>}</button>
        </>) : (<>
          <div className="sub">{tr('هذي الأصناف اللي فهمتها. غيّر أي صنف أو كمية، أو شيله، وبعدين أضفهم للطلب.')}</div>
          <div className="card list" style={{ padding: '2px 10px' }}>
            {lines.map((l, i) => {
              const it = byId[l.item_id]
              return (
                <div key={i} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, opacity: l.keep ? 1 : 0.45 }}>
                  <div className="row" style={{ gap: 8 }}>
                    {it ? <ProductImage itemId={it.id} size={40} /> : <span className="thumb"><Icon name="warn" /></span>}
                    <div className="grow" style={{ minWidth: 0 }}>
                      {it ? <div style={{ fontWeight: 600 }}>{itemNames(it, lang)[0]} {!l.sure && <span className="pill amber">{tr('تأكد')}</span>}</div>
                        : <div style={{ fontWeight: 600, color: 'var(--red)' }}>{tr('ما عرفت')}: «{l.said}»</div>}
                      <div className="cell-sub">{tr('قلت')}: «{l.said}»{l.note ? ` · ${l.note}` : ''}</div>
                    </div>
                    <input className="input num" style={{ width: 80, height: 42 }} inputMode="decimal" value={l.qty} disabled={!l.keep}
                      onChange={(e) => setL(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} aria-label={tr('الكمية')} />
                    <span className="sub" style={{ minWidth: 40 }}>{tn(it?.unit || l.unit_said || '')}</span>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {l.alternatives?.filter((a) => byId[a]).map((a) => (
                      <button key={a} type="button" className="chip" style={{ minHeight: 30 }} onClick={() => setL(i, { item_id: a, sure: true, alternatives: [l.item_id, ...l.alternatives.filter((x) => x !== a)].filter(Boolean) })}>
                        ⇄ {itemNames(byId[a], lang)[0]}</button>))}
                    <button type="button" className="chip" style={{ minHeight: 30 }} onClick={() => setSwap(i)}><Icon name="search" size={14} /> {it ? tr('صنف ثاني') : tr('اختار الصنف')}</button>
                    <button type="button" className="chip" style={{ minHeight: 30, color: l.keep ? 'var(--red)' : undefined }} onClick={() => setL(i, { keep: !l.keep })}>{l.keep ? tr('شيله') : tr('رجّعه')}</button>
                  </div>
                </div>)
            })}
          </div>
          {err && <div className="error">{err}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => { setLines(null) }}>🎤 {tr('رجوع وأكمل الكلام')}</button>
            <button type="button" className="btn primary grow" disabled={!ready.length} onClick={() => onAdd(ready.map((l) => ({ item_id: l.item_id, qty: Number(l.qty) })))}>
              <Icon name="plus" /> {tr('أضف {n} صنف للطلب', { n: ready.length })}</button>
          </div>
          {ready.length > 0 && <div className="sub">{ready.map((l) => `${itemNames(byId[l.item_id], lang)[0]} ${qtyFmt(l.qty)}`).join(' · ')}</div>}
        </>)}

        {swap !== null && <ItemSearchSheet items={items} line={{ name: lines[swap].said, qty: Number(lines[swap].qty) }} current={lines[swap].item_id} hint={tr('اختار الصنف الصحيح')}
          onPick={(id) => { setL(swap, { item_id: id, sure: true, keep: true }); setSwap(null) }} onClose={() => setSwap(null)} />}
      </div>
    </div>
  )
}
