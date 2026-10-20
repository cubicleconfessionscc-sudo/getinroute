import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import LocationPickerPage, { MAP_LOCATION_RESULT_KEY } from '../LocationPickerPage';

/* The map itself is MapLibre/WebGL — mocked here so jsdom can exercise the
   picker logic: search → name the point → Confirm hands the result back. */

vi.mock('../../../components/MapLibreMap', () => ({
  default: ({ onPick }) => (
    <div
      data-testid="mock-map"
      onClick={() => onPick && onPick(37.422, -122.084)}
    />
  )
}));

const MOCK_ADDR = '1600 Amphitheatre Parkway, Mountain View, CA';

function okJson(payload) {
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="route">{loc.pathname + loc.search}</div>;
}

const renderPicker = (search = '') => render(
  <MemoryRouter initialEntries={[`/app/map-picker${search}`]}>
    <LocationPickerPage />
    <LocationProbe />
  </MemoryRouter>
);

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/api/config/public')) return okJson({ geocodingProvider: 'photon', mapsProvider: 'maplibre' });
    if (String(url).includes('/api/geo/search')) {
      return okJson([{ label: MOCK_ADDR, address: MOCK_ADDR, lat: 37.422, lng: -122.084, provider_id: 'mock-place-123' }]);
    }
    if (String(url).includes('/api/geo/reverse')) return okJson({ address: MOCK_ADDR });
    throw new Error('unexpected fetch ' + url);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LocationPickerPage', () => {
  it('renders search + confirm, with confirm disabled until a point is named', () => {
    renderPicker('?returnToken=t1&returnTo=/app/address');
    expect(screen.getByTestId('address-search')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-location')).toBeDisabled();
    expect(screen.getByText('Not selected')).toBeInTheDocument();
  });

  it('search → pick enables Confirm and shows the address name (not coordinates)', async () => {
    const user = userEvent.setup();
    renderPicker('?returnToken=t1&returnTo=/app/address');
    await user.type(screen.getByTestId('address-search'), 'Googleplex');
    const option = await screen.findByText(MOCK_ADDR);
    await user.click(option);
    await waitFor(() => expect(screen.getByTestId('confirm-location')).toBeEnabled());
    expect(screen.getByText(MOCK_ADDR)).toBeInTheDocument();
    expect(screen.queryByText(/37\.42200/)).not.toBeInTheDocument();
  });

  it('Confirm with no opener writes the result to sessionStorage and returns to returnTo', async () => {
    const user = userEvent.setup();
    renderPicker('?returnToken=tok-1&returnTo=/app/address');
    await user.type(screen.getByTestId('address-search'), 'Googleplex');
    await user.click(await screen.findByText(MOCK_ADDR));
    await waitFor(() => expect(screen.getByTestId('confirm-location')).toBeEnabled());
    await user.click(screen.getByTestId('confirm-location'));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toContain('/app/address'));
    const raw = sessionStorage.getItem(MAP_LOCATION_RESULT_KEY);
    expect(raw).toBeTruthy();
    const result = JSON.parse(raw);
    expect(result).toMatchObject({ returnToken: 'tok-1', address: MOCK_ADDR, lat: 37.422, lng: -122.084 });
  });

  it('Confirm with an opener postMessages the result back instead of navigating', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    // jsdom's window.opener is not a spy-able accessor; define it directly.
    Object.defineProperty(window, 'opener', { value: { postMessage, closed: false }, configurable: true });
    vi.spyOn(window, 'close').mockImplementation(() => {});
    try {
      renderPicker('?returnToken=tok-2&returnTo=/admin/settings');
      await user.type(screen.getByTestId('address-search'), 'Googleplex');
      await user.click(await screen.findByText(MOCK_ADDR));
      await waitFor(() => expect(screen.getByTestId('confirm-location')).toBeEnabled());
      await user.click(screen.getByTestId('confirm-location'));
      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = postMessage.mock.calls[0][0];
      expect(payload).toMatchObject({ type: 'GETINROUTE_MAP_LOCATION', returnToken: 'tok-2', address: MOCK_ADDR, lat: 37.422, lng: -122.084 });
      expect(sessionStorage.getItem(MAP_LOCATION_RESULT_KEY)).toBeNull();
    } finally {
      Object.defineProperty(window, 'opener', { value: null, configurable: true });
    }
  });

  it('restores a caller-supplied point and names it if needed', async () => {
    renderPicker(`?returnToken=t3&lat=37.422&lng=-122.084&address=${encodeURIComponent(MOCK_ADDR)}`);
    await waitFor(() => expect(screen.getByTestId('confirm-location')).toBeEnabled());
    expect(screen.getByText(MOCK_ADDR)).toBeInTheDocument();
  });

  it('map tap drops a pin and reverse-geocodes it', async () => {
    const user = userEvent.setup();
    renderPicker('?returnToken=t4');
    await user.click(screen.getByTestId('mock-map'));
    await waitFor(() => expect(screen.getByTestId('confirm-location')).toBeEnabled());
    expect(screen.getByText(MOCK_ADDR)).toBeInTheDocument();
  });
});
