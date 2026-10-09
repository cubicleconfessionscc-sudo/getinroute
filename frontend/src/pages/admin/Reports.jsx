import React, { useEffect, useState } from 'react';
import { api, downloadCsv, downloadFile } from '../../api';
import { useToast } from '../../components/ui';
import { BarChart3, Download, FileSpreadsheet } from 'lucide-react';

const REPORT_KINDS = [
  { key: 'operations', label: 'Operations', desc: 'Trip completion, cancellation, and no-show rates by date' },
  { key: 'fleet', label: 'Fleet', desc: 'Vehicle usage, capacity, and completion rates' },
  { key: 'drivers', label: 'Drivers', desc: 'Driver trip counts and completion stats' },
  { key: 'routes', label: 'Routes', desc: 'Route utilization, stops, and trip counts' },
  { key: 'vendors', label: 'Vendors', desc: 'Vendor status and login activity' },
  { key: 'safety', label: 'Safety', desc: 'Speed events and compliance violations' },
  { key: 'financial', label: 'Financial', desc: 'Billing records and financial data' },
];

export default function Reports() {
  const toast = useToast();
  const [kind, setKind] = useState('operations');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = (k) => {
    setKind(k);
    setLoading(true);
    setData(null);
    api.get('/api/v3/reports/' + k).then((r) => setData(r)).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false));
  };
  useEffect(() => { load('operations'); }, []);

  const rows = data && data.rows ? data.rows : [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const exportReport = async (xlsx) => {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const name = `GetInRoute_${label}_Report_${new Date().toISOString().slice(0, 10)}`;
    try {
      if (xlsx) await downloadFile(`/api/admin/export/report/${kind}.xlsx`, name + '.xlsx');
      else await downloadCsv(`/api/admin/export/report/${kind}`, name + '.csv');
      toast(`${xlsx ? 'Excel' : 'CSV'} exported`);
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><BarChart3 size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Analytics Reports</div>
          <div className="page-sub">Platform-wide operational analytics and reports.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {REPORT_KINDS.map((r) => (
          <button key={r.key} className={`btn btn-sm ${kind === r.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => load(r.key)}>{r.label}</button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{REPORT_KINDS.find((r) => r.key === kind)?.desc || ''}</div>

      {loading ? (
        <div className="card"><div className="empty">Loading report...</div></div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty">No data available for this report</div></div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={() => exportReport(false)} disabled={!rows.length}><Download size={14} /> Export CSV</button>
            <button className="btn btn-green btn-sm" onClick={() => exportReport(true)} disabled={!rows.length}><FileSpreadsheet size={14} /> Export Excel</button>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                {columns.map((c) => (
                  <th key={c} style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{c.replace(/_/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  {columns.map((c) => (
                    <td key={c} style={{ padding: '8px 10px' }}>{row[c] != null ? String(row[c]) : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
