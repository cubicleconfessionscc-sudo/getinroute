import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* Shared address-name resolution: cache + in-flight dedupe + coordinate
   fallback. fetch is mocked so the suite is deterministic and offline.
   The api wrapper reads res.text(), so mocks must provide text(). */

let fetchMock;

function okJson(payload) {
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
}

beforeEach(() => {
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/api/geo/reverse')) {
      return okJson({ address: '1600 Amphitheatre Parkway, Mountain View, CA' });
    }
    if (String(url).includes('/api/geo/search')) {
      return okJson([{ address: 'MG Road, Bengaluru', lat: 12.975, lng: 77.6, provider_id: 'x' }]);
    }
    throw new Error('unexpected fetch ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// The module-level cache survives between tests in one file; use fresh modules.
async function freshGeo() {
  vi.resetModules();
  return import('../geo');
}

describe('coordLabel / isCoordsOnly', () => {
  it('formats coordinates to 5 decimals and detects coordinate-shaped text', async () => {
    const geo = await freshGeo();
    expect(geo.coordLabel(12.9716001, 77.5946)).toBe('12.97160, 77.59460');
    expect(geo.isCoordsOnly('12.97160, 77.59460')).toBe(true);
    expect(geo.isCoordsOnly('12.9716, 77.5946')).toBe(true);
    expect(geo.isCoordsOnly(' 12.9716,77.5946 ')).toBe(true);
    expect(geo.isCoordsOnly('MG Road, Bengaluru')).toBe(false);
    expect(geo.isCoordsOnly('')).toBe(false);
  });
});

describe('resolveAddress', () => {
  it('resolves once per distinct point and reuses the cache', async () => {
    const geo = await freshGeo();
    const a = await geo.resolveAddress(37.422, -122.084);
    expect(a).toBe('1600 Amphitheatre Parkway, Mountain View, CA');
    const b = await geo.resolveAddress(37.422, -122.084);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent lookups of the same point', async () => {
    const geo = await freshGeo();
    const [a, b] = await Promise.all([
      geo.resolveAddress(37.422, -122.084),
      geo.resolveAddress(37.422, -122.084)
    ]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string without calling the API when there are no coords', async () => {
    const geo = await freshGeo();
    expect(await geo.resolveAddress(null, null)).toBe('');
    expect(await geo.resolveAddress(NaN, NaN)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pickLocation', () => {
  it('returns the point with its resolved address', async () => {
    const geo = await freshGeo();
    const picked = await geo.pickLocation(37.422, -122.084);
    expect(picked).toEqual({
      lat: 37.422,
      lng: -122.084,
      address: '1600 Amphitheatre Parkway, Mountain View, CA'
    });
  });

  it('falls back to a coordinate string so a pick is never lost', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 502, text: async () => JSON.stringify({ error: 'down' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const geo = await freshGeo();
    const picked = await geo.pickLocation(12.9716, 77.5946);
    expect(picked.lat).toBe(12.9716);
    expect(picked.lng).toBe(77.5946);
    expect(picked.address).toBe('12.97160, 77.59460');
  });

  it('returns null for invalid coordinates', async () => {
    const geo = await freshGeo();
    expect(await geo.pickLocation('x', 'y')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
