import React, { useEffect, useState } from 'react';
import { resolveAddress, isCoordsOnly, coordLabel } from '../lib/geo';

/* Address-name display primitive.
   Shows the human address instead of raw latitude/longitude. When only
   coordinates exist on record it resolves a name once (shared cache in
   lib/geo, so a screen with twenty rows makes at most one request per
   distinct point). Coordinates appear only as a last resort — when the
   provider cannot name the point at all. */

export { resolveAddress, isCoordsOnly, coordLabel };

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function LocationText({ lat, lng, address, max = 140, fallback = 'coords', style }) {
  const stored = String(address || '').trim();
  const usable = stored && !isCoordsOnly(stored) ? stored : '';
  const hasCoords = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));
  const needsLookup = !usable && hasCoords && fallback === 'coords';
  // undefined = lookup not finished yet; '' = provider could not name the point.
  const [resolved, setResolved] = useState(undefined);

  useEffect(() => {
    if (!needsLookup) return undefined;
    setResolved(undefined);
    let alive = true;
    resolveAddress(lat, lng).then((addr) => { if (alive) setResolved(addr || ''); });
    return () => { alive = false; };
  }, [needsLookup, lat, lng]);

  const shown = usable || resolved || '';
  if (shown) {
    return (
      <span title={shown} style={style}>
        {truncate(shown, max)}
      </span>
    );
  }
  if (needsLookup && resolved === undefined) {
    return <span style={{ ...style, color: 'var(--muted)' }}>Locating address…</span>;
  }
  const coords = coordLabel(lat, lng);
  if (coords) return <span title={coords} style={style}>{coords}</span>;
  return <span style={style}>—</span>;
}
