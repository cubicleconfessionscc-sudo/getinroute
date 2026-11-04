import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '../SettingsPage';
import { ToastProvider } from '../../../components/ui';
import { AuthProvider } from '../../../auth';

let calls;

function mockApi(settingsPayload, locationsPayload = { states: [], cities: [], locations: [] }) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const u = String(url);
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'PATCH') {
      return { ok: true, status: 200, text: async () => JSON.stringify(opts.body ? JSON.parse(opts.body) : {}) };
    }
    if (u.includes('/api/admin/locations')) {
      if (method === 'POST') {
        const body = opts.body ? JSON.parse(opts.body) : {};
        const payload = u.includes('/states') ? { ok: true, id: 11 }
          : u.includes('/cities') ? { ok: true, id: 12 }
          : { ok: true, id: 13, code: 'NEWLO-CODE-1', ...body };
        return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(locationsPayload) };
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

describe('SettingsPage — registered company locations (State > City > Location)', () => {
  it('lists the locations registered at signup with State · City and address', async () => {
    mockApi({ company: {}, loginTimes: [], logoutTimes: [] }, {
      states: [{ id: 1, name: 'Karnataka' }],
      cities: [{ id: 1, state_id: 1, name: 'Bengaluru' }],
      locations: [{ id: 7, state_id: 1, city_id: 1, name: 'Repro HQ', address: 'Vidhana Soudha, Bengaluru', lat: 12.9794, lng: 77.5946 }]
    });
    renderPage();

    const row = await screen.findByTestId('registered-location');
    expect(row).toHaveTextContent('Repro HQ');
    expect(row).toHaveTextContent('Karnataka · Bengaluru');
    expect(row).toHaveTextContent('Vidhana Soudha, Bengaluru');
    expect(screen.getByText('Company Address (1)')).toBeInTheDocument();
    // The registered place must not be mistaken for an empty configuration.
    expect(screen.queryByText(/No company addresses configured/i)).not.toBeInTheDocument();
  });

  it('empty company still shows the friendly empty state', async () => {
    mockApi({ company: {} });
    renderPage();
    expect(await screen.findByText(/No company addresses configured/i)).toBeInTheDocument();
    expect(screen.getByText('Company Address (0)')).toBeInTheDocument();
  });

  it('Add location modal posts state/city/location and refreshes the list', async () => {
    const user = userEvent.setup();
    mockApi({ company: {} }, {
      states: [{ id: 1, name: 'Karnataka' }],
      cities: [{ id: 1, state_id: 1, name: 'Bengaluru' }],
      locations: []
    });
    renderPage();

    await user.click(await screen.findByTestId('add-location'));
    await user.selectOptions(screen.getByTestId('place-state'), '1');
    await user.selectOptions(screen.getByTestId('place-city'), '1');
    await user.type(screen.getByTestId('place-name'), 'Second Office');
    await user.click(screen.getByTestId('place-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/admin/locations/locations'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/admin/locations/locations'));
    expect(post.body).toMatchObject({ city_id: 1, name: 'Second Office' });
    // List refreshed after saving.
    await waitFor(() => {
      const gets = calls.filter((c) => c.method === 'GET' && c.url.includes('/api/admin/locations'));
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('never renders the ErrorBoundary message when opening Add Point / Add location', async () => {
    const user = userEvent.setup();
    mockApi({ company: {} });
    renderPage();

    await user.click(await screen.findByTestId('add-location'));
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByRole('button', { name: /add point/i }));
    expect(await screen.findByTestId('address-label')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
