import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { X } from 'lucide-react';

/* ---------- Toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = (msg, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, msg, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3800);
  };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.type === 'ok' ? '✓' : t.type === 'err' ? '✕' : 'ℹ'} {t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, title, onClose, children, wide }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : {}} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({ color = 'slate', children }) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}

export const statusColor = (s) => {
  const map = {
    approved: 'green', pending: 'amber', rejected: 'red', active: 'green', inactive: 'slate',
    completed: 'green', confirmed: 'blue', scheduled: 'violet', in_progress: 'pink', cancelled: 'red', idle: 'slate'
  };
  return map[s] || 'slate';
};
export const statusLabel = (s) => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ---------- Map ---------- */
const fixIcons = () => {
  L.Icon.Default.mergeOptions({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
  });
};
fixIcons();

const vehIcon = L.divIcon({ className: '', html: '<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.3)"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
const empIcon = L.divIcon({ className: '', html: '<div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);border:2.5px solid #fff;box-shadow:0 4px 10px rgba(0,0,0,.3)"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
const stopIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#fff;border:4px solid #f59e0b;box-shadow:0 3px 8px rgba(0,0,0,.25)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function FocusController({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus && focus.lat && focus.lng) {
      map.flyTo([focus.lat, focus.lng], 15, { duration: 1.2 });
    }
  }, [focus?.lat, focus?.lng]);
  return null;
}

const toArr = (v) => (Array.isArray(v) ? v : []);

export function LiveMap({ center, zoom = 12, stops, vehicles, employees, polyline, height = '420px', focus = null }) {
  const safeStops = toArr(stops);
  const safeVehicles = toArr(vehicles);
  const safeEmployees = toArr(employees);
  const safePolyline = toArr(polyline);
  const companyIcon = L.divIcon({
    html: '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">C</div>',
    className: '', iconSize: [28, 28], iconAnchor: [14, 14]
  });
  const pos = center || (safeStops[0] ? [safeStops[0].lat, safeStops[0].lng] : [12.9716, 77.5946]);
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={pos} zoom={zoom} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
        <FocusController focus={focus} />
        {safeStops.map((s, i) => (
          <Marker key={i} position={[s.lat, s.lng]} icon={stopIcon}>
            <Popup><b>{i + 1}. {s.name}</b></Popup>
          </Marker>
        ))}
        {safeStops.length > 1 && <Polyline positions={safeStops.map((s) => [s.lat, s.lng])} pathOptions={{ color: '#7c3aed', weight: 4, opacity: 0.7, dashArray: '6 8' }} />}
        {safePolyline.length > 1 && <Polyline positions={safePolyline} pathOptions={{ color: '#4f46e5', weight: 5 }} />}
        {safeVehicles.map((v) => v.lat && v.lng ? (
          <Marker key={`v${v.id}`} position={[v.lat, v.lng]} icon={v.type === 'company' ? companyIcon : vehIcon}>
            <Popup>
              <b>{v.vehicle_name || v.name}</b><br />{v.plate || v.email || ''}<br />
              {v.type === 'company' ? `Department: ${v.department || ''}` : <>Driver: {v.driver_name}<br />{v.speed != null && `Speed: ${Math.round(v.speed)} km/h`}</>}
              {v.route_name && <><br />Route: {v.route_name}</>}
            </Popup>
          </Marker>
        ) : null)}
        {safeEmployees.map((e) => e.lat && e.lng ? (
          <CircleMarker key={`e${e.id}`} center={[e.lat, e.lng]} radius={7} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.85, weight: 2 }}>
            <Popup><b>{e.name}</b>{e.emp_id ? <><br />{e.emp_id}</> : null}</Popup>
          </CircleMarker>
        ) : null)}
      </MapContainer>
    </div>
  );
}

/* ---------- useInterval hook ---------- */
export function useInterval(fn, ms) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
