import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'

// "+ نوع آخر" chip that turns into a small input; adds a document type and hands it back
export default function AddDocType({ scope, onAdded, label = '+ نوع آخر' }) {
  const [name, setName] = useState(null)
  const [err, setErr] = useState('')
  const add = async () => {
    const n = name?.trim()
    if (!n) return
    const { data, error } = await supabase.from('document_types')
      .insert({ name: n, scope, default_remind_days: scope === 'branch' ? 60 : 30, sort_order: 50 }).select().single()
    if (error) { setErr(errMsg(error)); return }
    setName(null); setErr(''); onAdded(data)
  }
  if (name === null) return <button type="button" className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setName('')}>{label}</button>
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <input className="input" autoFocus style={{ height: 40, width: 200 }} placeholder="اسم النوع الجديد" value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      <button type="button" className="btn primary" style={{ minHeight: 40 }} onClick={add}>إضافة</button>
      <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => { setName(null); setErr('') }}>إلغاء</button>
      {err && <span className="error">{err}</span>}
    </span>
  )
}
