import React from 'react';
import { downloadCsv, downloadFile } from '../../api';
import { useToast } from '../../components/ui';
import { FileSpreadsheet, Download, Users, Truck, Route as RouteIcon, CalendarClock, Star, BellRing, History, LayoutDashboard } from 'lucide-react';

const EXPORTS = [
  { kind: 'trip-dashboard', label: 'Trip Dashboard', desc: 'Full trip lifecycle — logins, boarding, check-in, arrival, checkout & end-trip times', icon: <LayoutDashboard size={20} />, color: 'ico-indigo' },
  { kind: 'employees', label: 'Employee roster', desc: 'All registered employees with approval & status', icon: <Users size={20} />, color: 'ico-indigo' },
  { kind: 'drivers', label: 'Driver roster', desc: 'Drivers linked with their vehicles, lines & trips', icon: <Truck size={20} />, color: 'ico-violet' },
  { kind: 'vehicles', label: 'Vehicle fleet', desc: 'Vehicles, plates, lines, trips and driver contacts', icon: <Truck size={20} />, color: 'ico-pink' },
  { kind: 'schedules', label: 'Schedules', desc: 'Full schedule log — employee, cab, route & timings', icon: <CalendarClock size={20} />, color: 'ico-blue' },
  { kind: 'runs', label: 'Cab Runs', desc: 'All allotted cab runs with stop sequences, driver & vehicle info', icon: <History size={20} />, color: 'ico-green' },
  { kind: 'feedback', label: 'Feedback', desc: 'Ratings and comments from employees & drivers', icon: <Star size={20} />, color: 'ico-amber' },
  { kind: 'speed-events', label: 'Speed violations', desc: 'Every time a cab crossed the set speed limit', icon: <BellRing size={20} />, color: 'ico-red' }
];

export default function ExportsPage() {
  const toast = useToast();
  const dl = async (kind, label, xlsx) => {
    try {
      if (xlsx) await downloadFile(`/api/admin/export/${kind}.xlsx`, `getinroute-${kind}.xlsx`);
      else await downloadCsv(`/api/admin/export/${kind}`, `getinroute-${kind}.csv`);
      toast(`${label} downloaded`);
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Export Spreadsheets</div>
          <div className="page-sub">Download CSV reports for any area of the platform.</div>
        </div>
        <FileSpreadsheet size={28} color="var(--primary)" />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {EXPORTS.map((e) => (
          <div className="card" key={e.kind}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div className={`ico ${e.color}`}>{e.icon}</div>
              <b style={{ fontSize: 15 }}>{e.label}</b>
            </div>
            <p style={{ color: 'var(--slate)', fontSize: 13, marginBottom: 14, minHeight: 36 }}>{e.desc}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => dl(e.kind, e.label, false)}><Download size={15} /> CSV</button>
              <button className="btn btn-green btn-sm" onClick={() => dl(e.kind, e.label, true)}><FileSpreadsheet size={15} /> Excel</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
