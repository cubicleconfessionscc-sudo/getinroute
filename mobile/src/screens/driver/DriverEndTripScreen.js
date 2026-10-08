import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getMyDriverAllotments } from "../../api/schedules";
import { saveDriverAssignment, setStandingPoint, getStandingPoint } from "../../api/driver";
import Dropdown from "../../components/Dropdown";
import { colors, spacing, radius, shadow } from "../../theme";

// End-of-trip operational procedure. Line/Stand/Trip selection belongs HERE
// (when the driver finishes a trip and parks the cab), never at login.
//
// First Trip: Trip + Line + Stand are all required (recorded for Admin/Vendor).
// Second Trip: only Trip is required; Line/Stand are optional.
const TRIP_OPTIONS = ["First Trip", "Second Trip"];
const STANDS = Array.from({ length: 60 }, (_, i) => `L${i + 1}`);

export default function DriverEndTripScreen({ navigation, route }) {
  const params = route?.params || {};
  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(params.direction === "toHome" ? "Second Trip" : "First Trip");
  const [line, setLine] = useState(null);
  const [stand, setStand] = useState(null);
  const [lineOptions, setLineOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const isFirst = trip === "First Trip";
  const canConfirm = !!trip && (isFirst ? (!!line && !!stand) : true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allotments = await getMyDriverAllotments().catch(() => []);
      const runs = Array.isArray(allotments) ? allotments : [];
      // Line options come from the real configured data (the vehicle's line),
      // falling back to the standard 1..10 set when none is configured.
      const lines = new Set();
      runs.forEach((r) => { if (r.vehicle && r.vehicle.line != null) lines.add(Number(r.vehicle.line)); });
      if (!lines.size) { for (let i = 1; i <= 10; i += 1) lines.add(i); }
      setLineOptions([...lines].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `Line ${n}` })));
      const sp = await getStandingPoint().catch(() => null);
      if (sp && sp.standingPoint) setStand(sp.standingPoint);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    try {
      if (stand) await setStandingPoint(stand).catch(() => {});
      await saveDriverAssignment({
        tripId: params.runId || null,
        tripName: trip,
        line: line ?? null,
        stand: stand ?? null
      }).catch(() => {});
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  // Reset = clear the current trip/session UI state and return to the next
  // assigned trip. Historical trip records are never touched.
  function onReset() {
    setTrip(params.direction === "toHome" ? "Second Trip" : "First Trip");
    setLine(null);
    setStand(null);
    setSaved(false);
    navigation.replace("DriverHome");
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{saved ? "Trip completed ✓" : "End-of-trip details"}</Text>
        <Text style={styles.sub}>
          {saved
            ? "Your end-of-trip information has been recorded. Reset to load your next trip."
            : "Record where your cab is parked to finish this trip. Admin and Vendor can see this."}
        </Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : saved ? (
          <View style={styles.card}>
            <View style={styles.doneRow}><Text style={styles.doneTick}>✓</Text><Text style={styles.doneTitle}>Recorded</Text></View>
            <Text style={styles.doneLine}>Trip: {trip}</Text>
            {line ? <Text style={styles.doneLine}>Line: Line {line}</Text> : null}
            {stand ? <Text style={styles.doneLine}>Stand: {stand}</Text> : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Dropdown label="SELECT TRIP" value={trip} options={TRIP_OPTIONS} onChange={setTrip} />
            <Dropdown
              label={`SELECT LINE${isFirst ? "" : " (optional)"}`}
              placeholder="Choose a line"
              value={line ? `Line ${line}` : null}
              options={lineOptions}
              onChange={setLine}
            />
            <Dropdown
              label={`SELECT STAND${isFirst ? "" : " (optional)"}`}
              placeholder="Choose a stand"
              value={stand}
              options={STANDS}
              onChange={setStand}
            />
            {!isFirst ? (
              <Text style={styles.note}>Second trip: Line and Stand are optional — only the trip is required.</Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {saved ? (
          <TouchableOpacity style={styles.primary} onPress={onReset}>
            <Text style={styles.primaryText}>RESET FOR NEXT TRIP</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primary, !canConfirm && styles.primaryOff]}
            disabled={!canConfirm || busy || loading}
            onPress={onConfirm}
          >
            <Text style={styles.primaryText}>{busy ? "Saving…" : "Confirm"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 130 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.md, lineHeight: 19 },
  center: { alignItems: "center", padding: spacing.xl },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  note: { color: colors.textDim, fontSize: 12.5, marginTop: spacing.md, lineHeight: 18 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  doneTick: { color: colors.green, fontSize: 26, fontWeight: "900" },
  doneTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  doneLine: { color: colors.textDim, fontSize: 14, marginTop: 8, fontWeight: "600" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  primaryOff: { opacity: 0.5 },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.4 }
});
