import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge, Modal } from '../../components/ui';
import { DollarSign, Plus, FileText, CheckCircle } from 'lucide-react';

export default function BillingOps() {
  const toast = useToast();
  const [tab, setTab] = useState('rates');
  const [rates, setRates] = useState([]);
  const [records, setRecords] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rateModal, setRateModal] = useState(false);
  const [newRate, setNewRate] = useState({ rate_key: '', name: '', unit: 'trip', base_amount: 0, per_unit_amount: 0, waiting_rate: 0, cancellation_fee: 0, no_show_fee: 0, tax_rate: 0 });
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ type: 'credit', amount: 0, reason: '' });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/api/v3/billing/rates').then((r) => setRates(Array.isArray(r) ? r : [])).catch(() => setRates([])),
      api.get('/api/v3/billing/list?kind=records').then((r) => setRecords(Array.isArray(r) ? r : [])).catch(() => setRecords([])),
      api.get('/api/v3/billing/list?kind=invoices').then((r) => setInvoices(Array.isArray(r) ? r : [])).catch(() => setInvoices([])),
    ]).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const addRate = async () => {
    try {
      await api.put('/api/v3/billing/rates', newRate);
      toast('Rate saved');
      setRateModal(false);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const adjust = async () => {
    if (!adjustModal) return;
    try {
      await api.post('/api/v3/billing/adjust', { invoiceId: adjustModal.id, ...adjustForm });
      toast('Adjustment applied');
      setAdjustModal(null);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><DollarSign size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Billing Operations</div>
          <div className="page-sub">Operational/vendor billing management. Rates, records, invoices, adjustments.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['rates', 'Rates', rates.length], ['records', 'Records', records.length], ['invoices', 'Invoices', invoices.length]].map(([k, label, count]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>{label} ({count})</button>
        ))}
      </div>

      {tab === 'rates' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Billing Rates</div>
            <button className="btn btn-primary btn-sm" onClick={() => setRateModal(true)}><Plus size={14} /> Add Rate</button>
          </div>
          {rates.length === 0 ? <div className="empty">No billing rates configured</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Key</th><th style={{ padding: '8px 10px' }}>Name</th><th style={{ padding: '8px 10px' }}>Unit</th><th style={{ padding: '8px 10px' }}>Base</th><th style={{ padding: '8px 10px' }}>Per Unit</th><th style={{ padding: '8px 10px' }}>Tax</th><th style={{ padding: '8px 10px' }}>Currency</th>
                </tr></thead>
                <tbody>{rates.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, fontFamily: 'monospace' }}>{r.rate_key}</td>
                    <td style={{ padding: '8px 10px' }}>{r.name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{r.unit}</td>
                    <td style={{ padding: '8px 10px' }}>{r.base_amount}</td>
                    <td style={{ padding: '8px 10px' }}>{r.per_unit_amount}</td>
                    <td style={{ padding: '8px 10px' }}>{r.tax_rate}%</td>
                    <td style={{ padding: '8px 10px' }}>{r.currency}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'records' && (
        <div className="card">
          {records.length === 0 ? <div className="empty">No billing records</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>ID</th><th style={{ padding: '8px 10px' }}>Type</th><th style={{ padding: '8px 10px' }}>Gross</th><th style={{ padding: '8px 10px' }}>Tax</th><th style={{ padding: '8px 10px' }}>Net</th><th style={{ padding: '8px 10px' }}>Date</th><th style={{ padding: '8px 10px' }}>Status</th>
                </tr></thead>
                <tbody>{records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px' }}>#{r.id}</td>
                    <td style={{ padding: '8px 10px' }}>{r.record_type}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(r.gross_amount).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(r.tax).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>₹{Number(r.net_amount).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>{r.trip_date}</td>
                    <td style={{ padding: '8px 10px' }}><Badge color={r.status === 'DRAFT' ? 'amber' : 'green'}>{r.status}</Badge></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="card">
          {invoices.length === 0 ? <div className="empty">No invoices generated</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Invoice</th><th style={{ padding: '8px 10px' }}>Period</th><th style={{ padding: '8px 10px' }}>Gross</th><th style={{ padding: '8px 10px' }}>Adjustments</th><th style={{ padding: '8px 10px' }}>Tax</th><th style={{ padding: '8px 10px' }}>Net</th><th style={{ padding: '8px 10px' }}>Status</th><th style={{ padding: '8px 10px' }}>Action</th>
                </tr></thead>
                <tbody>{invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{inv.invoice_no}</td>
                    <td style={{ padding: '8px 10px' }}>{inv.period_start} → {inv.period_end}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(inv.gross_amount).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(inv.adjustments).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(inv.tax).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>₹{Number(inv.net_amount).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}><Badge color={inv.status === 'MATCHED' ? 'green' : inv.status === 'DRAFT' ? 'amber' : 'blue'}>{inv.status}</Badge></td>
                    <td style={{ padding: '8px 10px' }}>
                      <button className="btn btn-sm btn-outline" onClick={() => setAdjustModal(inv)}>Adjust</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={rateModal} title="Add Billing Rate" onClose={() => setRateModal(false)}>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Rate Key</label><input value={newRate.rate_key} onChange={(e) => setNewRate({ ...newRate, rate_key: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label><input value={newRate.name} onChange={(e) => setNewRate({ ...newRate, name: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit</label><select value={newRate.unit} onChange={(e) => setNewRate({ ...newRate, unit: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}><option value="trip">Trip</option><option value="km">Per KM</option><option value="employee">Per Employee</option></select></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Base Amount</label><input type="number" value={newRate.base_amount} onChange={(e) => setNewRate({ ...newRate, base_amount: Number(e.target.value) })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Per Unit Amount</label><input type="number" value={newRate.per_unit_amount} onChange={(e) => setNewRate({ ...newRate, per_unit_amount: Number(e.target.value) })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tax Rate %</label><input type="number" value={newRate.tax_rate} onChange={(e) => setNewRate({ ...newRate, tax_rate: Number(e.target.value) })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setRateModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={addRate}>Save Rate</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!adjustModal} title={'Adjust Invoice ' + (adjustModal?.invoice_no || '')} onClose={() => setAdjustModal(null)}>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</label>
            <select value={adjustForm.type} onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
              <option value="credit">Credit (reduce)</option>
              <option value="debit">Debit (increase)</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount</label>
            <input type="number" value={adjustForm.amount} onChange={(e) => setAdjustForm({ ...adjustForm, amount: Number(e.target.value) })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason</label>
            <input value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setAdjustModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={adjust}>Apply</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
