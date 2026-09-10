import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import ApprovalsPage from '../ApprovalsPage';
import { ToastProvider } from '../../../components/ui';

const mockUser = { id: 36, role: 'admin', name: 'Edwin', emp_id: 'ADMIN', isOwner: false };
vi.mock('../../../auth', () => ({
  useAuth: () => ({ user: mockUser })
}));

const pendingUser = { _id: 41, id: 41, name: 'Temp Check User', email: 'tmp.xchk.01@opencode.test', emp_id: 'TMP-XCHK-01', role: 'driver', approved: 0, phone: '9900000001', department: 'Ops', created_at: '2026-08-30 10:00' };

function mockApi(data) {
  const calls = [];
  let users = (data.users || [pendingUser]).slice();
  let companies = (data.companies || []).slice();
  let address = (data.address || []).slice();
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    let out;
    if (data.owner) {
      if (path === '/api/owner/all-users') out = { users };
    } else {
      if (path === '/api/admin/approvals') out = users;
      else if (path === '/api/admin/pending-companies') out = companies;
      else if (path === '/api/admin/address-updates') out = address;
    }
    if (path.startsWith('/api/admin/approvals/') && method === 'POST') {
      out = { ok: true };
      users = users.filter((u) => (u._id || u.id) !== Number(path.split('/').pop()));
    }
    if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
      out = { ok: true };
      users = users.filter((u) => (u._id || u.id) !== Number(path.split('/').pop()));
    }
    if (!out) out = { ok: true };
    return Promise.resolve({ ok: out.ok ?? true, status: 200, text: async () => JSON.stringify(out) });
  }));
  return calls;
}

const renderPage = () => render(<ToastProvider><ApprovalsPage /></ToastProvider>);

beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('ApprovalsPage — reject flow (admin cards)', () => {
  it('clicking ✕ Reject confirms, POSTs reject, and removes the card', async () => {
    mockUser.isOwner = false;
    const user = userEvent.setup();
    const calls = mockApi({});
    renderPage();
    await screen.findByText('Temp Check User');
    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/approvals/41')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/approvals/41');
    expect(post.body).toEqual({ action: 'reject' });
    await waitFor(() => expect(screen.queryByText('Temp Check User')).not.toBeInTheDocument());
  });
});

describe('ApprovalsPage — owner list', () => {
  it('pending user row shows ✕ Reject which rejects and reloads the list', async () => {
    mockUser.isOwner = true;
    const user = userEvent.setup();
    const calls = mockApi({ owner: true });
    renderPage();
    await screen.findByText('Temp Check User');
    const rejectBtn = await screen.findByTitle('Reject request');
    expect(screen.getByTitle('Approve request')).toBeInTheDocument();
    await user.click(rejectBtn);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/approvals/41')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Temp Check User')).not.toBeInTheDocument());
  });

  it('approved users do not show the reject (✕) button', async () => {
    mockUser.isOwner = true;
    const user = userEvent.setup();
    const approved = { ...pendingUser, id: 42, _id: 42, approved: 1 };
    mockApi({ owner: true, users: [approved] });
    renderPage();
    await screen.findByText('Temp Check User');
    expect(screen.queryByTitle('Reject request')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Approve request')).not.toBeInTheDocument();
  });
});
