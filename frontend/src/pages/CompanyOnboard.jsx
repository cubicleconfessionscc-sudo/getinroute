import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { Building2, Eye, EyeOff, Clock, ShieldCheck, ChevronLeft, ChevronRight, Sparkles, CheckCircle2, MapPin, Plus, Trash2, X } from 'lucide-react';
import AddressPicker from '../components/AddressPicker';
import { searchAddress } from '../lib/geo';

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
    setPlan(plan.map((p) => {
      if (p.state !== stateName) return p;
      return { ...p, cities: p.cities.map((c) => {
        if (c.name !== cityName) return c;
        if (c.locations.find((l) => l.name.toLowerCase() === loc.name.toLowerCase())) return c;
        return { ...c, locations: [...c.locations, { name: loc.name, address: loc.address || '', lat: loc.lat, lng: loc.lng }] };
      }) };
    }));
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
              lng: l.lng
            }))
          });
        }
      }
      const states = plan.map((p) => p.state);
      await api.post('/api/company/onboard', {
        companyName,
        domain,
        phone,
        adminName,
        adminEmail,
        adminPassword,
        states,
        addresses: flat
      });
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
  const [pendingAddress, setPendingAddress] = useState(null);
  const [saving, setSaving] = useState(false);

  // A location is valid as soon as it has a name. Picking an address from the
  // autocomplete dropdown is optional enrichment (adds lat/lng for maps and
  // navigation) — it must never be a prerequisite, otherwise a typo-free typed
  // name could not reach the portal or the APKs.
  async function add() {
    const name = locName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      let address = (pendingAddress && pendingAddress.address) || name;
      let lat = pendingAddress ? pendingAddress.lat : null;
      let lng = pendingAddress ? pendingAddress.lng : null;
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
          }
        } catch { /* offline / rate-limited / no match — save with the typed name */ }
      }
      addLocation(stateName, cityName, { name, address, lat, lng });
      setLocName('');
      setPendingAddress(null);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 10, background: '#f8fafc' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={locName}
          onChange={(e) => setLocName(e.target.value)}
          placeholder={`Location name (e.g. "${cityName} Location 1")`}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <AddressPicker value={pendingAddress} onChange={setPendingAddress} />
      </div>
      <button type="button" className="btn btn-primary" disabled={!locName.trim() || saving} onClick={add} style={{ width: '100%', justifyContent: 'center' }}>
        <Plus size={14} /> {saving ? 'Saving…' : 'Add'}
      </button>
      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0' }}>
        Typing a name is enough — the address below is optional and only pins the location on the map.
      </p>
      {city.locations.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {city.locations.map((l) => (
            <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}>
              <MapPin size={12} color="#7c3aed" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                <div style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.address || '—'}{l.lat != null ? ` (${Number(l.lat).toFixed(4)}, ${Number(l.lng).toFixed(4)})` : ''}
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
