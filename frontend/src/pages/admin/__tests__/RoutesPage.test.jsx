import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import RoutesPage from '../RoutesPage';
import { ToastProvider } from '../../../components/ui';
import { AuthProvider } from '../../../auth';

/* Routes → New route must offer the company's REGISTERED locations
   (company_locations, created at registration or in Settings) as office
   choices — not just nodal points of type 'office'. A freshly registered
   company has locations but no nodal points, and used to be blocked with
   "Office location is not configured." */

const NODAL = [
  { _id: 11, label: 'Legacy Office Nodal', address: 'MG Road', lat: 12.97, lng: 77.59 }
];
const LOCATIONS = [
  { id: 7, name: 'Bengaluru Location 1', address: '100 MG Road', lat: 12.9756, lng: 77.6068 },
  { id: 8, name: 'Chennai Location 1', address: '1 Anna Salai', lat: 13.0827, lng: 80.2707 },
  // Registered WITHOUT coordinates (the Settings path can do this) — the
  // option must still be listed, but disabled with a fix-it hint.
  { id: 9, name: 'No-Coord Site', address: '', lat: null, lng: null }
];

function mockFetch({ nodal = [], locations = LOCATIONS } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (u.includes('/api/auth/me')) return ok({ id: 1, role: 'admin', name: 'Test Admin', company_id: 1 });
    if (u.includes('/api/company/me/nodal-points')) return ok(nodal);
    if (u.includes('/api/admin/locations')) return ok({ states: [], cities: [], locations });
    if (u.includes('/api/admin/routes')) return ok([]);
    if (u.includes('/api/admin/vendors')) return ok([]);
    if (u.includes('/api/admin/vehicles')) return ok([]);
    if (u.includes('/api/admin/drivers/all')) return ok([]);
    if (u.includes('/api/admin/users')) return ok([]);
    if (u.includes('/api/v3/routes/auto-run')) return ok(null);
    return ok({});
  }));
}

const renderPage = () => render(
  <AuthProvider>
    <ToastProvider>
      <RoutesPage />
    </ToastProvider>
  </AuthProvider>
);

beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('RoutesPage — New route office dropdown (registered locations + nodal offices)', () => {
  it('offers registered company locations even with zero nodal office points', async () => {
    const user = userEvent.setup();
    mockFetch({ nodal: [] }); // fresh company: no nodal points at all
    renderPage();

    await user.click(await screen.findByRole('button', { name: /new route/i }));

    // The old empty-state blocker must be gone.
    await screen.findByTestId('office-location');
    expect(screen.queryByText(/Office location is not configured/i)).not.toBeInTheDocument();

    const sel = screen.getByTestId('office-location');
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent);
    expect(opts.some((t) => t.includes('Bengaluru Location 1'))).toBe(true);
    expect(opts.some((t) => t.includes('Chennai Location 1'))).toBe(true);
  });

  it('merges nodal offices AND registered locations into one list', async () => {
    const user = userEvent.setup();
    mockFetch({ nodal: NODAL });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /new route/i }));
    const sel = await screen.findByTestId('office-location');
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent);
    expect(opts.some((t) => t.includes('Legacy Office Nodal'))).toBe(true);
    expect(opts.some((t) => t.includes('Bengaluru Location 1'))).toBe(true);
    expect(opts.some((t) => t.includes('Chennai Location 1'))).toBe(true);
  });

  it('selecting a registered location shows the 🏢 badge with its label', async () => {
    const user = userEvent.setup();
    mockFetch({ nodal: [] });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /new route/i }));
    const sel = await screen.findByTestId('office-location');
    const blr = within(sel).getAllByRole('option').find((o) => o.textContent.includes('Bengaluru Location 1'));
    await user.selectOptions(sel, blr.value);

    const badge = await screen.findByTestId('office-selected');
    expect(badge).toHaveTextContent('Bengaluru Location 1');
  });

  it('lists a registered location WITHOUT coordinates but disables it with a hint', async () => {
    const user = userEvent.setup();
    mockFetch({ nodal: [], locations: LOCATIONS });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /new route/i }));
    const sel = await screen.findByTestId('office-location');
    const bad = within(sel).getAllByRole('option').find((o) => o.textContent.includes('No-Coord Site'));
    expect(bad).toBeDefined();
    expect(bad).toBeDisabled();
    expect(bad.textContent).toMatch(/add coordinates in Settings/i);
  });

  it('shows the empty hint (not the old blocker) only when there are no choices at all', async () => {
    const user = userEvent.setup();
    mockFetch({ nodal: [], locations: [] });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /new route/i }));
    await waitFor(() => expect(screen.queryByTestId('office-location')).not.toBeInTheDocument());
    expect(screen.queryByText(/Office location is not configured/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No office location available yet/i)).toBeInTheDocument();
  });
});
