import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import VehiclesPage from '../VehiclesPage';
import { ToastProvider } from '../../../components/ui';

vi.mock('../../../auth', () => ({
  useAuth: () => ({ user: { id: 36, role: 'admin', name: 'Edwin', emp_id: 'ADMIN' } })
}));

const driver = { id: 17, role: 'driver', emp_id: 'D2001', name: 'Ramesh Kumar', phone: '9886684938', approved: 1, status: 'active', vehicle_id: 1, vendor_id: null };

function mockApi() {
  const calls = [];
  let vehicles = [
    { id: 1, vehicle_name: 'Cab 1', plate: 'KA01AB1234', type: 'Cab', capacity: 4, stand: 'Depot-2', line: 1, trip: 1, route_id: null, driver_name: 'Ramesh Kumar', driver_phone: '9886684938', vendor_id: null, status: 'idle' }
  ];
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    let out;
    if (path === '/api/admin/vehicles' && method === 'GET') out = vehicles;
    else if (path === '/api/admin/vehicles' && method === 'POST') {
      out = { ok: true, id: 99 };
      vehicles = [...vehicles, { id: 99, vehicle_name: body.vehicle_name, plate: body.plate, type: body.type, capacity: body.capacity, stand: body.stand || '', line: body.line, trip: body.trip, route_id: body.route_id, driver_name: body.driver_name, driver_phone: body.driver_phone, vendor_id: body.vendor_id, status: 'idle' }];
    }
    else if (path.startsWith('/api/admin/vehicles/') && method === 'PUT') out = { ok: true };
    else if (path === '/api/admin/routes') out = [];
    else if (path === '/api/admin/vendors') out = [];
    else if (path === '/api/admin/drivers') out = [driver];
    else out = { ok: true };
    return Promise.resolve({ ok: out.ok ?? true, status: 200, text: async () => JSON.stringify(out) });
  }));
  return calls;
}

const renderPage = () => render(<ToastProvider><VehiclesPage /></ToastProvider>);

beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('VehiclesPage — Add vehicle flow', () => {
  it('clicking "Add vehicle" opens the modal', async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();
    await screen.findByText('Cab 1');
    expect(screen.queryByPlaceholderText('Volvo AC Bus')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add vehicle/i }));
    expect(screen.getByPlaceholderText('Volvo AC Bus')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ramesh Kumar \(D2001\)/ })).toBeInTheDocument();
  });

  it('submitting the form POSTs to /api/admin/vehicles and the new row renders in the table', async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();
    await screen.findByText('Cab 1');
    await user.click(screen.getByRole('button', { name: /add vehicle/i }));
    await user.type(screen.getByPlaceholderText('Volvo AC Bus'), 'New AC Bus');
    await user.type(screen.getByPlaceholderText(/e\.g\. Depot-2/), 'Hub-1 Stand');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/vehicles' && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.path === '/api/admin/vehicles' && c.method === 'POST');
    expect(post.body.vehicle_name).toBe('New AC Bus');
    await waitFor(() => expect(screen.getByText('New AC Bus')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});