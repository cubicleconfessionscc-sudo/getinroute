import React, { useEffect, useRef, useState } from 'react';
import { api, todayStr, downloadCsv } from '../../api';

const TABS = [
  { key: 'users', label: 'Employees & Drivers', desc: 'All employee / driver / student / parent accounts, unscoped.' },
  { key: 'vehicles', label: 'Vehicles', desc: 'All vehicles with status and live positions.' },
  { key: 'schedules', label: 'Schedules', desc: 'All schedules joined with employee, vehicle and route.' },
  { key: 'checkins', label: 'Check-Ins', desc: 'All confirmed check-in / check-out rows with GPS locations.' },
  { key: 'trips', label: 'Trips', desc: 'Per-passenger trip records for a selected date.' }
];

const ENTITY_LABEL = { employees: 'Employees', drivers: 'Drivers', vehicles: 'Vehicles', routes: 'Routes', vendors: 'Vendors' };

const EXAMPLES = {
  employees: 'name,email,emp_id,phone,designation,department,home_address,home_lat,home_lng\nRavi Kumar,ravi@company.com,E1001,+91 9845010001,Engineer,Engineering,Whitefield,12.9698,77.7500',
  drivers: 'name,email,emp_id,phone,vehicle_plate,driver_verified\nSuresh,su@company.com,E2001,+91 9845020002,Bengaluru-BS6,1',
  vehicles: 'vehicle_name,plate,type,capacity,line,trip\nMaruti Swift,KA-01-AB-1234,Cab,4,1,1',
  routes: 'name,start_point,end_point,speed_limit,stops\nRoute A,Office,Mall,40,"ST-1@12.9698,77.7500;ST-2@12.9700,77.7600"',
  vendors: 'name,email,phone,vendor_code,assigned_locations\nKaveri Cabs,kmcabs@vendor.in,+91 9845030003,KMC,Koramangala;Whitefield'
};

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const inputStyle = {
  width: '100%', maxWidth: 620, padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--border, #ccc)', background: 'var(--input-bg, #fff)', color: 'inherit', fontSize: 13
};
const labelStyle = { fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' };

function Card({ title, children, style }) {
  return (
    <div style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 14, background: 'var(--card-bg, #fff)', ...style }}>
      {title && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>}
      {children}
    </div>
  );
}
function Stat({ k, v, color }) {
  return (
    <div style={{ flex: 1, minWidth: 120, border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'inherit' }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{k}</div>
    </div>
  );
}

export default function RawDataPage() {
  const [mode, setMode] = useState('read');

  // ---- read mode (existing) ----
  const [tab, setTab] = useState('users');
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    const q = tab === 'trips' ? `?date=${date}` : '';
    api.get(`/api/owner/data/${tab}${q}`)
      .then((d) => setData(d && typeof d === 'object' ? d : { rows: [] }))
      .catch((e) => setError(e.message || 'Access denied'))
      .finally(() => setLoading(false));
  }, [tab, date]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  const copyJson = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); alert('Copied JSON to clipboard'); }
    catch { alert('Could not copy — see browser console'); }
  };
  const download = () => {
    const csv = [cols, ...rows.map((r) => cols.map((c) => `"${String(fmt(r[c])).replace(/"/g, '""')}"`).join(','))].map((l) => l.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `owner-${tab}${tab === 'trips' ? '-' + date : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- import mode ----
  const [entity, setEntity] = useState('employees');
  const [mapping, setMapping] = useState([]);
  const [pasteText, setPasteText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileData, setFileData] = useState('');
  const [preview, setPreview] = useState(null);
  const [commit, setCommit] = useState(null);
  const [dupPolicy, setDupPolicy] = useState('skip');
  const [backupFirst, setBackupFirst] = useState(true);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [impErr, setImpErr] = useState('');
  const fileRef = useRef(null);

  const loadMapping = (e) => {
    api.post('/api/owner/raw/mapping', { entity: e })
      .then((d) => setMapping(d.mapping || []))
      .catch(() => setMapping([]));
  };
  useEffect(() => { loadMapping(entity); }, [entity]);

  const loadLog = async () => {
    try { const d = await api.get('/api/owner/raw/import/log'); setLog(Array.isArray(d.rows) ? d.rows : []); } catch {}
  };
  useEffect(() => { if (mode === 'import') loadLog(); }, [mode]);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      reader.onload = () => setFileData(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(f);
    } else {
      reader.onload = () => setFileText(String(reader.result));
      reader.readAsText(f);
    }
  };

  const doPreview = async () => {
    setImpErr(''); setCommit(null);
    if (!entity) return setImpErr('Pick an entity.');
    const body = { entity };
    if (fileData) { body.source = 'xlsx'; body.fileName = fileName || 'sheet.xlsx'; body.fileData = fileData; }
    else if (fileName) { if (!fileText.trim()) return setImpErr('Read that file first — pick it again if empty.'); body.source = 'paste'; body.text = fileText; }
    else { if (!pasteText.trim()) return setImpErr('Paste data or upload a CSV / Excel file.'); body.source = 'paste'; body.text = pasteText; }
    setBusy(true); setPreview(null);
    try {
      const d = await api.post('/api/owner/raw/import/preview', body);
      setPreview({ ...d, token: d.token });
    } catch (e) { setImpErr(e.message || 'Preview failed'); }
    finally { setBusy(false); }
  };

  const doCommit = async (tok) => {
    setBusy(true); setImpErr('');
    try {
      const d = await api.post('/api/owner/raw/import/commit', { token: tok, duplicatePolicy: dupPolicy, backupFirst });
      setCommit(d);
      setPreview(null);
      await loadLog();
    } catch (e) { setImpErr(e.message || 'Commit failed'); }
    finally { setBusy(false); }
  };

  const pv = preview;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Raw Data <span style={{ fontSize: 13, fontWeight: 500 }}>(all companies)</span></h2>
        <div className="spacer" />
        <button className={`btn btn-sm ${mode === 'read' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('read')}>View data</button>
        <button className={`btn btn-sm ${mode === 'import' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('import')}>Import & Audit</button>
      </div>

      {mode === 'read' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {TABS.map((t) => (
              <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn btn-outline btn-sm" disabled={!rows.length} onClick={copyJson}>Copy JSON</button>
            <button className="btn btn-green btn-sm" disabled={!rows.length} onClick={download}>CSV</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{TABS.find((t) => t.key === tab)?.desc}</div>
          {tab === 'trips' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, marginRight: 8 }}>Trip date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
          {loading ? <div className="empty">Loading…</div> : error ? (
            <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div>
          ) : (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <b>{data?.count ?? rows.length}</b> records · generated {data?.generatedAt || '—'}
            </div>
          )}
          {!loading && !error && (rows.length ? (
            <div style={{ overflowX: 'auto' }}><TBody rows={rows} /></div>
          ) : <div className="empty">No records.</div>)}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Import employees, drivers, vehicles, routes or vendors from pasted text, CSV or Excel. Nothing is written at
            Preview — Commit runs inside one transaction (all-or-nothing + <b>auto backup</b> by default), records an audit
            log and notifies admins in-app.
          </div>

          <Card title="1 · What are you importing?">
            <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
              {Object.keys(ENTITY_LABEL).map((k) => <option key={k} value={k}>{ENTITY_LABEL[k]}</option>)}
            </select>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {mapping.map((m) => (
                <span key={m.field} style={{ border: '1px solid var(--border, #ddd)', borderRadius: 12, padding: '2px 8px' }}>
                  {m.field}{m.required ? ' *' : ''}
                </span>
              ))}
            </div>
          </Card>

          <Card title="2 · Provide the data">
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Paste or type below <span style={{ fontWeight: 400 }}>(CSV — first row = column names)</span></label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={EXAMPLES[entity]}
                style={{ ...inputStyle, fontFamily: 'monospace', maxWidth: 740 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
                {fileName ? `Re-choose file (${fileName})` : '… or upload CSV / XLSX'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" style={{ display: 'none' }} onChange={onFile} />
              {fileName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fileData ? fileText ? 'xlsx' : 'xlsx (base64 ready)' : fileText ? `${fileText.split(/\r?\n/).length} lines` : 'reading…'}</span>}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={doPreview}>
                {busy ? 'Processing…' : 'Preview (validate only)'}
              </button>
            </div>
          </Card>

          {impErr && <div className="empty" style={{ color: 'var(--danger)' }}>{impErr}</div>}

          {pv && (
            <Card title="3 · Validation result">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <Stat k="total" v={pv.stats?.total} />
                <Stat k="valid" v={pv.stats?.valid} color="var(--good, #16a34a)" />
                <Stat k="invalid" v={pv.stats?.invalid} color="var(--danger)" />
                <Stat k="duplicate" v={pv.stats?.duplicate} color="#d97706" />
              </div>
              {pv.stats?.valid > 0 && (
                <div style={{ marginBottom: 14, fontSize: 13 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 18 }}>
                    Duplicates
                    <select value={dupPolicy} onChange={(e) => setDupPolicy(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '5px 8px' }}>
                      <option value="skip">Skip (import the rest)</option>
                      <option value="reject">Reject whole import</option>
                    </select>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} />
                    Take an automatic DB backup first
                  </label>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-green btn-sm" disabled={busy} onClick={() => doCommit(pv.token)}>
                      {busy ? 'Committing…' : `Commit ${pv.stats.valid} row${pv.stats.valid === 1 ? '' : 's'}`}
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>preview token valid ~15 min · {pv.stats.valid > 0 ? 'writes only the valid rows' : 'nothing to write'}</span>
                  </div>
                </div>
              )}
              {pv.preview?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Valid rows (first {pv.preview.length})</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl"><TBody rows={pv.preview.map((r) => ({ line: r.line, ...r.values }))} /></table>
                  </div>
                </div>
              )}
              {pv.issues?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Rows with problems ({pv.issues.length} shown of {pv.stats?.invalid + pv.stats?.duplicate})</div>
                  <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead><tr><th>Line</th><th>Data</th><th>Why</th></tr></thead>
                    <tbody>
                      {pv.issues.map((r, i) => (
                        <tr key={i}>
                          <td>{r.line}</td>
                          <td style={{ fontSize: 12, maxWidth: 420, overflowWrap: 'anywhere' }}>{fmt(r.values)}</td>
                          <td style={{ fontSize: 12, color: 'var(--danger)' }}>{r.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {commit && (
            <Card title="4 · Commit result">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <Stat k="inserted" v={commit.summary?.inserted} color="var(--good, #16a34a)" />
                <Stat k="skipped (duplicates)" v={commit.summary?.skipped} color="#d97706" />
                <Stat k="rejected" v={commit.summary?.rejected} color="var(--danger)" />
              </div>
              <div style={{ fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>This run was recorded in the audit log below.</span>
                {commit.rejectedCount > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/owner/raw/import/rejected/${log[0]?.id || ''}`, `rejected-${commit.summary?.entity}-${Date.now()}.csv`)}>
                    Download rejected / skipped rows (CSV)
                  </button>
                )}
                <button className="btn btn-outline btn-sm" onClick={loadLog}>Refresh audit log</button>
              </div>
            </Card>
          )}

          <Card title="Audit log (last 100 imports)">
            {log.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>#</th><th>When</th><th>By</th><th>Entity</th><th>File</th><th>Total</th><th>Valid</th><th>Dup</th><th>Errors</th><th>Inserted</th><th>Skipped</th><th>Rejected CSV</th></tr>
                  </thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.created_at}</td>
                        <td>{r.user_name || '—'}</td>
                        <td>{r.entity}</td>
                        <td>{r.filename || '—'}</td>
                        <td>{r.total_rows}</td>
                        <td>{r.valid_rows}</td>
                        <td>{r.duplicate_rows}</td>
                        <td>{r.error_rows}</td>
                        <td>{r.inserted_rows}</td>
                        <td>{r.skipped_rows}</td>
                        <td>{r.error_rows > 0 || r.skipped_rows > 0 ? <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/owner/raw/import/rejected/${r.id}`, `rejected-${r.id}.csv`)}>CSV</button> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No imports yet.</div>}
          </Card>
        </div>
      )}
    </div>
  );
}

function TBody({ rows }) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <>
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c} style={{ fontSize: 12 }}>{fmt(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </>
  );
}