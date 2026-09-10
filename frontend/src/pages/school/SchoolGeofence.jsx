import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useInterval, Badge } from '../../components/ui';
import { useSocketEvent } from '../../socket';

export default function SchoolGeofence() {
  const [list, setList] = useState([]);
  const load = () => api.get('/api/school/geofence').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 30000);
  useSocketEvent('geofence', () => load());

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Geofence Log</div>
          <div className="page-sub">Every time a bus enters or leaves a safety zone, it's recorded here.</div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Time</th><th>Event</th><th>Bus</th><th>Zone</th><th>Student</th></tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 13 }}>{String(e.created_at || '').slice(0, 19)}</td>
                  <td>{e.event === 'enter' ? <Badge color="green">Entered</Badge> : <Badge color="red">Left</Badge>}</td>
                  <td style={{ fontSize: 13 }}>{e.vehicle_name || '—'}</td>
                  <td style={{ fontSize: 13 }}>{e.zone_name || '—'}</td>
                  <td style={{ fontSize: 13 }}>{e.student_name || '—'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5}><div className="empty">No geofence events yet. Events appear when buses cross a safety zone.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}