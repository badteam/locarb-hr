import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import Icon from '../components/Icon.jsx'

function RoleForm({ role, catalog, onClose, onSaved }) {
  const [name, setName] = useState(role?.name || '')
  const [desc, setDesc] = useState(role?.description || '')
  const [perms, setPerms] = useState(role?.permissions || [])
  const [scope, setScope] = useState(role?.branch_scope || 'all')
  const [err, setErr] = useState('')
  const toggle = (k) => setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  const save = async (e) => {
    e.preventDefault()
    const row = { name, description: desc, permissions: perms, branch_scope: scope }
    const { error } = role ? await supabase.from('roles').update(row).eq('id', role.id) : await supabase.from('roles').insert(row)
    if (error) setErr(errMsg(error)); else { onSaved(); onClose() }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet form" onSubmit={save}>
        <div className="sheet-head"><h2 style={{ fontSize: 20 }}>{role ? role.name : 'دور جديد'}</h2>
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><Icon name="x" /></button></div>
        <div className="field"><label htmlFor="rn">اسم الدور</label><input id="rn" className="input" placeholder="مثلاً: مشرف مطبخ" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label htmlFor="rd">وصف قصير</label><input id="rd" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="field">
          <span className="lbl">يشوف</span>
          <div className="chips">
            <button type="button" className={'chip' + (scope === 'all' ? ' on' : '')} onClick={() => setScope('all')}>كل الفروع</button>
            <button type="button" className={'chip' + (scope === 'own' ? ' on' : '')} onClick={() => setScope('own')}>فرعه بس</button>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 14, marginBottom: 4 }}>الصلاحيات</strong>
          {catalog.map((c) => <label key={c.key} className="check"><input type="checkbox" checked={perms.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>)}
          <div className="sub" style={{ marginTop: 6 }}>كل الموظفين يقدرون يسجلون حضورهم ويشوفون مستنداتهم بدون صلاحيات إضافية.</div>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="btn primary block">حفظ</button>
      </form>
    </div>
  )
}

export default function Roles() {
  const [roles, setRoles] = useState([])
  const [catalog, setCatalog] = useState([])
  const [counts, setCounts] = useState({})
  const [editing, setEditing] = useState(undefined)
  const load = useCallback(() => {
    supabase.from('roles').select('*').order('created_at').then(({ data }) => setRoles(data || []))
    supabase.from('employees').select('role_id').eq('active', true).then(({ data }) => {
      const m = {}; (data || []).forEach((e) => { m[e.role_id] = (m[e.role_id] || 0) + 1 }); setCounts(m)
    })
  }, [])
  useEffect(() => { load(); supabase.from('permission_catalog').select('*').order('sort_order').then(({ data }) => setCatalog(data || [])) }, [load])
  const label = Object.fromEntries(catalog.map((c) => [c.key, c.label]))

  return (
    <div>
      <div className="page-head">
        <div><h1>الأدوار والصلاحيات</h1><div className="sub">أنت بس كمالك تقدر تعدّل هنا</div></div>
        <button className="btn primary" onClick={() => setEditing(null)}><Icon name="plus" /> دور جديد</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {roles.map((r) => (
          <button key={r.id} className="card" style={{ textAlign: 'right', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }} onClick={() => setEditing(r)}>
            <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <strong style={{ fontSize: 16 }}>{r.name}</strong>
              <span className="pill gray">{counts[r.id] || 0} موظف</span>
            </div>
            {r.description && <div className="sub">{r.description}</div>}
            <div className="sub">{r.branch_scope === 'all' ? 'كل الفروع' : 'فرعه بس'}</div>
            <div className="chips" style={{ gap: 6 }}>
              {r.permissions.length === 0 ? <span className="pill gray">بدون صلاحيات إضافية</span> : r.permissions.map((p) => <span key={p} className="pill ok" style={{ fontWeight: 500 }}>{label[p] || p}</span>)}
            </div>
          </button>
        ))}
      </div>
      {editing !== undefined && <RoleForm role={editing} catalog={catalog} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  )
}
