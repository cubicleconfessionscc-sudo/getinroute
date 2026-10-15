import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { LocateFixed, MapPin, Check } from 'lucide-react';

let mapsPromise;
function loadMaps(key) {
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
    script.async = true;
    script.onload = () => window.google?.maps?.places ? resolve(window.google.maps) : reject(new Error('Google Places API did not load.'));
    script.onerror = () => reject(new Error('Google Maps failed to load. Check the API key and Places API configuration.'));
    document.head.appendChild(script);
  });
  return mapsPromise;
}

export default function GoogleLocationPickerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('returnToken') || '';
  const radius = Math.max(1, Number(params.get('radius')) || 1000);
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [key, setKey] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const initial = {
      address: params.get('address') || '',
      lat: params.has('lat') ? Number(params.get('lat')) : null,
      lng: params.has('lng') ? Number(params.get('lng')) : null,
      place_id: params.get('place_id') || ''
    };
    if (initial.lat != null && initial.lng != null) setSelected(initial);
    api.get('/api/config/public')
      .then((cfg) => {
        if (!cfg?.googleMapsKey) { setError('Google Maps key not configured'); setLoading(false); return; }
        setKey(cfg.googleMapsKey);
        setLoading(false);
      })
      .catch(() => { setError('Google Maps key not configured'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!key || !mapDiv.current) return undefined;
    let cancelled = false;
    loadMaps(key).then((maps) => {
      if (cancelled || !mapDiv.current) return;
      const center = selected?.lat != null ? { lat: Number(selected.lat), lng: Number(selected.lng) } : { lat: 12.9716, lng: 77.5946 };
      const map = new maps.Map(mapDiv.current, { center, zoom: selected?.lat != null ? 15 : 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      mapRef.current = map;
      const marker = new maps.Marker({ map, position: center, draggable: true, title: 'Selected address' });
      markerRef.current = marker;
      const circle = new maps.Circle({ map, center, radius, fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeOpacity: 0.75, strokeWeight: 1 });
      circleRef.current = circle;
      const geocoder = new maps.Geocoder();
      const selectPoint = (lat, lng, address = '', placeId = '') => {
        const point = { lat: Number(lat), lng: Number(lng) };
        marker.setPosition(point); map.panTo(point); circle.setCenter(point);
        setSelected((prev) => ({ ...(prev || {}), address: address || prev?.address || '', lat: point.lat, lng: point.lng, place_id: placeId || prev?.place_id || '' }));
      };
      marker.addListener('dragend', (event) => {
        const p = event.latLng;
        geocoder.geocode({ location: p }, (results, status) => {
          const item = status === 'OK' && results?.[0] ? results[0] : null;
          selectPoint(p.lat(), p.lng(), item?.formatted_address || '', item?.place_id || '');
        });
      });
      map.addListener('click', (event) => {
        const p = event.latLng;
        geocoder.geocode({ location: p }, (results, status) => {
          const item = status === 'OK' && results?.[0] ? results[0] : null;
          selectPoint(p.lat(), p.lng(), item?.formatted_address || '', item?.place_id || '');
        });
      });
      const input = document.querySelector('[data-testid="google-address-search"]');
      if (input) {
        const ac = new maps.places.Autocomplete(input, { fields: ['formatted_address', 'geometry', 'place_id'] });
        autocompleteRef.current = ac;
        ac.bindTo('bounds', map);
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place?.geometry?.location) { setError('Choose a result from the Google Places list.'); return; }
          setError('');
          selectPoint(place.geometry.location.lat(), place.geometry.location.lng(), place.formatted_address || '', place.place_id || '');
        });
      }
    }).catch((e) => { if (!cancelled) setError(e.message || 'Google Maps failed to load.'); });
    return () => { cancelled = true; };
  }, [key]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const maps = window.google?.maps;
      if (!maps) return;
      new maps.Geocoder().geocode({ location: { lat: p.coords.latitude, lng: p.coords.longitude } }, (results, status) => {
        const r = status === 'OK' && results?.[0] ? results[0] : null;
        const point = { lat: p.coords.latitude, lng: p.coords.longitude };
        markerRef.current?.setPosition(point); mapRef.current?.panTo(point); circleRef.current?.setCenter(point);
        setSelected({ address: r?.formatted_address || '', ...point, place_id: r?.place_id || '' });
      });
    }, () => setError('Could not get your location. Check browser location permission.'), { enableHighAccuracy: true, timeout: 10000 });
  };

  const confirm = () => {
    if (!selected || selected.lat == null || selected.lng == null || !selected.address) {
      setError('Select a Google Places result or reverse-geocoded map point first.');
      return;
    }
    const result = { type: 'GETINROUTE_MAP_LOCATION', returnToken: token, address: selected.address, lat: Number(selected.lat), lng: Number(selected.lng), place_id: selected.place_id || '' };
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(result, window.location.origin);
      window.close();
    } else {
      // Same-tab fallback for embedded/mobile webviews or popup-blocking browsers.
      sessionStorage.setItem(`nodal-map-result:${token}`, JSON.stringify(result));
      navigate('/admin/settings', { replace: true });
    }
  };

  return (
    <main style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#f8fafc', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, flex: 1 }}>Select company address on Google Maps</h1>
        <button type="button" className="btn btn-outline" onClick={useMyLocation}><LocateFixed size={16} /> Use my location</button>
      </header>
      {error && <div role="alert" style={{ padding: 12, borderRadius: 8, background: '#fff1f2', color: '#be123c', fontWeight: 700 }}>{error}</div>}
      {loading && <div>Loading Google Maps…</div>}
      {!loading && error === 'Google Maps key not configured' ? (
        <section style={{ padding: 24, background: 'white', borderRadius: 12 }}>Google Maps key not configured</section>
      ) : (
        <>
          <input data-testid="google-address-search" aria-label="Search address" placeholder="Search an address or place" style={{ padding: 12, border: '1px solid #94a3b8', borderRadius: 8, fontSize: 16, width: '100%' }} />
          <div ref={mapDiv} data-testid="google-map" style={{ flex: 1, minHeight: 300, borderRadius: 12, overflow: 'hidden', background: '#e2e8f0' }} />
          <section aria-live="polite" style={{ background: 'white', borderRadius: 10, padding: 12, fontSize: 13 }}>
            <div><b>Address:</b> {selected?.address || 'Not selected'}</div>
            <div><b>Latitude:</b> {selected?.lat ?? '—'} &nbsp; <b>Longitude:</b> {selected?.lng ?? '—'}</div>
            <div><b>Place ID:</b> {selected?.place_id || '—'}</div>
            <div><MapPin size={14} style={{ verticalAlign: 'middle' }} /> Radius on map: {radius} m</div>
          </section>
          <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={() => window.opener ? window.close() : navigate(-1)}>Cancel</button>
            <button type="button" data-testid="confirm-location" className="btn btn-primary" disabled={!selected?.address || selected?.lat == null || selected?.lng == null} onClick={confirm}><Check size={16} /> Confirm location</button>
          </footer>
        </>
      )}
    </main>
  );
}
