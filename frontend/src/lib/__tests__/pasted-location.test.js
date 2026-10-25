import { describe, it, expect } from 'vitest';
import { isMapLink, parseLatLng, parseMapUrlCoordinates } from '../geo';
import { decodePlusCode, looksLikePlusCode } from '../pluscode';

describe('pasted location parsing', () => {
  it('reads raw coordinates copied next to a pin', () => {
    expect(parseLatLng('12.8601234, 77.6601234')).toEqual({ lat: 12.8601234, lng: 77.6601234 });
    expect(parseLatLng('12.9716 77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(parseLatLng('12 MG Road, Bangalore')).toBeNull();
    expect(parseLatLng('hello')).toBeNull();
  });

  it('extracts the pin from Google Maps links', () => {
    expect(isMapLink('https://www.google.com/maps/place/x')).toBe(true);
    expect(isMapLink('https://maps.app.goo.gl/abc123')).toBe(true);
    expect(isMapLink('https://example.com/maps')).toBe(false);

    expect(parseMapUrlCoordinates('https://www.google.com/maps/place/Sagility/@12.8601234,77.6601234,17z/data=!4m2'))
      .toEqual({ lat: 12.8601234, lng: 77.6601234 });
    expect(parseMapUrlCoordinates('https://www.google.com/maps/place/x/data=!4m2!3d12.9!4d77.6!5m1'))
      .toEqual({ lat: 12.9, lng: 77.6 });
    expect(parseMapUrlCoordinates('https://maps.google.com/?q=12.9716,77.5946'))
      .toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(parseMapUrlCoordinates('https://www.google.com/maps/search/?api=1&query=not-coords')).toBeNull();
  });

  it('decodes a full Google Plus Code', () => {
    expect(looksLikePlusCode('849VCWC8+R9')).toBe(true);
    expect(looksLikePlusCode('XJ2M+2M')).toBe(false);
    const p = decodePlusCode('849VCWC8+R9');
    expect(p.lat).toBeCloseTo(37.422, 3);
    expect(p.lng).toBeCloseTo(-122.084, 3);
    expect(decodePlusCode('not-a-code')).toBeNull();
  });
});
