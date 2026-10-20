import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Modal, Badge, useToast } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import MapPicker from '../../components/MapPicker';
import LocationText from '../../components/LocationText';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import { calculateRoute, pickLocation } from '../../lib/geo';
import { Plus, Pencil, Trash2, Route as RouteIcon, GripVertical, MapPin, MapPinned, User, Navigation, Loader2, Wand2, Play, CalendarClock } from 'lucide-react';

// A route is built from a Route Type (LOGIN / LOGOUT) + an office + an editable
// ordered list of employee stops. LOGIN => first employee → office;
// LOGOUT => office → last employee. Legacy routes keep type CUSTOM (manual
// start/end). stops[] = [{ sequence, employee_id, emp_id, employee_name, name, lat, lng }]
// Admin route form: name + Vendor + office only (type/employees are the Vendor's).
const emptyRoute = { name: '', vendor_id: null, office_point_id: null, office_label: '', office_lat: null, office_lng: null, route_type: 'LOGIN', stops: [], start_point: '', end_point: '', speed_limit: 40, start_lat: null, start_lng: null, end_lat: null, end_lng: null };

export default function RoutesPage() {
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';
  const toast = useToast();
  const [routes, setRoutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [offices, setOffices] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [modal, setModal] = useState(false);
  const [vendorConfig, setVendorConfig] = useState(null); // route being configured by the Vendor
  const [form, setForm] = useState(emptyRoute);
  const [editing, setEditing] = useState(null);
  const [mapFor, setMapFor] = useState(null); // null | 'start' | 'end' | stopIndex
  const [dragIdx, setDragIdx] = useState(null);
  const [empPick, setEmpPick] = useState('');
  const [assign, setAssign] = useState(null);
  const [selEmps, setSelEmps] = useState([]);
  const [pushDate, setPushDate] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [dir, setDir] = useState(null); // { status: 'OK'|'ERROR'|'not-configured', ... }
  const [dirLoading, setDirLoading] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [optId, setOptId] = useState(null);
  const [autoRun, setAutoRun] = useState(null);
  const [genDate, setGenDate] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  // Explicit "Create Trip" (operational run) — separate from route creation.
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tripFor, setTripFor] = useState(null);
  const [tripForm, setTripForm] = useState({ date: '', vehicle_id: '', driver_id: '', pickup_time: '08:00', drop_time: '18:00' });
  const [tripBusy, setTripBusy] = useState(false);

  const asArr = (r) => (Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : []));
  const load = () => {
    api.get('/api/admin/routes').then((r) => setRoutes(asArr(r))).catch(() => {});
    api.get('/api/admin/users?role=employee').then((rows) => setEmployees(asArr(rows))).catch(() => {});
    api.get('/api/v3/routes/auto-run').then((s) => setAutoRun(s || null)).catch(() => setAutoRun(null));
    api.get('/api/admin/vehicles').then((r) => setVehicles(asArr(r))).catch(() => {});
    api.get('/api/admin/drivers/all').then((r) => setDrivers(asArr(r))).catch(() => {});
    // Office locations reuse the company's existing nodal points (type='office').
    api.get('/api/company/me/nodal-points').then((r) => setOffices((asArr(r)).filter((p) => !p.type || p.type === 'office'))).catch(() => setOffices([]));
    // Vendors the Admin can assign a route to (reuses the existing vendors API).
    api.get('/api/admin/vendors').then((r) => setVendors(asArr(r))).catch(() => setVendors([]));
  };

  const openTrip = (r) => {
    setTripFor(r);
    setTripForm({ date: new Date().toISOString().slice(0, 10), vehicle_id: '', driver_id: '', pickup_time: '08:00', drop_time: '18:00' });
  };

  // Creates the operational trip/run for a route's employees on a date. This is
  // the ONLY place a trip is created from a route — never during route creation.
  const createTrip = async () => {
    if (!tripFor) return;
    if (!tripForm.date) return toast('Please select a date.', 'err');
    const emps = (tripFor.employees || []).map((e) => Number(e.employee_id ?? e.id)).filter(Boolean);
    if (!emps.length) return toast('This route has no employees yet — assign employees first.', 'err');
    setTripBusy(true);
    let created = 0;
    try {
      for (const eid of emps) {
        try {
          await api.post('/api/admin/schedules', {
            employee_id: eid,
            route_id: tripFor.id,
            vehicle_id: tripForm.vehicle_id ? Number(tripForm.vehicle_id) : undefined,
            driver_id: tripForm.driver_id ? Number(tripForm.driver_id) : undefined,
            date: tripForm.date,
            pickup_time: tripForm.pickup_time || undefined,
            drop_time: tripForm.drop_time || undefined
          });
          created += 1;
        } catch (e) {
          toast(`${employees.find((x) => String(x.id) === String(eid))?.name || 'Employee'}: ${e.response?.data?.error || e.message}`, 'err');
        }
      }
      toast(created
        ? `✓ Trip created — ${created} stop${created === 1 ? '' : 's'} scheduled for ${tripForm.date}. It now appears in All Trips & Cab Runs.`
        : 'No trips created.');
      if (created) setTripFor(null);
    } finally { setTripBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const runAutoAssign = async () => {
    if (autoBusy) return;
    setAutoBusy(true);
    try {
      const res = await api.post('/api/v3/routes/auto-assign', {});
      const n = (res && (res.assigned || []).length) || 0;
      toast(res && res.message ? res.message : (n ? `Auto-assigned ${n} employee(s) to the nearest route` : 'No unassigned employees — everyone is already on a route'));
      setAutoRun(res && res.autoRun);
      load();
    } catch (e) { toast(e.message || 'Auto-assign failed', 'err'); } finally { setAutoBusy(false); }
  };

  const optimizeRoute = async (r) => {
    setOptId(r.id);
    try {
      const res = await api.post(`/api/v3/routes/${r.id}/optimize`, {});
      toast(res && res.optimized ? `Route "${r.name}" pickup/drop order optimized` : 'Route order already optimal');
      load();
    } catch (e) { toast(e.message || 'Optimize failed', 'err'); } finally { setOptId(null); }
  };

  const saveAutoRun = async (patch) => {
    const next = { ...(autoRun || { auto_active: 0 }), ...patch };
    try {
      const res = await api.post('/api/v3/routes/auto-run', next);
      setAutoRun(res || next);
      toast(res && res.active ? 'Auto roster enabled — schedules will be generated daily' : 'Auto roster disabled');
    } catch (e) { toast(e.message || 'Failed to save', 'err'); }
  };

  const generateRosters = async () => {
    if (!genDate) return toast('Choose a date first', 'err');
    setGenBusy(true);
    try {
      const res = await api.post(`/api/v3/routes/generate-schedules?date=${genDate}`, {});
      toast(res ? res.message : 'Roster generated for ' + genDate);
    } catch (e) { toast(e.message || 'Generation failed', 'err'); } finally { setGenBusy(false); }
  };

  // Admin saves the route: name + Vendor + office only. The Vendor configures
  // the route type and the employees afterwards.
  const save = async () => {
    if (!form.name || !form.name.trim()) return toast('Please enter a route name.', 'err');
    if (!form.vendor_id) return toast('Please select the Vendor who will manage this route.', 'err');
    const payload = {
      name: form.name,
      vendor_id: Number(form.vendor_id),
      office_point_id: form.office_point_id ?? null,
      office_label: form.office_label || null,
      office_lat: form.office_lat ?? null,
      office_lng: form.office_lng ?? null
    };
    try {
      if (editing) await api.put(`/api/admin/routes/${editing}`, payload);
      else await api.post('/api/admin/routes', payload);
      toast(`✓ ${editing ? 'Route updated' : 'Route created'} successfully — "${form.name}". The assigned Vendor will configure it.`);
      setModal(false); load();
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
  };

  // Vendor opens an assigned route to configure its type + employee sequence.
  const openVendorConfig = (r) => {
    setVendorConfig(r);
    setForm({
      ...emptyRoute,
      route_type: (r.route_type === 'LOGIN' || r.route_type === 'LOGOUT') ? r.route_type : 'LOGIN',
      office_label: r.office_label || '',
      office_lat: r.office_lat ?? null,
      office_lng: r.office_lng ?? null,
      stops: Array.isArray(r.stops) ? r.stops.map((s) => ({ ...s })) : []
    });
    setDir(null);
  };

  // Vendor saves the route configuration: type + ordered employee stops.
  const saveVendorConfig = async () => {
    if (!vendorConfig) return;
    if (form.route_type !== 'LOGIN' && form.route_type !== 'LOGOUT') return toast('Select the route type (LOGIN or LOGOUT).', 'err');
    const stops = form.stops
      .filter((s) => s && (s.name || s.employee_name || s.lat != null))
      .map((s, i) => ({ ...s, sequence: i + 1 }));
    if (!stops.length) return toast('Assign at least one employee to this route.', 'err');
    const bad = stops.find((s) => !stopValid(s));
    if (bad) return toast(`This employee does not have a valid saved address${bad.employee_name ? ` (${bad.employee_name})` : ''}. Please update the employee address before saving.`, 'err');
    try {
      await api.put(`/api/admin/routes/${vendorConfig.id}`, { route_type: form.route_type, stops });
      toast(`✓ Route "${vendorConfig.name}" configured — ${form.route_type}, ${stops.length} employee${stops.length === 1 ? '' : 's'}.`);
      setVendorConfig(null); load();
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
  };

  const delRoute = async (r) => {
    if (!confirm(`Delete route "${r.name}"? This cannot be undone.`)) return;
    await api.del(`/api/admin/routes/${r.id}`);
    toast('Route deleted');
    load();
  };

  const openAssign = (r) => {
    const current = (r.employees || []).filter((e) => e && (e.employee_id != null || e.id != null)).map((e) => String(e.employee_id ?? e.id));
    setAssign(r);
    setSelEmps(current);
    setPushDate('');
  };

  const saveAssign = async () => {
    if (!assign) return;
    setAssigning(true);
    try {
      await api.put(`/api/admin/routes/${assign.id}/employees`, { employee_ids: selEmps.map(Number) });
      let pushed = 0;
      if (pushDate && selEmps.length) {
        for (const eid of selEmps) {
          try {
            await api.post('/api/admin/schedules', { employee_id: Number(eid), route_id: assign.id, date: pushDate });
            pushed += 1;
          } catch (e) {
            toast(`${employees.find((x) => String(x.id) === String(eid))?.name || 'Employee'}: ${e.message}`, 'err');
          }
        }
      }
      toast(pushed ? `Roster updated — ${pushed} schedule(s) created for ${pushDate}` : 'Roster updated');
      setAssign(null); setSelEmps([]); setPushDate(''); load();
    } catch (e) { toast(e.message, 'err'); } finally { setAssigning(false); }
  };

  const empAddress = (e) => (e && (e.home_address || e.address || e.pickup_address)) || null;
  const employeesWithAddr = employees.filter((e) => e && empAddress(e));

  // ---- Route Type driven endpoints (LOGIN: first employee → office;
  //      LOGOUT: office → last employee; CUSTOM keeps manual start/end) ----
  const officePoint = () => ({ name: form.office_label || '', lat: form.office_lat, lng: form.office_lng });
  const stopPoint = (s) => ({ name: (s && (s.name || s.employee_name)) || '', lat: s && s.lat, lng: s && s.lng });
  const effStart = () => form.route_type === 'CUSTOM'
    ? { name: form.start_point, lat: form.start_lat, lng: form.start_lng }
    : (form.route_type === 'LOGIN' ? stopPoint(form.stops[0]) : officePoint());
  const effEnd = () => form.route_type === 'CUSTOM'
    ? { name: form.end_point, lat: form.end_lat, lng: form.end_lng }
    : (form.route_type === 'LOGIN' ? officePoint() : stopPoint(form.stops[form.stops.length - 1]));
  const hasXY = (o) => o && o.lat != null && o.lng != null && !Number.isNaN(Number(o.lat)) && !Number.isNaN(Number(o.lng));
  const stopValid = (s) => !!(s && (s.name || s.employee_name) && hasXY(s));
  const officeValid = () => hasXY(form);

  const setStops = (stops) => setForm((f) => ({ ...f, stops: stops.map((s, i) => ({ ...s, sequence: i + 1 })) }));
  const addEmployeeStop = (empId) => {
    const emp = employees.find((e) => empIdOf(e) === String(empId));
    if (!emp) return;
    const addr = empAddress(emp);
    if (!addr) return toast(`${emp.name} has no address on file`, 'err');
    const stop = {
      employee_id: Number(emp.id ?? emp._id),
      emp_id: emp.emp_id || emp.employeeId || '',
      employee_name: emp.name,
      name: addr.split(',').slice(0, 2).join(', '),
      lat: Number(emp.home_lat) || null,
      lng: Number(emp.home_lng) || null
    };
    setStops([...form.stops, stop]);
    toast(`Added ${emp.name} as stop ${form.stops.length + 1}`);
  };
  const setStopEmployee = (i, empId) => {
    const stops = [...form.stops];
    if (!empId) { stops[i] = { ...stops[i], employee_id: null, emp_id: '', employee_name: '' }; return setStops(stops); }
    const emp = employees.find((e) => empIdOf(e) === String(empId));
    if (!emp) return;
    const addr = empAddress(emp);
    if (!addr) return toast(`${emp.name} has no address on file`, 'err');
    stops[i] = { ...stops[i], employee_id: Number(emp.id ?? emp._id), emp_id: emp.emp_id || emp.employeeId || '', employee_name: emp.name, name: addr.split(',').slice(0, 2).join(', '), lat: Number(emp.home_lat) || stops[i].lat, lng: Number(emp.home_lng) || stops[i].lng };
    setStops(stops);
  };
  const setStopAddress = (i, item) => {
    if (!item) return;
    const stops = [...form.stops];
    stops[i] = { ...stops[i], name: item.address || stops[i].name, lat: item.lat ?? stops[i].lat, lng: item.lng ?? stops[i].lng };
    setStops(stops);
  };
  const removeStop = (i) => setStops(form.stops.filter((_, j) => j !== i));
  const moveStop = (i, d) => {
    const j = i + d; const stops = [...form.stops];
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    setStops(stops);
  };
  const reorderStops = (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    const stops = [...form.stops];
    const [it] = stops.splice(from, 1);
    stops.splice(to, 0, it);
    setStops(stops);
  };
  const empIdOf = (e) => String(e.id ?? e._id);

  const move = (i, dir) => {
    const stops = [...form.stops];
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    setForm({ ...form, stops });
  };

  const applyAddress = (target, item) => {
    if (!item) return;
    if (target === 'start') setForm((f) => ({ ...f, start_point: item.address, start_lat: item.lat ?? f.start_lat, start_lng: item.lng ?? f.start_lng }));
    else if (target === 'end') setForm((f) => ({ ...f, end_point: item.address, end_lat: item.lat ?? f.end_lat, end_lng: item.lng ?? f.end_lng }));
    else if (typeof target === 'number') {
      setForm((f) => {
        const stops = [...f.stops];
        stops[target] = { ...stops[target], name: item.address.split(',').slice(0, 2).join(','), lat: item.lat ?? stops[target].lat, lng: item.lng ?? stops[target].lng };
        return { ...f, stops };
      });
    }
    setMapFor(null);
  };

  const mapCenterFor = (target) => {
    if (target === 'start' && form.start_lat && form.start_lng) return { lat: Number(form.start_lat), lng: Number(form.start_lng) };
    if (target === 'end' && form.end_lat && form.end_lng) return { lat: Number(form.end_lat), lng: Number(form.end_lng) };
    if (typeof target === 'number') {
      const s = form.stops[target];
      if (s && s.lat && s.lng) return { lat: Number(s.lat), lng: Number(s.lng) };
    }
    const first = form.stops.find((s) => s.lat && s.lng);
    return first ? { lat: Number(first.lat), lng: Number(first.lng) } : { lat: 12.9716, lng: 77.5946 };
  };

  const pickEmployee = (id) => {
    setEmpPick(id);
    const emp = employees.find((e) => String(e.id || e._id) === String(id));
    if (!emp) return;
    const addr = emp.home_address || emp.address || emp.pickup_address;
    if (!addr) return toast(`${emp.name} has no address on file`, 'err');
    setForm((f) => {
      const stops = [...f.stops];
      stops[stops.length - 1] = { ...stops[stops.length - 1], name: addr.split(',').slice(0, 2).join(', '), lat: Number(emp.home_lat) || stops[stops.length - 1].lat, lng: Number(emp.home_lng) || stops[stops.length - 1].lng };
      return { ...f, stops };
    });
    toast(`Added ${emp.name}'s address as a stop`);
  };

  const coords = form.stops.filter((s) => s && s.lat != null && s.lng != null && !isNaN(Number(s.lat)));
  // Ordered coordinates for the current route: start + employee stops + end,
  // where start/end are derived from the route type (CUSTOM uses manual start/end).
  const routePoints = () => {
    const pts = [];
    const st = effStart();
    if (hasXY(st)) pts.push({ lat: Number(st.lat), lng: Number(st.lng) });
    form.stops.forEach((s) => { if (s && s.lat != null && s.lng != null && !isNaN(Number(s.lat))) pts.push({ lat: Number(s.lat), lng: Number(s.lng) }); });
    const en = effEnd();
    if (hasXY(en) && !(pts.length && Math.abs(pts[pts.length - 1].lat - Number(en.lat)) < 1e-6 && Math.abs(pts[pts.length - 1].lng - Number(en.lng)) < 1e-6)) {
      pts.push({ lat: Number(en.lat), lng: Number(en.lng) });
    }
    return pts;
  };
  // Only offer to calculate once there is enough real data: a start, an end and
  // at least one employee/stop with a location.
  const canCalculate = hasXY(effStart()) && hasXY(effEnd()) && coords.length >= 1;

  const calcDirections = async () => {
    const points = routePoints();
    if (points.length < 2) return toast('Add a start, an end and at least one employee stop with a location first.', 'err');
    setDirLoading(true);
    setDir(null);
    try {
      const res = await calculateRoute(points);
      const distKm = (res.distanceMeters || 0) / 1000;
      const mins = (res.durationSeconds || 0) / 60;
      const geo = res.geometry;
      const polyline = geo && geo.coordinates ? geo.coordinates.map((c) => ({ lat: c[1], lng: c[0] })) : [];
      setDir({
        status: 'OK',
        distText: `${distKm.toFixed(1)} km`,
        timeText: `${Math.round(mins)} min`,
        polyline,
        legs: (res.legs || []).map((l) => ({
          dist: `${((l.distanceMeters || 0) / 1000).toFixed(1)} km`,
          dur: `${Math.round((l.durationSeconds || 0) / 60)} min`,
          from: '',
          to: '',
          steps: []
        }))
      });
    } catch (e) {
      const msg = e.message || String(e);
      setDir({ status: 'ERROR', msg: msg.includes('No route found') ? 'No driving route found between these points — verify the coordinates.' : msg });
    }
  };

  const previewMarkers = () => {
    const mk = [];
    const st = effStart(); const en = effEnd();
    if (hasXY(st)) mk.push({ id: 'start', lat: Number(st.lat), lng: Number(st.lng), label: 'A', color: 'green', title: st.name || 'Start' });
    coords.forEach((s, i) => mk.push({ id: `s${form.stops.indexOf(s)}`, lat: Number(s.lat), lng: Number(s.lng), label: String(i + 1), color: 'amber', title: s.employee_name || s.name || `Stop ${i + 1}` }));
    if (hasXY(en)) mk.push({ id: 'end', lat: Number(en.lat), lng: Number(en.lng), label: 'B', color: 'red', title: en.name || 'End' });
    return mk;
  };

  const previewLines = () => {
    const lines = [];
    const pts = routePoints();
    if (pts.length > 1) lines.push({ path: pts, color: '#f59e0b', weight: 4, dash: true, opacity: 0.8 });
    if (dir && dir.status === 'OK' && dir.polyline.length > 1) lines.push({ path: dir.polyline, color: '#22c55e', weight: 5 });
    return lines;
  };

  const dragStop = (id, la, ln) => {
    setForm((f) => {
      // For LOGIN/LOGOUT the start/end markers are the first/last employee, so
      // dragging them edits that employee's location (never the office).
      if (id === 'start') {
        if (f.route_type === 'CUSTOM') return { ...f, start_lat: la, start_lng: ln };
        if (f.route_type === 'LOGIN' && f.stops[0]) { const stops = [...f.stops]; stops[0] = { ...stops[0], lat: la, lng: ln }; return { ...f, stops }; }
        return f;
      }
      if (id === 'end') {
        if (f.route_type === 'CUSTOM') return { ...f, end_lat: la, end_lng: ln };
        if (f.route_type === 'LOGOUT' && f.stops.length) { const stops = [...f.stops]; const k = stops.length - 1; stops[k] = { ...stops[k], lat: la, lng: ln }; return { ...f, stops }; }
        return f;
      }
      const n = Number(String(id).replace(/^s/, ''));
      if (Number.isNaN(n)) return f;
      const stops = [...f.stops];
      if (stops[n]) stops[n] = { ...stops[n], lat: la, lng: ln };
      return { ...f, stops };
    });
  };

  // ---- Full-page Create/Edit (NOT a modal). The Admin configures the route
  //      only; employees are assigned by the Vendor. ----
  // ---- Full-page Admin Create/Edit (NOT a modal). The Admin configures the
  //      route name + Vendor + office only. ----
  if (modal) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">{editing ? 'Edit route' : 'New route'}</div>
            <div className="page-sub">The Admin creates the route and assigns the Vendor. The Vendor configures LOGIN/LOGOUT and the employees.</div>
          </div>
          <button className="btn btn-outline" onClick={() => setModal(false)}>← Back</button>
        </div>
        <div className="card" style={{ maxWidth: 720 }}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Route name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kammana" autoFocus />
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label><User size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Vendor (manages this route)</label>
            {vendors.length ? (
              <select value={form.vendor_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value || null }))}>
                <option value="">Select the Vendor…</option>
                {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}{v.vendor_code ? ` · ${v.vendor_code}` : ''}</option>))}
              </select>
            ) : (
              <div style={{ fontSize: 12, color: '#ef4444' }}>No vendors yet — create a Vendor under Vendor Management first.</div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label><MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} color="#0ea5e9" />Office / location</label>
            {offices.length ? (
              <select value={form.office_point_id ?? ''} onChange={(e) => {
                const o = offices.find((x) => String(x._id) === String(e.target.value));
                if (!o) return setForm((f) => ({ ...f, office_point_id: null, office_label: '', office_lat: null, office_lng: null }));
                setForm((f) => ({ ...f, office_point_id: o._id, office_label: o.label, office_address: o.address || '', office_lat: o.lat, office_lng: o.lng }));
              }}>
                <option value="">Select the office location…</option>
                {offices.map((o) => (<option key={o._id} value={o._id}>{o.label}{o.address ? ` — ${o.address}` : ''}</option>))}
              </select>
            ) : (
              <div style={{ fontSize: 12, color: '#ef4444' }}>Office location is not configured. Please configure the office location first.</div>
            )}
            {form.office_label && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>🏢 {form.office_label}</div>}
          </div>

          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', fontSize: 13, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Route configuration</div>
            <div style={{ color: 'var(--muted)' }}>LOGIN / LOGOUT and the employees are configured by the assigned Vendor.</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><RouteIcon size={16} /> {editing ? 'Save changes' : 'Create route'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Full-page Vendor Route Configuration (NOT a modal). The Vendor selects
  //      LOGIN/LOGOUT and assigns/orders the employees. ----
  if (vendorConfig) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">Configure route — {vendorConfig.name}</div>
            <div className="page-sub">Select the route type and assign the employees. Their order sets the route.</div>
          </div>
          <button className="btn btn-outline" onClick={() => setVendorConfig(null)}>← Back</button>
        </div>
        <div className="card" style={{ maxWidth: 860 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Route type</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[['LOGIN', 'LOGIN · Employees → Office'], ['LOGOUT', 'LOGOUT · Office → Employees']].map(([t, lbl]) => (
                <button key={t} type="button" className={`btn btn-sm ${form.route_type === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => setForm((f) => ({ ...f, route_type: t }))}>{lbl}</button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 13, marginBottom: 14, color: 'var(--muted)' }}>
            Office: <b style={{ color: 'var(--text)' }}>🏢 {vendorConfig.office_label || 'not set'}</b>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>Employees — order sets the route (drag or use ↑ ↓)</b>
            <select value="" onChange={(e) => { if (e.target.value) addEmployeeStop(e.target.value); }} style={{ maxWidth: 260 }}>
              <option value="">{employeesWithAddr.length ? '+ Add employee…' : 'No approved addresses yet — approve address requests under Approvals'}</option>
              {employeesWithAddr.map((e) => (<option key={empIdOf(e)} value={empIdOf(e)}>{e.name} · {e.emp_id || e.employeeId}</option>))}
            </select>
          </div>
          {!form.stops.length && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Add at least one employee to configure this route.</div>}
          {form.stops.map((s, i) => (
            <div key={i} className="stop-row" draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); reorderStops(dragIdx, i); setDragIdx(null); }}>
              <GripVertical size={18} style={{ color: 'var(--muted)', cursor: 'grab' }} />
              <select value={s.employee_id ? String(s.employee_id) : ''} onChange={(e) => setStopEmployee(i, e.target.value)} style={{ maxWidth: 190 }}>
                <option value="">— Manual address —</option>
                {employeesWithAddr.map((e) => (<option key={empIdOf(e)} value={empIdOf(e)}>{e.name} · {e.emp_id || e.employeeId}</option>))}
              </select>
              <AddressPicker
                mapButton={false}
                value={(s.lat && s.lng) ? { address: s.name, lat: s.lat, lng: s.lng } : (s.name ? { address: s.name } : null)}
                onChange={(item) => setStopAddress(i, item)}
              />
              <button type="button" title={`Pick stop ${i + 1} on map`} className="btn btn-outline" onClick={() => setMapFor(i)} style={{ padding: '7px 9px' }}>
                <MapPinned size={15} color="#f59e0b" />
              </button>
              <div className="stop-coords">
                <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => moveStop(i, -1)}>↑</button>
                <button className="btn btn-sm btn-ghost" disabled={i === form.stops.length - 1} onClick={() => moveStop(i, 1)}>↓</button>
                <button className="btn btn-sm btn-danger" onClick={() => removeStop(i)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}

          <div style={{ margin: '10px 0 4px', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{form.route_type} route summary</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <span>📍 <b>Start:</b> {effStart().name || '—'}</span>
              {hasXY(effStart())
                ? <LocationText lat={effStart().lat} lng={effStart().lng} address={effStart().address} max={90} />
                : <span style={{ color: '#ef4444' }}>· missing</span>}
              {hasXY(effStart()) && <ViewOnMapLink lat={effStart().lat} lng={effStart().lng} address={effStart().address} label="Map" />}
            </div>
            <div style={{ color: 'var(--muted)', margin: '4px 0' }}>↓ {form.stops.map((s, i) => `${i + 1}. ${s.employee_name || s.name || '—'}`).join('  →  ') || '—'}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <span>🏢 <b>End:</b> {effEnd().name || '—'}</span>
              {hasXY(effEnd())
                ? <LocationText lat={effEnd().lat} lng={effEnd().lng} address={effEnd().address} max={90} />
                : <span style={{ color: '#ef4444' }}>· missing</span>}
              {hasXY(effEnd()) && <ViewOnMapLink lat={effEnd().lat} lng={effEnd().lng} address={effEnd().address} label="Map" />}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => setVendorConfig(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveVendorConfig}><RouteIcon size={16} /> Save route configuration</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Routes</div>
          <div className="page-sub">Search start and end points, build the stop sequence on the map (drag pins to fine-tune), then calculate the driving route and assign employees. Speed limits are set per cab under Vehicles.</div>
        </div>
        {!isVendor && <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(emptyRoute); setMapFor(null); setDir(null); setModal(true); }}><Plus size={16} /> New route</button>}
      </div>

      {!isVendor && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}><Wand2 size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} color="#7c3aed" />SMART ROUTES</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-outline" disabled={autoBusy} onClick={runAutoAssign}>
              {autoBusy ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Wand2 size={15} />} {autoBusy ? 'Assigning…' : 'Auto-assign unassigned employees'}
            </button>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10 }}>
              <CalendarClock size={15} color="var(--slate)" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Daily roster</span>
              <button className={`btn btn-sm ${autoRun?.active ? 'btn-green' : 'btn-outline'}`} onClick={() => saveAutoRun({ active: autoRun?.active ? 0 : 1 })}>
                {autoRun?.active ? 'ON' : 'OFF'}
              </button>
              {autoRun?.active && (
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>pickup {autoRun.pickup_time} · drop {autoRun.drop_time} · next {autoRun.next_run}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} style={{ width: 150 }} />
              <button className="btn btn-primary btn-sm" disabled={genBusy || !genDate} onClick={generateRosters}>
                {genBusy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Play size={14} />} Generate schedules
              </button>
            </div>
          </div>
          {autoRun && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Pickup
                <input type="time" value={autoRun.pickup_time || '08:00'} onChange={(e) => saveAutoRun({ pickup_time: e.target.value })} style={{ width: 110, marginLeft: 6 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Drop
                <input type="time" value={autoRun.drop_time || '18:00'} onChange={(e) => saveAutoRun({ drop_time: e.target.value })} style={{ width: 110, marginLeft: 6 }} />
              </label>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>tip: set times, then toggle ON. A scheduled job generates tomorrow's roster from assigned routes every 5 minutes.</span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Route</th><th>Vendor</th><th>Type</th><th>Start → End</th><th>Stops</th><th>Employees</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td style={{ fontSize: 13 }}>{r.vendor_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{(r.route_type === 'LOGIN' || r.route_type === 'LOGOUT') ? <Badge color="blue">{r.route_type}</Badge> : <Badge color="slate">Not configured</Badge>}</td>
                  <td style={{ fontSize: 13, color: 'var(--slate)' }}>{r.start_point || '—'} → {r.end_point || '—'}</td>
                  <td><Badge color="violet">{Array.isArray(r.stops) ? r.stops.length : 0} stops</Badge></td>
                  <td>
                    <Badge color={r.employees?.length ? 'green' : 'slate'}>{r.employees?.length ? `${r.employees.length} assigned` : 'None'}</Badge>
                    <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={(r.employees || []).map((e) => e.name).join(', ') || ''}>
                      {(r.employees || []).map((e) => e.name).join(', ')}
                    </div>
                  </td>
                  <td><Badge color={r.status === 'active' ? 'green' : 'slate'}>{r.status}</Badge></td>
                  <td>
                    <div className="actions">
                      {isVendor && <button className="btn btn-sm btn-primary" onClick={() => openVendorConfig(r)}><RouteIcon size={14} /> Configure route</button>}
                      {!isVendor && <button className="btn btn-sm btn-primary" onClick={() => openTrip(r)} title="Create an operational trip/cab run from this route"><Play size={14} /> Create Trip</button>}
                      {!isVendor && <button className="btn btn-sm btn-outline" onClick={() => { setEditing(r.id); setForm({ ...emptyRoute, name: r.name, vendor_id: r.vendor_id ?? null, office_point_id: r.office_point_id ?? null, office_label: r.office_label || '', office_lat: r.office_lat ?? null, office_lng: r.office_lng ?? null }); setDir(null); setModal(true); }}><Pencil size={14} /> Edit</button>}
                      {!isVendor && <button className="btn btn-sm btn-ghost" title="Delete route" onClick={() => delRoute(r)}><Trash2 size={14} color="#ef4444" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!routes.length && <tr><td colSpan={8} className="empty">No routes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>


      <Modal open={mapFor !== null} onClose={() => setMapFor(null)} title="Search & select location" wide>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Type the address and pick from the dropdown, tap anywhere on the map, drag the pin, or use your current location.</p>
        <AddressPicker mapButton={false} onChange={(item) => applyAddress(mapFor, item)} />
        <div style={{ marginTop: 12 }}>
          <MapPicker
            lat={(mapCenterFor(mapFor) || {}).lat ?? null}
            lng={(mapCenterFor(mapFor) || {}).lng ?? null}
            height={300}
            onPick={(la, ln) => {
              applyAddress(mapFor, { lat: la, lng: ln, address: '' });
              pickLocation(la, ln).then((p) => { if (p) applyAddress(mapFor, { lat: la, lng: ln, address: p.address }); });
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setMapFor(null)}>Close</button>
        </div>
      </Modal>


      <Modal open={!!tripFor} onClose={() => setTripFor(null)} title={`Create Trip — ${tripFor?.name || ''}`} wide>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          This is the operational step: it creates a trip/cab run for this route's employees on a chosen date.
          The route itself is a reusable definition and is <b>not</b> changed — reuse it for other dates.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label>Date</label><input type="date" value={tripForm.date} onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })} /></div>
          <div className="field"><label>Vehicle</label>
            <select value={tripForm.vehicle_id} onChange={(e) => setTripForm({ ...tripForm, vehicle_id: e.target.value })}>
              <option value="">Auto-assign a free vehicle</option>
              {vehicles.map((v) => (<option key={v.id} value={v.id}>{v.plate || v.vehicle_name || ('Vehicle ' + v.id)}{v.line ? ` · Line ${v.line}` : ''}</option>))}
            </select>
          </div>
          <div className="field"><label>Driver (optional)</label>
            <select value={tripForm.driver_id} onChange={(e) => setTripForm({ ...tripForm, driver_id: e.target.value })}>
              <option value="">No specific driver</option>
              {drivers.map((d) => (<option key={d.id} value={d.id}>{d.name}{d.emp_id ? ` · ${d.emp_id}` : ''}</option>))}
            </select>
          </div>
          <div className="field"><label>Pickup time</label><input type="time" value={tripForm.pickup_time} onChange={(e) => setTripForm({ ...tripForm, pickup_time: e.target.value })} /></div>
          <div className="field"><label>Drop time</label><input type="time" value={tripForm.drop_time} onChange={(e) => setTripForm({ ...tripForm, drop_time: e.target.value })} /></div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
          {(tripFor?.employees || []).length} employee(s) on this route will be scheduled. Trip appears in <b>All Trips &amp; Cab Runs</b> immediately.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setTripFor(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={tripBusy || !tripForm.date} onClick={createTrip}><Play size={15} /> {tripBusy ? 'Creating…' : 'Create Trip'}</button>
        </div>
      </Modal>
    </div>
  );
}