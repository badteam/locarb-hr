import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAccess } from './lib/access.jsx'
import { supabase } from './lib/supabase'
import Icon from './components/Icon.jsx'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import MyDocuments from './pages/MyDocuments.jsx'
import Dashboard from './pages/Dashboard.jsx'
import AllDocuments from './pages/AllDocuments.jsx'
import Employees from './pages/Employees.jsx'
import Branches from './pages/Branches.jsx'
import Roles from './pages/Roles.jsx'
import Notifications from './pages/Notifications.jsx'
import Attendance from './pages/Attendance.jsx'
import Leaves from './pages/Leaves.jsx'
import Corrections from './pages/Corrections.jsx'
import Notices from './pages/Notices.jsx'
import Payroll from './pages/Payroll.jsx'
import Payslips from './pages/Payslips.jsx'

function useUnread(enabled) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const load = () => supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).then(({ count }) => setN(count || 0))
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('notifications-changed', load)
    return () => { clearInterval(t); window.removeEventListener('notifications-changed', load) }
  }, [enabled])
  return n
}

export default function App() {
  const { session, access, loading, can } = useAccess()
  const unread = useUnread(!!access)

  if (session === undefined || loading) return <div className="center sub">جاري التحميل…</div>
  if (!session) return <Login />
  if (!access) return (
    <div className="center"><div className="card form" style={{ maxWidth: 420 }}>
      <h2>حسابك غير مفعّل</h2>
      <p className="sub">هذا الحساب مو مربوط بموظف فعّال. تواصل مع الإدارة.</p>
      <button className="btn" onClick={() => supabase.auth.signOut()}>تسجيل خروج</button>
    </div></div>
  )

  const isManager = can('view_attendance') || can('manage_documents') || can('manage_employees')
  const nav = [
    { to: '/', icon: 'home', label: 'الرئيسية', show: true },
    { to: '/my-documents', icon: 'doc', label: 'مستنداتي', show: true },
    { to: '/leaves', icon: 'calendar', label: 'الإجازات', show: true },
    { to: '/corrections', icon: 'finger', label: 'نسيان البصمة', show: true },
    { to: '/payslips', icon: 'doc', label: 'كشوف راتبي', show: true },
    { to: '/notices', icon: 'warn', label: 'العقوبات والإنذارات', show: true },
    { to: '/dashboard', icon: 'dash', label: 'لوحة اليوم', show: isManager },
    { to: '/payroll', icon: 'box', label: 'الرواتب', show: can('manage_payroll') },
    { to: '/attendance', icon: 'calendar', label: 'سجل الحضور', show: can('view_attendance') },
    { to: '/documents', icon: 'warn', label: 'كل المستندات', show: can('manage_documents') },
    { to: '/employees', icon: 'users', label: 'الموظفين', show: can('view_employees') || can('manage_employees') },
    { to: '/branches', icon: 'branch', label: 'الفروع', show: can('manage_branches') },
    { to: '/roles', icon: 'shield', label: 'الأدوار والصلاحيات', show: access.is_owner },
    { to: '/notifications', icon: 'bell', label: 'التنبيهات', show: true, badge: unread },
  ].filter((x) => x.show)

  const mobileNav = isManager
    ? nav.filter((x) => ['/', '/dashboard', '/employees', '/documents', '/notifications'].includes(x.to))
    : nav.filter((x) => ['/', '/leaves', '/my-documents', '/payslips', '/notifications'].includes(x.to))

  return (
    <div className="shell">
      <aside className="side no-print">
        <div className="brand">LoCarb HR</div>
        {nav.map((x) => (
          <NavLink key={x.to} to={x.to} end className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <Icon name={x.icon} /> {x.label} {x.badge ? <span className="badge">{x.badge}</span> : null}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="sub" style={{ padding: '0 12px 8px' }}>{access.employee.full_name} · {access.role_name || 'موظف'}</div>
        <button className="navlink" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => supabase.auth.signOut()}>
          <Icon name="logout" /> تسجيل خروج
        </button>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/my-documents" element={<MyDocuments />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/leaves" element={<Leaves />} />
          <Route path="/corrections" element={<Corrections />} />
          <Route path="/notices" element={<Notices />} />
          <Route path="/payslips" element={<Payslips />} />
          {can('manage_payroll') && <Route path="/payroll" element={<Payroll />} />}
          {isManager && <Route path="/dashboard" element={<Dashboard />} />}
          {can('view_attendance') && <Route path="/attendance" element={<Attendance />} />}
          {can('manage_documents') && <Route path="/documents" element={<AllDocuments />} />}
          {(can('view_employees') || can('manage_employees')) && <Route path="/employees" element={<Employees />} />}
          {can('manage_branches') && <Route path="/branches" element={<Branches />} />}
          {access.is_owner && <Route path="/roles" element={<Roles />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottomnav no-print">
        {mobileNav.map((x) => (
          <NavLink key={x.to} to={x.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
            <span style={{ position: 'relative' }}>
              <Icon name={x.icon} size={22} />
              {x.badge ? <span className="badge" style={{ position: 'absolute', top: -6, left: -10 }}>{x.badge}</span> : null}
            </span>
            {x.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
