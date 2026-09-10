import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import VendorsPage from '../VendorsPage';
import { ToastProvider } from '../../../components/ui';

let calls;
let vendorsPayload;
let routesPayload;
let createResponse;

function ok(body) { return { ok: true, status: 200, text: async () => JSON.stringify(body) }; }

function mockApi() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'POST' && u.includes('/api/admin/vendors')) return ok(createResponse);
    if (method === 'PUT' && u.includes('/api/admin/vendors')) return ok({ ok: true });
    if (u.includes('/api/admin/routes')) return ok(routesPayload);
    if (u.includes('/api/admin/vendors')) return ok(vendorsPayload);
    return ok({});
  }));
}

const vendor = {
  id: 1, name: 'LUPL Transport', email: 'ops@lupl.com', status: 'active',
  assigned_locations: ['Whitefield'], assigned_route_ids: [2], vendor_code: 'VND-A1B2C3',
  has_login: true, login_count: 0, last_login: null
};

const renderPage = () => render(<ToastProvider><VendorsPage /></ToastProvider>);

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vendorsPayload = [vendor];
  routesPayload = [{ id: 1, name: 'Line A' }, { id: 2, name: 'Line B' }];
  createResponse = { ok: true, id: 9, credentials: { vendorCode: 'VND-ZZ9XX', email: 'v@x.com', password: 'secret1' } };
  mockApi();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Vendor management — IDs, route assignment, credentials', () => {
  it('displays the generated Vendor ID and its assigned routes on the card', async () => {
    renderPage();
    expect(await screen.findByText('LUPL Transport')).toBeInTheDocument();
    expect(screen.getByText('VND-A1B2C3')).toBeInTheDocument();
    expect(screen.getByText('Line B')).toBeInTheDocument();
  });

  it('create flow sends assignedRouteIds and shows new credentials incl. Vendor ID', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('LUPL Transport');
    await user.click(screen.getByRole('button', { name: /add vendor/i }));
    await user.type(screen.getByPlaceholderText('LUPL Transport'), 'Speedy Cabs');
    const cb = screen.getByRole('checkbox', { name: /line a/i });
    await user.click(cb);
    await user.click(screen.getByRole('button', { name: /create vendor$/i }));

    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/admin/vendors'));
    expect(post).toBeDefined();
    expect(post.body.assignedRouteIds).toEqual([1]);

    expect(await screen.findByText('VND-ZZ9XX')).toBeInTheDocument();
  });

  it('edit modal pre-checks assigned routes and saves them', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('LUPL Transport');
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    const cbB = screen.getByRole('checkbox', { name: /line b/i });
    expect(cbB.checked).toBe(true);
    const cbA = screen.getByRole('checkbox', { name: /line a/i });
    expect(cbA.checked).toBe(false);
    await user.click(cbA);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body.assignedRouteIds.sort()).toEqual([1, 2]);
  });
});
