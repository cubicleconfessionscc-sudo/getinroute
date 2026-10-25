import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  Modal, TextInput, Alert, Share, Linking, Platform
} from "react-native";
import {
  getAdminStats, getAdminEmployees, getAdminDrivers, getAdminVehicles, getAdminRoutes,
  getAdminSchedules, getAdminTracking, getCheckinLogs,   getApprovals, resolveApproval, getLocationChangeRequests, approveLocationChange, rejectLocationChange,
  getVendorDashboard, getVendorEmployees, getVendorDrivers, getVendorVehicles, getVendorRoutes, getVendorTrips,
  getLocationCodes, issueLocationCode, revokeLocationCode,
  getDriverInvites, createDriverInvite, revokeDriverInvite,
  getLocations, addLocation,
  addEmployee, deleteEmployee, setEmployeeLocation, suspendEmployee, approveEmployee,
  addVehicle, deleteVehicle, addDriver, deleteDriver, addRoute, deleteRoute,
  getNotifications, downloadExport,
} from "../../api/adminvendor";
import { connectSocket } from "../../services/socket";
import { API_BASE_URL } from "../../api/client";
import { colors, spacing, radius } from "../../theme";

// The web console lives at the API origin (…/api is stripped).
const WEB_BASE = String(API_BASE_URL || "https://www.getinroute.in/api").replace(/\/api\/?$/, "");

// Full admin/vendor console. Mirrors the web portal: a hamburger drawer switches
// between screens; data reloads on drawer actions and on live socket events
// (driver:status, run:state, checkin:confirmed, allotment:statusBroadcast) so
// every screen shows real-time updates like the web dashboard.
const MENU = [
  { key: "dashboard", label: "Dashboard" },
  { key: "employees", label: "Employees" },
  { key: "drivers", label: "Drivers" },
  { key: "vehicles", label: "Vehicles" },
  { key: "routes", label: "Routes" },
  { key: "schedules", label: "Schedules" },
  { key: "approvals", label: "Approvals" },
  { key: "loccr", label: "Location Changes" },
  { key: "locations", label: "Locations" },
  { key: "codes", label: "Location Codes" },
  { key: "invites", label: "Driver Invites" },
  { key: "tracking", label: "Live Tracking" },
  { key: "checkins", label: "Check-in Logs" },
  { key: "exports", label: "Exports" },
  { key: "notifications", label: "Notifications" },
];

const EXPORT_KINDS = [
  ["insights-daily", "Insights · Daily"],
  ["insights-locations", "Insights · Locations"],
  ["insights-events", "Insights · Event log"],
  ["trip-dashboard", "Trip Dashboard (Excel lifecycle)"],
  ["employees", "Employee roster"],
  ["drivers", "Driver roster"],
  ["vehicles", "Vehicle fleet"],
  ["schedules", "Schedules"],
  ["runs", "Cab Runs"],
  ["checkin-logs", "Check-in logs"],
  ["no-shows", "No-shows"],
  ["speed-events", "Speed violations"],
  ["feedback", "Feedback"],
];

export default function AdminVendorHome({ user, mode, onLogout }) {
  const [drawer, setDrawer] = useState(false);
  const [screen, setScreen] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    stats: null, employees: [], drivers: [], vehicles: [], routes: [], schedules: [],
    tracking: [], checkins: [], approvals: [], loccr: [], codes: [], invites: [], locations: null,
    notifications: [],
  });
  const [modal, setModal] = useState(null); // {type:..., ...}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);

  const isVendor = mode === "vendor";

  const load = useCallback(async (silent) => {
    if (!silent) setError("");
    try {
      const [stats, employees, drivers, vehicles, routes, schedules, tracking, checkins, codes, invites, locations, notifications] =
        await Promise.all([
          (isVendor ? getVendorDashboard() : getAdminStats()).catch(() => null),
          (isVendor ? getVendorEmployees() : getAdminEmployees()).catch(() => []),
          (isVendor ? getVendorDrivers() : getAdminDrivers()).catch(() => []),
          (isVendor ? getVendorVehicles() : getAdminVehicles()).catch(() => []),
          (isVendor ? getVendorRoutes() : getAdminRoutes()).catch(() => []),
          (isVendor ? getVendorTrips() : getAdminSchedules()).catch(() => []),
          getAdminTracking().catch(() => []),
          getCheckinLogs().catch(() => []),
          getLocationCodes().catch(() => []),
          getDriverInvites().catch(() => []),
          getLocations().catch(() => null),
          getNotifications().catch(() => []),
        ]);
      const approvals = isVendor ? [] : await getApprovals().catch(() => []);
      const loccr = isVendor ? [] : await getLocationChangeRequests("pending").catch(() => []);
      setData({
        stats: stats || null,
        employees: arr(employees), drivers: arr(drivers), vehicles: arr(vehicles),
        routes: arr(routes), schedules: arr(schedules), tracking: arr(tracking),
        checkins: arr(checkins), approvals: arr(approvals), loccr: arr(loccr), codes: arr(codes),
        invites: arr(invites), locations, notifications: arr(notifications),
      });
    } catch (e) {
      if (!silent) setError(e?.response?.data?.error || e?.message || "Could not reach the server.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [isVendor]);

  useEffect(() => { load(); }, [load]);

  // Live updates: subscribe to admin broadcast events and silently refresh.
  useEffect(() => {
    let active = true;
    let sock = null;
    const refresh = () => { if (active) load(true); };
    (async () => {
      try {
        sock = await connectSocket();
        if (!active || !sock) return;
        socketRef.current = sock;
        ["driver:status", "run:state", "checkin:confirmed", "allotment:statusBroadcast", "driver:duty", "alert"].forEach((ev) => sock.on(ev, refresh));
      } catch (e) { /* socket optional */ }
    })();
    return () => {
      active = false;
      if (sock) ["driver:status", "run:state", "checkin:confirmed", "allotment:statusBroadcast", "driver:duty", "alert"].forEach((ev) => sock.off(ev, refresh));
    };
  }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  function go(key) { setScreen(key); setDrawer(false); setModal(null); }

  async function runAction(fn, successMsg) {
    setBusy(true);
    try {
      const result = await fn();
      setModal(null); setForm({});
      const msg = typeof successMsg === "function" ? successMsg(result) : successMsg;
      if (msg) Alert.alert("Done", msg);
      await load(true);
    } catch (e) {
      Alert.alert("Failed", e?.response?.data?.error || e?.message || "Please try again.");
    } finally { setBusy(false); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={styles.root}>
      {/* Top bar with hamburger */}
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => setDrawer(true)} style={styles.hamburger} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.hamburgerIcon}>☰</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{MENU.find((m) => m.key === screen)?.label || "Console"}</Text>
          <Text style={styles.sub}>{user?.name || user?.email || ""} · {isVendor ? "Vendor" : "Admin"}</Text>
        </View>
        <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}><Text style={styles.logoutText}>Exit</Text></TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errBox}><Text style={styles.errText}>{error}</Text>
          <TouchableOpacity onPress={() => load()}><Text style={styles.retry}>Retry</Text></TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Screen
          screen={screen} data={data} mode={mode} user={user}
          openModal={(m) => { setForm({}); setModal(m); }}
          runAction={runAction} busy={busy}
          downloadExport={downloadExport}
        />
      </ScrollView>

      {/* Hamburger drawer */}
      <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
        <View style={styles.drawerOverlay}>
          <View style={styles.drawer}>
            <Text style={styles.drawerBrand}>GetInRoute</Text>
            <Text style={styles.drawerUser}>{user?.name || user?.email}</Text>
            <ScrollView style={{ flex: 1, marginTop: 12 }}>
              {MENU.map((m) => (
                <TouchableOpacity key={m.key} style={[styles.drawerItem, screen === m.key && styles.drawerItemOn]} onPress={() => go(m.key)}>
                  <Text style={[styles.drawerItemText, screen === m.key && styles.drawerItemTextOn]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.drawerItem}
                onPress={() => { setDrawer(false); Linking.openURL(`${WEB_BASE}/admin/insights`).catch(() => Alert.alert("Couldn't open", "Open the web dashboard in your browser.")); }}
              >
                <Text style={styles.drawerItemText}>Dashboard 2 (web) ↗</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.drawerItem, styles.drawerLogout]} onPress={onLogout}>
                <Text style={[styles.drawerItemText, { color: colors.coral }]}>Sign out</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
          <TouchableOpacity style={styles.drawerBackdrop} onPress={() => setDrawer(false)} />
        </View>
      </Modal>

      {/* Action modal (add employee/driver/vehicle/route/location/invite + confirmations) */}
      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{modal?.title || ""}</Text>
            <ScrollView>
              {(modal?.fields || []).map((f) => (
                <View key={f.key}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <TextInput
                    style={styles.input} value={form[f.key] || ""} onChangeText={(v) => setForm((p) => ({ ...p, [f.key]: v }))}
                    placeholder={f.placeholder || ""} placeholderTextColor={colors.textDim}
                    autoCapitalize={f.caps || "none"} keyboardType={f.keyboard || "default"}
                  />
                </View>
              ))}
              {modal?.body}
            </ScrollView>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModal(null)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalOk, busy && { opacity: 0.6 }]} disabled={busy}
                onPress={() => modal?.onOk ? modal.onOk(form) : null}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalOkText}>{modal?.okText || "Save"}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function arr(x) { return Array.isArray(x) ? x : (x && Array.isArray(x.items) ? x.items : []); }

/* ---------------- Screens ---------------- */

function Screen({ screen, data, mode, user, openModal, runAction, busy, downloadExport }) {
  const isVendor = mode === "vendor";

  if (screen === "dashboard") {
    const s = data.stats || {};
    const rows = [
      ["Employees", s.employees ?? data.employees.length],
      ["Drivers", s.drivers ?? data.drivers.length],
      ["Vehicles", s.vehicles ?? data.vehicles.length],
      ["Trips today", s.trips_today ?? "—"],
      ["Active trips", s.active_trips ?? "—"],
      ["Alerts today", s.alerts_today ?? "—"],
      ["Routes", data.routes.length],
      ["Schedules", data.schedules.length],
    ];
    return (
      <View>
        <View style={styles.grid}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.kpi}><Text style={styles.kpiNum}>{String(value)}</Text><Text style={styles.kpiLbl}>{label}</Text></View>
          ))}
        </View>
        <Text style={styles.section}>Recent activity</Text>
        {data.checkins.slice(0, 8).map((c, i) => (
          <Row key={i} title={c.employee_name || c.name || `Check-in #${c.id}`} sub={`${c.type || "checkin"} · ${c.time || c.created_at || ""}${c.location_name ? ` · ${c.location_name}` : ""}`} />
        ))}
        {!data.checkins.length ? <Empty text="No recent check-ins." /> : null}
      </View>
    );
  }

  if (screen === "employees") {
    return (
      <View>
        <Action label="+ Add employee" onPress={() => openModal({
          title: "Add employee", fields: [
            { key: "name", label: "FULL NAME", placeholder: "Jane Doe", caps: "words" },
            { key: "email", label: "EMAIL", placeholder: "jane@company.com", keyboard: "email-address" },
            { key: "emp_id", label: "EMPLOYEE ID", placeholder: "E1234" },
            { key: "phone", label: "PHONE", placeholder: "+91...", keyboard: "phone-pad" },
            { key: "password", label: "TEMP PASSWORD", placeholder: "Min 6 chars" },
          ],
          okText: "Create",
          onOk: (f) => runAction(() => addEmployee(f), "Employee created."),
        })} />
        {data.employees.map((e, i) => (
          <Row key={e.id || i} title={e.name || e.emp_id || "Employee"}
            sub={[e.emp_id, e.email, e.department, e.status, e.company_location_id ? `Loc #${e.company_location_id}` : null].filter(Boolean).join(" · ")}
            actions={[
              e.approved === 0 && !isVendor ? { label: "Approve", onPress: () => runAction(() => approveEmployee(e.id), "Approved.") } : null,
              e.status === "active" && !isVendor ? { label: "Suspend", onPress: () => runAction(() => suspendEmployee(e.id), "Suspended.") } : null,
              !isVendor ? { label: "Location", onPress: () => openModal({
                title: "Assign location", fields: [{ key: "company_location_id", label: "LOCATION ID", placeholder: String(data.locations?.locations?.[0]?.id || "1") }],
                okText: "Assign",
                onOk: (f) => runAction(() => setEmployeeLocation(e.id, Number(f.company_location_id)), "Location assigned."),
              }) } : null,
              !isVendor ? { label: "Delete", danger: true, onPress: () => runAction(() => deleteEmployee(e.id), "Deleted.") } : null,
            ].filter(Boolean)} />
        ))}
        {!data.employees.length ? <Empty text="No employees for your scope." /> : null}
      </View>
    );
  }

  if (screen === "drivers") {
    return (
      <View>
        <Action label="+ Add driver" onPress={() => openModal({
          title: "Add driver", fields: [
            { key: "name", label: "FULL NAME", placeholder: "John Doe", caps: "words" },
            { key: "phone", label: "PHONE", placeholder: "+91...", keyboard: "phone-pad" },
            { key: "emp_id", label: "DRIVER ID", placeholder: "D100" },
            { key: "password", label: "TEMP PASSWORD", placeholder: "Min 6 chars" },
          ],
          okText: "Create",
          onOk: (f) => runAction(() => addDriver(f), "Driver created."),
        })} />
        {data.drivers.map((d, i) => (
          <Row key={d.id || i} title={d.name || d.emp_id || "Driver"}
            sub={[d.emp_id, d.phone, d.vehicle_name, d.status].filter(Boolean).join(" · ")}
            actions={isVendor ? [] : [{ label: "Delete", danger: true, onPress: () => runAction(() => deleteDriver(d.id), "Deleted.") }]} />
        ))}
        {!data.drivers.length ? <Empty text="No drivers for your scope." /> : null}
      </View>
    );
  }

  if (screen === "vehicles") {
    return (
      <View>
        <Action label="+ Add vehicle" onPress={() => openModal({
          title: "Add vehicle", fields: [
            { key: "vehicle_name", label: "VEHICLE NAME", placeholder: "Innova", caps: "words" },
            { key: "plate", label: "PLATE", placeholder: "KA-01-1234", caps: "characters" },
            { key: "type", label: "TYPE", placeholder: "SUV / Sedan / Mini", caps: "words" },
            { key: "capacity", label: "CAPACITY", placeholder: "4", keyboard: "number-pad" },
          ],
          okText: "Create",
          onOk: (f) => runAction(() => addVehicle(f), "Vehicle added."),
        })} />
        {data.vehicles.map((v, i) => (
          <Row key={v.id || i} title={v.vehicle_name || v.plate || "Vehicle"}
            sub={[v.plate, v.type, v.driver_name, v.line ? `Line ${v.line}` : null, v.status].filter(Boolean).join(" · ")}
            actions={[{ label: "Delete", danger: true, onPress: () => runAction(() => deleteVehicle(v.id), "Deleted.") }]} />
        ))}
        {!data.vehicles.length ? <Empty text="No vehicles for your scope." /> : null}
      </View>
    );
  }

  if (screen === "routes") {
    return (
      <View>
        {!isVendor ? (
          <Action label="+ Add route" onPress={() => openModal({
            title: "Add route", fields: [
              { key: "name", label: "ROUTE NAME", placeholder: "Whitefield Loop", caps: "words" },
              { key: "description", label: "DESCRIPTION", placeholder: "Optional" },
            ],
            okText: "Create",
            onOk: (f) => runAction(() => addRoute(f), "Route created."),
          })} />
        ) : null}
        {data.routes.map((r, i) => (
          <Row key={r.id || i} title={r.name || `Route #${r.id}`} sub={[r.description, r.employees_count != null ? `${r.employees_count} employees` : null].filter(Boolean).join(" · ")}
            actions={isVendor ? [] : [{ label: "Delete", danger: true, onPress: () => runAction(() => deleteRoute(r.id), "Deleted.") }]} />
        ))}
        {!data.routes.length ? <Empty text="No routes for your scope." /> : null}
      </View>
    );
  }

  if (screen === "schedules") {
    return (
      <View>
        <Text style={styles.section}>Schedules ({data.schedules.length})</Text>
        {data.schedules.slice(0, 100).map((s, i) => (
          <Row key={s.id || i} title={s.employee_name || s.emp_id || `Schedule #${s.id}`}
            sub={[s.date, s.login_time || s.pickup_time, s.vehicle_name, s.driver_name, s.state || s.status].filter(Boolean).join(" · ")} />
        ))}
        {!data.schedules.length ? <Empty text="No schedules for your scope." /> : null}
      </View>
    );
  }

  if (screen === "approvals") {
    if (isVendor) return <Empty text="Approvals are managed by the company admin." />;
    return (
      <View>
        <Text style={styles.section}>Pending approvals ({data.approvals.length})</Text>
        {data.approvals.map((a, i) => (
          <Row key={a.id || i} title={a.name || a.email || `User #${a.id}`}
            sub={[a.role, a.emp_id, a.email, a.company_name].filter(Boolean).join(" · ")}
            actions={[
              { label: "Accept", onPress: () => runAction(() => resolveApproval(a.id, "accept"), "Approved.") },
              { label: "Reject", danger: true, onPress: () => runAction(() => resolveApproval(a.id, "reject"), "Rejected.") },
            ]} />
        ))}
        {!data.approvals.length ? <Empty text="Nothing pending approval." /> : null}
      </View>
    );
  }

  if (screen === "loccr") {
    if (isVendor) return <Empty text="Location changes are approved by the company admin." />;
    return (
      <View>
        <Text style={styles.section}>Pending location changes ({data.loccr.length})</Text>
        <Text style={styles.hint}>Employees pick their office location in the Employee app. Approve to move them (and their future bookings/check-ins) to that location; history stays with the old location.</Text>
        {data.loccr.map((r, i) => (
          <Row key={r.id || i}
            title={(r.employee && r.employee.name) || `Employee #${r.employee_id || r.id}`}
            sub={[
              r.employee && r.employee.emp_id,
              `From ${r.from ? r.from.name : "—"} → ${r.to ? r.to.name : "—"}`,
              r.reason || null
            ].filter(Boolean).join(" · ")}
            actions={[
              { label: "Approve", onPress: () => runAction(() => approveLocationChange(r.id), "Location approved.") },
              { label: "Reject", danger: true, onPress: () => runAction(() => rejectLocationChange(r.id), "Location request rejected.") },
            ]} />
        ))}
        {!data.loccr.length ? <Empty text="No pending location changes." /> : null}
      </View>
    );
  }

  if (screen === "locations") {
    const locs = data.locations || { states: [], cities: [], locations: [] };
    return (
      <View>
        {!isVendor ? (
          <Action label="+ Add location" onPress={() => openModal({
            title: "Add operational location", fields: [
              { key: "city_id", label: "CITY ID", placeholder: String(locs.cities?.[0]?.id || "1"), keyboard: "number-pad" },
              { key: "name", label: "LOCATION NAME", placeholder: "Office Tower A", caps: "words" },
              { key: "address", label: "ADDRESS", placeholder: "Optional street address" },
              { key: "code", label: "INVITE CODE (optional)", placeholder: "e.g. BLR-HQ-2026", caps: "characters" },
            ],
            okText: "Create",
            onOk: (f) => runAction(
              () => addLocation(Number(f.city_id), f.name, f.address, (f.code || "").trim().toUpperCase()),
              (r) => `Location created. Invite code: ${r?.code || "—"}`
            ),
          })} />
        ) : null}
        <Text style={styles.section}>Locations ({locs.locations.length})</Text>
        {locs.locations.map((l, i) => (
          <Row key={l.id || i} title={l.name} sub={[l.address, `City #${l.city_id}`, `ID ${l.id}`].filter(Boolean).join(" · ")} />
        ))}
        {!locs.locations.length ? <Empty text="No locations yet." /> : null}
        <Text style={styles.section}>Cities ({locs.cities.length})</Text>
        {locs.cities.slice(0, 30).map((c, i) => <Row key={c.id || i} title={c.name} sub={`State #${c.state_id}`} />)}
        <Text style={styles.section}>States ({locs.states.length})</Text>
        {locs.states.slice(0, 30).map((s, i) => <Row key={s.id || i} title={s.name} sub={s.code || ""} />)}
      </View>
    );
  }

  if (screen === "codes") {
    return (
      <View>
        <Text style={styles.section}>Location invite codes</Text>
        <Text style={styles.hint}>Each operational location has an active code used to sign in scoped to that location.</Text>
        {!isVendor ? (
          <Action label="+ Issue / regenerate code" onPress={() => openModal({
            title: "Issue location invite code", fields: [
              { key: "company_location_id", label: "LOCATION ID", placeholder: String(data.locations?.locations?.[0]?.id || "1"), keyboard: "number-pad" },
              { key: "code", label: "CUSTOM CODE (optional)", placeholder: "e.g. BLR-HQ-2026", caps: "characters" },
            ],
            okText: "Issue",
            onOk: (f) => runAction(
              () => issueLocationCode(Number(f.company_location_id), (f.code || "").trim().toUpperCase()),
              (r) => `Active code: ${r?.code || "—"}`
            ),
          })} />
        ) : null}
        {data.codes.map((c, i) => (
          <Row key={c.id || i} title={c.code || `Code #${c.id}`}
            sub={[c.location_name || c.company_location_id, c.status, c.created_at].filter(Boolean).join(" · ")}
            actions={[
              c.status === "active" && !isVendor ? { label: "Revoke", danger: true, onPress: () => runAction(() => revokeLocationCode(c.id), "Code revoked.") } : null,
            ].filter(Boolean)} />
        ))}
        {!data.codes.length ? <Empty text="No codes issued yet. Codes are auto-created when locations are added." /> : null}
      </View>
    );
  }

  if (screen === "invites") {
    return (
      <View>
        <Action label="+ Create driver invite" onPress={() => openModal({
          title: "Create driver invite code", fields: [
            { key: "company_location_id", label: "LOCATION ID", placeholder: String(data.locations?.locations?.[0]?.id || "1"), keyboard: "number-pad" },
            { key: "vehicle_id", label: "VEHICLE ID (optional)", placeholder: "Leave empty for any", keyboard: "number-pad" },
          ],
          okText: "Create",
          onOk: (f) => runAction(() => createDriverInvite({
            company_location_id: Number(f.company_location_id) || undefined,
            vehicle_id: f.vehicle_id ? Number(f.vehicle_id) : undefined,
          }), "Invite created — share the code with your driver."),
        })} />
        {data.invites.map((v, i) => (
          <Row key={v.id || i} title={v.code || `Invite #${v.id}`}
            sub={[v.location_name || v.company_location_id, v.status, v.created_at].filter(Boolean).join(" · ")}
            actions={[
              v.status === "active" ? { label: "Revoke", danger: true, onPress: () => runAction(() => revokeDriverInvite(v.id), "Invite revoked.") } : null,
            ].filter(Boolean)} />
        ))}
        {!data.invites.length ? <Empty text="No driver invites yet. Drivers redeem these codes to work at a location." /> : null}
      </View>
    );
  }

  if (screen === "tracking") {
    return (
      <View>
        <Text style={styles.section}>Live vehicles ({data.tracking.length})</Text>
        <Text style={styles.hint}>Auto-refreshes on live driver status & check-in events.</Text>
        {data.tracking.map((v, i) => (
          <Row key={v.id || i} title={v.vehicle_name || v.plate || `Vehicle #${v.id}`}
            sub={[v.plate, v.driver_name, v.live_status || v.status, v.speed != null ? `${Math.round(v.speed)} km/h` : null, v.last_update].filter(Boolean).join(" · ")} />
        ))}
        {!data.tracking.length ? <Empty text="No vehicles reporting position right now." /> : null}
      </View>
    );
  }

  if (screen === "checkins") {
    return (
      <View>
        <Text style={styles.section}>Check-in logs ({data.checkins.length})</Text>
        {data.checkins.slice(0, 150).map((c, i) => (
          <Row key={c.id || i} title={c.employee_name || c.name || `#${c.id}`}
            sub={[c.type, c.time || c.created_at, c.location_name, c.distance_m != null ? `${Math.round(c.distance_m)}m from office` : null].filter(Boolean).join(" · ")} />
        ))}
        {!data.checkins.length ? <Empty text="No check-ins recorded." /> : null}
      </View>
    );
  }

  if (screen === "exports") {
    return (
      <View>
        <Text style={styles.section}>Export spreadsheets</Text>
        <Text style={styles.hint}>Downloads an Excel file with the full dashboard view (trip lifecycle: logins, boarding, check-in, arrival, checkout, end-trip).</Text>
        {EXPORT_KINDS.map(([kind, label]) => (
          <View key={kind} style={styles.exportRow}>
            <Text style={styles.exportLabel}>{label}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={styles.exportBtn} onPress={() => downloadExport(kind, false).catch((e) => Alert.alert("Export failed", e.message))}>
                <Text style={styles.exportBtnText}>CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportBtn, styles.exportBtnXlsx]} onPress={() => downloadExport(kind, true).catch((e) => Alert.alert("Export failed", e.message))}>
                <Text style={[styles.exportBtnText, { color: "#fff" }]}>Excel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (screen === "notifications") {
    return (
      <View>
        <Text style={styles.section}>Notifications ({data.notifications.length})</Text>
        {data.notifications.slice(0, 100).map((n, i) => (
          <Row key={n.id || i} title={n.title || "Notification"} sub={[n.message, n.created_at].filter(Boolean).join(" · ")} />
        ))}
        {!data.notifications.length ? <Empty text="No notifications." /> : null}
      </View>
    );
  }

  return <Empty text="Screen not found." />;
}

function Action({ label, onPress }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}
function Row({ title, sub, actions }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      {actions && actions.length ? (
        <View style={styles.rowActions}>
          {actions.map((a, i) => (
            <TouchableOpacity key={i} style={[styles.rowBtn, a.danger && styles.rowBtnDanger]} onPress={a.onPress}>
              <Text style={[styles.rowBtnText, a.danger && { color: colors.coral }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
function Empty({ text }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: Platform.OS === "ios" ? 54 : 34, paddingBottom: 10, backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  hamburger: { paddingRight: 14, paddingVertical: 4 },
  hamburgerIcon: { color: colors.text, fontSize: 24, fontWeight: "700" },
  title: { color: colors.text, fontSize: 18, fontWeight: "900" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.coral },
  logoutText: { color: colors.coral, fontWeight: "800", fontSize: 13 },
  body: { padding: spacing.lg, paddingBottom: 40 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, minWidth: 100, flexGrow: 1 },
  kpiNum: { color: colors.text, fontSize: 22, fontWeight: "900" },
  kpiLbl: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  section: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 18, marginBottom: 6 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  row: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  rowBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary },
  rowBtnDanger: { borderColor: colors.coral },
  rowBtnText: { color: colors.primary, fontWeight: "800", fontSize: 12 },
  empty: { padding: 16, alignItems: "center" },
  emptyText: { color: colors.textDim, fontSize: 13 },
  action: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", marginBottom: 12 },
  actionText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  errBox: { backgroundColor: "#fef2f2", borderRadius: 8, margin: spacing.md, padding: 12 },
  errText: { color: colors.coral, fontSize: 13, fontWeight: "600" },
  retry: { color: colors.primary, fontWeight: "800", marginTop: 6 },
  drawerOverlay: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.45)" },
  drawer: { width: 270, backgroundColor: colors.panel, paddingTop: Platform.OS === "ios" ? 64 : 44, paddingHorizontal: 16 },
  drawerBackdrop: { flex: 1 },
  drawerBrand: { color: colors.text, fontSize: 20, fontWeight: "900" },
  drawerUser: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  drawerItem: { paddingVertical: 13, paddingHorizontal: 10, borderRadius: radius.sm, marginBottom: 2 },
  drawerItemOn: { backgroundColor: colors.primary },
  drawerItemText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  drawerItemTextOn: { color: "#fff" },
  drawerLogout: { marginTop: 14, borderWidth: 1, borderColor: colors.coral },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: "85%" },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginBottom: 12 },
  fieldLabel: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 12, color: colors.text, fontSize: 15 },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalCancel: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  modalCancelText: { color: colors.textDim, fontWeight: "800" },
  modalOk: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.primary },
  modalOkText: { color: "#fff", fontWeight: "800" },
  exportRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  exportLabel: { color: colors.text, fontSize: 13, fontWeight: "700", flex: 1, marginRight: 8 },
  exportBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary },
  exportBtnXlsx: { backgroundColor: colors.primary },
  exportBtnText: { color: colors.primary, fontWeight: "800", fontSize: 12 },
});
