import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, useInterval, Badge } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { ShieldAlert, Check, Phone, MapPin } from 'lucide-react';

export default function SchoolSOS() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const load = () => api.get('/api/school/sos').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 15000);
  useSocketEvent('sos:new', () => load());

  const resolve = async (e) => {
    try { await api.post(`/api/school/sos/${e.id}/resolve`); toast('SOS resolved'); load(); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">SOS & Safety</div>
          <div className="page-sub">Alerts raised by parents, with location and the child's bus.</div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Raised by</th><th>Student</th><th>Bus</th><th>Message</th><th>Location</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 13 }}>#{e.id}</td>
                  <td>
                    <b style={{ fontSize: 13 }}>{e.reporter_name || '—'}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.reporter_role} · {String(e.created_at || '').slice(0, 16)}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>{e.student_name || '—'}</td>
                  <td style={{ fontSize: 13 }}>{e.vehicle_name || '—'}</td>
                  <td style={{ fontSize: 13, maxWidth: 220 }}>{e.message || '—'}</td>
                  <td>
                    {e.lat && e.lng ? (
                      <a href={`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=16/${e.lat}/${e.lng}`} target="_blank" rel="noopener" style={{ color: 'var(--blue)' }}>
                        <MapPin size={13} /> View
                      </a>
                    ) : '—'}
                  </td>
                  <td>{e.status === 'open' ? <Badge color="red">Open</Badge> : <Badge color="green">Resolved</Badge>}</td>
                  <td>
                    {e.status === 'open' ? (
                      <div className="actions">
                        <button className="btn btn-sm btn-green" onClick={() => resolve(e)}><Check size={14} /> Resolve</button>
                        {e.reporter_phone && <a className="btn btn-sm btn-outline" href={`tel:${e.reporter}`}><Phone size={14} /></a>}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>by {e.resolved_by}@{String(e.resolved_at || '').slice(0, 16)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={8}><div className="empty"><ShieldAlert size={18} /> No SOS alerts. Touch wood.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}