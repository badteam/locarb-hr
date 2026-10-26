import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useAccess } from './lib/access.jsx'
import { supabase } from './lib/supabase'
import Icon from './components/Icon.jsx'
import Avatar from './components/Avatar.jsx'
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
import AttendanceBoard from './pages/AttendanceBoard.jsx'
import Leaves from './pages/Leaves.jsx'
import Corrections from './pages/Corrections.jsx'
import Notices from './pages/Notices.jsx'
import Payroll from './pages/Payroll.jsx'
import Payslips from './pages/Payslips.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Overtime from './pages/Overtime.jsx'
import BranchDocs from './pages/BranchDocs.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Transactions from './pages/Transactions.jsx'
import SmartUpload from './pages/SmartUpload.jsx'
import PriceFill from './pages/inventory/PriceFill.jsx'
import BranchLocation from './pages/BranchLocation.jsx'
import Inventory from './pages/inventory/Inventory.jsx'
import Invoices from './pages/inventory/Invoices.jsx'
import InvoiceDetail from './pages/inventory/InvoiceDetail.jsx'
import Suppliers from './pages/inventory/Suppliers.jsx'
import SupplierProfile from './pages/inventory/SupplierProfile.jsx'
import Sales from './pages/inventory/Sales.jsx'
import Monitor from './pages/inventory/Monitor.jsx'
import Movements from './pages/inventory/Movements.jsx'
import Prices from './pages/inventory/Prices.jsx'
import Orders from './pages/inventory/Orders.jsx'
import Settings from './pages/Settings.jsx'
import BranchStock from './pages/inventory/BranchStock.jsx'
import StockCount from './pages/inventory/StockCount.jsx'
import Reports from './pages/inventory/Reports.jsx'
import OpeningBalance from './pages/inventory/OpeningBalance.jsx'
import NewOrder from './pages/inventory/NewOrder.jsx'
import OrderDetail from './pages/inventory/OrderDetail.jsx'
import OrderImport from './pages/inventory/OrderImport.jsx'
import Devices from './pages/devices/Devices.jsx'
import DeviceNames from './pages/devices/DeviceNames.jsx'
import DeviceLog from './pages/devices/DeviceLog.jsx'
import Kiosk from './pages/Kiosk.jsx'

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

// counts of things waiting for me, per page (leaves to approve, invoices to receive, new alerts…)
function useBadges(enabled, path) {
  const [b, setB] = useState({})
  const load = useCallback(() => { supabase.rpc('my_badges').then(({ data }) => data && setB(data)) }, [])
  useEffect(() => {
    if (!enabled) return
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('badges-changed', load)
    window.addEventListener('focus', load)
    return () => { clearInterval(t); window.removeEventListener('badges-changed', load); window.removeEventListener('focus', load) }
  }, [enabled, load])
  useEffect(() => { if (enabled) load() }, [path, enabled, load])
  return b
}

const BRANCH_PATHS = ['/inventory/orders', '/inventory/stock', '/inventory/count']
const ADMIN_PATHS = ['/branch-location', '/devices', '/smart-upload', '/branch-docs', '/maintenance', '/transactions', '/settings', '/inventory', '/overtime', '/dashboard', '/payroll', '/attendance', '/documents', '/employees', '/branches', '/roles']

export default function App() {
  const { access } = useAccess()
  const location = useLocation()
  // the branch iPad punch screen works without anyone being logged in
  if (location.pathname.startsWith('/kiosk')) return <Kiosk />
  return <LangProvider employee={access?.employee}><Shell /></LangProvider>
}

function Shell() {
  const { session, access, loading, can } = useAccess()
  const { t, tr, dir } = useLang()
  const location = useLocation()
  const unread = useUnread(!!access)
  const badges = useBadges(!!access, location.pathname)
  const [more, setMore] = useState(false)
  const adminPage = ADMIN_PATHS.some((p) => location.pathname.startsWith(p)) && !BRANCH_PATHS.some((p) => location.pathname.startsWith(p))

  if (session === undefined || loading) return <div className="center sub">{t('loading')}</div>
  if (!session) return <Login />
  if (!access) return (
    <div className="center"><div className="card form" style={{ maxWidth: 420 }}>
      <p>{t('not_active')}</p>
      <button className="btn" onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
    </div></div>
  )

  if (access.employee.must_change_password) return <ChangePassword />

  const isManager = can('view_attendance') || can('manage_documents') || can('manage_employees') || can('manage_branch_docs')
  const canBranchDocs = can('manage_branch_docs') || can('branch_maintenance')
  const canTx = can('manage_branch_docs') || can('manage_documents')
  const canSmart = canTx || can('manage_suppliers')
  const canLocation = can('branch_location') || can('manage_branches') || !!access.employee.is_branch_manager
  const canInv = can('manage_inventory') || can('manage_suppliers') || can('approve_purchases') || can('approve_branch_requests') || can('view_reports')
  const canOrders = can('branch_orders') || can('approve_branch_requests') || can('manage_inventory') || can('view_reports')
  const canCount = can('branch_count') || can('manage_inventory')
  const canReports = can('view_reports') || can('manage_inventory') || can('approve_branch_requests')
  const canInvoices = can('manage_suppliers') || can('approve_purchases') || can('view_reports') || can('receive_goods') || can('supplier_payments')
  const canSuppliers = canInv || can('supplier_payments')
  const canMonitor = can('monitor_alerts')
  const canSales = can('view_reports') || can('manage_inventory')
  const invHome = canInv ? '/inventory' : canOrders ? '/inventory/orders' : canCount ? '/inventory/stock' : '/inventory/invoices'
  const canDev = can('view_devices') || can('open_doors') || can('manage_devices')
  const canInvSection = canInv || canOrders || canCount || canInvoices || canMonitor
  const section = location.pathname.startsWith('/inventory') ? 'inv' : location.pathname.startsWith('/devices') ? 'dev' : 'hr'

  const hrNav = [
    { to: '/', icon: 'home', label: t('nav_home'), show: true },
    { to: '/my-documents', icon: 'doc', label: t('nav_docs'), show: true },
    { to: '/leaves', icon: 'calendar', label: t('nav_leaves'), show: true },
    { to: '/corrections', icon: 'finger', label: t('nav_corrections'), show: true },
    { to: '/payslips', icon: 'doc', label: t('nav_payslips'), show: true },
    { to: '/notices', icon: 'warn', label: t('nav_notices'), show: true },
    { to: '/dashboard', icon: 'dash', label: tr('لوحة اليوم'), show: isManager, group: 'الإدارة' },
    { to: '/payroll', icon: 'box', label: tr('الرواتب'), show: can('manage_payroll') },
    { to: '/overtime', icon: 'calendar', label: tr('الإضافي'), show: can('approve_overtime') },
    { to: '/attendance/board', icon: 'users', label: tr('الحضور والغياب'), show: can('view_attendance') },
    { to: '/attendance', icon: 'calendar', label: tr('سجل الحضور'), show: can('view_attendance') },
    { to: '/smart-upload', icon: 'camera', label: tr('رفع ذكي'), show: canSmart },
    { to: '/documents', icon: 'warn', label: tr('مستندات الموظفين'), show: can('manage_documents') },
    { to: '/branch-docs', icon: 'doc', label: tr('تراخيص الفروع'), show: canBranchDocs },
    { to: '/maintenance', icon: 'gear', label: tr('الصيانة'), show: canBranchDocs },
    { to: '/transactions', icon: 'list', label: tr('المعاملات الحكومية'), show: canTx },
    { to: '/employees', icon: 'users', label: tr('الموظفين'), show: can('view_employees') || can('manage_employees') },
    { to: '/branches', icon: 'branch', label: tr('الفروع'), show: can('manage_branches') },
    { to: '/branch-location', icon: 'pin', label: tr('موقع الفرع'), show: canLocation && !can('manage_branches') },
    { to: '/roles', icon: 'shield', label: tr('الأدوار والصلاحيات'), show: access.is_owner },
    { to: '/settings', icon: 'gear', label: tr('الإعدادات'), show: access.is_owner },
    { to: '/notifications', icon: 'bell', label: t('nav_notifications'), show: true, badge: unread },
  ]
  const invNav = [
    { to: '/inventory', icon: 'box', label: tr('المخزون'), show: canInv },
    { to: '/inventory/orders', icon: 'list', label: tr('طلبات الفروع'), show: canOrders },
    { to: '/inventory/orders/import', icon: 'download', label: tr('رفع طلبيات إكسل'), show: can('manage_inventory') || can('approve_branch_requests') },
    { to: '/inventory/stock', icon: 'check', label: tr('رصيد الفرع والجرد'), show: canCount },
    { to: '/inventory/monitor', icon: 'shield', label: tr('المراقب'), show: canMonitor },
    { to: '/inventory/sales', icon: 'dash', label: tr('المبيعات وتكلفة المواد'), show: canSales },
    { to: '/inventory/reports', icon: 'dash', label: tr('التقارير'), show: canReports },
    { to: '/inventory/invoices', icon: 'receipt', label: tr('فواتير الموردين'), show: canInvoices },
    { to: '/inventory/suppliers', icon: 'truck', label: tr('الموردين'), show: canSuppliers },
    { to: '/inventory/movements', icon: 'arrows', label: tr('حركة المخزون'), show: canInv },
    { to: '/inventory/prices', icon: 'receipt', label: tr('أسعار الأصناف'), show: can('manage_inventory') },
    { to: '/settings', icon: 'gear', label: tr('الإعدادات'), show: access.is_owner },
    { to: '/notifications', icon: 'bell', label: t('nav_notifications'), show: true, badge: unread },
  ]
  const devNav = [
    { to: '/devices', icon: 'door', label: tr('الأجهزة والأبواب'), show: canDev },
    { to: '/devices/log', icon: 'list', label: tr('السجل'), show: canDev },
    { to: '/notifications', icon: 'bell', label: t('nav_notifications'), show: true, badge: unread },
  ]
  const withBadge = (list) => list.map((x) => ({ ...x, badge: x.badge ?? (badges[x.to] || 0) }))
  const sum = (list) => list.filter((x) => x.show && x.to !== '/notifications').reduce((a, x) => a + (badges[x.to] || 0), 0)
  const secCount = { hr: sum(hrNav), inv: sum(invNav), dev: sum(devNav) }
  const nav = withBadge((section === 'inv' ? invNav : section === 'dev' ? devNav : hrNav).filter((x) => x.show))

  const INV_MOBILE = ['/inventory', '/inventory/orders', '/inventory/stock', '/inventory/invoices', '/inventory/reports']
  const pick = (paths) => paths.map((p) => nav.find((x) => x.to === p)).filter(Boolean)
  const mobileNav = section === 'inv'
    ? [...pick(INV_MOBILE).slice(0, 3), ...pick(['/notifications'])]
    : section === 'dev' ? pick(['/devices', '/devices/log', '/notifications'])
    : isManager
      ? pick(['/', '/dashboard', '/documents', '/notifications'])
      : pick(['/', '/leaves', '/my-documents', '/notifications'])

  const switcher = (canInvSection || canDev) && (
    <div className="seg no-print" role="tablist" aria-label={tr('القسم')}>
      <NavLink to="/" className={section === 'hr' ? 'on' : ''} role="tab" aria-selected={section === 'hr'}><Icon name="users" size={18} /> {tr('الموارد البشرية')}{section !== 'hr' && secCount.hr ? <span className="badge">{secCount.hr}</span> : null}</NavLink>
      {canInvSection && <NavLink to={invHome} className={section === 'inv' ? 'on' : ''} role="tab" aria-selected={section === 'inv'}><Icon name="box" size={18} /> {tr('المخزون والتوريد')}{section !== 'inv' && secCount.inv ? <span className="badge">{secCount.inv}</span> : null}</NavLink>}
      {canDev && <NavLink to="/devices" className={section === 'dev' ? 'on' : ''} role="tab" aria-selected={section === 'dev'}><Icon name="door" size={18} /> {tr('الأجهزة والأبواب')}{section !== 'dev' && secCount.dev ? <span className="badge">{secCount.dev}</span> : null}</NavLink>}
    </div>
  )

  return (
    <div className="shell">
      <aside className="side no-print">
        <div className="brand">LoCarb</div>
        {switcher}
        {nav.map((x) => (
          <NavLink key={x.to} to={x.to} end={!['/inventory/invoices', '/inventory/orders', '/inventory/suppliers'].includes(x.to)} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <Icon name={x.icon} /> {x.label} {x.badge ? <span className="badge">{x.badge}</span> : null}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="row" style={{ padding: '0 12px 8px', gap: 8 }}><Avatar name={access.employee.full_name} path={access.employee.personal_pic_path} size={32} /><span className="sub">{access.employee.full_name} · {tr(access.role_name || '')}</span></div>
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
          {can('view_attendance') && <Route path="/attendance/board" element={<AttendanceBoard />} />}
          {can('manage_documents') && <Route path="/documents" element={<AllDocuments />} />}
          {canBranchDocs && <Route path="/branch-docs" element={<BranchDocs />} />}
          {canBranchDocs && <Route path="/maintenance" element={<Maintenance />} />}
          {canTx && <Route path="/transactions" element={<Transactions />} />}
          {canSmart && <Route path="/smart-upload" element={<SmartUpload />} />}
          {canLocation && <Route path="/branch-location" element={<BranchLocation />} />}
          {(can('view_employees') || can('manage_employees')) && <Route path="/employees" element={<Employees />} />}
          {can('manage_branches') && <Route path="/branches" element={<Branches />} />}
          {access.is_owner && <Route path="/roles" element={<Roles />} />}
          {access.is_owner && <Route path="/settings" element={<Settings />} />}
          {canInv && <Route path="/inventory" element={<Inventory />} />}
          {can('manage_inventory') && <Route path="/inventory/opening" element={<OpeningBalance />} />}
          {can('manage_inventory') && <Route path="/inventory/price-fill" element={<PriceFill />} />}
          {canInvoices && <Route path="/inventory/invoices" element={<Invoices />} />}
          {canInvoices && <Route path="/inventory/invoices/:id" element={<InvoiceDetail />} />}
          {canMonitor && <Route path="/inventory/monitor" element={<Monitor />} />}
          {canSales && <Route path="/inventory/sales" element={<Sales />} />}
          {canSuppliers && <Route path="/inventory/suppliers" element={<Suppliers />} />}
          {canSuppliers && <Route path="/inventory/suppliers/:id" element={<SupplierProfile />} />}
          {canInv && <Route path="/inventory/movements" element={<Movements />} />}
          {can('manage_inventory') && <Route path="/inventory/prices" element={<Prices />} />}
          {canOrders && <Route path="/inventory/orders" element={<Orders />} />}
          {canCount && <Route path="/inventory/stock" element={<BranchStock />} />}
          {canCount && <Route path="/inventory/count" element={<StockCount />} />}
          {canReports && <Route path="/inventory/reports" element={<Reports />} />}
          {canOrders && <Route path="/inventory/orders/new" element={<NewOrder />} />}
          {(can('manage_inventory') || can('approve_branch_requests')) && <Route path="/inventory/orders/import" element={<OrderImport />} />}
          {canOrders && <Route path="/inventory/orders/:id" element={<OrderDetail />} />}
          {canDev && <Route path="/devices" element={<Devices />} />}
          {canDev && <Route path="/devices/log" element={<DeviceLog />} />}
          {can('manage_devices') && <Route path="/devices/:id/names" element={<DeviceNames />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottomnav no-print">
        {mobileNav.map((x) => (
          <NavLink key={x.to} to={x.to} end={!['/inventory/invoices', '/inventory/orders', '/inventory/suppliers'].includes(x.to)} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span style={{ position: 'relative' }}>
              <Icon name={x.icon} size={22} />
              {x.badge ? <span className="badge" style={{ position: 'absolute', top: -6, left: -10 }}>{x.badge}</span> : null}
            </span>
            {x.label}
          </NavLink>
        ))}
        <a href="#more" onClick={(e) => { e.preventDefault(); setMore(true) }} className={more ? 'active' : ''}>
          <span style={{ position: 'relative' }}>
            <Icon name="list" size={22} />
            {(() => { const shown = new Set(mobileNav.map((x) => x.to)); const n = nav.filter((x) => !shown.has(x.to)).reduce((a, x) => a + (x.badge || 0), 0)
              return n ? <span className="badge" style={{ position: 'absolute', top: -6, left: -10 }}>{n}</span> : null })()}
          </span>
          {t('more')}
        </a>
      </nav>

      {more && (
        <div className="overlay no-print" onClick={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="sheet" dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="sheet-head">
              <div><strong>{access.employee.full_name}</strong><div className="sub">{tr(access.role_name || '')}</div></div>
              <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => setMore(false)}><Icon name="x" /></button>
            </div>
            {nav.map((x) => (
              <NavLink key={x.to} to={x.to} end={!['/inventory/invoices', '/inventory/orders', '/inventory/suppliers'].includes(x.to)} onClick={() => setMore(false)} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
                <Icon name={x.icon} /> {x.label} {x.badge ? <span className="badge">{x.badge}</span> : null}
              </NavLink>
            ))}
            <button className="navlink" style={{ border: 0, background: 'none', cursor: 'pointer', marginTop: 8 }} onClick={() => supabase.auth.signOut()}>
              <Icon name="logout" /> {t('logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
