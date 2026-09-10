import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { ToastProvider } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';

import Landing from './pages/Landing';
import OwnerLogin from './pages/OwnerLogin';
import AdminLogin from './pages/AdminLogin';
import EmployeeLogin from './pages/EmployeeLogin';
import Register from './pages/Register';
import CompanyOnboard from './pages/CompanyOnboard';
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
import VendorPortal from './pages/admin/VendorPortal';
import VendorLogin from './pages/VendorLogin';

import EmployeeApp from './pages/employee/EmployeeApp';
import EHome from './pages/employee/EHome';
import ETrack from './pages/employee/ETrack';
import EHistory from './pages/employee/EHistory';
import EFeedback from './pages/employee/EFeedback';

import DriverApp from './pages/driver/DriverApp';
import DHome from './pages/driver/DHome';
import DRoute from './pages/driver/DRoute';
import DFeedback from './pages/driver/DFeedback';
import MobileChat from './pages/MobileChat';

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
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
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

          <Route path="/owner" element={<OwnerLogin />} />
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/employee-login" element={<EmployeeLogin />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-company" element={<CompanyOnboard />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/parent/register" element={<ParentRegister />} />

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
            <Route path="track" element={<ETrack />} />
            <Route path="history" element={<EHistory />} />
            <Route path="chat" element={<MobileChat />} />
            <Route path="feedback" element={<EFeedback />} />
            <Route path="tickets" element={<TicketListPage />} />
            <Route path="tickets/new" element={<TicketCreatePage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
          </Route>

          <Route path="/driver" element={<Require role="driver"><DriverApp /></Require>}>
            <Route index element={<DHome />} />
            <Route path="route" element={<DRoute />} />
            <Route path="chat" element={<MobileChat />} />
            <Route path="feedback" element={<DFeedback />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </ErrorBoundary>
  );
}