import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { ToastProvider } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';

import Landing from './pages/Landing';
import PortalLogin from './pages/PortalLogin';
import RoleLogin from './pages/RoleLogin';
import AdminLogin from './pages/AdminLogin';
import CompanyLogin from './pages/CompanyLogin';
import SchoolLogin from './pages/SchoolLogin';
import OwnerLogin from './pages/OwnerLogin';
import EmployeeLogin from './pages/EmployeeLogin';
import Register from './pages/Register';
import CompanyOnboard from './pages/CompanyOnboard';
import Apps from './pages/Apps';
import AppDownload from './pages/AppDownload';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import LiveTracking from './pages/admin/LiveTracking';
import RoutesPage from './pages/admin/RoutesPage';
import VehiclesPage from './pages/admin/VehiclesPage';
import EmployeesPage from './pages/admin/EmployeesPage';
import ApprovalsPage from './pages/admin/ApprovalsPage';
import CompanyApprovalsPage from './pages/admin/CompanyApprovalsPage';
import AdminAccountsPage from './pages/admin/AdminAccountsPage';
import SchedulesPage from './pages/admin/SchedulesPage';
import ExportsPage from './pages/admin/ExportsPage';
import TripsPage from './pages/admin/TripsPage';
import AdminNotifications from './pages/admin/AdminNotifications';
import AdminChat from './pages/admin/AdminChat';
import SmsLogPage from './pages/admin/SmsLogPage';
import SettingsPage from './pages/admin/SettingsPage';
import AdminOpsPage from './pages/admin/AdminOpsPage';
import CheckInLogsPage from './pages/admin/CheckInLogsPage';
import NoShowsPage from './pages/admin/NoShowsPage';
import TicketListPage from './pages/admin/TicketListPage';
import TicketCreatePage from './pages/admin/TicketCreatePage';
import TicketDetailPage from './pages/admin/TicketDetailPage';
import CSPortalPage from './pages/admin/CSPortalPage';
import RawDataPage from './pages/admin/RawDataPage';
import MapsDiagPage from './pages/admin/MapsDiagPage';
import VendorsPage from './pages/admin/VendorsPage';
import SchoolManagement from './pages/admin/SchoolManagement';
import ParkingLinesPage from './pages/admin/ParkingLinesPage';
import CancellationsPage from './pages/admin/CancellationsPage';
import SafetyPage from './pages/admin/SafetyPage';
import VendorLogin from './pages/VendorLogin';

import SubscriptionCommandCenter from './pages/admin/SubscriptionCommandCenter';
import FeatureFlags from './pages/admin/FeatureFlags';
import SystemHealth from './pages/admin/SystemHealth';
import LocationPickerPage from './pages/shared/LocationPickerPage';
import PolicyEngine from './pages/admin/PolicyEngine';
import IntelligenceCenter from './pages/admin/IntelligenceCenter';
import AITransportManager from './pages/admin/AITransportManager';
import Reports from './pages/admin/Reports';
import Documents from './pages/admin/Documents';
import BillingOps from './pages/admin/BillingOps';
import NotificationTemplates from './pages/admin/NotificationTemplates';
import CommandCenter from './pages/admin/CommandCenter';
import AutomationBuilder from './pages/admin/AutomationBuilder';
import AnnouncementsPage from './pages/admin/AnnouncementsPage';
import DriversManagement from './pages/admin/DriversManagement';
import DriverAssignmentsPage from './pages/admin/DriverAssignmentsPage';
import ParentsManagement from './pages/admin/ParentsManagement';
import WhatIfSimulator from './pages/admin/WhatIfSimulator';

import EmployeeApp from './pages/employee/EmployeeApp';
import EHome from './pages/employee/EHome';
import ESchedule from './pages/employee/ESchedule';
import EBook from './pages/employee/EBook';
import ETrack from './pages/employee/ETrack';
import EHistory from './pages/employee/EHistory';
import EFeedback from './pages/employee/EFeedback';
import AddressSettings from './pages/employee/AddressSettings';
import ELocation from './pages/employee/ELocation';

import DriverApp from './pages/driver/DriverApp';
import DHome from './pages/driver/DHome';
import DRoute from './pages/driver/DRoute';
import DFeedback from './pages/driver/DFeedback';
import DDuty from './pages/driver/DDuty';
import MobileChat from './pages/MobileChat';
import NotificationsPage from './pages/NotificationsPage';

import SchoolLayout from './pages/school/SchoolLayout';
import SchoolDashboard from './pages/school/SchoolDashboard';
import SchoolStudents from './pages/school/SchoolStudents';
import SchoolParents from './pages/school/SchoolParents';
import SchoolDrivers from './pages/school/SchoolDrivers';
import SchoolVehicles from './pages/school/SchoolVehicles';
import SchoolRoutes from './pages/school/SchoolRoutes';
import SchoolSchedules from './pages/school/SchoolSchedules';
import SchoolNodalPoints from './pages/school/SchoolNodalPoints';
import SchoolGeofence from './pages/school/SchoolGeofence';
import SchoolSOS from './pages/school/SchoolSOS';
import SchoolSettings from './pages/school/SchoolSettings';

import ParentApp from './pages/parent/ParentApp';
import ParentHome from './pages/parent/ParentHome';
import ParentSOS from './pages/parent/ParentSOS';
import ParentAccount from './pages/parent/ParentAccount';
import ParentRegister from './pages/parent/ParentRegister';

function Require({ role, roles, vertical, children }) {
  const { user, loading } = useAuth();
  const loginTarget = role === 'admin' ? '/admin/login' : role === 'employee' ? '/employee-login' : role === 'driver' ? '/driver/login' : role === 'parent' ? '/parent/login' : '/login';
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
  if (!user) return <Navigate to={loginTarget} replace />;
  const allowed = roles || (role ? [role] : null);
  if (vertical && user.vertical !== vertical) {
    if (user.role === 'admin') return <Navigate to={user.vertical === 'school' ? '/school' : '/admin'} replace />;
    if (user.role === 'parent') return <Navigate to="/parent" replace />;
    return <Navigate to="/" replace />;
  }
  if (allowed && !allowed.includes(user.role)) {
    if (user.role === 'vendor') return <Navigate to="/admin" replace />;
    if (user.role === 'admin') return <Navigate to={user.vertical === 'school' ? '/school' : '/admin'} replace />;
    if (user.role === 'employee') return <Navigate to="/app" replace />;
    if (user.role === 'driver') return <Navigate to="/driver" replace />;
    if (user.role === 'parent') return <Navigate to="/parent" replace />;
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />

          <Route path="/login" element={<PortalLogin />} />
          <Route path="/driver/login" element={<RoleLogin role="driver" />} />
          <Route path="/driver-login" element={<RoleLogin role="driver" />} />
          <Route path="/parent/login" element={<RoleLogin role="parent" />} />
          <Route path="/parent-login" element={<RoleLogin role="parent" />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/company/login" element={<CompanyLogin />} />
          <Route path="/company-login" element={<CompanyLogin />} />
          <Route path="/vendor/login" element={<VendorLogin />} />
          <Route path="/school/login" element={<SchoolLogin />} />
          <Route path="/school-login" element={<SchoolLogin />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/apps/:appKey" element={<AppDownload />} />
          <Route path="/get-started" element={<Navigate to="/register-company" replace />} />
          <Route path="/platform" element={<Navigate to="/#platform" replace />} />
          <Route path="/solutions" element={<Navigate to="/#solutions" replace />} />
          <Route path="/about" element={<Navigate to="/#about" replace />} />
          <Route path="/contact" element={<Navigate to="/#contact" replace />} />

          <Route path="/owner" element={<OwnerLogin />} />
          <Route path="/employee-login" element={<EmployeeLogin />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-company" element={<CompanyOnboard />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/parent/register" element={<ParentRegister />} />

          {/* Shared full-screen location picker (MapLibre + OSM, no key). Kept at the
              legacy /admin/map-picker URL so existing admin/vendor flows are unchanged. */}
          <Route path="/admin/map-picker" element={<Require role="admin" roles={['admin', 'vendor']} vertical="company"><LocationPickerPage /></Require>} />
          <Route path="/admin" element={<Require role="admin" roles={['admin', 'vendor']} vertical="company"><AdminLayout /></Require>}>
            <Route index element={<Dashboard />} />
            <Route path="tracking" element={<LiveTracking />} />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="vehicles" element={<VehiclesPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="company-approvals" element={<CompanyApprovalsPage />} />
            <Route path="admin-accounts" element={<AdminAccountsPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="trips" element={<TripsPage />} />
            <Route path="exports" element={<ExportsPage />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="chat" element={<AdminChat />} />
            <Route path="sms-log" element={<SmsLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="operations" element={<AdminOpsPage />} />
            <Route path="checkin-logs" element={<CheckInLogsPage />} />
            <Route path="no-shows" element={<NoShowsPage />} />
            <Route path="tickets" element={<TicketListPage />} />
            <Route path="tickets/new" element={<TicketCreatePage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
            <Route path="cs" element={<CSPortalPage />} />
            <Route path="raw-data" element={<RawDataPage />} />
            <Route path="maps-diag" element={<MapsDiagPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="schools" element={<SchoolManagement />} />
            <Route path="parking-lines" element={<ParkingLinesPage />} />
            <Route path="cancellations" element={<CancellationsPage />} />
            <Route path="safety" element={<SafetyPage />} />
            <Route path="subscription" element={<SubscriptionCommandCenter />} />
            <Route path="feature-flags" element={<FeatureFlags />} />
            <Route path="system-health" element={<SystemHealth />} />
            <Route path="policies" element={<PolicyEngine />} />
            <Route path="intelligence" element={<IntelligenceCenter />} />
            <Route path="transport-manager" element={<AITransportManager />} />
            <Route path="reports" element={<Reports />} />
            <Route path="documents" element={<Documents />} />
            <Route path="billing" element={<BillingOps />} />
            <Route path="notification-templates" element={<NotificationTemplates />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="command-center" element={<CommandCenter />} />
            <Route path="automation" element={<AutomationBuilder />} />
            <Route path="drivers" element={<DriversManagement />} />
            <Route path="driver-assignments" element={<DriverAssignmentsPage />} />
            <Route path="parents" element={<ParentsManagement />} />
            <Route path="what-if" element={<WhatIfSimulator />} />
          </Route>

          <Route path="/school" element={<Require role="admin" vertical="school"><SchoolLayout /></Require>}>
            <Route index element={<SchoolDashboard />} />
            <Route path="students" element={<SchoolStudents />} />
            <Route path="parents" element={<SchoolParents />} />
            <Route path="drivers" element={<SchoolDrivers />} />
            <Route path="vehicles" element={<SchoolVehicles />} />
            <Route path="routes" element={<SchoolRoutes />} />
            <Route path="schedules" element={<SchoolSchedules />} />
            <Route path="zones" element={<SchoolNodalPoints />} />
            <Route path="geofence" element={<SchoolGeofence />} />
            <Route path="sos" element={<SchoolSOS />} />
            <Route path="settings" element={<SchoolSettings />} />
          </Route>

          <Route path="/parent" element={<Require role="parent" vertical="school"><ParentApp /></Require>}>
            <Route index element={<ParentHome />} />
            <Route path="sos" element={<ParentSOS />} />
            <Route path="account" element={<ParentAccount />} />
          </Route>

          <Route path="/vendor-login" element={<VendorLogin />} />
          <Route path="/vendor-portal" element={<Require role="vendor"><Navigate to="/admin" replace /></Require>} />

          <Route path="/app" element={<Require role="employee"><EmployeeApp /></Require>}>
            <Route index element={<EHome />} />
            <Route path="book" element={<EBook />} />
            <Route path="schedule" element={<ESchedule />} />
            <Route path="track" element={<ETrack />} />
            <Route path="address" element={<AddressSettings />} />
            <Route path="map-picker" element={<LocationPickerPage />} />
            <Route path="location" element={<ELocation />} />
            <Route path="history" element={<EHistory />} />
            <Route path="chat" element={<MobileChat />} />
            <Route path="feedback" element={<EFeedback />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="tickets" element={<TicketListPage />} />
            <Route path="tickets/new" element={<TicketCreatePage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
          </Route>

          <Route path="/driver" element={<Require role="driver"><DriverApp /></Require>}>
            <Route index element={<DHome />} />
            <Route path="route" element={<DRoute />} />
            <Route path="duty" element={<DDuty />} />
            <Route path="chat" element={<MobileChat />} />
            <Route path="feedback" element={<DFeedback />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </ErrorBoundary>
  );
}
