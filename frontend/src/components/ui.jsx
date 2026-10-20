import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import MapLibreMap from './MapLibreMap';

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

/* ---------- Map (MapLibre GL JS) ---------- */
export function LiveMap({ center, zoom = 12, stops, vehicles, employees, polyline, height = '420px', focus = null }) {
  const safeStops = Array.isArray(stops) ? stops : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];
  const safeEmployees = Array.isArray(employees) ? employees : [];
  const safePolyline = Array.isArray(polyline) ? polyline : [];
  const markers = [];
  safeStops.forEach((s, i) => {
    if (s && s.lat != null && s.lng != null) {
      markers.push({
        id: `s${i}`, lat: Number(s.lat), lng: Number(s.lng), label: String(i + 1), color: 'amber',
        title: `${i + 1}. ${s.name || ''}`,
        // Popups show the address name; raw coordinates only as a last resort,
        // plus a Google Maps deep link (no key needed) to open the stop.
        info: {
          title: `${i + 1}. ${s.name || 'Stop'}`,
          body: [
            s.address || `${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}`,
            `<a href="https://www.google.com/maps/search/?api=1&query=${Number(s.lat)},${Number(s.lng)}" target="_blank" rel="noreferrer">View on Google Maps</a>`
          ].join('<br/>')
        }
      });
    }
  });
  safeVehicles.forEach((v) => {
    if (v && v.lat != null && v.lng != null) {
      const body = [v.plate || v.email];
      if (v.type === 'company') body.push(v.department ? `Department: ${v.department}` : 'Company vehicle');
      else body.push(v.driver_name ? `Driver: ${v.driver_name}` : '');
      if (v.speed != null) body.push(`Speed: ${Math.round(v.speed)} km/h`);
      if (v.route_name) body.push(`Route: ${v.route_name}`);
      markers.push({
        id: `v${v.id || v._id || v.vehicle_name}`,
        lat: Number(v.lat), lng: Number(v.lng),
        label: v.type === 'company' ? 'C' : '',
        color: v.type === 'company' ? 'indigo' : 'blue',
        title: v.vehicle_name || v.name || 'Vehicle',
        info: { title: v.vehicle_name || v.name || 'Vehicle', body: body.filter(Boolean).join('<br/>') }
      });
    }
  });
  safeEmployees.forEach((e) => {
    if (e && e.lat != null && e.lng != null) {
      markers.push({
        id: `e${e.id || e._id}`,
        lat: Number(e.lat), lng: Number(e.lng),
        color: 'green', title: e.name || '',
        info: { title: e.name || '', body: e.emp_id ? e.emp_id : (e.home_address || e.address || '') }
      });
    }
  });
  const lines = [];
  if (safeStops.length > 1) lines.push({ path: safeStops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })), color: '#7c3aed', dash: true, opacity: 0.7, weight: 4 });
  if (safePolyline.length > 1) lines.push({ path: safePolyline, color: '#4f46e5', weight: 5 });
  return <MapLibreMap markers={markers} lines={lines} center={center} zoom={zoom} height={height} focus={focus} />;
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
