import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Linking, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { getTripHistory, downloadMyHistoryCsv } from "../../api/trips";
import { clearCacheFor } from "../../services/offlineQueue";
import { colors, spacing, radius } from "../../theme";

// ---- Status model -----------------------------------------------------------
// The backend stores trip/booking status on `schedules.status` and a no-show flag
// on `schedules.absent`. We map those EXISTING values into user-friendly buckets:
//   no-show   -> absent = 1
//   cancelled -> status = 'cancelled'
//   completed -> status = 'completed'
//   booked    -> everything else (requested / confirmed / scheduled / in_progress)
const CATEGORY = {
  booked: { label: "Booked", color: colors.amber },
  completed: { label: "Completed", color: colors.green },
  cancelled: { label: "Cancelled", color: colors.coral },
  no_show: { label: "No-show", color: colors.violet }
};

function categoryOf(r) {
  if (r.absent) return "no_show";
  const s = String(r.status || "").toLowerCase();
  if (s === "cancelled") return "cancelled";
  if (s === "completed") return "completed";
  return "booked";
}

function dirLabel(d) { return d === "toHome" ? "Logout" : "Login"; }

function recordOf(r) {
  const stops = Array.isArray(r.stops) ? r.stops : [];
  const idx = Math.max(0, (Number(r.sequence) || 1) - 1);
  const myStop = stops[idx] || stops[0] || {};
  const direction = r.direction || ((r.login_time || r.pickup_time) ? "toOffice" : "toHome");
  const pickup = myStop.name || r.pickup_point || "Pickup";
  const drop = direction === "toHome" ? (myStop.name || "Home") : (r.route_name || "Office");
  const time = r.pickup_time || r.login_time || r.drop_time || r.logout_time || "";
  return {
    id: "sched-" + r.id,
    date: r.date,
    direction,
    pickup,
    drop,
    vehicle: r.vehicle_name || r.plate || "",
    driver: r.driver_name || "",
    route: r.route_name || "",
    statusRaw: r.status,
    time,
    checkin: r.checkin?.time || null,
    checkout: r.checkout?.time || null,
    category: categoryOf(r)
  };
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No-show" }
];

export default function EmployeeHistoryScreen() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getTripHistory();
      const mapped = (Array.isArray(rows) ? rows : [])
        .map(recordOf)
        .filter((i) => i.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      setItems(mapped);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not load your history.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // ---- Statistics (across all records, not the filtered view) ----
  const stats = (() => {
    let booked = 0, completed = 0, cancelled = 0, noShow = 0;
    for (const i of items) {
      if (i.category === "completed") completed++;
      else if (i.category === "cancelled") cancelled++;
      else if (i.category === "no_show") noShow++;
      else booked++;
    }
    return { total: items.length, booked, completed, cancelled, noShow };
  })();

  const now = Date.now();
  const filtered = items.filter((i) => {
    if (filter === "completed" || filter === "cancelled" || filter === "no_show") return i.category === filter;
    const d = new Date(i.date);
    if (isNaN(d)) return filter === "all";
    if (filter === "7d") return now - d <= 7 * 86400000;
    if (filter === "30d") return now - d <= 30 * 86400000;
    return true;
  });

  // Clear ONLY the locally cached history — never the server records, the token,
  // the offline queue, the profile or the approved address.
  const clearLocal = () => {
    Alert.alert(
      "Clear trip history from this device?",
      "Your official trip records will remain available to your company. Only locally stored history will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearCacheFor(["/trips/history", "/trips/mine", "/schedules/mine", "/schedules/allotments", "/schedules/allotments/live"]);
            setItems([]);
            Alert.alert("Local history cleared.", "Pull to refresh to reload it from the server.");
          }
        }
      ]
    );
  };

  const exportCsv = async () => {
    try {
      const uri = await downloadMyHistoryCsv();
      await Linking.openURL(uri).catch(() => Alert.alert("Exported", "Saved your official history on this device."));
    } catch (e) {
      Alert.alert("Export failed", e.response?.data?.error || e.message || "Please try again.");
    }
  };

  const renderStat = (label, value, tone) => (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone && { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip history</Text>
        <TouchableOpacity style={styles.exportButton} onPress={exportCsv}>
          <Text style={styles.exportButtonText}>Export .csv</Text>
        </TouchableOpacity>
      </View>

      {/* Statistics */}
      <View style={styles.statsCard}>
        {renderStat("Total", stats.total)}
        {renderStat("Booked", stats.booked, colors.amber)}
        {renderStat("Completed", stats.completed, colors.green)}
        {renderStat("Cancelled", stats.cancelled, colors.coral)}
        {renderStat("No-show", stats.noShow, colors.violet)}
      </View>

      {/* Filters */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={(f) => f.key}
        style={styles.filterList}
        contentContainerStyle={styles.filterRow}
        renderItem={({ item: f }) => (
          <TouchableOpacity
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Couldn't load history</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}><Text style={styles.retryBtnText}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xs }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>No trips or cab bookings yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.rowDate}>{formatDate(item.date)}{item.time ? ` · ${item.time}` : ""}</Text>
                <View style={[styles.catBadge, { borderColor: CATEGORY[item.category].color }]}>
                  <Text style={[styles.catBadgeText, { color: CATEGORY[item.category].color }]}>{CATEGORY[item.category].label}</Text>
                </View>
              </View>
              <Text style={styles.dirLabel}>{dirLabel(item.direction)}</Text>
              <Text style={styles.routeText}>{item.pickup} → {item.drop}</Text>
              {item.vehicle || item.driver ? (
                <Text style={styles.metaText}>
                  {item.vehicle ? `🚗 ${item.vehicle}` : ""}{item.driver ? `${item.vehicle ? " · " : ""}${item.driver}` : ""}
                </Text>
              ) : null}
              {item.route ? <Text style={styles.metaDim}>{item.route}</Text> : null}
              {item.checkin || item.checkout ? (
                <Text style={styles.metaDim}>
                  {item.checkin ? `Check-in ${fmtClock(item.checkin)}` : ""}{item.checkin && item.checkout ? " · " : ""}{item.checkout ? `Check-out ${fmtClock(item.checkout)}` : ""}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.clearBtn} onPress={clearLocal}>
        <Text style={styles.clearBtnText}>Clear local history</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatDate(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return String(iso || "—").slice(0, 10);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function fmtClock(t) {
  const s = String(t || "");
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return s.slice(0, 5);
  let h = Number(m[1]); const mm = m[2];
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  exportButton: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  exportButtonText: { color: colors.primary, fontSize: 12.5, fontWeight: "600" },
  statsCard: { flexDirection: "row", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, marginHorizontal: spacing.lg, paddingVertical: spacing.md },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2, fontWeight: "600" },
  filterList: { flexGrow: 0, marginTop: spacing.sm },
  filterRow: { gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDim, fontSize: 12.5, fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  row: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowDate: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  catBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  catBadgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  dirLabel: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 6 },
  routeText: { color: colors.text, fontSize: 13.5, marginTop: 4 },
  metaText: { color: colors.text, fontSize: 12.5, marginTop: 4 },
  metaDim: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40 },
  errorBox: { alignItems: "center", marginTop: 40, paddingHorizontal: spacing.xl },
  errorTitle: { color: colors.coral, fontSize: 15, fontWeight: "800" },
  errorBody: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 6 },
  retryBtn: { marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 24 },
  retryBtnText: { color: "#fff", fontWeight: "800" },
  clearBtn: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, borderWidth: 1.5, borderColor: colors.coral, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  clearBtnText: { color: colors.coral, fontWeight: "800", fontSize: 14 }
});
