import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '../SettingsPage';
import { ToastProvider } from '../../../components/ui';

vi.mock('../../../auth', () => ({
  useAuth: () => ({
    user: { id: 7, name: 'Ops Admin', email: 'ops@acme.com', department: 'Acme Corp', invite_code: 'USERFALL-99' },
    setUser: vi.fn(), logout: vi.fn(), loading: false
  })
}));

function mockApi(payload) {
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'PATCH') return { ok: true, status: 200, text: async () => JSON.stringify(JSON.parse(opts.body || '{}')) };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  }));
}

const renderPage = () => render(<ToastProvider><SettingsPage /></ToastProvider>);

let writeTextSpy;

function injectClipboard(obj) {
  for (const navRef of [globalThis.navigator, window.navigator]) {
    if (!navRef) continue;
    try { Object.defineProperty(navRef, 'clipboard', { configurable: true, value: obj }); } catch {}
    try { Object.defineProperty(Object.getPrototypeOf(navRef), 'clipboard', { configurable: true, value: obj }); } catch {}
  }
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  writeTextSpy = vi.fn().mockResolvedValue();
  injectClipboard({ writeText: writeTextSpy });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Company Profile — persisted per-company Invite Code', () => {
  it('shows the server-provided invite code and copies it', async () => {
    const user = userEvent.setup();
    injectClipboard({ writeText: writeTextSpy });
    mockApi({ company: {}, loginTimes: [], logoutTimes: [], account: { inviteCode: 'ACME-4F7K' } });
    renderPage();

    const input = await screen.findByDisplayValue('ACME-4F7K');
    expect(input).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeTextSpy).toHaveBeenCalledWith('ACME-4F7K');
    expect(await screen.findByText(/Invite code copied/i)).toBeInTheDocument();
  });

  it('falls back to the account record code when settings payload lacks it', async () => {
    mockApi({ company: {}, loginTimes: [], logoutTimes: [] });
    renderPage();
    expect(await screen.findByDisplayValue('USERFALL-99')).toBeInTheDocument();
  });
});

describe('Company Profile — identity binding', () => {
  it('shows the authenticated company name and email', async () => {
    mockApi({ company: {}, loginTimes: [], logoutTimes: [], account: { inviteCode: 'X' } });
    renderPage();
    expect(await screen.findByDisplayValue('Acme Corp')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ops@acme.com')).toBeInTheDocument();
  });
});
