import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import {
  getAdminStats, getAdminEmployees, getAdminDrivers, getAdminVehicles,
  getVendorDashboard, getVendorEmployees, getVendorDrivers, getVendorVehicles,
} from "../../api/adminvendor";
import { colors, spacing, radius } from "../../theme";

const TABS = ["Overview", "People", "Fleet"];

export default function AdminVendorHome({ user, mode, onLogout }) {
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ stats: null, employees: [], drivers: [], vehicles: [] });

  const load = useCallback(async () => {
    setError("");
    try {
      const isVendor = mode === "vendor";
      const [stats, employees, drivers, vehicles] = await Promise.all([
        isVendor ? getVendorDashboard().catch(() => null) : getAdminStats().catch(() => null),
        (isVendor ? getVendorEmployees() : getAdminEmployees()).catch(() => []),
        (isVendor ? getVendorDrivers() : getAdminDrivers()).catch(() => []),
        (isVendor ? getVendorVehicles() : getAdminVehicles()).catch(() => []),
      ]);
      setData({
        stats: stats || null,
        employees: Array.isArray(employees) ? employees : [],
        drivers: Array.isArray(drivers) ? drivers : [],
        vehicles: Array.isArray(vehicles) ? vehicles : [],
      });
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Could not reach the server.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const kpis = () => {
    const s = data.stats || {};
    const rows = [
      ["Employees", s.employees ?? data.employees.length],
      ["Drivers", s.drivers ?? data.drivers.length],
      ["Vehicles", s.vehicles ?? data.vehicles.length],
      ["Trips today", s.trips_today ?? "—"],
      ["Active trips", s.active_trips ?? "—"],
      ["Alerts today", s.alerts_today ?? "—"],
    ];
    return rows;
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{mode === "vendor" ? "Vendor Console" : "Admin Console"}</Text>
        <Text style={styles.sub}>{user?.name || user?.email || ""}{user?.role ? ` · ${user.role}` : ""}</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.logout} onPress={onLogout}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errBox}><Text style={styles.errText}>{error}</Text>
          <TouchableOpacity onPress={onRefresh}><Text style={styles.retry}>Retry</Text></TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === "Overview" && (
          <View style={styles.grid}>
            {kpis().map(([label, value]) => (
              <View key={label} style={styles.kpi}><Text style={styles.kpiNum}>{String(value)}</Text><Text style={styles.kpiLbl}>{label}</Text></View>
            ))}
          </View>
        )}
        {tab === "People" && (
          <View>
            <Text style={styles.section}>Employees ({data.employees.length})</Text>
            {data.employees.slice(0, 40).map((e, i) => (
              <Row key={e.id || e._id || i} title={e.name || e.emp_id || "Employee"} sub={[e.emp_id, e.department, e.status].filter(Boolean).join(" · ")} />
            ))}
            {!data.employees.length ? <Empty text="No employees visible for your scope." /> : null}
            <Text style={styles.section}>Drivers ({data.drivers.length})</Text>
            {data.drivers.slice(0, 40).map((d, i) => (
              <Row key={d.id || d._id || i} title={d.name || d.emp_id || "Driver"} sub={[d.emp_id, d.phone, d.vehicle_name].filter(Boolean).join(" · ")} />
            ))}
            {!data.drivers.length ? <Empty text="No drivers visible for your scope." /> : null}
          </View>
        )}
        {tab === "Fleet" && (
          <View>
            <Text style={styles.section}>Vehicles ({data.vehicles.length})</Text>
            {data.vehicles.slice(0, 40).map((v, i) => (
              <Row key={v.id || v._id || i} title={v.vehicle_name || v.plate || "Vehicle"} sub={[v.plate, v.type, v.line ? `Line ${v.line}` : null, v.stand].filter(Boolean).join(" · ")} />
            ))}
            {!data.vehicles.length ? <Empty text="No vehicles visible for your scope." /> : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ title, sub }) {
  return (
    <View style={styles.row}><Text style={styles.rowTitle}>{title}</Text>{sub ? <Text style={styles.rowSub}>{sub}</Text> : null}</View>
  );
}
function Empty({ text }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  tabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontWeight: "800", fontSize: 13 },
  tabTextOn: { color: "#fff" },
  logout: { marginLeft: "auto", paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.coral },
  logoutText: { color: colors.coral, fontWeight: "800", fontSize: 13 },
  body: { padding: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, minWidth: 120, flexGrow: 1 },
  kpiNum: { color: colors.text, fontSize: 22, fontWeight: "900" },
  kpiLbl: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  section: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  row: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  empty: { padding: 16, alignItems: "center" },
  emptyText: { color: colors.textDim, fontSize: 13 },
  errBox: { backgroundColor: "#fef2f2", borderRadius: 8, margin: spacing.md, padding: 12 },
  errText: { color: colors.coral, fontSize: 13, fontWeight: "600" },
  retry: { color: colors.primary, fontWeight: "800", marginTop: 6 }
});
