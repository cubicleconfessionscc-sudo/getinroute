import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator
} from "react-native";
import * as Location from "expo-location";
import { getLocationProfile, updateLocationProfile } from "../../api/locations";
import { getMyCompany } from "../../api/company";
import { connectSocket } from "../../services/socket";
import { useAuth } from "../../context/AuthContext";
import { colors, spacing, radius } from "../../theme";

/**
 * "My pickup & drop" - two directional profiles, both submitted together and
 * reviewed by the admin (locationStatus):
 *
 *  Going to office (login):
 *    - Pickup: either an exact location (GPS) or a company nodal point.
 *    - Drop: a company nodal point (the office location the admin configured
 *      under "Nodal pickup/drop points").
 *  Going home (logout):
 *    - Drop: the exact home address.
 */
export default function EmployeeLocationsScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [tab, setTab] = useState("login"); // "login" | "logout"

  // Going-to-office: pickup = exact location or nodal point
  const [pickupMode, setPickupMode] = useState("exact"); // "exact" | "nodal"
  const [pickup, setPickup] = useState({ address: "", lat: null, lng: null, nodalPointId: null, picking: false });
  // Going-to-office: drop = company nodal point
  const [drop, setDrop] = useState({ address: "", lat: null, lng: null, nodalPointId: null });
  // Going-home: drop = exact home address
  const [home, setHome] = useState({ address: "", lat: null, lng: null, picking: false });

  const nodalPoints = (company?.nodalPoints || []).filter((p) => p.active !== false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([getLocationProfile(), getMyCompany()]);
      setProfile(p);
      setCompany(c);
      const pu = p.pickupLocation || {};
      setPickupMode(pu.source === "nodal" ? "nodal" : "exact");
      setPickup({
        address: pu.address || "",
        lat: pu.lat ?? null,
        lng: pu.lng ?? null,
        nodalPointId: pu.nodalPointId || null,
        picking: false
      });
      const dr = p.dropLocation || {};
      setDrop({
        address: dr.address || "",
        lat: dr.lat ?? null,
        lng: dr.lng ?? null,
        nodalPointId: dr.nodalPointId || null
      });
      const hm = p.homeLocation || {};
      setHome({ address: hm.address || "", lat: hm.lat ?? null, lng: hm.lng ?? null, picking: false });
    } catch (e) {
      Alert.alert("Couldn't load", e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live feedback when the admin approves/rejects this submission.
  useEffect(() => {
    let socket;
    (async () => {
      socket = await connectSocket();
      socket.on("location:approval", () => load());
    })();
    return () => socket?.off("location:approval");
  }, [load]);

  async function currentAddress() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission is required to set your current position.");
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = pos.coords;
    let address = "";
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      address =
        [place?.name, place?.district, place?.city, place?.region]
          .filter(Boolean)
          .join(", ");
    } catch (e) {
      address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
    return { address, lat: latitude, lng: longitude };
  }

  async function useCurrentLocationForPickup() {
    setPickup((prev) => ({ ...prev, picking: true }));
    try {
      const p = await currentAddress();
      setPickup({ ...p, nodalPointId: null, picking: false });
    } catch (err) {
      setPickup((prev) => ({ ...prev, picking: false }));
      Alert.alert("Location unavailable", err.message || String(err));
    }
  }

  async function useCurrentLocationForHome() {
    setHome((prev) => ({ ...prev, picking: true }));
    try {
      const p = await currentAddress();
      setHome({ ...p, picking: false });
    } catch (err) {
      setHome((prev) => ({ ...prev, picking: false }));
      Alert.alert("Location unavailable", err.message || String(err));
    }
  }

  function pickNodalPoint(list, point) {
    const value = {
      address: point.address || point.label,
      lat: point.lat,
      lng: point.lng,
      nodalPointId: point._id
    };
    if (list === "pickup") {
      setPickup((prev) => ({ ...value, picking: false }));
      setPickupMode("nodal");
    } else {
      setDrop(value);
    }
  }

  function handleSubmit() {
    if (!pickup.address && !drop.address && !home.address) {
      Alert.alert("Nothing to submit", "Set your pickup/drop for going to office, your home address for going home, or both.");
      return;
    }
    const hasCoords = (l) => l.address && typeof l.lat === "number" && typeof l.lng === "number";
    const loginPartial = Boolean(pickup.address || drop.address);
    const logoutPartial = Boolean(home.address);

    if (loginPartial && !(hasCoords(pickup) && hasCoords(drop))) {
      Alert.alert("Going to office incomplete", "Pick a pickup point (exact or nodal) and a company nodal point as your drop.");
      return;
    }
    if (logoutPartial && !hasCoords(home)) {
      Alert.alert("Going home incomplete", "Set your home address so the evening cab can drop you there.");
      return;
    }
    if (!loginPartial && !logoutPartial) return;

    const payload = {};
    if (loginPartial) {
      payload.pickupLocation = {
        address: pickup.address,
        lat: pickup.lat,
        lng: pickup.lng,
        source: pickupMode,
        ...(pickup.nodalPointId ? { nodalPointId: pickup.nodalPointId } : {})
      };
      payload.dropLocation = {
        address: drop.address,
        lat: drop.lat,
        lng: drop.lng,
        source: "nodal",
        nodalPointId: drop.nodalPointId
      };
    }
    if (logoutPartial) {
      payload.homeLocation = { address: home.address, lat: home.lat, lng: home.lng, source: "exact" };
    }

    setSubmitting(true);
    updateLocationProfile(payload)
      .then((updated) => {
        setProfile(updated);
        Alert.alert("Submitted for approval", "Your transport admin will review your pickup/drop and home address.");
      })
      .catch((err) => Alert.alert("Couldn't submit", err.response?.data?.message || err.message))
      .finally(() => setSubmitting(false));
  }

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator color={colors.teal} size="large" /></View>
    );
  }

  const status = profile?.locationStatus || "none";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
      <Text style={styles.brand}>My pickup &amp; drop</Text>
      <Text style={styles.tagline}>
        {company?.name
          ? `Tell ${company.name}'s drivers where to pick you up, where the office drop is, and where you live.`
          : "Tell your company's drivers where to pick you up, the office drop, and your home."}
      </Text>

      {status !== "none" && (
        <View style={[styles.statusCard, statusBannerStyle(status)]}>
          <Text style={styles.statusTitle}>
            {status === "approved" ? "Approved" : status === "pending" ? "Awaiting approval" : "Update rejected"}
          </Text>
          <Text style={styles.statusBody}>
            {status === "approved"
              ? "Your points are approved. Drivers will navigate to these."
              : status === "pending"
                ? "Your transport admin is reviewing your points. You'll get a notification when decided."
                : (profile?.locationNote || "Please correct the highlighted details and resubmit.")}
          </Text>
        </View>
      )}

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "login" && styles.tabActive]}
          onPress={() => setTab("login")}
        >
          <Text style={[styles.tabText, tab === "login" && styles.tabTextActive]}>Going to office</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "logout" && styles.tabActive]}
          onPress={() => setTab("logout")}
        >
          <Text style={[styles.tabText, tab === "logout" && styles.tabTextActive]}>Going home</Text>
        </TouchableOpacity>
      </View>

      {tab === "login" ? (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Pickup point</Text>
                <Text style={styles.sectionHint}>Where the cab picks you up in the morning</Text>
              </View>
            </View>
            <View style={styles.modeRow}>
              {[["exact", "Exact location"], ["nodal", "Nodal point"]].map(([m, label]) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeChip, pickupMode === m && styles.modeChipActive]}
                  onPress={() => setPickupMode(m)}
                >
                  <Text style={[styles.modeChipText, pickupMode === m && styles.modeChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {pickupMode === "exact" ? (
              <>
                <TouchableOpacity style={styles.locateButton} onPress={useCurrentLocationForPickup} disabled={pickup.picking}>
                  <Text style={styles.locateText}>{pickup.picking ? "Locating…" : "Set to my location"}</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, { marginTop: spacing.sm }]}
                  value={pickup.address}
                  onChangeText={(address) => setPickup((p) => ({ ...p, address }))}
                  placeholder="Street, landmark, area…"
                  placeholderTextColor={colors.textDim}
                  multiline
                />
                {pickup.lat != null && (
                  <Text style={styles.coordText}>{pickup.lat.toFixed(5)}, {pickup.lng.toFixed(5)}</Text>
                )}
              </>
            ) : (
              <NodalList
                points={nodalPoints}
                selectedId={pickup.nodalPointId}
                emptyText="Your admin hasn't added any nodal points yet — use “Exact location” instead."
                onSelect={(point) => pickNodalPoint("pickup", point)}
              />
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Drop at office</Text>
                <Text style={styles.sectionHint}>Choose the company nodal point where the cab drops you</Text>
              </View>
            </View>
            {nodalPoints.length ? (
              <NodalList
                points={nodalPoints}
                selectedId={drop.nodalPointId}
                onSelect={(point) => pickNodalPoint("drop", point)}
              />
            ) : (
              <Text style={styles.sectionHint}>
                No company nodal points yet — ask your admin to add them under “Nodal pickup/drop points”.
              </Text>
            )}
          </View>
        </>
      ) : (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Home address</Text>
              <Text style={styles.sectionHint}>Where the evening cab drops you when you leave</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.locateButton} onPress={useCurrentLocationForHome} disabled={home.picking}>
            <Text style={styles.locateText}>{home.picking ? "Locating…" : "Set my home location"}</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { marginTop: spacing.sm }]}
            value={home.address}
            onChangeText={(address) => setHome((h) => ({ ...h, address }))}
            placeholder="Home address"
            placeholderTextColor={colors.textDim}
            multiline
          />
          {home.lat != null && (
            <Text style={styles.coordText}>{home.lat.toFixed(5)}, {home.lng.toFixed(5)}</Text>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.primaryButtonText}>
          {submitting ? "Submitting…" : status === "approved" ? "Update my locations" : "Submit for approval"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function NodalList({ points, selectedId, onSelect, emptyText }) {
  if (!points.length) {
    return <Text style={styles.sectionHint}>{emptyText || "No nodal points available."}</Text>;
  }
  return (
    <View style={{ marginTop: spacing.xs }}>
      {points.map((p) => {
        const selected = p._id && selectedId && String(p._id) === String(selectedId);
        return (
          <TouchableOpacity
            key={String(p._id)}
            style={[styles.nodalOption, selected && styles.nodalOptionSelected]}
            onPress={() => onSelect(p)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.nodalTitle, selected && styles.nodalTitleSelected]}>{p.label}</Text>
              {p.address ? <Text style={styles.nodalAddress}>{p.address}</Text> : null}
            </View>
            <View style={[styles.radio, selected && styles.radioSelected]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function statusBannerStyle(status) {
  if (status === "approved") return { borderColor: colors.teal, backgroundColor: "rgba(0,217,192,0.08)" };
  if (status === "pending") return { borderColor: colors.amber, backgroundColor: "rgba(255,176,32,0.08)" };
  return { borderColor: colors.coral, backgroundColor: "rgba(255,90,90,0.08)" };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  brand: { color: colors.text, fontSize: 22, fontWeight: "700" },
  tagline: { color: colors.textDim, fontSize: 13, marginTop: 6, marginBottom: spacing.lg, lineHeight: 19 },
  statusCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  statusTitle: { color: colors.text, fontSize: 14, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  statusBody: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  tabs: { flexDirection: "row", backgroundColor: colors.panel2, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center" },
  tabActive: { backgroundColor: colors.teal },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#02201C" },
  section: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sectionHint: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 18 },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  modeChip: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.panel2
  },
  modeChipActive: { borderColor: colors.violet, backgroundColor: "rgba(139,124,246,0.12)" },
  modeChipText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  modeChipTextActive: { color: colors.violet, fontWeight: "700" },
  locateButton: {
    borderWidth: 1, borderColor: colors.teal, borderRadius: radius.sm,
    paddingVertical: 10, paddingHorizontal: 12, alignItems: "center", alignSelf: "flex-start"
  },
  locateText: { color: colors.teal, fontSize: 13, fontWeight: "700" },
  input: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, color: colors.text, fontSize: 15
  },
  coordText: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  nodalOption: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm
  },
  nodalOptionSelected: { borderColor: colors.teal },
  nodalTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  nodalTitleSelected: { color: colors.teal },
  nodalAddress: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line, marginLeft: spacing.md },
  radioSelected: { borderColor: colors.teal, backgroundColor: colors.teal },
  primaryButton: {
    backgroundColor: colors.amber, borderRadius: radius.md, padding: 16,
    alignItems: "center", marginTop: spacing.sm
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#1A1400", fontWeight: "700", fontSize: 15 }
});
