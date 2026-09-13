import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_URL, MAP_DEFAULTS, MARKER_COLORS, ATTRIBUTION } from '../config/maps';

export function MapError({ detail, onRetry }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 180, padding: 24, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'color-mix(in srgb, var(--bg) 40%, transparent)', color: 'var(--text)' }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Map unavailable</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 420, textAlign: 'center' }}>
        {detail || 'We couldn\u2019t load the map right now.'}
      </div>
      {onRetry && <button className="btn btn-outline" onClick={onRetry} style={{ marginTop: 4 }}>Retry</button>}
    </div>
  );
}

export function MapConfigError({ detail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', justifyContent: 'center', minHeight: 180, padding: 24, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'color-mix(in srgb, var(--bg) 40%, transparent)', color: 'var(--text)' }}>
      <b style={{ fontSize: 15 }}>Map configuration unavailable</b>
      <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 560 }}>
        {detail || 'Please contact the system administrator.'}
      </div>
    </div>
  );
}

function createMarkerEl(label, colorHex) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:' + colorHex + ';box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:pointer;position:relative;';
  if (label) {
    const span = document.createElement('span');
    span.textContent = String(label);
    span.style.cssText = 'color:#fff;font-size:11px;font-weight:700;line-height:1;pointer-events:none;';
    el.appendChild(span);
  }
  return el;
}

export default function MapLibreMap({
  markers = [],
  lines = [],
  center,
  zoom = MAP_DEFAULTS.zoom,
  height = '420px',
  onPick = null,
  onMarkerDrag = null,
  focus = null,
  fit = true,
  clickableMarkers = true
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerInstances = useRef([]);
  const popupRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errMsg, setErrMsg] = useState('');
  const live = useRef({ onPick, onMarkerDrag, clickableMarkers });
  live.current = { onPick, onMarkerDrag, clickableMarkers };

  const initMap = useCallback(() => {
    if (!containerRef.current || mapRef.current) return;
    setStatus('loading');
    setErrMsg('');
    try {
      const pos = focus || center || (markers[0] && { lat: markers[0].lat, lng: markers[0].lng });
      const centerArr = pos
        ? [Number(pos.lng) || MAP_DEFAULTS.center[0], Number(pos.lat) || MAP_DEFAULTS.center[1]]
        : MAP_DEFAULTS.center;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: centerArr,
        zoom: focus ? 15 : (zoom || MAP_DEFAULTS.zoom),
        maxZoom: MAP_DEFAULTS.maxZoom,
        minZoom: MAP_DEFAULTS.minZoom,
        attributionControl: true
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-left');

      map.on('error', (e) => {
        console.warn('[GetInRoute] MapLibre error:', e.error?.message || e.message);
      });

      map.on('load', () => {
        setStatus('ready');
        applyData(map);
      });

      map.on('style.error', () => {
        if (status !== 'ready') {
          setErrMsg('Failed to load map style. Check the tile provider configuration.');
          setStatus('error');
        }
      });

      if (live.current.onPick) {
        map.on('click', (e) => {
          if (e.originalEvent?.target?.closest('.maplibregl-marker')) return;
          live.current.onPick(e.lngLat.lat, e.lngLat.lng);
        });
      }

      mapRef.current = map;
    } catch (e) {
      setErrMsg(e.message || 'Failed to initialize map');
      setStatus('error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const observer = new ResizeObserver(() => {
      if (mapRef.current && !cancelled) {
        try { mapRef.current.resize(); } catch {}
      }
    });
    observer.observe(containerRef.current);

    initMap();

    return () => {
      cancelled = true;
      observer.disconnect();
      clearMarkers();
      if (popupRef.current) { try { popupRef.current.remove(); } catch {} popupRef.current = null; }
      if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function clearMarkers() {
    markerInstances.current.forEach((m) => { try { m.remove(); } catch {} });
    markerInstances.current = [];
  }

  function applyData(map) {
    clearMarkers();
    if (popupRef.current) { try { popupRef.current.remove(); } catch {} popupRef.current = null; }

    markers.forEach((m) => {
      if (m.lat == null || m.lng == null || isNaN(Number(m.lat))) return;
      const colorHex = MARKER_COLORS[m.color] || MARKER_COLORS.default;
      const el = createMarkerEl(m.label, colorHex);
      const mk = new maplibregl.Marker({ element: el, draggable: !!onMarkerDrag })
        .setLngLat([Number(m.lng), Number(m.lat)])
        .addTo(map);

      if (m.title) el.setAttribute('title', m.title);

      if (m.info && clickableMarkers) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (popupRef.current) { try { popupRef.current.remove(); } catch {} }
          const popup = new maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: '280px' })
            .setHTML(`<div style="font-family:inherit;font-size:13px;padding:2px"><b>${m.info.title || ''}</b>${m.info.body ? '<br/>' + m.info.body : ''}</div>`);
          popup.setLngLat([Number(m.lng), Number(m.lat)]).addTo(map);
          popupRef.current = popup;
        });
      }

      if (onMarkerDrag) {
        mk.on('dragend', () => {
          const ll = mk.getLngLat();
          live.current.onMarkerDrag(m.id, ll.lat, ll.lng);
        });
      }

      markerInstances.current.push(mk);
    });

    if (lines && lines.length) {
      const features = [];
      lines.forEach((ln) => {
        const coords = (ln.path || []).filter((p) => p && p.lat != null && p.lng != null)
          .map((p) => [Number(p.lng), Number(p.lat)]);
        if (coords.length >= 2) {
          features.push({
            type: 'Feature',
            properties: { color: ln.color || '#4f46e5', weight: ln.weight || 4, dash: ln.dash || false, opacity: ln.opacity ?? 0.9 },
            geometry: { type: 'LineString', coordinates: coords }
          });
        }
      });

      if (features.length) {
        if (map.getLayer('route-lines')) map.removeLayer('route-lines');
        if (map.getSource('route-lines')) map.removeSource('route-lines');
        map.addSource('route-lines', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        map.addLayer({
          id: 'route-lines',
          type: 'line',
          source: 'route-lines',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'weight'],
            'line-opacity': ['get', 'opacity'],
            'line-dasharray': ['case', ['get', 'dash'], [6, 3], [1, 0]]
          }
        });
      }
    } else {
      if (map.getLayer('route-lines')) map.removeLayer('route-lines');
      if (map.getSource('route-lines')) map.removeSource('route-lines');
    }

    if (fit && markerInstances.current.length) {
      const bounds = new maplibregl.LngLatBounds();
      markerInstances.current.forEach((mk) => bounds.extend(mk.getLngLat()));
      lines.forEach((ln) => {
        (ln.path || []).forEach((p) => {
          if (p && p.lat != null && p.lng != null) bounds.extend([Number(p.lng), Number(p.lat)]);
        });
      });
      try { map.fitBounds(bounds, { padding: 60, maxZoom: 15 }); } catch {}
    }
  }

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    applyData(mapRef.current);
  }, [JSON.stringify(markers), JSON.stringify(lines)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !focus || !focus.lat) return;
    mapRef.current.flyTo({ center: [Number(focus.lng), Number(focus.lat)], zoom: 15, duration: 800 });
  }, [status, focus?.lat, focus?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {status === 'loading' && (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', borderRadius: 12, border: '1.5px solid var(--line)' }}>
          Loading map\u2026
        </div>
      )}
      {status === 'error' && <MapError detail={errMsg} onRetry={() => { mapRef.current = null; initMap(); }} />}
      <div
        ref={containerRef}
        style={{
          height,
          width: '100%',
          borderRadius: 12,
          border: '1.5px solid var(--line)',
          display: status === 'ready' ? 'block' : 'none',
          zIndex: 0,
          position: 'relative'
        }}
      />
    </div>
  );
}
