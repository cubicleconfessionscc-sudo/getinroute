import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge, Modal } from '../../components/ui';
import { FileText, Plus, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

const VEHICLE_TYPES = ['registration', 'insurance', 'permit', 'fitness', 'pollution'];
const DRIVER_TYPES = ['licence', 'certificate'];

export default function Documents() {
  const toast = useToast();
  const [tab, setTab] = useState('expiring');
  const [expiring, setExpiring] = useState({ vehicle: [], driver: [] });
  const [list, setList] = useState([]);
  const [kind, setKind] = useState('vehicle');
  const [ownerId, setOwnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [newDoc, setNewDoc] = useState({ doc_type: '', doc_number: '', issue_date: '', expiry_date: '' });

  const loadExpiring = () => {
    api.get('/api/v3/documents/expiring?days=30').then((r) => setExpiring(r || { vehicle: [], driver: [] })).catch(() => {});
  };
  const loadList = () => {
    if (!ownerId) return;
    setLoading(true);
    api.get('/api/v3/documents/' + kind + '/' + ownerId).then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { loadExpiring(); }, []);
  useEffect(() => { loadList(); }, [kind, ownerId]);

  const addDoc = async () => {
    if (!ownerId || !newDoc.doc_type) { toast('Please select type and enter owner ID', 'err'); return; }
    try {
      await api.post('/api/v3/documents/' + kind + '/' + ownerId, newDoc);
      toast('Document added');
      setAddModal(false);
      setNewDoc({ doc_type: '', doc_number: '', issue_date: '', expiry_date: '' });
      loadList();
    } catch (e) { toast(e.message, 'err'); }
  };

  const verifyDoc = async (docId, decision) => {
    try {
      await api.post('/api/v3/documents/' + kind + '/' + docId + '/verify', { decision, reason: '' });
      toast('Document ' + decision);
      loadList();
      loadExpiring();
    } catch (e) { toast(e.message, 'err'); }
  };

  const allExpiring = [...(expiring.vehicle || []).map((d) => ({ ...d, _kind: 'vehicle' })), ...(expiring.driver || []).map((d) => ({ ...d, _kind: 'driver' }))];
  const expiredCount = allExpiring.filter((d) => d.expiry_date && d.expiry_date.slice(0, 10) < new Date().toISOString().slice(0, 10)).length;
  const soonCount = allExpiring.length - expiredCount;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><FileText size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Document Management</div>
          <div className="page-sub">Vehicle and driver document compliance, verification, and expiry tracking.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'expiring' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('expiring')}>
          Expiring ({allExpiring.length})
        </button>
        <button className={`btn btn-sm ${tab === 'lookup' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('lookup')}>
          Lookup by ID
        </button>
      </div>

      {tab === 'expiring' && (
        <>
          {expiredCount > 0 && (
            <div className="card" style={{ borderLeft: '4px solid var(--red)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>
                <AlertTriangle size={16} /> {expiredCount} document(s) already expired — action required
              </div>
            </div>
          )}
          {soonCount > 0 && (
            <div className="card" style={{ borderLeft: '4px solid var(--amber)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--amber)', fontWeight: 600, fontSize: 13 }}>
                <Clock size={16} /> {soonCount} document(s) expiring within 30 days
              </div>
            </div>
          )}
          {allExpiring.length === 0 ? (
            <div className="card"><div className="empty">No documents expiring within 30 days</div></div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Kind</th><th style={{ padding: '8px 10px' }}>Owner</th><th style={{ padding: '8px 10px' }}>Type</th><th style={{ padding: '8px 10px' }}>Expiry</th><th style={{ padding: '8px 10px' }}>Status</th>
                </tr></thead>
                <tbody>{allExpiring.map((d) => {
                  const isExpired = d.expiry_date && d.expiry_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={d._kind + d.id} style={{ borderBottom: '1px solid var(--line)', background: isExpired ? 'rgba(239,68,68,.05)' : 'transparent' }}>
                      <td style={{ padding: '8px 10px' }}><Badge color={d._kind === 'vehicle' ? 'blue' : 'violet'}>{d._kind}</Badge></td>
                      <td style={{ padding: '8px 10px' }}>#{d._kind === 'vehicle' ? d.vehicle_id : d.driver_id}</td>
                      <td style={{ padding: '8px 10px' }}>{d.doc_type}</td>
                      <td style={{ padding: '8px 10px', color: isExpired ? 'var(--red)' : 'var(--amber)' }}>{d.expiry_date}</td>
                      <td style={{ padding: '8px 10px' }}><Badge color={isExpired ? 'red' : 'amber'}>{isExpired ? 'Expired' : 'Expiring'}</Badge></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'lookup' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Document Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
                <option value="vehicle">Vehicle</option>
                <option value="driver">Driver</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{kind === 'vehicle' ? 'Vehicle' : 'Driver'} ID</label>
              <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="Enter ID" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, width: 140 }} />
            </div>
            <button className="btn btn-outline btn-sm" onClick={loadList}>Load</button>
            <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}><Plus size={14} /> Add Document</button>
          </div>

          {loading && ownerId ? <div className="empty">Loading...</div> : list.length === 0 && ownerId ? (
            <div className="empty">No documents found for this {kind}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Type</th><th style={{ padding: '8px 10px' }}>Number</th><th style={{ padding: '8px 10px' }}>Issue Date</th><th style={{ padding: '8px 10px' }}>Expiry Date</th><th style={{ padding: '8px 10px' }}>Status</th><th style={{ padding: '8px 10px' }}>Action</th>
                </tr></thead>
                <tbody>{list.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{d.doc_type}</td>
                    <td style={{ padding: '8px 10px' }}>{d.doc_number || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{d.issue_date || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{d.expiry_date || '—'}</td>
                    <td style={{ padding: '8px 10px' }}><Badge color={d.status === 'verified' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'}>{d.status}</Badge></td>
                    <td style={{ padding: '8px 10px', display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-green" onClick={() => verifyDoc(d.id, 'verified')}><CheckCircle size={12} /></button>
                      <button className="btn btn-sm btn-danger" onClick={() => verifyDoc(d.id, 'rejected')}><XCircle size={12} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={addModal} title="Add Document" onClose={() => setAddModal(false)}>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Document Type</label>
            <select value={newDoc.doc_type} onChange={(e) => setNewDoc({ ...newDoc, doc_type: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
              <option value="">Select type</option>
              {(kind === 'vehicle' ? VEHICLE_TYPES : DRIVER_TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Document Number</label>
            <input value={newDoc.doc_number} onChange={(e) => setNewDoc({ ...newDoc, doc_number: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Issue Date</label>
              <input type="date" value={newDoc.issue_date} onChange={(e) => setNewDoc({ ...newDoc, issue_date: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Expiry Date</label>
              <input type="date" value={newDoc.expiry_date} onChange={(e) => setNewDoc({ ...newDoc, expiry_date: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setAddModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={addDoc}>Add</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
