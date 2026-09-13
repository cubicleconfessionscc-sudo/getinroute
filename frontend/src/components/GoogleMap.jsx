import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, getGoogleMapsKey, mapErrorMessage } from '../lib/gmaps';

const PIN_URL = (color) => `https://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;

const COLORS = {
  green: 'green', red: 'red', blue: 'blue', amber: 'orange', violet: 'purple', indigo: 'purple', default: 'orange'
};

export function MapConfigError({ detail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', justifyContent: 'center', minHeight: 180, padding: 24, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'color-mix(in srgb, var(--bg) 40%, transparent)', color: 'var(--text)' }}>
      <b style={{ fontSize: 15 }}>Google Maps is not configured</b>
      <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 560 }}>
        {detail || 'Set the GOOGLE_MAPS_API_KEY environment variable (or VITE_GOOGLE_MAPS_API_KEY) on the server, then reload.'}
      </div>
    </div>
  );
}

export default function GoogleMap({
  markers = [],
  lines = [],
  center,
  zoom = 12,
  height = '420px',
  onPick = null,
  onMarkerDrag = null,
  focus = null,
  fit = true,
  clickableMarkers = true
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const gRef = useRef(null);
  const mkRef = useRef([]);
  const polyRef = useRef([]);
  const [status, setStatus] = useState('loading'); // loading | error | ready
  const [errMsg, setErrMsg] = useState('');
  const [noKey, setNoKey] = useState(false);
  // Tracks the latest prop set for effect-less handlers:
  const live = useRef({ onPick, onMarkerDrag, clickableMarkers });
  live.current = { onPick, onMarkerDrag, clickableMarkers };

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let map;
    (async () => {
      const key = await getGoogleMapsKey();
      if (cancelled) return;
      if (!key) { setNoKey(true); setStatus('error'); return; }
      try {
        const g = await loadGoogleMaps();
        if (cancelled || !g || !ref.current) return;
        gRef.current = g;
        const el = ref.current;
        const pos = focus || center || (markers[0] && { lat: markers[0].lat, lng: markers[0].lng }) || { lat: 12.9716, lng: 77.5946 };
        map = new g.maps.Map(el, {
          center: { lat: Number(pos.lat) || 12.9716, lng: Number(pos.lng) || 77.5946 },
          zoom: focus ? 15 : (zoom || 12),
          mapTypeId: g.maps.MapTypeId.ROADMAP,
          fullscreenControl: true,
          mapTypeControl: false,
          streetViewControl: false
        });
        mapRef.current = map;
        if (live.current.onPick) {
          map.addListener('click', (e) => { live.current.onPick(e.latLng.lat(), e.latLng.lng()); });
        }
        setStatus('ready');
        applyData(map, g);
      } catch (e) {
        if (!cancelled) { setNoKey(false); setStatus('error'); setErrMsg(mapErrorMessage(e)); }
      }
    })();
    return () => {
      cancelled = true;
      mkRef.current.forEach((m) => { try { m.setMap(null); } catch {} });
      polyRef.current.forEach((p) => { try { p.setMap(null); } catch {} });
      mkRef.current = [];
      polyRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyData(map, g) {
    mkRef.current.forEach((m) => { try { m.setMap(null); } catch {} });
    polyRef.current.forEach((p) => { try { p.setMap(null); } catch {} });
    mkRef.current = [];
    polyRef.current = [];
    const infoWin = new g.maps.InfoWindow();

    const makeIcon = (c) => {
      const mc = COLORS[c] || 'orange';
      return { url: PIN_URL(mc), scaledSize: new g.maps.Size(32, 32), anchor: new g.maps.Point(16, 32) };
    };

    markers.forEach((m) => {
      if (m.lat == null || m.lng == null || Number.isNaN(Number(m.lat))) return;
      const marker = new g.maps.Marker({
        position: { lat: Number(m.lat), lng: Number(m.lng) },
        map,
        title: m.title || m.label || '',
        icon: makeIcon(m.color || 'default'),
        draggable: !!onMarkerDrag
      });
      if (m.label) {
        marker.setLabel({ text: String(m.label), color: '#ffffff', fontSize: '12px', fontWeight: '700' });
      }
      if (m.info) {
        marker.addListener('click', (e) => {
          infoWin.setContent(`<div style="font-family:inherit;font-size:13px;padding:2px"><b>${m.info.title || ''}</b>${m.info.body ? '<br/>' + m.info.body : ''}</div>`);
          infoWin.open(map, marker);
        });
      }
      if (onMarkerDrag) {
        marker.addListener('dragend', (e) => {
          live.current.onMarkerDrag(m.id, e.latLng.lat(), e.latLng.lng());
        });
      }
      mkRef.current.push(marker);
    });

    lines.forEach((ln) => {
      const path = (ln.path || []).filter((p) => p && p.lat != null && p.lng != null);
      if (path.length >= 2) {
        polyRef.current.push(new g.maps.Polyline({
          path: path.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
          map,
          geodesic: true,
          strokeColor: ln.color || '#4f46e5',
          strokeOpacity: (ln.opacity == null ? 0.9 : ln.opacity),
          strokeWeight: ln.weight || 4,
          strokeDashStyle: ln.dash ? 'dash' : undefined
        }));
      }
    });

    if (fit && mkRef.current.length) {
      const b = new g.maps.LatLngBounds();
      mkRef.current.forEach((m) => b.extend(m.getPosition()));
      polyRef.current.forEach((p) => p.getPath().forEach((ll) => b.extend(ll)));
      try { map.fitBounds(b, 60); } catch {}
    }
  }

  // Re-apply on data change without recreating the map.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !gRef.current) return;
    applyData(mapRef.current, gRef.current);
  }, [JSON.stringify(markers), JSON.stringify(lines)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus change.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !focus || !focus.lat) return;
    mapRef.current.panTo({ lat: Number(focus.lat), lng: Number(focus.lng) });
    mapRef.current.setZoom(15);
  }, [status, focus && focus.lat, focus && focus.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {status === 'loading' && <div className="map-box" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', borderRadius: 12, border: '1.5px solid var(--line)' }}>Loading Google Maps…</div>}
      {status === 'error' && <MapConfigError detail={errMsg} />}
      <div ref={ref} style={{ height, width: '100%', borderRadius: 12, border: '1.5px solid var(--line)', display: status === 'ready' ? 'block' : 'none', zIndex: 0, position: 'relative' }} />
    </div>
  );
}