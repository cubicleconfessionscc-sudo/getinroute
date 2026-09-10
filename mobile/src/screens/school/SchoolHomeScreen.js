import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert } from "react-native";
import { useAuth } from "../../context/AuthContext";
import client from "../../api/client";
import { schoolColors as colors, schoolSpacing as spacing, schoolRadius as radius } from "../../theme-school";

function StatCard({ label, value, accent }) {
  return (
    <View style={[styles.card, { borderTopColor: accent || colors.teal }]}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

// Read-only transport dashboard for the School build. Everything comes from
// /api/school/me (school + today's stats), so this is a genuine separate app
// backed by the school vertical endpoints - no Employee screens, no company
// branding (Issue #2).
export default function SchoolHomeScreen() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const res = await client.get("/school/me");
      setData(res.data);
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        Alert.alert("Session expired", "Please sign in again.");
        await logout();
      } else {
        setFailed(true);
      }
    }
  }, [logout]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = data?.stats || {};
  const schoolName = data?.school?.displayName || data?.school?.name || "School";
  const statCards = [
    { label: "Students", value: stats.students ?? "–", accent: colors.teal },
    { label: "Parents", value: stats.parents ?? "–", accent: colors.green },
    { label: "Vehicles", value: `${stats.vehicles ?? "–"}/${stats.vehicles_on_trip ?? "–"} on trip` },
    { label: "Routes", value: stats.routes ?? "–", accent: colors.tealDeep },
    { label: "Trips today", value: stats.trips_today ?? "–", accent: colors.green },
    { label: "Boarded / Dropped", value: `${stats.boarded_today ?? "–"} / ${stats.dropped_today ?? "–"}` }
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.schoolName}>{schoolName}</Text>
        <Text style={styles.liveLabel}>School transport control</Text>
        <TouchableOpacity style={styles.signOut} onPress={async () => { await logout(); }}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} tintColor={colors.teal} />}
      >
        {failed && (
          <TouchableOpacity style={styles.errorBox} onPress={load}>
            <Text style={styles.errorText}>Couldn't load data. Tap to retry.</Text>
          </TouchableOpacity>
        )}

        <View style={styles.statGrid}>
          {statCards.map((s) => <StatCard key={s.label} label={s.label} value={s.value} accent={s.accent} />)}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Signed in as {user?.name} ({user?.email}). Manage students, vehicles, routes and parents from the{"\n"}
            GetInRoute School web app for full control.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.tealDeep,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg
  },
  schoolName: { color: "#FFFFFF", fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  liveLabel: { color: "#CCFBF1", fontSize: 13, marginTop: 4 },
  signOut: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  signOutText: { color: "#FFFFFF", fontWeight: "600", fontSize: 13 },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  statGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.md },
  card: {
    width: "48%",
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderTopWidth: 3,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  cardValue: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  cardLabel: { color: colors.textDim, fontSize: 12, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  errorBox: {
    backgroundColor: "#FEE2E2",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  errorText: { color: "#7F1D1D", fontWeight: "600", textAlign: "center" },
  infoBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.panel2,
    borderRadius: radius.md,
    padding: spacing.md
  },
  infoText: { color: colors.textDim, fontSize: 13, lineHeight: 19 }
});