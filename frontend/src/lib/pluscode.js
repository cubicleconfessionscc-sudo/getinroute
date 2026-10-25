/* Open Location Code (Google Plus Code) decoder.
 *
 * Google Maps lets you copy a Plus Code (e.g. "7J4VXJ2M+2M") instead of a full
 * address. Decoding is a pure, keyless calculation. Only full global codes
 * (8+ characters before the '+') are decoded; short codes that need a
 * reference location are rejected rather than guessed.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';

export function looksLikePlusCode(text) {
  const s = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  const plus = s.indexOf('+');
  if (plus < 0) return false;
  const before = s.slice(0, plus);
  const after = s.slice(plus + 1);
  return /^[23456789CFGHJMPQRVWX]{8}$/.test(before)
    && /^[23456789CFGHJMPQRVWX]{0,3}$/.test(after);
}

export function decodePlusCode(text) {
  const s = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!looksLikePlusCode(s)) return null;
  const plus = s.indexOf('+');
  const chars = (s.slice(0, plus) + s.slice(plus + 1)).slice(0, 10);
  let lat = -90;
  let lng = -180;
  let res = 20;
  let cell = 20;
  for (let i = 0; i + 1 < chars.length; i += 2) {
    const latIdx = ALPHABET.indexOf(chars[i]);
    const lngIdx = ALPHABET.indexOf(chars[i + 1]);
    if (latIdx < 0 || lngIdx < 0) return null;
    lat += latIdx * res;
    lng += lngIdx * res;
    cell = res;
    res /= 20;
  }
  // Decoded values are the south-west corner; return the centre of the cell.
  return { lat: lat + cell / 2, lng: lng + cell / 2 };
}
