import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Modal, Badge, useToast } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import GoogleMapPicker from '../../components/GoogleMapPicker';
import GoogleRouteMap from '../../components/GoogleRouteMap';
import { calculateRoute } from '../../lib/geo';
import { Plus, Pencil, Trash2, Route as RouteIcon, GripVertical, MapPin, MapPinned, User, Navigation, Loader2, Wand2, Play, CalendarClock } from 'lucide-react';

const emptyRoute = { name: '', start_point: '', end_point: '', speed_limit: 40, stops: [{ sequence: 1, name: '', lat: 12.97, lng: 77.59 }], start_lat: null, start_lng: null, end_lat: null, end_lng: null };

export default function RoutesPage() {
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';
  const toast = useToast();
  const [routes, setRoutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyRoute);
  const [editing, setEditing] = useState(null);
  const [mapFor, setMapFor] = useState(null); // null | 'start' | 'end' | stopIndex
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

  const save = async () => {
    if (!form.name || !form.name.trim()) return toast('Please enter a route name.', 'err');
    if (!form.start_point) return toast('Please select a start point.', 'err');
    if (!form.end_point) return toast('Please select an end point.', 'err');
    const stops = form.stops
      .filter((s) => s && (s.name || s.lat != null))
      .map((s, i) => ({ ...s, sequence: i + 1 }));
    if (!stops.length) return toast('Please select at least one employee.', 'err');
    const payload = { ...form, stops };
    try {
      if (editing) await api.put(`/api/admin/routes/${editing}`, payload);
      else await api.post('/api/admin/routes', payload);
      toast(`✓ ${editing ? 'Route updated' : 'Route created'} successfully — "${form.name}" (${stops.length} stop${stops.length === 1 ? '' : 's'}).`);
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
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
  // Only offer to calculate once there is enough real data: a start, an end and
  // at least one employee/stop with a location.
  const canCalculate = form.start_lat != null && form.start_lng != null && form.end_lat != null && form.end_lng != null && coords.length >= 1;

  const calcDirections = async () => {
    if (coords.length < 2) return toast('Add coordinates for the start and end of the route first (search the start and end points, then add stops).', 'err');
    setDirLoading(true);
    setDir(null);
    try {
      const ordered = coords;
      const points = [];
      if (form.start_lat != null && form.start_lng != null) points.push({ lat: Number(form.start_lat), lng: Number(form.start_lng) });
      coords.forEach((s) => points.push({ lat: Number(s.lat), lng: Number(s.lng) }));
      if (form.end_lat != null && form.end_lng != null &&
          !(points.length && Math.abs(points[points.length - 1].lat - Number(form.end_lat)) < 1e-6 && Math.abs(points[points.length - 1].lng - Number(form.end_lng)) < 1e-6)) {
        points.push({ lat: Number(form.end_lat), lng: Number(form.end_lng) });
      }
      if (points.length < 2) { setDir({ status: 'ERROR', msg: 'Add coordinates to at least 2 stops, or start & end points.' }); setDirLoading(false); return; }
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
    if (form.start_lat != null && form.start_lng != null) mk.push({ id: 'start', lat: Number(form.start_lat), lng: Number(form.start_lng), label: 'A', color: 'green', title: form.start_point || 'Start' });
    coords.forEach((s, i) => mk.push({ id: `s${form.stops.indexOf(s)}`, lat: Number(s.lat), lng: Number(s.lng), label: String(i + 1), color: 'amber', title: s.name || `Stop ${i + 1}` }));
    if (form.end_lat != null && form.end_lng != null) mk.push({ id: 'end', lat: Number(form.end_lat), lng: Number(form.end_lng), label: 'B', color: 'red', title: form.end_point || 'End' });
    return mk;
  };

  const previewLines = () => {
    const lines = [];
    if (coords.length > 1) lines.push({ path: coords.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })), color: '#f59e0b', weight: 4, dash: true, opacity: 0.8 });
    if (dir && dir.status === 'OK' && dir.polyline.length > 1) lines.push({ path: dir.polyline, color: '#22c55e', weight: 5 });
    return lines;
  };

  const dragStop = (id, la, ln) => {
    const n = Number(String(id).replace(/^s/, ''));
    if (Number.isNaN(n)) return;
    setForm((f) => {
      if (id === 'start') return { ...f, start_lat: la, start_lng: ln };
      if (id === 'end') return { ...f, end_lat: la, end_lng: ln };
      const stops = [...f.stops];
      if (stops[n]) stops[n] = { ...stops[n], lat: la, lng: ln };
      return { ...f, stops };
    });
  };

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
            <thead><tr><th>Route</th><th>Start → End</th><th>Stops</th><th>Employees</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
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
                      {!isVendor && <button className="btn btn-sm btn-outline" title="Auto-optimize pickup/drop sequence" onClick={() => optimizeRoute(r)}>{optId === r.id ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Wand2 size={14} />} Optimize</button>}
                      {!isVendor && <button className="btn btn-sm btn-outline" onClick={() => openAssign(r)}><User size={14} /> Assign</button>}
                      {!isVendor && <button className="btn btn-sm btn-primary" onClick={() => openTrip(r)} title="Create an operational trip/cab run from this route"><Play size={14} /> Create Trip</button>}
                      {!isVendor && <button className="btn btn-sm btn-outline" onClick={() => { setEditing(r.id); setForm({ name: r.name, start_point: r.start_point, end_point: r.end_point, speed_limit: r.speed_limit, stops: Array.isArray(r.stops) ? r.stops.map((s) => ({ ...s })) : [], start_lat: r.start_lat ?? null, start_lng: r.start_lng ?? null, end_lat: r.end_lat ?? null, end_lng: r.end_lng ?? null }); setDir(null); setModal(true); }}><Pencil size={14} /> Edit</button>}
                      {!isVendor && <button className="btn btn-sm btn-ghost" title="Delete route" onClick={() => delRoute(r)}><Trash2 size={14} color="#ef4444" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!routes.length && <tr><td colSpan={6} className="empty">No routes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit route' : 'New route'} wide>
        <div className="field" style={{ marginBottom: 12 }}><label>Route name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Electronic City → Manyata Tech Park" /></div>

        <div className="startend-duo">
          <div className="field">
            <label><MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} color="#22c55e" />Start point (search & pick exact location)</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AddressPicker
                  value={form.start_point ? { address: form.start_point, lat: form.start_lat, lng: form.start_lng } : null}
                  onChange={(item) => setForm((f) => ({ ...f, start_point: item.address || f.start_point, start_lat: item.lat ?? f.start_lat, start_lng: item.lng ?? f.start_lng }))}
                />
              </div>
              <button type="button" title="Pick start point on map" className="btn btn-outline" onClick={() => setMapFor('start')} style={{ padding: '7px 9px', alignSelf: 'flex-start' }}>
                <MapPinned size={15} color="#22c55e" />
              </button>
            </div>
            {form.start_point && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>✓ Location selected</div>}
          </div>
          <div className="field">
            <label><MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} color="#ef4444" />End point (search & pick exact location)</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AddressPicker
                  value={form.end_point ? { address: form.end_point, lat: form.end_lat, lng: form.end_lng } : null}
                  onChange={(item) => setForm((f) => ({ ...f, end_point: item.address || f.end_point, end_lat: item.lat ?? f.end_lat, end_lng: item.lng ?? f.end_lng }))}
                />
              </div>
              <button type="button" title="Pick end point on map" className="btn btn-outline" onClick={() => setMapFor('end')} style={{ padding: '7px 9px', alignSelf: 'flex-start' }}>
                <MapPinned size={15} color="#ef4444" />
              </button>
            </div>
            {form.end_point && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>✓ Location selected</div>}
            <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 6 }} onClick={() => setForm((f) => ({ ...f, end_point: f.start_point, end_lat: f.start_lat, end_lng: f.start_lng }))}>Same as Start Point</button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 8px' }}>
          <b style={{ fontSize: 14 }}>Stops (pick-up / drop sequence — drag the numbered pin on the preview map to fine-tune)</b>
          <button className="btn btn-sm btn-outline" onClick={() => setForm({ ...form, stops: [...form.stops, { sequence: form.stops.length + 1, name: '', lat: 12.97, lng: 77.59 }] })}><Plus size={14} /> Add stop</button>
        </div>
        {form.stops.map((s, i) => (
          <div key={i} className="stop-row">
            <GripVertical size={18} style={{ color: 'var(--muted)' }} />
            <AddressPicker
              value={(s.lat && s.lng) ? { address: s.name, lat: s.lat, lng: s.lng } : (s.name ? { address: s.name } : null)}
              onChange={(item) => setForm((f) => {
                const stops = [...f.stops];
                stops[i] = { ...stops[i], name: item.address || stops[i].name, lat: item.lat ?? stops[i].lat, lng: item.lng ?? stops[i].lng };
                return { ...f, stops };
              })}
            />
            <button type="button" title={`Pick stop ${i + 1} on map`} className="btn btn-outline" onClick={() => setMapFor(i)} style={{ padding: '7px 9px' }}>
              <MapPinned size={15} color="#f59e0b" />
            </button>
            <div className="stop-coords">
              <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-sm btn-ghost" disabled={i === form.stops.length - 1} onClick={() => move(i, 1)}>↓</button>
              {form.stops.length > 1 && <button className="btn btn-sm btn-danger" onClick={() => setForm({ ...form, stops: form.stops.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>}
            </div>
          </div>
        ))}

        <div className="field" style={{ marginBottom: 12 }}>
          <label><User size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Add employee by address (auto-fills their saved address)</label>
          <select value={empPick} onChange={(e) => pickEmployee(e.target.value)}>
            <option value="">{employeesWithAddr.length ? 'Select an employee to add their address…' : 'No approved addresses yet — approve address requests under Approvals…'}</option>
            {employeesWithAddr.map((e) => (
              <option key={e.id || e._id} value={String(e.id || e._id)}>{e.name} · {e.emp_id} — {String(e.home_address || e.address || e.pickup_address).split(',').slice(0, 2).join(',')}</option>
            ))}
          </select>
        </div>

        <div style={{ margin: '14px 0 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" disabled={dirLoading || !canCalculate} onClick={calcDirections}>
            {dirLoading ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Navigation size={15} />} {dirLoading ? 'Calculating route… please wait.' : 'Calculate route'}
          </button>
          {dir && dir.status === 'OK' && (
            <span className="badge badge-green">✓ Route calculated — {dir.distText} · {dir.timeText}</span>
          )}
          {!canCalculate && !dirLoading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Select your start point, destination and employees to preview the route.</span>}
          {dir && dir.status === 'ERROR' && (
            <button className="btn btn-sm btn-outline" onClick={calcDirections}>Try Again</button>
          )}
        </div>

        {dir && dir.status === 'ERROR' && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>
            <b>Could not calculate directions.</b> {dir.msg} <span style={{ color: '#7f1d1d' }}>Check the coordinates, then try again.</span>
          </div>
        )}
        {dir && dir.status === 'not-configured' && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, marginBottom: 10 }}>
            The map backend is not configured on the server, so live routing can't be calculated. Check that the routing service is reachable, then reload.
          </div>
        )}

        {dir && dir.status === 'OK' && (
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1.5px solid var(--line)', borderRadius: 12, marginBottom: 12 }}>
            {dir.legs.map((leg, i) => (
              <div key={i} style={{ padding: '9px 12px', borderBottom: i < dir.legs.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}>
                <b>{i + 1}. {leg.from}</b> → {leg.to}
                <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{leg.dist} · {leg.dur}</span>
                {leg.steps.length > 0 && <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 4 }}>{leg.steps.join(' · ')}</div>}
              </div>
            ))}
          </div>
        )}

        {previewMarkers().length > 0 && (
          <GoogleRouteMap
            markers={previewMarkers()}
            lines={previewLines()}
            height={300}
            onMarkerDrag={dragStop}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><RouteIcon size={16} /> {editing ? 'Save changes' : 'Create route'}</button>
        </div>
      </Modal>

      <Modal open={mapFor !== null} onClose={() => setMapFor(null)} title="Search & select location" wide>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Type the address and pick from the dropdown, tap anywhere on the map, drag the pin, or use your current location.</p>
        <AddressPicker onChange={(item) => applyAddress(mapFor, item)} />
        <div style={{ marginTop: 12 }}>
          <GoogleMapPicker
            lat={(mapCenterFor(mapFor) || {}).lat ?? null}
            lng={(mapCenterFor(mapFor) || {}).lng ?? null}
            height={300}
            onPick={(la, ln) => applyAddress(mapFor, { lat: la, lng: ln, address: `${Number(la).toFixed(5)}, ${Number(ln).toFixed(5)}` })}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setMapFor(null)}>Close</button>
        </div>
      </Modal>

      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign employees — ${assign?.name || ''}`} wide>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Choose the employees this route covers. Their saved home/pickup address is shown to help you verify stops. Assign only saves the roster; a date turns the same roster into confirmed schedules (cab auto-assigned) for that day.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--muted)' }}>Push schedules for this date (optional)</label>
            <input type="date" value={pushDate} onChange={(e) => setPushDate(e.target.value)} />
          </div>
          <Badge color="green">{selEmps.length} selected</Badge>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1.5px solid var(--line)', borderRadius: 12, padding: 8, marginBottom: 8 }}>
          {employees.map((e) => {
            const val = String(e.id || e._id);
            const checked = selEmps.includes(val);
            const addr = empAddress(e);
            return (
              <label key={val} style={Object.assign({ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 8px', borderRadius: 8, cursor: 'pointer' }, checked ? { background: 'rgba(79,70,229,.08)' } : {})}>
                <input type="checkbox" checked={checked} onChange={() => setSelEmps(checked ? selEmps.filter((x) => x !== val) : [...selEmps, val])} />
                <b style={{ fontSize: 13, minWidth: 170 }}>{e.name}</b>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace', minWidth: 70 }}>{e.emp_id || e.employeeId || ''}</span>
                <span style={{ fontSize: 12, color: addr ? 'var(--slate)' : '#ef4444', flex: 1 }}>{addr || 'No address on file'}</span>
              </label>
            );
          })}
          {!employees.length && <div className="empty">No approved employees yet.</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => setAssign(null)}>Cancel</button>
          <button className="btn btn-outline" disabled={assigning} onClick={saveAssign}><User size={15} /> Save roster</button>
          <button className="btn btn-primary" disabled={assigning || !pushDate} onClick={saveAssign}><RouteIcon size={15} /> Save & push schedules</button>
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