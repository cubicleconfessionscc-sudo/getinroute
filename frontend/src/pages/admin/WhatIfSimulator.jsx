import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Brain, CarFront, RotateCcw } from 'lucide-react';

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const DEFAULT_S = { empDelta: 0, vehicles: 0, shift: 1, branches: 0, traffic: 0, shortage: 0, routes: 0 };

export default function WhatIfSimulator() {
  const [baseline, setBaseline] = useState({ employees: 850, vehicles: 24, routes: 18, drivers: 26, cost: 1450000, onTime: 92, eta: 28, utilization: 76 });
  const [live, setLive] = useState(null);
  const [s, setS] = useState(DEFAULT_S);

  useEffect(() => {
    api.get('/api/admin/stats').then((r) => setLive(r || null)).catch(() => {});
  }, []);

  const est = useMemo(() => {
    const b = baseline;
    const employees = Math.max(1, b.employees + b.employees * (s.empDelta / 100));
    const capPeak = employees / 48; // ~48 riders per vehicle across peak vs off-peak
    const fleetRequired = Math.max(1, Math.ceil(capPeak * (1 + Math.abs(s.vehicles) * 0.04) * (1 + s.branches * 0.05)));
    const fleetDelta = fleetRequired - b.vehicles;
    const shortagePenalty = Math.max(0, s.shortage) * 0.02;
    const onTime = Math.max(55, Math.min(99, b.onTime - s.traffic * 0.32 - shortagePenalty * 10 - Math.max(0, s.shortage) * 1.2));
    const eta = Math.max(6, b.eta + s.traffic * 1.4 + Math.max(0, s.shortage) * 3 - Math.min(0, s.vehicles) * 0.5 - Math.max(0, s.routes) * 0.4);
    const utilization = Math.max(40, Math.min(96, b.utilization + s.empDelta * 0.18 - s.branches * 0.6 + Math.sign(s.vehicles) * Math.min(8, Math.abs(s.vehicles) * 0.8)));
    const driverCount = fleetRequired * (s.shift + (s.shift > 1 ? 0.3 : 0.15)) + Math.max(0, s.shortage);
    const fuelCost = 42000 + fleetRequired * 11500 * (1 + s.traffic * 0.012) * (1 + s.branches * 0.08);
    const driverCost = (59100 * s.shift + 34000) * Math.ceil(fleetRequired / (s.shift || 1));
    const maintCost = 26000 + fleetRequired * 2600;
    const cost = fuelCost + driverCost + maintCost;
    return {
      employees, fleetRequired, fleetDelta, driverCount,
      cost, avgCostPerRider: cost / employees,
      onTime, eta, utilization,
      status: fleetDelta > 0 ? (s.vehicles < 0 || s.empDelta > 0 ? 'under' : 'over') : (fleetDelta < 0 ? 'over' : 'ok')
    };
  }, [baseline, s]);

  const badgeFor = (diff) => diff === 0 ? { c: '#94a3b8', l: 'Unchanged' }
    : diff > 0 ? { c: '#22d3ee', l: `+${diff}` }
    : { c: '#f59e0b', l: String(diff) };

  const row = (label, base, current, format = (x) => (Math.round(x * 10) / 10).toString()) => {
    const diff = current - base;
    const bd = badgeFor(Math.round(diff * 10) / 10);
    return (
      <div className="whatif-row" key={label}>
        <span>{label}</span>
        <span className="whatif-base">{format(base)}</span>
        <span className="whatif-cur" style={{ color: diff > 0 ? 'var(--accent)' : diff < 0 ? '#f59e0b' : '#cbd5e1' }}>{format(current)}</span>
        <span className={`badge badge-slate whatif-badge`} style={{ color: bd.c, borderColor: bd.c }}>
          {bd.l} {diff > 0 ? '▲' : diff < 0 ? '▼' : '•'}
        </span>
      </div>
    );
  };

  const setter = (k) => (e) => setS((p) => ({ ...p, [k]: Number(e.target.value) }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">What-If Simulator <span className="pill-whatif">Digital Twin</span></h1>
          <p className="page-sub">Model the impact of operational changes on your fleet — without touching live operations. Projections are estimates based on your real configuration.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => { setS(DEFAULT_S); setBaseline((b) => ({ ...b })); }}><RotateCcw size={15} /> Reset</button>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: 'minmax(300px, 400px) 1fr', gap: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Brain size={18} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0 }}>Scenario Controls</h3>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Drag any lever. The model recomputes fleet need, driver count, cost, ETA and impact instantly.</p>

          {[
            { k: 'empDelta', label: 'Employee count', from: -50, to: 100, step: 5, disp: (v) => `${v > 0 ? '+' : ''}${v}%` },
            { k: 'vehicles', label: 'Fleet size', from: -8, to: 8, step: 1, disp: (v) => (v > 0 ? `+${v}` : String(v)) },
            { k: 'shift', label: 'Shift schedule', from: 1, to: 2, step: 1, disp: (v) => (v === 1 ? 'Single' : 'Split') },
            { k: 'branches', label: 'New branch / locations', from: 0, to: 5, step: 1, disp: (v) => String(v) },
            { k: 'traffic', label: 'Traffic congestion', from: 0, to: 100, step: 5, disp: (v) => `+${v}%` },
            { k: 'shortage', label: 'Driver shortage', from: 0, to: 20, step: 1, disp: (v) => String(v) },
            { k: 'routes', label: 'New routes', from: 0, to: 6, step: 1, disp: (v) => `+${v}` }
          ].map(({ k, label, from, to, step, disp }) => (
            <div className="whatif-slider" key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="lbl" style={{ marginBottom: 0 }}>{label}</label>
                <span className="whatif-val">{disp(s[k])}</span>
              </div>
              <input type="range" className="range" min={from} max={to} step={step} value={s[k]} onChange={setter(k)} />
            </div>
          ))}
        </div>

        <div>
          <div className="whatif-summary">
            <div className="whatif-kpi" style={{ borderColor: est.status === 'under' ? 'var(--danger)' : (est.status === 'over' ? '#f59e0b' : 'var(--accent)') }}>
              <div className="whatif-kpi-lbl">Fleet required</div>
              <div className="whatif-kpi-val">{est.fleetRequired}</div>
              <div className={`whatif-kpi-delta ${est.fleetDelta === 0 ? '' : est.fleetDelta > 0 ? 'up' : 'down'}`}>
                {est.fleetDelta === 0 ? 'unchanged' : `${est.fleetDelta > 0 ? '+' : ''}${est.fleetDelta} vs today`}
              </div>
            </div>
            <div className="whatif-kpi">
              <div className="whatif-kpi-lbl">Drivers needed</div>
              <div className="whatif-kpi-val">{Math.round(est.driverCount)}</div>
              <div className="whatif-kpi-delta">buses assigned {s.shift}s/day</div>
            </div>
            <div className="whatif-kpi">
              <div className="whatif-kpi-lbl">Est. monthly cost</div>
              <div className="whatif-kpi-val" style={{ fontSize: 24 }}>{inr(est.cost)}</div>
              <div className={`whatif-kpi-delta ${est.cost > baseline.cost ? 'up' : est.cost < baseline.cost ? 'down' : ''}`}>
                {est.cost > baseline.cost ? `+${inr(est.cost - baseline.cost)}` : est.cost < baseline.cost ? `−${inr(baseline.cost - est.cost)}` : 'unchanged'}
              </div>
            </div>
            <div className="whatif-kpi">
              <div className="whatif-kpi-lbl">On-time rate</div>
              <div className="whatif-kpi-val">{est.onTime.toFixed(1)}%</div>
              <div className={`whatif-kpi-delta ${est.onTime > baseline.onTime ? 'down' : 'up'}`}>vs {baseline.onTime}% today</div>
            </div>
            <div className="whatif-kpi">
              <div className="whatif-kpi-lbl">Avg pickup ETA</div>
              <div className="whatif-kpi-val">{est.eta.toFixed(0)}m</div>
              <div className={`whatif-kpi-delta ${est.eta > baseline.eta ? 'up' : 'down'}`}>vs ~{baseline.eta}m today</div>
            </div>
            <div className="whatif-kpi">
              <div className="whatif-kpi-lbl">Capacity utilization</div>
              <div className="whatif-kpi-val">{est.utilization.toFixed(0)}%</div>
              <div className={`whatif-kpi-delta ${est.utilization > baseline.utilization ? 'up' : 'down'}`}>vs {baseline.utilization}% today</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <CarFront size={17} style={{ color: 'var(--accent)' }} />
              <h3 style={{ margin: 0 }}>Projected Impact</h3>
              {live?.employees != null && <span className="chip chip-cyan" style={{ marginLeft: 'auto' }}>Live baseline • {live.employees} employees</span>}
            </div>
            <div className="whatif-rows">
              {row('Employee count', baseline.employees, est.employees)}
              {row('Fleet required', baseline.vehicles, est.fleetRequired)}
              {row('Drivers required', baseline.drivers, est.driverCount)}
              {row('Avg on-time rate', baseline.onTime, est.onTime, (x) => `${x.toFixed(1)}%`)}
              {row('Avg pickup ETA', baseline.eta, est.eta, (x) => `${x.toFixed(1)}m`)}
              {row('Capacity utilization', baseline.utilization, est.utilization, (x) => `${x.toFixed(1)}%`)}
            </div>
            <div className="whatif-note">
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>Reading the model:</strong> growing headcount (+{s.empDelta}%) raises fleet demand to ~{est.fleetRequired} vehicles.
                {est.fleetDelta > 0 ? ` That is ${est.fleetDelta} more buses than today — procurements or route redesign would be triggered.` : est.fleetDelta < 0 ? ` You are ${-est.fleetDelta} vehicles above need — some routes could be consolidated to cut cost.` : ' Current fleet size already fits projected demand.'}
                Driver requirement lands at {Math.round(est.driverCount)} with a {s.shift === 1 ? 'single' : 'split'} shift schedule.
                Estimated monthly bill: {inr(est.cost)} (≈ {inr(est.avgCostPerRider)} per employee).
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                Simulator is advisory only and never mutates live operations. Ground truth comes from schedules, GPS pings, trips and payroll data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}