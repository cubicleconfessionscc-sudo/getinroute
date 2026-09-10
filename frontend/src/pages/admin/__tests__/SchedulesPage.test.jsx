import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import SchedulesPage from '../SchedulesPage';
import { ToastProvider } from '../../../components/ui';

vi.mock('../../../auth', () => ({
  useAuth: () => ({ user: { id: 36, role: 'admin', name: 'Edwin', emp_id: 'ADMIN' } })
}));

const employee = { _id: 39, id: 39, name: 'Test Employee', email: 'bookcab.test.2026@gmail.com', emp_id: 'E39', role: 'employee', approved: 1, status: 'approved', vehicle_id: null, phone: '9999999999' };
const driver = { id: 40, role: 'driver', emp_id: 'D2001', name: 'Edwin Peroli C', phone: '8899999940', approved: 1, status: 'approved', vehicle_id: null, vendor_id: null };
const vehicle1 = { id: 1, vehicle_name: 'Cab 1', plate: 'KA01AB1234', line: 1, trip: 1, stand: 'Depot-2', driver_name: 'Edwin Peroli C', driver_phone: '8899999940', vendor_id: null };
const vehicle2 = { id: 2, vehicle_name: 'Cab 2', plate: 'KA01AB5678', line: 1, trip: 2, stand: 'Depot-2', driver_name: null, driver_phone: null, vendor_id: null };

function mockApi() {
  const calls = [];
  let schedules = [
    { id: 5, date: '2026-08-30', employee_name: 'Test Employee', emp_id: 'E39', vehicle_name: 'Cab 1', plate: 'KA01AB1234', line: 1, trip: 1, driver_account: 'Edwin Peroli C', driver_emp_id: 'D2001', driver_name: 'Edwin Peroli C', route_name: 'Route A', pickup_time: '08:00', drop_time: '09:30', login_time: '09:45', logout_time: '18:00', sequence: 1, status: 'confirmed', employee_id: 39, vehicle_id: 1 }
  ];
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    let out;
    if (path.startsWith('/api/admin/schedules') && method === 'GET') out = schedules;
    else if (path === '/api/admin/schedules' && method === 'POST') {
      out = { ok: true, id: 10 };
      schedules = [...schedules, { id: 10, date: body.date, employee_name: employee.name, emp_id: employee.emp_id, vehicle_name: 'Cab 2', plate: 'KA01AB5678', line: 1, trip: 2, driver_account: driver.name, driver_emp_id: driver.emp_id, driver_name: driver.name, route_name: 'Route A', pickup_time: body.pickup_time, drop_time: body.drop_time, login_time: body.login_time, logout_time: body.logout_time, sequence: body.sequence, status: 'confirmed', employee_id: body.employee_id, vehicle_id: 2 }];
    }
    else if (path.startsWith('/api/admin/users') && path.includes('employee')) out = [employee];
    else if (path === '/api/admin/vehicles') out = [vehicle1, vehicle2];
    else if (path === '/api/admin/drivers') out = [driver];
    else if (path === '/api/admin/routes') out = [];
    else out = { ok: true };
    return Promise.resolve({ ok: out.ok ?? true, status: 200, text: async () => JSON.stringify(out) });
  }));
  return calls;
}

const renderPage = () => render(<ToastProvider><SchedulesPage /></ToastProvider>);

beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SchedulesPage — approved driver appears', () => {
  it('approved driver shows in the schedule modal Driver dropdown', async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();
    await screen.findByText('Edwin Peroli C');
    await user.click(screen.getByRole('button', { name: /new schedule/i }));
    expect(screen.getByRole('option', { name: /Edwin Peroli C/ })).toBeInTheDocument();
  });

  it('approved driver renders in the Driver column of the table', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Edwin Peroli C');
    expect(screen.getByText('D2001')).toBeInTheDocument();
  });

  it('saving a schedule includes driver_id in the POST payload', async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const { container } = renderPage();
    await screen.findByText('Edwin Peroli C');
    await user.click(screen.getByRole('button', { name: /new schedule/i }));
    const grid = container.querySelector('.modal .form-grid');
    const selects = within(grid).getAllByRole('combobox');
    await user.selectOptions(selects[0], '39');
    await user.selectOptions(selects[2], '2');
    await user.selectOptions(selects[3], '40');
    await user.click(screen.getByRole('button', { name: /create schedule/i }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/schedules' && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.path === '/api/admin/schedules' && c.method === 'POST');
    expect(post.body.driver_id).toBe(40);
    expect(post.body.employee_id).toBe(39);
    expect(post.body.vehicle_id).toBe(2);
  });
});