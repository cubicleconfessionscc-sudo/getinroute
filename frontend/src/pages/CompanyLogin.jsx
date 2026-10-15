import React from 'react';
import AdminLogin from './AdminLogin';

// The Company portal and the Admin portal are the SAME company-admin login:
// Admin/Company ID -> optional State/City/Operational Location scope -> password.
// Both routes render the shared, location-scoped login so there is one clean flow.
export default function CompanyLogin() {
  return <AdminLogin variant="company" />;
}
