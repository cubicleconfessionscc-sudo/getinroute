import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AddressSettings from '../AddressSettings';

/* Regression: the page used to crash with "pending is not defined" (an
   undefined identifier in JSX), which blanked the whole My Address screen.
   It must render the update form when nothing is pending, and the pending
   card (hiding the form) when a request is awaiting approval. */

const apiGet = vi.fn();
const toast = vi.fn();

vi.mock('../../../api', () => ({
  api: { get: (...a) => apiGet(...a), post: vi.fn(async () => ({ message: 'ok' })) },
  todayStr: () => '2026-10-20'
}));
vi.mock('../../../auth', () => ({
  useAuth: () => ({ user: { home_address: 'Home Road', home_lat: 12.9, home_lng: 77.6, home_city: '', home_state: '' } })
}));
vi.mock('../../../components/ui', () => ({
  useToast: () => toast
}));
vi.mock('../../../components/MapLibreMap', () => ({
  default: () => <div data-testid="mock-map" />
}));

beforeEach(() => {
  apiGet.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddressSettings', () => {
  it('renders the update form when there is no pending request (no crash)', async () => {
    render(<AddressSettings />);
    expect(await screen.findByText('My Address')).toBeInTheDocument();
    expect(screen.getByText('Pickup point — choose a method')).toBeInTheDocument();
    expect(screen.getByText('Open map picker')).toBeInTheDocument();
  });

  it('shows the pending card and hides the form while a request awaits approval', async () => {
    apiGet.mockResolvedValue([{ id: 1, status: 'pending', new_address: 'New Street 42', new_lat: 13.0, new_lng: 77.5, created_at: '2026-10-19' }]);
    render(<AddressSettings />);
    expect(await screen.findByText('New Street 42')).toBeInTheDocument();
    expect(screen.getByText(/Pending change/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Pickup point — choose a method')).not.toBeInTheDocument());
  });
});
