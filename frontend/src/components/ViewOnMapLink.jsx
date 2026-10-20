import React from 'react';
import { ExternalLink } from 'lucide-react';
import { googleMapsUrl } from '../lib/mapsUrl';

/* "View on Google Maps" for any saved/picked location.
   Deep link only — no API key, no billing, opens the Google Maps app on mobile
   and the website on desktop. Renders nothing when there is nothing to show. */

export default function ViewOnMapLink({ lat, lng, address, label = 'View on Google Maps', style }) {
  const href = googleMapsUrl({ lat, lng, address });
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: 'var(--primary)',
        fontWeight: 600,
        textDecoration: 'none',
        ...style
      }}
    >
      <ExternalLink size={12} style={{ flexShrink: 0 }} />
      {label}
    </a>
  );
}
