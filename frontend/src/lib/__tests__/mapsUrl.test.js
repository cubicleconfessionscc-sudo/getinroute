import { describe, it, expect } from 'vitest';
import { googleMapsUrl, googleMapsDirUrl } from '../mapsUrl';

describe('googleMapsUrl', () => {
  it('prefers coordinates when present', () => {
    const url = googleMapsUrl({ lat: 12.9716, lng: 77.5946, address: 'Bengaluru' });
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=12.9716,77.5946');
  });

  it('falls back to the address name when coordinates are missing', () => {
    expect(googleMapsUrl({ address: 'Indiranagar, Bengaluru' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Indiranagar%2C%20Bengaluru');
    expect(googleMapsUrl({ address: 'MG Road' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=MG%20Road');
  });

  it('ignores invalid coordinates and falls back to the address', () => {
    expect(googleMapsUrl({ lat: 'not-a-number', lng: null, address: 'Somewhere' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Somewhere');
  });

  it('returns null when there is nothing to show', () => {
    expect(googleMapsUrl({})).toBeNull();
    expect(googleMapsUrl(null)).toBeNull();
  });

  it('builds a directions link the same way', () => {
    expect(googleMapsDirUrl({ lat: 1, lng: 2 })).toBe('https://www.google.com/maps/dir/?api=1&destination=1,2');
    expect(googleMapsDirUrl({ address: 'Whitefield' })).toBe('https://www.google.com/maps/dir/?api=1&destination=Whitefield');
  });
});
