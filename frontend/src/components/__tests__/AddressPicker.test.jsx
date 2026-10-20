import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import AddressPicker, { MapPickerModal } from '../AddressPicker';

/* MapLibre/WebGL is mocked so jsdom can exercise the picker logic: the
   "Pick on map" button opens the inline modal, a map tap names the point,
   and Confirm hands the selection back to the form field. */

vi.mock('../MapLibreMap', () => ({
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

function Harness({ mapButton = true }) {
  const [item, setItem] = useState(null);
  return (
    <div>
      <AddressPicker mapButton={mapButton} onChange={setItem} />
      <div data-testid="picked">{item ? `${item.address}|${item.lat}|${item.lng}` : 'none'}</div>
    </div>
  );
}

beforeEach(() => {
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

describe('AddressPicker map button', () => {
  it('shows a "Pick on map" button by default and hides it when mapButton={false}', async () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByTestId('pick-on-map')).toBeInTheDocument();
    unmount();
    render(<Harness mapButton={false} />);
    expect(screen.queryByTestId('pick-on-map')).not.toBeInTheDocument();
  });

  it('opens the inline map modal from the button and Confirm fills the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId('map-picker-modal')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('pick-on-map'));
    expect(screen.getByTestId('map-picker-modal')).toBeInTheDocument();
    // Drop a pin on the map; the modal reverse-geocodes it to a named address.
    await user.click(screen.getByTestId('mock-map'));
    const confirm = screen.getByTestId('map-picker-confirm');
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(screen.getByTestId('picked').textContent).toBe(`${MOCK_ADDR}|37.422|-122.084`));
    expect(screen.queryByTestId('map-picker-modal')).not.toBeInTheDocument();
  });

  it('search inside the modal selects a point and Confirm returns it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('pick-on-map'));
    const searches = screen.getAllByTestId('address-search');
    await user.type(searches[searches.length - 1], 'Googleplex');
    const option = await screen.findByText(MOCK_ADDR);
    await user.click(option);
    const confirm = screen.getByTestId('map-picker-confirm');
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(screen.getByTestId('picked').textContent).toContain(MOCK_ADDR));
  });
});

describe('MapPickerModal', () => {
  it('stays closed when open=false and seeds from an initial point', async () => {
    render(<MapPickerModal open={false} onPick={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId('map-picker-modal')).not.toBeInTheDocument();
    render(<MapPickerModal open initial={{ lat: 12.97, lng: 77.59, address: 'Bengaluru' }} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('map-picker-modal')).toBeInTheDocument();
    expect(screen.getByText('Bengaluru')).toBeInTheDocument();
    expect(screen.getByTestId('map-picker-confirm')).toBeEnabled();
  });
});
