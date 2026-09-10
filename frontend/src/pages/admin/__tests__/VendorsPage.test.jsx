import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import VendorsPage from '../VendorsPage';
import { ToastProvider } from '../../../components/ui';

function mockApi(body, { ok = true, reject = false } = {}) {
  vi.stubGlobal('fetch', vi.fn(() => {
    if (reject) return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(body)
    });
  }));
}

const vendor = (over = {}) => ({
  id: 1, name: 'LUPL Transport', email: 'ops@lupl.com', phone: '+91 90000 00000',
  status: 'active', assigned_locations: ['Whitefield', 'KR Puram'],
  created_at: '2026-01-01', last_login: null, login_count: 0, has_login: false,
  ...over
});

const renderPage = () => render(<ToastProvider><VendorsPage /></ToastProvider>);

beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('VendorsPage — malformed / edge API responses must never crash', () => {
  it('renders a valid vendors array with zones', async () => {
    mockApi([vendor()]);
    renderPage();
    expect(await screen.findByText('LUPL Transport')).toBeInTheDocument();
    expect(screen.getByText('Whitefield')).toBeInTheDocument();
    expect(screen.getByText('KR Puram')).toBeInTheDocument();
  });

  it('API returns null → empty state, no throw', async () => {
    mockApi(null);
    renderPage();
    expect(await screen.findByText(/No vendors yet/i)).toBeInTheDocument();
  });

  it('API returns an object instead of an array → empty state, no throw', async () => {
    mockApi({ error: 'unexpected shape' });
    renderPage();
    expect(await screen.findByText(/No vendors yet/i)).toBeInTheDocument();
  });

  it('assigned_locations arrives as a JSON STRING (legacy backend) → renders zones, no throw', async () => {
    mockApi([vendor({ assigned_locations: JSON.stringify(['Whitefield']) })]);
    renderPage();
    expect(await screen.findByText('LUPL Transport')).toBeInTheDocument();
    expect(screen.getByText('Whitefield')).toBeInTheDocument();
  });

  it('assigned_locations arrives as corrupt text → treated as no zones ("All"), no throw', async () => {
    mockApi([vendor({ assigned_locations: 'Whitefield, KR Puram' })]);
    renderPage();
    expect(await screen.findByText('LUPL Transport')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('assigned_locations is null → "All" badge, no throw', async () => {
    mockApi([vendor({ assigned_locations: null })]);
    renderPage();
    expect(await screen.findByText('LUPL Transport')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('missing name/status/login_count fields → safe defaults, no throw', async () => {
    mockApi([{ id: 2 }]);
    renderPage();
    expect(await screen.findByText(/Vendor #2|Unnamed vendor/)).toBeInTheDocument();
  });

  it('network rejection → empty state, no unhandled crash', async () => {
    mockApi(null, { reject: true });
    renderPage();
    expect(await screen.findByText(/No vendors yet/i)).toBeInTheDocument();
  });

  it('HTTP 500 error payload → empty state, no throw', async () => {
    mockApi({ error: 'boom' }, { ok: false });
    renderPage();
    expect(await screen.findByText(/No vendors yet/i)).toBeInTheDocument();
  });

  it('Edit modal with corrupted zones opens and saves without throwing', async () => {
    const user = userEvent.setup();
    mockApi([vendor({ assigned_locations: 'not-json' , has_login: true })]);
    renderPage();
    await screen.findByText('LUPL Transport');
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const zoneInput = await screen.findByLabelText('Allotted zones');
    expect(zoneInput).toBeInTheDocument();
    await user.clear(zoneInput);
    await user.type(zoneInput, 'Hebbal, Yelahanka');
    mockApi({ ok: true });
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
