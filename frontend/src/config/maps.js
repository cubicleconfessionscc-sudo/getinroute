/* GetInRoute Map Configuration
   Single source of truth for map rendering, geocoding, and routing providers.
   All provider URLs are configurable via Vite env vars.
   Default tile style: OpenFreeMap "liberty" (free, no key, commercially permitted). */

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export const MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_STYLE;

export const MAP_DEFAULTS = {
  center: [77.5946, 12.9716], // Bengaluru [lng, lat] for MapLibre
  zoom: 12,
  maxZoom: 19,
  minZoom: 3
};

export const MARKER_COLORS = {
  green: '#22c55e',
  red: '#ef4444',
  blue: '#3b82f6',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  indigo: '#6366f1',
  pink: '#ec4899',
  slate: '#64748b',
  default: '#f59e0b'
};

export const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://openfreemap.org">OpenFreeMap</a>';
