import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { Building2, Eye, EyeOff, Clock, ShieldCheck, ChevronLeft, ChevronRight, Sparkles, CheckCircle2, MapPin, Plus, Trash2, X, LocateFixed, Loader2 } from 'lucide-react';
import AddressPicker from '../components/AddressPicker';
import ViewOnMapLink from '../components/ViewOnMapLink';
import MapLibreMap from '../components/MapLibreMap';
import { searchAddress, pickLocation, reverseGeocode } from '../lib/geo';
import { getPosition } from '../lib/geolocation';

// Total steps: 6 to match the previous flow (Company Information, Locations,
// Administrator Information, Review, Pending Approval, Trial Activated).
// Here "Locations" expands into a multi-state, per-city, per-location
// address plan. Each saved address has a label, full address text, and
// lat/lng returned by the Google Maps picker. Duplicate labels per
// (state, city, location) are caught server-side and surfaced inline.
const STEPS = ['Company Information', 'Locations & Addresses', 'Administrator Information', 'Review', 'Pending Approval', 'Trial Activated'];
const TRIAL_POINTS = [
  { icon: <ShieldCheck size={15} />, text: 'No upfront payment' },
  { icon: <Clock size={15} />, text: 'Trial requires owner approval' },
  { icon: <Sparkles size={15} />, text: 'Full platform access during the approved trial' },
  { icon: <Clock size={15} />, text: 'Payment required only after the trial' }
];

// Curated list of major Indian cities per state. The form also accepts a
// free-text "Other" so any city is supported; this is the dropdown only.
const CITY_OPTIONS = {
  'andhra pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati', 'Nellore', 'Kurnool', 'Rajahmundry', 'Kakinada'],
  'arunachal pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang'],
  'assam': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Tezpur'],
  'bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga'],
  'chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg'],
  'goa': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa'],
  'gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar'],
  'haryana': ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Hisar', 'Rohtak'],
  'himachal pradesh': ['Shimla', 'Dharamshala', 'Mandi', 'Solan', 'Kullu'],
  'jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar'],
  'karnataka': ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi', 'Davanagere', 'Tumakuru', 'Udupi'],
  'kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Alappuzha', 'Kannur'],
  'madhya pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas'],
  'maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Thane', 'Navi Mumbai', 'Kolhapur', 'Solapur'],
  'manipur': ['Imphal'],
  'meghalaya': ['Shillong', 'Tura'],
  'mizoram': ['Aizawl', 'Lunglei'],
  'nagaland': ['Kohima', 'Dimapur'],
  'odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Brahmapur', 'Sambalpur', 'Puri'],
  'punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali'],
  'rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Pushkar'],
  'sikkim': ['Gangtok', 'Namchi'],
  'tamil nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Vellore', 'Erode'],
  'telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam'],
  'tripura': ['Agartala'],
  'uttar pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Prayagraj', 'Noida', 'Greater Noida', 'Ghaziabad', 'Meerut', 'Bareilly'],
  'uttarakhand': ['Dehradun', 'Haridwar', 'Rishikesh', 'Haldwani', 'Roorkee'],
  'west bengal': ['Kolkata', 'Howrah', 'Asansol', 'Siliguri', 'Durgapur', 'Darjeeling'],
  'andaman and nicobar islands': ['Port Blair'],
  'chandigarh': ['Chandigarh'],
  'dadra and nagar haveli and daman and diu': ['Daman', 'Diu', 'Silvassa'],
  'delhi': ['New Delhi', 'Delhi'],
  'jammu and kashmir': ['Srinagar', 'Jammu', 'Leh'],
  'ladakh': ['Leh', 'Kargil'],
  'lakshadweep': ['Kavaratti'],
  'puducherry': ['Puducherry', 'Karaikal', 'Mahe', 'Yanam']
};
// Full list of Indian states and union territories. The backend resolves
// both names and 2-letter codes; the dropdown is alphabetical by name.
const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

function defaultStateName() {
  return '';
}
function defaultCityFor(state) {
  return '';
}

// Canonicalise a state/UT name coming from the geocoder (often "Karnataka",
// sometimes "Karnataka, India") against our dropdown list. Returns null when it
// is not a recognised Indian state so callers can fall back.
function resolveIndianState(raw) {
  const needle = String(raw || '').split(',')[0].trim().toLowerCase();
  if (!needle) return null;
  const exact = INDIAN_STATES.find((s) => s.toLowerCase() === needle);
  if (exact) return exact;
  return INDIAN_STATES.find((s) => s.toLowerCase().includes(needle) || needle.includes(s.toLowerCase())) || null;
}

export default function CompanyOnboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // Step 1 — company details
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [phone, setPhone] = useState('');
  // Step 2 — multi-state + per-city + per-location address plan
  // plan: [{ state: 'Karnataka', cities: [{ name: 'Bengaluru', locations: [
  //   { name: 'Bangalore Location 1', address: '...', lat: 12.97, lng: 77.59 }
  // ]}]}]
  const [plan, setPlan] = useState([]);
  // Step 3 — admin
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  // Codes issued for each location during registration (returned by the API).
  // Shown on the success screen so the company can hand them to the location
  // admins / vendors who sign in scoped to that location.
  const [issuedCodes, setIssuedCodes] = useState([]);
  const [copiedCode, setCopiedCode] = useState('');
  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 1500);
    } catch (e) { /* clipboard unavailable — the code is still visible to copy manually */ }
  }

  // Lookup lists for the Location step
  const [stateSearch, setStateSearch] = useState('');
  const filteredStates = useMemo(() => {
    const s = stateSearch.trim().toLowerCase();
    if (!s) return INDIAN_STATES;
    return INDIAN_STATES.filter((n) => n.toLowerCase().includes(s));
  }, [stateSearch]);

  function addState(stateName) {
    if (!stateName) return;
    if (plan.find((p) => p.state === stateName)) return;
    setPlan([...plan, { state: stateName, cities: [] }]);
  }
  function removeState(stateName) {
    setPlan(plan.filter((p) => p.state !== stateName));
  }
  function addCity(stateName, cityName) {
    if (!cityName) return;
    setPlan(plan.map((p) => {
      if (p.state !== stateName) return p;
      if (p.cities.find((c) => c.name.toLowerCase() === cityName.toLowerCase())) return p;
      return { ...p, cities: [...p.cities, { name: cityName, locations: [] }] };
    }));
  }
  function removeCity(stateName, cityName) {
    setPlan(plan.map((p) => {
      if (p.state !== stateName) return p;
      return { ...p, cities: p.cities.filter((c) => c.name !== cityName) };
    }));
  }
  function addLocation(stateName, cityName, loc) {
    if (!loc || !loc.name) return;
    // When the location came from an address search / map pick, trust the
    // geocoder's state and city so the point lands under the right city even
    // if a different city tab was open. Unknown states fall back to the tab.
    const targetState = resolveIndianState(loc.state) || stateName;
    const targetCity = String(loc.city || '').trim() || cityName;
    setPlan((prev) => {
      const next = prev.map((p) => ({ ...p, cities: p.cities.map((c) => ({ ...c, locations: [...c.locations] })) }));
      let sp = next.find((p) => p.state === targetState);
      if (!sp) { sp = { state: targetState, cities: [] }; next.push(sp); }
      let cp = sp.cities.find((c) => c.name.toLowerCase() === targetCity.toLowerCase());
      if (!cp) { cp = { name: targetCity, locations: [] }; sp.cities.push(cp); }
      if (!cp.locations.find((l) => l.name.toLowerCase() === loc.name.toLowerCase())) {
        cp.locations.push({
          name: loc.name,
          address: loc.address || '',
          lat: loc.lat,
          lng: loc.lng,
          city: targetCity,
          state: targetState,
          code: loc.code || ''
        });
      }
      return next;
    });
    return { state: targetState, city: targetCity };
  }
  function removeLocation(stateName, cityName, locName) {
    setPlan(plan.map((p) => {
      if (p.state !== stateName) return p;
      return { ...p, cities: p.cities.map((c) => {
        if (c.name !== cityName) return c;
        return { ...c, locations: c.locations.filter((l) => l.name !== locName) };
      }) };
    }));
  }

  // Step-gating
  const canNext = () => {
    if (step === 1) return !!(companyName.trim() && domain.trim());
    if (step === 2) {
      // At least one state with at least one city with at least one location
      return plan.length > 0 && plan.every((p) => p.cities.length > 0) && plan.every((p) => p.cities.every((c) => c.locations.length > 0));
    }
    if (step === 3) return !!(adminName.trim() && adminEmail.trim() && adminPassword.length >= 8);
    return true;
  };

  const submit = async () => {
    setBusy(true);
    try {
      // Flatten the plan into the backend's expected payload.
      const addresses = plan.map((p) => ({
        state: p.state,
        city: p.cities[0] ? p.cities[0].name : '',
        // The plan can carry multiple cities per state. The backend's current
        // payload is one (state, city, locations[]) per entry, so we
        // re-emit one entry per city.
        locations: []
      }));
      // Rebuild properly: one entry per city, each carrying its own locations.
      const flat = [];
      for (const p of plan) {
        for (const c of p.cities) {
          flat.push({
            state: p.state,
            city: c.name,
            locations: c.locations.map((l) => ({
              name: l.name,
              address: l.address,
              lat: l.lat,
              lng: l.lng,
              ...(l.code ? { code: l.code } : {})
            }))
          });
        }
      }
      const states = plan.map((p) => p.state);
      const resp = await api.post('/api/company/onboard', {
        companyName,
        domain,
        phone,
        adminName,
        adminEmail,
        adminPassword,
        states,
        addresses: flat
      });
      setIssuedCodes(Array.isArray(resp && resp.locationCodes) ? resp.locationCodes : []);
      setStep(5);
      setDone(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,.2), transparent), #0f172a' }}>
        <div className="auth-card" style={{ textAlign: 'center', borderTop: '4px solid #7c3aed', maxWidth: 560 }}>
          <div className="onb-progress" style={{ marginBottom: 16 }}>
            {[1, 2, 3, 4].map((s) => <span key={s} className="onb-dot ok" />)}
            <span className="onb-dot wait" />
            <span className="onb-dot" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Step 5 — Pending Approval</h2>
          <CheckCircle2 size={52} style={{ color: '#f59e0b', margin: '10px auto' }} />
          <h1 style={{ fontSize: 20 }}>Request submitted</h1>
          <p className="sub" style={{ marginBottom: 8 }}>
            <strong>{companyName}</strong> has been registered.
          </p>
          <p className="sub" style={{ marginBottom: 20 }}>
            Your admin account is <strong>pending owner approval</strong>.
          </p>
          {issuedCodes.length > 0 && (
            <div style={{ background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.3)', borderRadius: 12, padding: '14px 16px', textAlign: 'left', fontSize: 13.5, color: '#374151', marginBottom: 16 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>Location invite codes</b>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#475569' }}>
                Share each code with that location&apos;s admin or vendor — they enter it at sign-in to work in that location.
              </p>
              <div style={{ display: 'grid', gap: 6 }}>
                {issuedCodes.map((c) => (
                  <div key={c.location_id || c.location} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.location}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>{[c.city, c.state].filter(Boolean).join(', ')}</div>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.06em', color: '#7c3aed' }}>{c.code}</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => copyCode(c.code)} style={{ padding: '4px 8px' }}>
                      {copiedCode === c.code ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 12, padding: '14px 16px', textAlign: 'left', fontSize: 13.5, color: '#374151', marginBottom: 20 }}>
            <b style={{ display: 'block', marginBottom: 6 }}>Step 6 — Trial Activated (what happens next)</b>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>The platform owner reviews and approves your company.</li>
              <li>A <b>10-day free trial</b> starts with full platform access.</li>
              <li>You sign in with the admin email you just created.</li>
              <li>After the trial, payment is requested and verified manually.</li>
            </ol>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => nav('/')}>Back to site</button>
            <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => nav('/admin/login')}>Go to Admin Login</button>
          </div>
        </div>
      </div>
    );
  }

  const stepHead = {
    1: { title: 'Company Information', sub: 'Basic company details to create your workspace.' },
    2: { title: 'Locations & Addresses', sub: 'Pick the states you operate in, then add the cities and locations where your employees report.' },
    3: { title: 'Administrator Information', sub: 'This person signs in and runs the company on GetInRoute.' },
    4: { title: 'Request 10-Day Trial', sub: 'Review and submit. The owner approves, then your trial starts.' }
  }[step];

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,.2), transparent), #0f172a' }}>
      <div className="auth-card" style={{ borderTop: '4px solid #7c3aed', maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
            <Building2 size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Get Started · 10-Day Free Trial</div>
          </div>
        </div>

        <div className="onb-progress" role="list" aria-label={`Step ${step} of 6`}>
          {STEPS.map((s, i) => {
            const n = i + 1;
            const cls = n === step ? 'cur' : n < step ? 'ok' : '';
            return <span key={s} className={`onb-dot ${cls}`} title={s} aria-label={s} />;
          })}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0 14px', textAlign: 'center' }}>
          Step {step} of 6: {STEPS[step - 1]}
        </div>

        <h1>{stepHead.title}</h1>
        <p className="sub" style={{ marginBottom: 18 }}>{stepHead.sub}</p>

        {step === 1 && (
          <div className="form-grid">
            <div className="field full">
              <label>Company Name</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" required />
            </div>
            <div className="field">
              <label>Company Domain</label>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" required />
            </div>
            <div className="field">
              <label>Contact Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98450 00000" />
            </div>
          </div>
        )}

        {step === 2 && <LocationsStep
          plan={plan}
          setPlan={setPlan}
          stateSearch={stateSearch}
          setStateSearch={setStateSearch}
          filteredStates={filteredStates}
          addState={addState}
          removeState={removeState}
          addCity={addCity}
          removeCity={removeCity}
          addLocation={addLocation}
          removeLocation={removeLocation}
        />}

        {step === 3 && (
          <div className="form-grid">
            <div className="field full">
              <label>Admin Name</label>
              <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Full name" required />
            </div>
            <div className="field full">
              <label>Admin Email</label>
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@acme.com" required />
            </div>
            <div className="field full">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Min 8 characters" minLength={8} required style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', fontSize: 13.5, color: '#334155', marginBottom: 14, display: 'grid', gap: 6 }}>
              <div><b>Company:</b> {companyName} ({domain})</div>
              <div><b>Phone:</b> {phone || '—'}</div>
              <div>
                <b>States:</b> {plan.map((p) => p.state).join(', ') || '—'}<br />
                <b>Total locations:</b> {plan.reduce((n, p) => n + p.cities.reduce((m, c) => m + c.locations.length, 0), 0)}
              </div>
              {plan.some((p) => p.cities.some((c) => c.locations.some((l) => l.code))) && (
                <div>
                  <b>Invite codes:</b>{' '}
                  {plan.flatMap((p) => p.cities.flatMap((c) => c.locations.filter((l) => l.code).map((l) => `${l.name} → ${l.code}`))).join(' · ')}
                </div>
              )}
              <div><b>Admin:</b> {adminName} ({adminEmail})</div>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {TRIAL_POINTS.map((p, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#475569' }}>
                  <span style={{ color: '#10b981' }}>{p.icon}</span> {p.text}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '12px 0 0' }}>
              No payment is collected now. Payment is requested after the trial and verified manually initially.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 1 && step < 5 && (
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setStep(step - 1)}>
              <ChevronLeft size={16} /> Back
            </button>
          )}
          {step === 1 && <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => nav('/')}>Cancel</button>}
          {step < 4 ? (
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!canNext()} onClick={() => setStep(step + 1)}>
              Continue <ChevronRight size={16} />
            </button>
          ) : step === 4 ? (
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={busy} onClick={submit}>
              {busy ? 'Submitting...' : 'Request 10-Day Trial'}
            </button>
          ) : null}
        </div>

        <p className="auth-switch">Already have an account? <Link to="/admin/login" className="auth-link">Sign in</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>All sign-in portals</Link>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components for Step 2 ---

function LocationsStep({ plan, setPlan, stateSearch, setStateSearch, filteredStates, addState, removeState, addCity, removeCity, addLocation, removeLocation }) {
  return (
    <div>
      {/* State multi-select */}
      <div className="field full">
        <label>States you operate in (pick all that apply)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={stateSearch} onChange={(e) => setStateSearch(e.target.value)} placeholder="Type to filter states..." />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{plan.length} selected</span>
        </div>
        {plan.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {plan.map((p) => (
              <span key={p.state} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(124,58,237,.12)', color: '#7c3aed', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                {p.state}
                <button type="button" onClick={() => removeState(p.state)} aria-label={`Remove ${p.state}`} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          {filteredStates.map((s) => {
            const selected = !!plan.find((p) => p.state === s);
            return (
              <button key={s} type="button" disabled={selected} onClick={() => addState(s)} className="state-pick-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 12px', background: selected ? '#f1f5f9' : '#fff', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: selected ? 'default' : 'pointer', textAlign: 'left', fontSize: 13, color: selected ? '#94a3b8' : '#0f172a' }}>
                <span>{s}</span>
                {selected ? <span style={{ fontSize: 11, color: '#94a3b8' }}>added</span> : <Plus size={14} color="#7c3aed" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-state address plan */}
      {plan.length === 0 && (
        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 12 }}>Pick at least one state above to add cities and locations.</p>
      )}

      {plan.map((p) => (
        <StateBlock
          key={p.state}
          stateName={p.state}
          state={p}
          addCity={addCity}
          removeCity={removeCity}
          addLocation={addLocation}
          removeLocation={removeLocation}
        />
      ))}
    </div>
  );
}

function StateBlock({ stateName, state, addCity, removeCity, addLocation, removeLocation }) {
  const [cityName, setCityName] = useState('');
  const [openCity, setOpenCity] = useState(state.cities[0] ? state.cities[0].name : '');
  useEffect(() => {
    if (!state.cities.find((c) => c.name === openCity)) setOpenCity(state.cities[0] ? state.cities[0].name : '');
  }, [state.cities, openCity]);
  const suggestions = (CITY_OPTIONS[stateName.toLowerCase()] || []);
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <MapPin size={16} color="#7c3aed" />
          {stateName}
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>{state.cities.length} cities</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={cityName}
          onChange={(e) => setCityName(e.target.value)}
          list={`cities-${stateName}`}
          placeholder="Add a city (e.g. Bengaluru)"
          style={{ flex: 1 }}
        />
        <datalist id={`cities-${stateName}`}>
          {suggestions.map((c) => <option key={c} value={c} />)}
        </datalist>
        <button type="button" className="btn btn-primary" disabled={!cityName.trim()} onClick={() => { addCity(stateName, cityName.trim()); setCityName(''); }}>
          <Plus size={14} /> Add city
        </button>
      </div>

      {state.cities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {state.cities.map((c) => (
            <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,.12)', color: '#15803d', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
              {c.name}
              <button type="button" onClick={() => removeCity(stateName, c.name)} aria-label={`Remove ${c.name}`} style={{ background: 'none', border: 'none', color: '#15803d', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {state.cities.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, color: '#475569' }}>
            <span>Locations in</span>
            <select value={openCity} onChange={(e) => setOpenCity(e.target.value)}>
              {state.cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {(state.cities.find((c) => c.name === openCity) || state.cities[0]) && (
            <CityBlock
              stateName={stateName}
              cityName={openCity || state.cities[0].name}
              city={(state.cities.find((c) => c.name === openCity) || state.cities[0])}
              addLocation={addLocation}
              removeLocation={removeLocation}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CityBlock({ stateName, cityName, city, addLocation, removeLocation }) {
  const [locName, setLocName] = useState('');
  const [locCode, setLocCode] = useState('');
  const [pendingAddress, setPendingAddress] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [placed, setPlaced] = useState(null);
  const [addrDetail, setAddrDetail] = useState('');

  const hasPoint = !!(pendingAddress && pendingAddress.lat != null && pendingAddress.lng != null);
  const addrText = String((pendingAddress && pendingAddress.address) || '');
  const addrParts = addrText.split(',').map((s) => s.trim()).filter(Boolean);
  const addrPrimary = addrParts[0] || '';
  const addrSecondary = addrParts.slice(1, 4).join(', ');
  const locality = [pendingAddress && pendingAddress.city, pendingAddress && pendingAddress.state, pendingAddress && pendingAddress.postal_code]
    .filter(Boolean).join(', ');

  function onAddressPicked(item) {
    if (!item) return;
    setGeoErr('');
    setPendingAddress(item);
    setPlaced(null);
    if (!locName.trim()) {
      const guess = String(item.name || item.address || item.label || '').split(',')[0].trim();
      if (guess) setLocName(guess);
    }
  }

  async function useMyLocation() {
    setGeoErr('');
    setLocating(true);
    try {
      const pos = await getPosition({ interactive: true });
      if (!pos) {
        setGeoErr('Could not read your location. Allow location access in the browser, or search the address instead.');
        return;
      }
      const row = await reverseGeocode(pos.lat, pos.lng).catch(() => null);
      if (row && row.address) {
        onAddressPicked({ ...row, lat: pos.lat, lng: pos.lng });
      } else {
        const picked = await pickLocation(pos.lat, pos.lng);
        if (picked) onAddressPicked({ ...picked, city: '', state: '', postal_code: '' });
      }
    } catch (e) {
      setGeoErr(e.message || 'Could not read your location.');
    } finally {
      setLocating(false);
    }
  }

  // A location is valid as soon as it has a name. Picking an address adds the
  // exact point (lat/lng) plus the city/state the point really belongs to, so
  // the registration always records real location information.
  async function add() {
    const name = locName.trim() || (pendingAddress ? String(pendingAddress.address || '').split(',')[0].trim() : '');
    if (!name || saving) return;
    setSaving(true);
    try {
      let address = (pendingAddress && pendingAddress.address) || '';
      let lat = pendingAddress && pendingAddress.lat != null ? pendingAddress.lat : null;
      let lng = pendingAddress && pendingAddress.lng != null ? pendingAddress.lng : null;
      let pickedCity = (pendingAddress && pendingAddress.city) || '';
      let pickedState = (pendingAddress && pendingAddress.state) || '';
      if (lat == null || lng == null) {
        try {
          const hits = await Promise.race([
            searchAddress(name, { limit: 1 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('geocode timeout')), 5000))
          ]);
          const hit = Array.isArray(hits) ? hits[0] : null;
          if (hit && hit.lat != null && hit.lng != null) {
            if (!pendingAddress) address = hit.address || hit.display_name || name;
            lat = hit.lat;
            lng = hit.lng;
            pickedCity = pickedCity || hit.city || '';
            pickedState = pickedState || hit.state || '';
          }
        } catch { /* offline / rate-limited / no match — save with the typed name */ }
      }
      const detail = addrDetail.trim();
      if (detail && address && !address.toLowerCase().includes(detail.toLowerCase())) {
        address = `${address}, ${detail}`;
      }
      const target = addLocation(stateName, cityName, {
        name,
        address,
        lat,
        lng,
        city: pickedCity,
        state: pickedState,
        code: locCode.trim().toUpperCase()
      });
      setPlaced(target || null);
      setLocName('');
      setLocCode('');
      setAddrDetail('');
      setPendingAddress(null);
      setGeoErr('');
    } finally {
      setSaving(false);
    }
  }

  const placedElsewhere = placed && (placed.state !== stateName || placed.city.toLowerCase() !== cityName.toLowerCase());

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#fff' }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Location name</label>
        <input
          value={locName}
          onChange={(e) => setLocName(e.target.value)}
          placeholder={`e.g. "${cityName} Head Office"`}
        />
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Address (recommended)</label>
        <div style={{ marginTop: 6 }}>
          <AddressPicker value={pendingAddress} onChange={onAddressPicked} mapButton />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={useMyLocation} disabled={locating} style={{ padding: '6px 10px', fontSize: 13 }}>
            {locating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={14} />}
            {locating ? 'Finding you…' : 'Use my location'}
          </button>
          <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Type the address and pick a suggestion, or drop an exact pin on the map.</span>
        </div>
        {geoErr ? (
          <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fff1f2', color: '#be123c', fontSize: 12.5, fontWeight: 600 }}>
            {geoErr}
          </div>
        ) : null}
        {hasPoint ? (
          <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '8px 10px', display: 'grid', gap: 2, fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{addrPrimary || locName || 'Pinned location'}</div>
              {addrSecondary ? <div style={{ color: '#64748b' }}>{addrSecondary}</div> : null}
              {locality ? <div style={{ color: '#475569', fontSize: 11.5 }}>{locality}</div> : null}
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#7c3aed', fontWeight: 700 }}>
                {Number(pendingAddress.lat).toFixed(5)}, {Number(pendingAddress.lng).toFixed(5)}
              </div>
            </div>
            <MapLibreMap
              center={{ lat: Number(pendingAddress.lat), lng: Number(pendingAddress.lng) }}
              zoom={15}
              markers={[{ id: 'pending', lat: Number(pendingAddress.lat), lng: Number(pendingAddress.lng), color: 'indigo' }]}
              fit={false}
              height={150}
            />
            <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: '#f8fafc' }}>
              <ViewOnMapLink lat={pendingAddress.lat} lng={pendingAddress.lng} address={pendingAddress.address} label="Open in Maps" />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setPendingAddress(null); setAddrDetail(''); }} style={{ marginLeft: 'auto' }}>Clear address</button>
            </div>
            <div style={{ padding: '0 8px 8px' }}>
              <input
                value={addrDetail}
                onChange={(e) => setAddrDetail(e.target.value)}
                placeholder="Add landmark / floor / gate (optional) — e.g. Tower B, 3rd floor"
                maxLength={120}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Invite code (optional)</label>
        <input
          value={locCode}
          onChange={(e) => setLocCode(e.target.value.toUpperCase())}
          placeholder="Leave blank to auto-generate (e.g. BLR-HQ-2026)"
          autoComplete="off"
          maxLength={32}
          style={{ fontFamily: 'monospace' }}
          aria-label="Invite code for this location"
        />
        <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0 }}>
          This is the code this location&apos;s admins and vendors enter at sign-in. Letters, numbers and dashes (4–32).
        </p>
      </div>

      <button type="button" className="btn btn-primary" disabled={(!locName.trim() && !pendingAddress) || saving} onClick={add} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>
        <Plus size={14} /> {saving ? 'Saving…' : 'Add location'}
      </button>
      {placedElsewhere ? (
        <p style={{ fontSize: 12, color: '#15803d', margin: '8px 0 0', fontWeight: 600 }}>
          Added under {placed.city}, {placed.state} (from the address).
        </p>
      ) : null}

      {city.locations.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {cityName} locations ({city.locations.length})
          </div>
          {city.locations.map((l) => (
            <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 12 }}>
              <MapPin size={13} color="#7c3aed" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{l.name}</div>
                {l.code ? (
                  <div style={{ fontSize: 11, color: '#7c3aed', fontFamily: 'monospace', fontWeight: 700 }}>code: {l.code}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>code auto-generated on submit</div>
                )}
                <div style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.address || '—'}</span>
                  {l.lat != null && <ViewOnMapLink lat={l.lat} lng={l.lng} address={l.address} label="Map" />}
                </div>
              </div>
              <button type="button" onClick={() => removeLocation(stateName, cityName, l.name)} aria-label={`Remove ${l.name}`} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', display: 'flex' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
