import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge } from '../../components/ui';
import { Save } from 'lucide-react';

const DEFAULTS = {
  displayName: '', primaryColor: '#0d9488', sequenceControl: 'admin', requireDropOtp: false,
  allowCollegeLogin: false, busStopRadiusMeters: 120, missedBoardingWindowMin: 15,
  downloads: { apk: '', play: '' }
};

export default function SchoolSettings() {
  const toast = useToast();
  const [school, setSchool] = useState(null);
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/school/me').then((r) => {
      if (r?.school) setSchool(r.school);
      if (r?.settings) setForm({ ...DEFAULTS, ...(r.settings || {}), downloads: { ...DEFAULTS.downloads, ...(r.settings?.downloads || {}) } });
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.patch('/api/school/settings', form);
      toast('Settings saved');
      setForm({ ...DEFAULTS, ...(r.settings || {}) });
    } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
  };

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">{school?.name || 'School'} configuration</div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save settings'}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Branding</div>
        <div className="form-grid">
          <div className="field"><label>School display name (in app header)</label><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={school?.name || ''} /></div>
          <div className="field"><label>Accent colour</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} style={{ width: 48, height: 36, padding: 0 }} />
              <code>{form.primaryColor}</code>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Safety & sequence</div>
        <div className="form-grid">
          <div className="field">
            <label>Bus stop sequence control</label>
            <select value={form.sequenceControl} onChange={(e) => setForm({ ...form, sequenceControl: e.target.value })}>
              <option value="admin">Admin sets pickup order</option>
              <option value="driver">Driver advances order per bus</option>
            </select>
          </div>
          <div className="field"><label>Bus stop radius (metres)</label><input type="number" value={form.busStopRadiusMeters} onChange={(e) => setForm({ ...form, busStopRadiusMeters: e.target.value })} /></div>
          <div className="field"><label>Missed-boarding window (minutes)</label><input type="number" value={form.missedBoardingWindowMin} onChange={(e) => setForm({ ...form, missedBoardingWindowMin: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.requireDropOtp} onChange={(e) => setForm({ ...form, requireDropOtp: e.target.checked })} />
            Require parent OTP before a drop-off is confirmed <Badge color="amber">2-factor drop-off</Badge>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.allowCollegeLogin} onChange={(e) => setForm({ ...form, allowCollegeLogin: e.target.checked })} />
            Allow college students to log in (per-student switch still required)
          </label>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Download links (shown on the landing page for this school)</div>
        <div className="form-grid">
          <div className="field"><label>School APK URL</label><input value={form.downloads.apk || ''} onChange={(e) => setForm({ ...form, downloads: { ...form.downloads, apk: e.target.value } })} placeholder="/apk/school" /></div>
          <div className="field"><label>Google Play URL</label><input value={form.downloads.play || ''} onChange={(e) => setForm({ ...form, downloads: { ...form.downloads, play: e.target.value } })} placeholder="https://play.google.com/…" /></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Leave blank to use the default web app fallback.</p>
      </div>
    </div>
  );
}