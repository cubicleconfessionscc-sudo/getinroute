/* Google Maps deep links.
   No API key and no billing required — these are plain maps.google.com URLs.

   Coordinates win over free-text: Google pins an exact point, whereas an
   address string can land on the wrong branch of the same street or a
   same-named locality. The address text is only used as a fallback when no
   coordinates exist on record. */

function hasCoords({ lat, lng } = {}) {
  return (
    lat != null && lng != null &&
    !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))
  );
}

/** Exact pin when coordinates exist, otherwise the address text. null when neither. */
export function googleMapsUrl(loc) {
  if (!loc) return null;
  if (hasCoords(loc)) {
    return `https://www.google.com/maps/search/?api=1&query=${Number(loc.lat)},${Number(loc.lng)}`;
  }
  const q = String(loc.address || '').trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** Turn-by-turn directions to the point (Google Maps app or browser). */
export function googleMapsDirUrl(loc) {
  if (!loc) return null;
  if (hasCoords(loc)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(loc.lat)},${Number(loc.lng)}`;
  }
  const q = String(loc.address || '').trim();
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null;
}
