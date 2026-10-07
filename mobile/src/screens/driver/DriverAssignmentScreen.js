import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { getMyDriverAllotments } from "../../api/schedules";
import { getAssignedTrips } from "../../api/trips";
import { getStandingPoint, setStandingPoint } from "../../api/driver";
import { colors, spacing, radius, shadow } from "../../theme";

const ASSIGN_KEY = "gir_driver_assignment";
const STANDS = Array.from({ length: 60 }, (_, i) => `L${i + 1}`);

export async function getSavedAssignment() {
  try { const raw = await SecureStore.getItemAsync(ASSIGN_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function saveAssignment(a) {
  try { await SecureStore.setItemAsync(ASSIGN_KEY, JSON.stringify(a)); } catch {}
}

export default function DriverAssignmentScreen({ navigation }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tripId, setTripId] = useState(null);
  const [line, setLine] = useState(null);
  const [stand, setStand] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [allotments, assigned] = await Promise.all([
        getMyDriverAllotments().catch(() => []),
        getAssignedTrips().catch(() => [])
      ]);
      const runs = Array.isArray(allotments) ? allotments : [];
      const list = runs.map((r) => ({
        id: r._id || r.id,
        name: r.routeName || (r.vehicle && r.vehicle.vehicleNumber) || r.slotLabel || "Assigned trip",
        line: r.vehicle && r.vehicle.line ? Number(r.vehicle.line) : null,
        vehicle: (r.vehicle && r.vehicle.vehicleNumber) || "",
        raw: r
      }));
      // If no cab-run allotments, fall back to assigned trips so the driver still
      // has something real to pick.
      if (!list.length && Array.isArray(assigned)) {
        assigned.forEach((t) => list.push({ id: t._id || t.id, name: t.routeName || "Assigned trip", line: null, vehicle: "", raw: t }));
      }
      setTrips(list);
      if (list.length === 1) { setTripId(list[0].id); setLine(list[0].line || 1); }
      const sp = await getStandingPoint().catch(() => null);
      if (sp && sp.standingPoint) setStand(sp.standingPoint);
    } catch (e) {
      setError(e?.message || "Could not load your assignments.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTrip = trips.find((t) => String(t.id) === String(tripId)) || null;
  const lineOptions = selectedTrip
    ? [...new Set(trips.map((t) => t.line).filter((n) => n != null))]
    : [];
  const canContinue = !!selectedTrip && line != null && !!stand;

  const onContinue = async () => {
    if (!canContinue) return;
    setBusy(true);
    try {
      await setStandingPoint(stand).catch(() => {});
      await saveAssignment({ tripId, tripName: selectedTrip.name, line, stand });
      navigation.replace("DriverHome", { assignment: { tripId, tripName: selectedTrip.name, line, stand } });
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Select your assignment</Text>
        <Text style={styles.sub}>Choose the trip, line and stand you are operating today.</Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your trips…</Text></View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.err}>⚠️ {error}</Text>
            <TouchableOpacity style={styles.btn} onPress={load}><Text style={styles.btnText}>Try Again</Text></TouchableOpacity>
          </View>
        ) : trips.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No trips are assigned to you yet. Please contact your transport admin.</Text>
            <TouchableOpacity style={styles.btnOutline} onPress={load}><Text style={styles.btnOutlineText}>Refresh</Text></TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.label}>TRIP</Text>
            {trips.map((t) => (
              <TouchableOpacity key={String(t.id)} style={[styles.opt, String(tripId) === String(t.id) && styles.optOn]} onPress={() => { setTripId(t.id); setLine(t.line || 1); }}>
                <Text style={[styles.optText, String(tripId) === String(t.id) && styles.optTextOn]}>{t.name}</Text>
                {t.vehicle ? <Text style={styles.optSub}>{t.vehicle}</Text> : null}
              </TouchableOpacity>
            ))}

            {selectedTrip && (
              <>
                <Text style={styles.label}>LINE</Text>
                <View style={styles.rowWrap}>
                  {(lineOptions.length ? lineOptions : [1, 2, 3, 4, 5]).map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, line === n && styles.chipOn]} onPress={() => setLine(n)}>
                      <Text style={[styles.chipText, line === n && styles.chipTextOn]}>Line {n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>STAND</Text>
                <View style={styles.rowWrap}>
                  {STANDS.map((s) => (
                    <TouchableOpacity key={s} style={[styles.chip, stand === s && styles.chipOn]} onPress={() => setStand(s)}>
                      <Text style={[styles.chipText, stand === s && styles.chipTextOn]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.continue, !canContinue && styles.continueOff]} disabled={!canContinue || busy} onPress={onContinue}>
          <Text style={styles.continueText}>{busy ? "Starting…" : "Continue"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  center: { alignItems: "center", padding: spacing.xl, gap: 10 },
  muted: { color: colors.textDim, fontSize: 13 },
  err: { color: colors.coral, fontSize: 13, marginBottom: 10 },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: 8 },
  opt: { backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.line, marginBottom: 8 },
  optOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  optTextOn: { color: colors.primary },
  optSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.panel },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: "#fff" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line },
  continue: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: "center" },
  continueOff: { opacity: 0.5 },
  continueText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  btnText: { color: "#fff", fontWeight: "800" },
  btnOutline: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  btnOutlineText: { color: colors.text, fontWeight: "700" }
});
