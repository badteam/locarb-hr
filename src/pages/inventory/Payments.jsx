import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { kwd, PAY_METHOD, invErr } from '../../lib/inv'
import Icon from '../../components/Icon.jsx'
import { compress } from './Invoices.jsx'

const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)

// one payment to a supplier: against one invoice, or on account
export function PaymentForm({ supplierId, supplierName, invoice, openInvoices = [], onClose, onSaved }) {
  const remaining = (v) => Math.max(0, Number(v.total_due || 0) - Number(v.paid_amount || 0))
  const [f, setF] = useState({
    invoice_id: invoice?.id || '', amount: invoice ? String(Math.round(remaining(invoice) * 1000) / 1000) : '',
    method: 'cash', paid_at: today(), note: '',
  })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => {
    const v = e.target.value
    if (k === 'invoice_id') {
      const inv = openInvoices.find((x) => x.id === v)
      setF({ ...f, invoice_id: v, amount: inv ? String(Math.round(remaining(inv) * 1000) / 1000) : f.amount })
    } else setF({ ...f, [k]: v })
  }
  const save = async (e) => {
    e.preventDefault(); setErr('')
    const amount = Number(f.amount)
    if (!(amount > 0)) { setErr('اكتب المبلغ'); return }
    setBusy(true)
    let receipt_path = null
    if (file) {
      const x = await compress(file)
      receipt_path = `payments/${supplierId}/${Date.now()}.${x.type === 'application/pdf' ? 'pdf' : 'jpg'}`
      const up = await supabase.storage.from('invoices').upload(receipt_path, x, { contentType: x.type || 'image/jpeg' })
      if (up.error) { setErr('ما قدرنا نرفع الإيصال: ' + up.error.message); setBusy(false); return }
    }
    const r = await supabase.from('supplier_payments').insert({
      supplier_id: supplierId, invoice_id: f.invoice_id || null, amount, method: f.method, paid_at: f.paid_at || today(),
      note: f.note || null, receipt_path,
    })
    setBusy(false)
    if (r.error) setErr(invErr(r.error)); else { onSaved?.(); onClose() }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><div><h2 style={{ fontSize: 20 }}>دفعة للمورد</h2><div className="sub">{supplierName}</div></div>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        {!invoice && (
          <div className="field"><label htmlFor="pi">عن فاتورة</label>
            <select id="pi" className="input" value={f.invoice_id} onChange={set('invoice_id')}>
              <option value="">دفعة على الحساب (مو لفاتورة معيّنة)</option>
              {openInvoices.map((v) => <option key={v.id} value={v.id}>{v.invoice_no ? `رقم ${v.invoice_no}` : 'بدون رقم'} · باقي {kwd(remaining(v))}</option>)}
            </select></div>)}
        {invoice && <div className="notice">فاتورة {invoice.invoice_no || ''} · المستحق {kwd(invoice.total_due)} · المدفوع {kwd(invoice.paid_amount)} · الباقي <strong>{kwd(remaining(invoice))}</strong></div>}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label htmlFor="pa">المبلغ (د.ك)</label><input id="pa" className="input num" type="number" step="any" min="0" value={f.amount} onChange={set('amount')} required /></div>
          <div className="field"><label htmlFor="pd">تاريخ الدفع</label><input id="pd" className="input" type="date" value={f.paid_at} onChange={set('paid_at')} /></div>
        </div>
        <div className="field"><span className="lbl">طريقة الدفع</span>
          <div className="chips">{Object.entries(PAY_METHOD).map(([k, l]) => <button type="button" key={k} className={'chip' + (f.method === k ? ' on' : '')} onClick={() => setF({ ...f, method: k })}>{l}</button>)}</div></div>
        <label className="upload" style={{ height: 70 }}>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Icon name="camera" /> {file ? file.name : 'صورة الإيصال أو التحويل (اختياري)'}
        </label>
        <div className="field"><label htmlFor="pn">ملاحظة</label><input id="pn" className="input" value={f.note} onChange={set('note')} placeholder="مثلاً: رقم الشيك أو التحويل" /></div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="check" />} تسجيل الدفعة</button>
      </form>
    </div>
  )
}
