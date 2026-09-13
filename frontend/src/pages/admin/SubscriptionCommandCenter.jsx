import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, useToast, Modal } from '../../components/ui';
import { useInterval } from '../../components/ui';
import { CreditCard, CheckCircle, XCircle, Clock, AlertTriangle, Shield, Users, Zap } from 'lucide-react';

const STATE_COLORS = {
  PENDING_APPROVAL: 'amber', TRIAL_PENDING: 'amber', TRIAL_ACTIVE: 'green', TRIAL_EXPIRING: 'amber',
  TRIAL_EXPIRED: 'red', PAYMENT_REQUIRED: 'red', PAYMENT_SUBMITTED: 'blue', PAYMENT_VERIFIED: 'blue',
  ACTIVE: 'green', PAYMENT_DUE: 'amber', GRACE_PERIOD: 'red', SUSPENDED: 'red', EXPIRED: 'red', TERMINATED: 'slate'
};
const STATE_ICONS = {
  PENDING_APPROVAL: Clock, TRIAL_PENDING: Clock, TRIAL_ACTIVE: Zap, TRIAL_EXPIRING: AlertTriangle,
  TRIAL_EXPIRED: XCircle, PAYMENT_REQUIRED: CreditCard, PAYMENT_SUBMITTED: CreditCard, PAYMENT_VERIFIED: CheckCircle,
  ACTIVE: CheckCircle, PAYMENT_DUE: AlertTriangle, GRACE_PERIOD: AlertTriangle, SUSPENDED: XCircle, EXPIRED: XCircle, TERMINATED: XCircle
};

export default function SubscriptionCommandCenter() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [verifyModal, setVerifyModal] = useState(null);
  const [verifyDecision, setVerifyDecision] = useState('VERIFIED');
  const [verifyReason, setVerifyReason] = useState('');
  const [tab, setTab] = useState('overview');

  const load = () => {
    api.get('/api/v3/subscription/command-center').then((r) => { setData(r); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 30000);

  const loadDetail = (companyId) => {
    setSelected(companyId);
    api.get(`/api/v3/subscription/company/${companyId}`).then((r) => setDetail(r)).catch(() => {});
  };

  const doAction = async (url, body = {}) => {
    setActionLoading(true);
    try {
      await api.post(url, body);
      toast('Action completed');
      load();
      if (selected) loadDetail(selected);
    } catch (e) { toast(e.message, 'err'); }
    setActionLoading(false);
  };

  const doVerify = async () => {
    if (!verifyModal) return;
    setActionLoading(true);
    try {
      await api.post(`/api/v3/subscription/payments/${verifyModal.id}/verify`, { decision: verifyDecision, reason: verifyReason });
      toast(`Payment ${verifyDecision.toLowerCase()}`);
      setVerifyModal(null);
      load();
      if (selected) loadDetail(selected);
    } catch (e) { toast(e.message, 'err'); }
    setActionLoading(false);
  };

  if (loading) return <div className="page"><div className="card"><div className="empty">Loading...</div></div></div>;
  if (!data) return <div className="page"><div className="card"><div className="empty">Failed to load command center</div></div></div>;

  const { counts = {}, payment_verification_queue = [], activation_queue = [], trials_expiring = [], upcoming_renewals = [] } = data;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Shield size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Subscription Command Center</div>
          <div className="page-sub">Platform-wide subscription oversight. Approve trials, verify payments, manage company access.</div>
        </div>
        <Badge color="blue">{total} companies</Badge>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['overview', 'Overview'], ['payments', `Payment Queue (${payment_verification_queue.length})`], ['activations', `Activation Queue (${activation_queue.length})`], ['expiring', `Expiring (${trials_expiring.length})`], ['renewals', `Renewals (${upcoming_renewals.length})`]].map(([k, label]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', marginBottom: 20 }}>
            {Object.entries(counts).filter(([, v]) => v > 0).map(([state, count]) => {
              const Icon = STATE_ICONS[state] || Clock;
              return (
                <div key={state} className="card" style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => {
                  const sub = activation_queue.find((s) => s.status === state) || trials_expiring.find((s) => s.status === state) || upcoming_renewals.find((s) => s.status === state);
                  if (sub) loadDetail(sub.company_id);
                }}>
                  <Icon size={20} style={{ color: `var(--${STATE_COLORS[state] === 'green' ? 'green' : STATE_COLORS[state] === 'red' ? 'red' : STATE_COLORS[state] === 'amber' ? 'amber' : 'blue'})`, margin: '0 auto 6px' }} />
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{count}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{state.replace(/_/g, ' ').toLowerCase()}</div>
                </div>
              );
            })}
          </div>

          {payment_verification_queue.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CreditCard size={16} /> Pending Payment Verification
              </h3>
              {payment_verification_queue.slice(0, 5).map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Company #{p.company_id} — ₹{Number(p.amount).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.method} · {p.submitted_at || '—'} · {p.external_reference || 'No ref'}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => setVerifyModal(p)}>Review</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'payments' && (
        <div className="card">
          {payment_verification_queue.length === 0 ? <div className="empty">No pending payments</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>ID</th><th style={{ padding: '8px 10px' }}>Company</th><th style={{ padding: '8px 10px' }}>Amount</th><th style={{ padding: '8px 10px' }}>Method</th><th style={{ padding: '8px 10px' }}>Submitted</th><th style={{ padding: '8px 10px' }}>Action</th>
                </tr></thead>
                <tbody>{payment_verification_queue.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px' }}>#{p.id}</td>
                    <td style={{ padding: '8px 10px' }}>{p.company_id}</td>
                    <td style={{ padding: '8px 10px' }}>₹{Number(p.amount).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>{p.method}</td>
                    <td style={{ padding: '8px 10px' }}>{p.submitted_at}</td>
                    <td style={{ padding: '8px 10px' }}><button className="btn btn-sm btn-primary" onClick={() => setVerifyModal(p)}>Review</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'activations' && (
        <div className="card">
          {activation_queue.length === 0 ? <div className="empty">No pending activations</div> : activation_queue.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Company #{s.company_id}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.status.replace(/_/g, ' ')} · Updated {s.updated_at || '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.status === 'TRIAL_PENDING' && <button className="btn btn-sm btn-green" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${s.company_id}/trial/approve`)}>Approve Trial</button>}
                {s.status === 'PAYMENT_VERIFIED' && <button className="btn btn-sm btn-green" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${s.company_id}/activate`)}>Activate</button>}
                <button className="btn btn-sm btn-outline" onClick={() => loadDetail(s.company_id)}>Detail</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'expiring' && (
        <div className="card">
          {trials_expiring.length === 0 ? <div className="empty">No trials expiring soon</div> : trials_expiring.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Company #{s.company_id}</div>
                <div style={{ fontSize: 12, color: 'var(--amber)' }}>Trial ends {s.trial_end_at || '—'}</div>
              </div>
              <Badge color="amber">Expiring</Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'renewals' && (
        <div className="card">
          {upcoming_renewals.length === 0 ? <div className="empty">No upcoming renewals</div> : upcoming_renewals.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Company #{s.company_id}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.status.replace(/_/g, ' ')} · Renewal {s.renewal_date || '—'}</div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => loadDetail(s.company_id)}>Detail</button>
            </div>
          ))}
        </div>
      )}

      {selected && detail && (
        <Modal open={!!selected} title={`Company #${selected} — Subscription Detail`} onClose={() => { setSelected(null); setDetail(null); }} wide>
          <div style={{ padding: 16 }}>
            {detail.subscription && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                  <Badge color={STATE_COLORS[detail.subscription.status] || 'slate'}>{detail.subscription.status.replace(/_/g, ' ')}</Badge>
                </div>
                {detail.subscription.trial_start_at && (
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Trial Period</div>
                    <div style={{ fontSize: 13 }}>{detail.subscription.trial_start_at?.slice(0, 10)} → {detail.subscription.trial_end_at?.slice(0, 10)}</div>
                    {detail.days_remaining != null && <div style={{ fontSize: 12, color: detail.days_remaining <= 3 ? 'var(--red)' : 'var(--muted)' }}>{detail.days_remaining} days remaining</div>}
                  </div>
                )}
                {detail.subscription.subscription_start_at && (
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Subscription Period</div>
                    <div style={{ fontSize: 13 }}>{detail.subscription.subscription_start_at?.slice(0, 10)} → {detail.subscription.subscription_end_at?.slice(0, 10)}</div>
                  </div>
                )}
              </div>
            )}

            {detail.plan && (
              <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Current Plan</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{detail.plan.name || 'Default Plan'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>₹{detail.plan.price || 0}/{detail.plan.interval || 'month'}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="btn btn-sm btn-green" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${selected}/trial/approve`)}>Approve Trial</button>
              <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${selected}/activate`)}>Activate</button>
              <button className="btn btn-sm btn-outline" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${selected}/renew`)}>Renew</button>
              <button className="btn btn-sm btn-outline" disabled={actionLoading} onClick={() => doAction(`/api/v3/subscription/company/${selected}/reactivate`)}>Reactivate</button>
              <button className="btn btn-sm btn-danger" disabled={actionLoading} onClick={() => {
                const reason = prompt('Suspend reason:');
                if (reason != null) doAction(`/api/v3/subscription/company/${selected}/suspend`, { reason });
              }}>Suspend</button>
              <button className="btn btn-sm btn-danger" disabled={actionLoading} onClick={() => {
                const reason = prompt('Termination reason:');
                if (reason != null) doAction(`/api/v3/subscription/company/${selected}/terminate`, { reason });
              }}>Terminate</button>
            </div>

            {detail.payments && detail.payments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Payment History</div>
                {detail.payments.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                    <div>₹{Number(p.amount).toLocaleString()} — {p.method}</div>
                    <Badge color={p.verification_status === 'VERIFIED' ? 'green' : p.verification_status === 'REJECTED' ? 'red' : 'amber'}>{p.verification_status}</Badge>
                  </div>
                ))}
              </div>
            )}

            {detail.events && detail.events.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Recent Events</div>
                {detail.events.slice(0, 10).map((e) => (
                  <div key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{e.from_state} → <b>{e.to_state}</b></span>
                    <span style={{ color: 'var(--muted)' }}>{e.created_at}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      <Modal open={!!verifyModal} title="Verify Payment" onClose={() => { setVerifyModal(null); setVerifyReason(''); }}>
        <div style={{ padding: 16 }}>
          {verifyModal && (
            <div style={{ marginBottom: 16, fontSize: 13 }}>
              <div>Company #{verifyModal.company_id} — ₹{Number(verifyModal.amount).toLocaleString()}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>{verifyModal.method} · Ref: {verifyModal.external_reference || '—'}</div>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Decision</label>
            <select value={verifyDecision} onChange={(e) => setVerifyDecision(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
              <option value="VERIFIED">Approve (VERIFIED)</option>
              <option value="REJECTED">Reject</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason {verifyDecision === 'REJECTED' ? '(required)' : '(optional)'}</label>
            <textarea value={verifyReason} onChange={(e) => setVerifyReason(e.target.value)} rows={3} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setVerifyModal(null); setVerifyReason(''); }}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={actionLoading || (verifyDecision === 'REJECTED' && !verifyReason)} onClick={doVerify}>{actionLoading ? 'Processing...' : 'Submit'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
