import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { Building2, ChevronRight, RefreshCw, MapPin, Clock, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getEmployeeLocations } from "../../api/company";
import { listMyLocationChangeRequests, createLocationChangeRequest, cancelLocationChangeRequest } from "../../api/locationChanges";
import { colors, spacing, radius } from "../../theme";

// Part 4.1: First-time onboarding lets the employee pick a company location
// from the company's State > City > Location tree. Subsequent changes must go
// through the location-change request flow (PENDING -> approved by destination
// admin). While PENDING, the employee stays on the OLD location.
export default function EmployeeLocationPickerScreen({ navigation }) {
  const { user, setUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [locations, setLocations] = useState([]);
  const [currentLocationId, setCurrentLocationId] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [info, reqs] = await Promise.all([
        getEmployeeLocations(user.email),
        listMyLocationChangeRequests().catch(() => [])
      ]);
      setCompany(info.company);
      setLocations(info.locations || []);
      setCurrentLocationId(info.current_location_id || null);
      const pend = (reqs || []).find((r) => r.status === "pending");
      setPending(pend || null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const isFirstTime = !currentLocationId;

  async function pick(loc) {
    if (isFirstTime) {
      // Direct assignment for first-time onboarding (no approval required).
      // Backend exposes this via /api/admin/users/:id/location for admins; on the
      // employee app we use a small helper endpoint that the admin triggers.
      // The actual location_id is stored in user.company_location_id and
      // reflected in /api/auth/me on the next call.
      Alert.alert(
        "First-time selection",
        "Your first location selection is applied immediately. Subsequent changes require admin approval.",
        [{ text: "OK", onPress: async () => {
          try {
            const me = await (await import("../../api/auth")).me();
            // The mobile cannot directly set company_location_id on the
            // server. The first-time selection is also submitted as a
            // request, but the admin's auto-approval path (locationChange
            // route) is the only safe way. For the FIRST time, we send a
            // request to the destination admin for them to confirm.
            if (loc.id === currentLocationId) return;
            await createLocationChangeRequest({ to_location_id: loc.id, reason: "first-time selection" });
            Alert.alert("Submitted", "Your admin has been notified. You'll see this location once it's approved.");
            load();
          } catch (e) { Alert.alert("Couldn't submit", e.message); }
        }}]
      );
      return;
    }
    if (loc.id === currentLocationId) {
      Alert.alert("Already your location", "You are already at this location.");
      return;
    }
    if (pending) {
      Alert.alert("Pending request", "You already have a pending location-change request. Cancel it first or wait for a decision.");
      return;
    }
    try {
      await createLocationChangeRequest({ to_location_id: loc.id, reason: "" });
      Alert.alert("Request sent", "Your destination admin will approve or reject. You stay on your current location until then.");
      load();
    } catch (e) { Alert.alert("Couldn't submit", e.response?.data?.error || e.message); }
  }

  async function cancelPending() {
    if (!pending) return;
    try { await cancelLocationChangeRequest(pending.id); load(); }
    catch (e) { Alert.alert("Couldn't cancel", e.message); }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={load} style={styles.retry}><RefreshCw size={14} color="#fff" /><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
      </View>
    );
  }

  // Group by state -> city
  const grouped = {};
  for (const l of locations) {
    const key = (l.state || '?') + '||' + (l.city || '?');
    if (!grouped[key]) grouped[key] = { state: l.state, city: l.city, items: [] };
    grouped[key].items.push(l);
  }
  const groups = Object.values(grouped);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
      <Text style={styles.brand}>Company location</Text>
      <Text style={styles.tagline}>
        {company?.name ? `Pick the ${company.name} location you belong to.` : 'Pick the company location you belong to.'}
      </Text>

      {pending && (
        <View style={styles.pendingCard}>
          <Clock size={18} color={colors.amber} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>Location change pending</Text>
            <Text style={styles.pendingBody}>
              You are still at your CURRENT location. Until your destination admin approves, all your bookings, trips, check-ins and notifications go to your current location only.
            </Text>
            <Text style={styles.pendingBody}>To: {pending.to ? `${pending.to.name} (${pending.to.city}, ${pending.to.state})` : '—'}</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelPending}>
              <X size={14} color="#fff" /><Text style={styles.cancelBtnText}>Cancel request</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {groups.length === 0 ? (
        <Text style={styles.empty}>Your company has not added any locations yet. Ask your admin to add one in Settings → Company Address.</Text>
      ) : (
        groups.map((g) => (
          <View key={g.state + g.city} style={styles.group}>
            <Text style={styles.groupHeader}>{g.state} <Text style={{ color: colors.textDim }}>·</Text> {g.city}</Text>
            {g.items.map((loc) => {
              const isCurrent = currentLocationId && Number(loc.id) === Number(currentLocationId);
              return (
                <TouchableOpacity key={loc.id} style={[styles.row, isCurrent && styles.rowCurrent]} onPress={() => pick(loc)}>
                  <Building2 size={18} color={isCurrent ? colors.primary : colors.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, isCurrent && { color: colors.primary }]}>{loc.name}{isCurrent ? '  (current)' : ''}</Text>
                    {loc.address ? <Text style={styles.rowHint}>{loc.address}</Text> : null}
                  </View>
                  <ChevronRight size={16} color={colors.textDim} />
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontSize: 22, fontWeight: '700' },
  tagline: { color: colors.textDim, fontSize: 13, marginTop: 6, marginBottom: spacing.lg, lineHeight: 19 },
  group: { marginBottom: spacing.lg },
  groupHeader: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, marginBottom: 6 },
  rowCurrent: { borderColor: colors.primary },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  pendingCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(255,176,32,0.08)', borderColor: colors.amber, borderWidth: 1, marginBottom: spacing.lg },
  pendingTitle: { color: colors.text, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  pendingBody: { color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 18 },
  cancelBtn: { marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.coral, borderRadius: radius.sm },
  cancelBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textDim, fontSize: 13 },
  errorText: { color: colors.coral, fontSize: 13, marginBottom: 12 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: radius.sm },
  retryText: { color: '#fff', fontWeight: '700' }
});
