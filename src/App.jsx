import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAccess } from './lib/access.jsx'
import { supabase } from './lib/supabase'
import Icon from './components/Icon.jsx'
import { LangProvider, useLang } from './lib/i18n.jsx'
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
import ChangePassword from './pages/ChangePassword.jsx'
import Overtime from './pages/Overtime.jsx'
import Inventory from './pages/inventory/Inventory.jsx'
import Invoices from './pages/inventory/Invoices.jsx'
import InvoiceDetail from './pages/inventory/InvoiceDetail.jsx'
import Suppliers from './pages/inventory/Suppliers.jsx'
import Movements from './pages/inventory/Movements.jsx'

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

const ADMIN_PATHS = ['/inventory', '/overtime', '/dashboard', '/payroll', '/attendance', '/documents', '/employees', '/branches', '/roles']

export default function App() {
  const { access } = useAccess()
  return <LangProvider employee={access?.employee}><Shell /></LangProvider>
}

function Shell() {
  const { session, access, loading, can } = useAccess()
  const { t, dir } = useLang()
  const location = useLocation()
  const unread = useUnread(!!access)
  const adminPage = ADMIN_PATHS.some((p) => location.pathname.startsWith(p))

  if (session === undefined || loading) return <div className="center sub">{t('loading')}</div>
  if (!session) return <Login />
  if (!access) return (
    <div className="center"><div className="card form" style={{ maxWidth: 420 }}>
      <p>{t('not_active')}</p>
      <button className="btn" onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
    </div></div>
  )

  if (access.employee.must_change_password) return <ChangePassword />

  const isManager = can('view_attendance') || can('manage_documents') || can('manage_employees')
  const canInv = can('manage_inventory') || can('manage_suppliers') || can('approve_purchases') || can('approve_branch_requests') || can('view_reports')
  const canInvoices = can('manage_suppliers') || can('approve_purchases') || can('view_reports')
  const section = location.pathname.startsWith('/inventory') ? 'inv' : 'hr'

  const hrNav = [
    { to: '/', icon: 'home', label: t('nav_home'), show: true },
    { to: '/my-documents', icon: 'doc', label: t('nav_docs'), show: true },
    { to: '/leaves', icon: 'calendar', label: t('nav_leaves'), show: true },
    { to: '/corrections', icon: 'finger', label: t('nav_corrections'), show: true },
    { to: '/payslips', icon: 'doc', label: t('nav_payslips'), show: true },
    { to: '/notices', icon: 'warn', label: t('nav_notices'), show: true },
    { to: '/dashboard', icon: 'dash', label: 'لوحة اليوم', show: isManager, group: 'الإدارة' },
    { to: '/payroll', icon: 'box', label: 'الرواتب', show: can('manage_payroll') },
    { to: '/overtime', icon: 'calendar', label: 'الإضافي', show: can('approve_overtime') },
    { to: '/attendance', icon: 'calendar', label: 'سجل الحضور', show: can('view_attendance') },
    { to: '/documents', icon: 'warn', label: 'كل المستندات', show: can('manage_documents') },
    { to: '/employees', icon: 'users', label: 'الموظفين', show: can('view_employees') || can('manage_employees') },
    { to: '/branches', icon: 'branch', label: 'الفروع', show: can('manage_branches') },
    { to: '/roles', icon: 'shield', label: 'الأدوار والصلاحيات', show: access.is_owner },
    { to: '/notifications', icon: 'bell', label: t('nav_notifications'), show: true, badge: unread },
  ]
  const invNav = [
    { to: '/inventory', icon: 'box', label: 'المخزون', show: canInv },
    { to: '/inventory/invoices', icon: 'receipt', label: 'فواتير الموردين', show: canInvoices },
    { to: '/inventory/suppliers', icon: 'truck', label: 'الموردين', show: canInv },
    { to: '/inventory/movements', icon: 'arrows', label: 'حركة المخزون', show: canInv },
    { to: '/notifications', icon: 'bell', label: t('nav_notifications'), show: true, badge: unread },
  ]
  const nav = (section === 'inv' ? invNav : hrNav).filter((x) => x.show)

  const mobileNav = section === 'inv'
    ? nav
    : isManager
      ? nav.filter((x) => ['/', '/dashboard', '/employees', '/documents', '/notifications'].includes(x.to))
      : nav.filter((x) => ['/', '/leaves', '/my-documents', '/payslips', '/notifications'].includes(x.to))

  const switcher = canInv && (
    <div className="seg no-print" role="tablist" aria-label="القسم">
      <NavLink to="/" className={section === 'hr' ? 'on' : ''} role="tab" aria-selected={section === 'hr'}><Icon name="users" size={18} /> الموارد البشرية</NavLink>
      <NavLink to="/inventory" className={section === 'inv' ? 'on' : ''} role="tab" aria-selected={section === 'inv'}><Icon name="box" size={18} /> المخزون والتوريد</NavLink>
    </div>
  )

  return (
    <div className="shell">
      <aside className="side no-print">
        <div className="brand">LoCarb</div>
        {switcher}
        {nav.map((x) => (
          <NavLink key={x.to} to={x.to} end={x.to !== '/inventory/invoices'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <Icon name={x.icon} /> {x.label} {x.badge ? <span className="badge">{x.badge}</span> : null}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="sub" style={{ padding: '0 12px 8px' }}>{access.employee.full_name} · {access.role_name || ''}</div>
        <button className="navlink" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => supabase.auth.signOut()}>
          <Icon name="logout" /> {t('logout')}
        </button>
      </aside>

      <main className="main" dir={adminPage ? 'rtl' : dir} lang={adminPage ? 'ar' : undefined}>
        {switcher && <div className="mobile-only" style={{ marginBottom: 16 }}>{switcher}</div>}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/my-documents" element={<MyDocuments />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/leaves" element={<Leaves />} />
          <Route path="/corrections" element={<Corrections />} />
          <Route path="/notices" element={<Notices />} />
          <Route path="/payslips" element={<Payslips />} />
          {can('manage_payroll') && <Route path="/payroll" element={<Payroll />} />}
          {can('approve_overtime') && <Route path="/overtime" element={<Overtime />} />}
          {isManager && <Route path="/dashboard" element={<Dashboard />} />}
          {can('view_attendance') && <Route path="/attendance" element={<Attendance />} />}
          {can('manage_documents') && <Route path="/documents" element={<AllDocuments />} />}
          {(can('view_employees') || can('manage_employees')) && <Route path="/employees" element={<Employees />} />}
          {can('manage_branches') && <Route path="/branches" element={<Branches />} />}
          {access.is_owner && <Route path="/roles" element={<Roles />} />}
          {canInv && <Route path="/inventory" element={<Inventory />} />}
          {canInvoices && <Route path="/inventory/invoices" element={<Invoices />} />}
          {canInvoices && <Route path="/inventory/invoices/:id" element={<InvoiceDetail />} />}
          {canInv && <Route path="/inventory/suppliers" element={<Suppliers />} />}
          {canInv && <Route path="/inventory/movements" element={<Movements />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottomnav no-print">
        {mobileNav.map((x) => (
          <NavLink key={x.to} to={x.to} end={x.to !== '/inventory/invoices'} className={({ isActive }) => (isActive ? 'active' : '')}>
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
