import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '../SettingsPage';
import { ToastProvider } from '../../../components/ui';
import { AuthProvider } from '../../../auth';

let calls;

function mockApi(settingsPayload) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'PATCH') {
      return { ok: true, status: 200, text: async () => JSON.stringify(opts.body ? JSON.parse(opts.body) : {}) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(settingsPayload) };
  }));
}

const renderPage = () => render(
  <AuthProvider>
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  </AuthProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SettingsPage — Shift & Schedule "Add slot" buttons must work', () => {
  it('Add login slot appends an editable row and PATCHes loginTimes to the backend', async () => {
    const user = userEvent.setup();
    mockApi({ company: {}, loginTimes: [], logoutTimes: [] });
    renderPage();

    expect(await screen.findByText('Shift & Schedule Configuration')).toBeInTheDocument();
    expect(screen.getByText(/No login slots configured/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add login slot/i }));

    expect(await screen.findByPlaceholderText('Morning')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH' && c.body?.loginTimes);
    expect(patch).toBeDefined();
    expect(patch.body.loginTimes).toHaveLength(1);
    expect(patch.body.loginTimes[0]).toMatchObject({ time: '09:00', cutoffMinutes: 120 });
  });

  it('Add logout slot appends a row and PATCHes logoutTimes to the backend', async () => {
    const user = userEvent.setup();
    mockApi({ company: {}, loginTimes: [], logoutTimes: [] });
    renderPage();

    expect(await screen.findByText('Shift & Schedule Configuration')).toBeInTheDocument();
    expect(screen.getByText(/No logout slots configured/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add logout slot/i }));

    expect(await screen.findByPlaceholderText('Evening')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH' && c.body?.logoutTimes);
    expect(patch).toBeDefined();
    expect(patch.body.logoutTimes).toHaveLength(1);
    expect(patch.body.logoutTimes[0]).toMatchObject({ time: '18:00', cutoffMinutes: 120 });
  });

  it('adding two login slots sends cumulative arrays (state not stale)', async () => {
    const user = userEvent.setup();
    mockApi({ company: {}, loginTimes: [], logoutTimes: [] });
    renderPage();

    await screen.findByText('Shift & Schedule Configuration');
    await user.click(screen.getByRole('button', { name: /add login slot/i }));
    await screen.findByPlaceholderText('Morning');
    await user.click(screen.getByRole('button', { name: /add login slot/i }));

    const patches = calls.filter((c) => c.method === 'PATCH' && c.body?.loginTimes);
    expect(patches.length).toBeGreaterThanOrEqual(2);
    const last = patches[patches.length - 1];
    expect(last.body.loginTimes).toHaveLength(2);
  });
});
