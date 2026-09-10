import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Linking, RefreshControl, Alert } from "react-native";
import { getMyTrips, exportMyHistory } from "../../api/trips";
import { getMyAllotments, cancelSchedule } from "../../api/schedules";
import { colors, spacing, radius } from "../../theme";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" }
];

export default function EmployeeHistoryScreen() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [requests, allotments] = await Promise.all([
      getMyTrips().catch(() => []),
      getMyAllotments().catch(() => [])
    ]);
    const tripItems = (requests || []).map((r) => ({
      id: "trip-" + r._id,
      kind: "trip",
      date: r.trip?.date || r.scheduledTime || r.createdAt,
      title: (r.pickupLocation?.address || "Pickup") + " → " + (r.dropLocation?.address || "Drop"),
      subtitle: r.trip?.date ? `Cab trip · ${r.trip.status}` : (r.status || "requested"),
      status: r.trip?.status || r.status
    }));
    const allotItems = (allotments || []).map((a) => ({
      id: "cab-" + a._id,
      kind: "cab",
      date: a.date,
      title: `${a.vehicle?.vehicleNumber || a.vehicleType || "Cab"} · ${a.direction === "toOffice" ? "Login" : "Logout"}`,
      subtitle: `${a.slotLabel || "Shift"} · ${a.driver?.name ? "driver " + a.driver.name : "no driver yet"}`,
      status: a.status
    }));
    const all = [...tripItems, ...allotItems]
      .filter((i) => i.date)
      .sort((x, y) => String(y.date).localeCompare(String(x.date)));
    setItems(all);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const now = new Date();
  const filtered = items.filter((i) => {
    const d = new Date(i.date);
    if (isNaN(d)) return filter === "all";
    if (filter === "7d") return now - d <= 7 * 86400000;
    if (filter === "30d") return now - d <= 30 * 86400000;
    return true;
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDelete = (item) => {
    // Only cab bookings can be deleted from history.
    if (item.kind !== "cab") return;
    const scheduleId = String(item.id).replace(/^cab-/, "");
    if (!scheduleId) return;
    Alert.alert(
      "Delete booking?",
      "This removes the cab booking from your history. You can't undo this.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelSchedule(scheduleId);
              setItems((prev) => prev.filter((i) => i.id !== item.id));
            } catch (err) {
              Alert.alert("Couldn't delete", err.response?.data?.error || err.message);
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip history</Text>
        <TouchableOpacity style={styles.exportButton} onPress={() => Linking.openURL(exportMyHistory())}>
          <Text style={styles.exportButtonText}>Export .xlsx</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xs }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowTop}>
                <Text style={styles.rowDate}>{formatDate(item.date)}</Text>
                <Text style={[styles.kindBadge, item.kind === "cab" ? styles.kindCab : styles.kindTrip]}>
                  {item.kind === "cab" ? "CAB" : "TRIP"}
                </Text>
              </View>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowSub}>{item.subtitle}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowStatus}>{item.status}</Text>
              {item.kind === "cab" && (
                <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item)}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No trips or cab bookings yet.</Text>}
      />
    </View>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10) || "—";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  exportButton: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  exportButtonText: { color: colors.teal, fontSize: 12.5, fontWeight: "600" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { color: colors.textDim, fontSize: 12.5, fontWeight: "600" },
  chipTextActive: { color: "#02201C", fontWeight: "700" },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  rowDate: { color: colors.textDim, fontSize: 11 },
  kindBadge: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  kindCab: { color: colors.violet, backgroundColor: "rgba(139,124,246,0.12)" },
  kindTrip: { color: colors.teal, backgroundColor: "rgba(0,217,192,0.12)" },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  rowStatus: { color: colors.amber, fontSize: 12, fontWeight: "600", textTransform: "capitalize", marginLeft: 10 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  deleteButton: { borderWidth: 1, borderColor: colors.coral, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 10, marginTop: 6 },
  deleteButtonText: { color: colors.coral, fontSize: 12, fontWeight: "600" },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40 }
});
