import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert, Linking, Modal, ActivityIndicator } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getMyTrips, checkIn, checkOut } from "../../api/trips";
import {
  getMyLiveAllotment,
  getMySchedules,
  allotmentCheckIn,
  allotmentCheckOut,
  confirmReachedHome,
  reportNotReachedHome
} from "../../api/schedules";
import { getLocationProfile } from "../../api/locations";
import { getSupportConfig } from "../../api/support";
import { connectSocket, joinTrip, leaveTrip, getSocket } from "../../services/socket";
import { useAuth } from "../../context/AuthContext";
import SwipeButton from "../../components/SwipeButton";
import OfflineBanner from "../../components/OfflineBanner";
import EmployeeBottomNav from "../../components/EmployeeBottomNav";
import { colors, spacing, radius, shadow } from "../../theme";

const DIR_LABEL = { toOffice: "Login", toHome: "Logout" };
const dirLabel = (d) => DIR_LABEL[d] || "Login";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusMeta(status) {
  switch (status) {
    case "assigned": return { label: "Vehicle allocated", tone: "ok" };
    case "started": return { label: "Driver started", tone: "ok" };
    case "in_progress": return { label: "On the way", tone: "ok" };
    case "completed": return { label: "Completed", tone: "muted" };
    case "confirmed": return { label: "Scheduled", tone: "ok" };
    case "requested": return { label: "Awaiting approval", tone: "warn" };
    case "cancelled": return { label: "Cancelled", tone: "muted" };
    default: return { label: "Vehicle pending", tone: "warn" };
  }
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const today = localToday();
  if (dateStr === today) return "Today";
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(); t.setDate(t.getDate() + 1);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  if (dateStr === tomorrow) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function fmtTime(t) {
  if (!t) return "—";
  const [h, m] = String(t).split(":").map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, "0")}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

export default function EmployeeHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [allotment, setAllotment] = useState(null);
  const [trip, setTrip] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [driverLocation, setDriverLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("none");
  const [locationProfile, setLocationProfile] = useState(null);
  const [helpline, setHelpline] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);
  const isFirstLoadRef = useRef(true);

  const callHelpline = () => {
    if (helpline) Linking.openURL(`tel:${helpline.replace(/[^+\d]/g, "")}`).catch(() => {});
  };
  const callNumber = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${String(phone).replace(/[^+\d]/g, "")}`).catch(() =>
      Alert.alert("Can't call", "No phone app is available.")
    );
  };

  const load = useCallback(async () => {
    const [requests, live, loc, sched] = await Promise.all([
      getMyTrips().catch(() => []),
      getMyLiveAllotment().catch(() => []),
      getLocationProfile().catch(() => ({ locationStatus: "none" })),
      getMySchedules().catch(() => [])
    ]);
    setLocationStatus(loc?.locationStatus || "none");
    setLocationProfile(loc || null);

    const activeRequest = (Array.isArray(requests) ? requests : []).find(
      (r) => r.trip && r.trip.status !== "completed" && r.trip.status !== "cancelled"
    );
    setTrip(activeRequest?.trip || null);

    const activeAllotment =
      (Array.isArray(live) ? live : []).find((a) => a.status === "assigned" || a.status === "started") || null;
    setAllotment(activeAllotment);
    setDriverLocation(activeAllotment?.driverLocation || null);

    setSchedules(Array.isArray(sched) ? sched : []);
    isFirstLoadRef.current = false;
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = navigation.addListener("focus", () => load());
    return sub;
  }, [navigation, load]);

  useEffect(() => {
    getSupportConfig().then((c) => setHelpline(c?.helplinePhone || "")).catch(() => {});
  }, []);

  const activeRoom = allotment ? allotment._id : trip ? trip._id : null;
  useEffect(() => {
    if (!activeRoom) return;
    let cancelled = false;
    (async () => {
      const sock = await connectSocket();
      if (cancelled) return;
      sock.on("location:broadcast", (data) => { setDriverLocation(data); });
      sock.on("trip:statusBroadcast", () => load());
      sock.on("allotment:statusBroadcast", () => load());
      joinTrip(activeRoom);
    })();
    return () => {
      cancelled = true;
      leaveTrip(activeRoom);
      const sock = getSocket();
      sock?.off("location:broadcast");
      sock?.off("trip:statusBroadcast");
      sock?.off("allotment:statusBroadcast");
    };
  }, [activeRoom, load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const driverLoc =
    driverLocation && Number.isFinite(driverLocation.lat) && Number.isFinite(driverLocation.lng)
      ? { latitude: driverLocation.lat, longitude: driverLocation.lng }
      : null;

  const firstName = (user?.name || "there").split(" ")[0];
  const empId = user?.emp_id || user?.id || "—";

  // Next trip = live allotment, else the soonest upcoming schedule, else legacy trip.
  const today = localToday();
  const upcoming = (schedules || [])
    .filter((s) => s.date >= today && ["confirmed", "requested", "in_progress"].includes(s.status))
    .sort((a, b) => (a.date + (a.pickup_time || a.login_time || "")).localeCompare(b.date + (b.pickup_time || b.login_time || "")));

  const v = allotment?.vehicle || {};
  const d = allotment?.driver || {};
  const ms = allotment?.myStop || {};
  const canCheckIn = ms?.status === "pending" && allotment?.status !== "completed";
  const canCheckOut = ms?.status === "picked_up" && allotment?.status !== "completed";

  const nextSchedule = upcoming[0] || null;
  const hasLiveTrip = !!allotment;

  async function doCheckIn() {
    if (!allotment) return;
    try { await allotmentCheckIn(allotment._id); load(); }
    catch (e) { Alert.alert("Check-in not allowed", e.response?.data?.message || e.message); load(); }
  }
  async function doCheckOut() {
    if (!allotment) return;
    try { await allotmentCheckOut(allotment._id); load(); }
    catch (e) { Alert.alert("Check-out not allowed", e.response?.data?.message || e.message); load(); }
  }
  async function doSafeDrop() {
    if (!allotment) return;
    try { await confirmReachedHome(allotment.scheduleId); load(); }
    catch (e) { Alert.alert("Couldn't confirm", e.response?.data?.message || e.message); }
  }
  async function doNotReached() {
    if (!allotment) return;
    Alert.alert("Send help request?", "This alerts your transport team that you have NOT reached home safely.", [
      { text: "Cancel", style: "cancel" },
      { text: "Send", style: "destructive", onPress: async () => {
        try { await reportNotReachedHome(allotment.scheduleId); load(); }
        catch (e) { Alert.alert("Couldn't send", e.response?.data?.message || e.message); }
      } }
    ]);
  }

  function openMapsToStop() {
    const addr = ms?.pickup?.address || locationProfile?.pickupLocation?.address;
    if (!addr) { Alert.alert("No pickup point", "Set your pickup address first."); return; }
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`).catch(() => {});
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Greeting header */}
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroGreet}>{greeting()}, {firstName} 👋</Text>
            <Text style={styles.heroId}>Employee ID {empId}</Text>
          </View>
          <TouchableOpacity style={styles.bell} onPress={() => navigation.navigate("EmployeeHistory")}>
            <Text style={styles.bellIcon}>🔔</Text>
          </TouchableOpacity>
        </View>

        <OfflineBanner onOpenSync={() => navigation.navigate("PendingSync")} />

        {/* Next trip */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Your next trip</Text>
        </View>

        {loading ? (
          <View style={styles.card}><ActivityIndicator color={colors.primary} /></View>
        ) : hasLiveTrip ? (
          <View style={[styles.card, styles.tripCard]}>
            <View style={styles.tripTopRow}>
              <View style={styles.typePill}><Text style={styles.typePillText}>{dirLabel(allotment.direction)}</Text></View>
              <Text style={styles.tripTime}>{fmtTime(allotment.slotLabel && allotment.slotLabel.includes(":") ? allotment.slotLabel : (allotment.pickupTime || allotment.startTime))}</Text>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusMeta(allotment.status).tone === "ok" ? colors.green : colors.amber }]} />
              <Text style={styles.statusText}>{statusMeta(allotment.status).label}</Text>
            </View>
            <Text style={styles.tripVehicle}>🚗 {v.vehicleNumber || "Vehicle TBD"} {v.vehicleType ? `· ${v.vehicleType}` : ""}</Text>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.routeText}>{ms.pickup?.address || locationProfile?.pickupLocation?.address || "Pickup point"}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.violet }]} />
              <Text style={styles.routeText}>{ms.drop?.address || "Destination"}</Text>
            </View>
            <Text style={styles.driverText}>{d.name ? `Driver: ${d.name}${d.phone ? ` · ${d.phone}` : ""}` : "Driver assigned soon"}</Text>
            <View style={styles.tripActions}>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={() => setMapOpen(true)}>
                <Text style={styles.smallBtnPrimaryText}>Track vehicle</Text>
              </TouchableOpacity>
              {d.phone ? (
                <TouchableOpacity style={styles.smallBtn} onPress={() => callNumber(d.phone)}>
                  <Text style={styles.smallBtnText}>Call driver</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate("Chat", { tripId: allotment._id, phone: d.phone })}>
                <Text style={styles.smallBtnText}>Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : nextSchedule ? (
          <View style={[styles.card, styles.tripCard]}>
            <View style={styles.tripTopRow}>
              <View style={styles.typePill}><Text style={styles.typePillText}>{dirLabel(nextSchedule.direction)}</Text></View>
              <Text style={styles.tripTime}>{fmtTime(nextSchedule.pickup_time || nextSchedule.login_time || nextSchedule.drop_time || nextSchedule.logout_time)}</Text>
            </View>
            <Text style={styles.tripDate}>{fmtDate(nextSchedule.date)}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusMeta(nextSchedule.status).tone === "ok" ? colors.green : colors.amber }]} />
              <Text style={styles.statusText}>{statusMeta(nextSchedule.status).label}</Text>
            </View>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.routeText}>{nextSchedule.pickup_point || locationProfile?.pickupLocation?.address || "Pickup point"}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.violet }]} />
              <Text style={styles.routeText}>{nextSchedule.direction === "toHome" ? "Home" : "Office"}</Text>
            </View>
            <View style={styles.tripActions}>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={() => navigation.navigate("EmployeeSchedule")}>
                <Text style={styles.smallBtnPrimaryText}>View details</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate("EmployeeSchedule")}>
                <Text style={styles.smallBtnText}>Edit / Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard]}>
            <Text style={styles.emptyEmoji}>🚐</Text>
            <Text style={styles.emptyTitle}>No active ride right now</Text>
            <Text style={styles.emptyBody}>
              You don't have an upcoming trip. Book one and it will appear here.
            </Text>
            {locationStatus !== "approved" ? (
              <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate("EmployeeLocations")}>
                <Text style={styles.ctaText}>{locationStatus === "none" ? "Set your pickup address" : "Open My Address"}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate("EmployeeSchedule")}>
                <Text style={styles.ctaText}>+ Book a Ride</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Booking CTA */}
        <TouchableOpacity style={styles.bookCta} activeOpacity={0.9} onPress={() => navigation.navigate("EmployeeSchedule")}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bookCtaTitle}>Need a ride?</Text>
            <Text style={styles.bookCtaSub}>Plan your next office trip in seconds.</Text>
          </View>
          <View style={styles.bookCtaBtn}><Text style={styles.bookCtaBtnText}>+ BOOK A RIDE</Text></View>
        </TouchableOpacity>

        {/* Quick actions */}
        <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Quick actions</Text></View>
        <View style={styles.actionsGrid}>
          <Action icon="🚗" label="Book Ride" onPress={() => navigation.navigate("EmployeeSchedule")} />
          <Action icon="📍" label="My Address" onPress={() => navigation.navigate("EmployeeLocations")} />
          <Action icon="📅" label="Schedule" onPress={() => navigation.navigate("EmployeeSchedule")} />
          <Action icon="📜" label="History" onPress={() => navigation.navigate("EmployeeHistory")} />
        </View>

        {/* Live trip actions */}
        {hasLiveTrip && (canCheckIn || canCheckOut || ms?.safeDropEnabled) && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Boarding</Text>
            {canCheckIn && <SwipeButton label="Swipe right to check in" direction="right" color={colors.primary} onConfirm={doCheckIn} />}
            {!canCheckIn && canCheckOut && <SwipeButton label="Swipe out to check out" direction="left" color={colors.amber} onConfirm={doCheckOut} />}
            {ms?.safeDropEnabled && !ms?.safeDropConfirmedAt && (
              <View style={{ marginTop: 12 }}>
                <SwipeButton label="Swipe to confirm safe arrival" direction="right" color={colors.violet} onConfirm={doSafeDrop} />
                <TouchableOpacity style={styles.helpBtn} onPress={doNotReached}>
                  <Text style={styles.helpBtnText}>I have NOT reached home — send help</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Upcoming trips */}
        {upcoming.length > 0 && (
          <>
            <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Upcoming trips</Text></View>
            {upcoming.slice(0, 4).map((s) => (
              <View key={String(s.id)} style={[styles.card, styles.upcomingCard]}>
                <View style={styles.typePill}><Text style={styles.typePillText}>{dirLabel(s.direction)}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.upcomingTime}>{fmtDate(s.date)} · {fmtTime(s.pickup_time || s.login_time || s.drop_time || s.logout_time)}</Text>
                  <Text style={styles.upcomingSub}>{s.direction === "toHome" ? "Office → Home" : "Home → Office"} · {statusMeta(s.status).label}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Profile footer */}
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.footerLink} onPress={() => navigation.navigate("Settings")}>
            <Text style={styles.footerLinkText}>Profile & Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerLink} onPress={() => navigation.navigate("Help")}>
            <Text style={styles.footerLinkText}>Help & Support</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerLink} onPress={logout}>
            <Text style={[styles.footerLinkText, { color: colors.coral }]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <EmployeeBottomNav navigation={navigation} active="home" />

      <Modal visible={mapOpen} animationType="slide" onRequestClose={() => setMapOpen(false)}>
        <View style={styles.mapModal}>
          <View style={styles.mapHead}>
            <Text style={styles.mapTitle}>Live cab location</Text>
            <TouchableOpacity onPress={() => setMapOpen(false)}><Text style={styles.mapClose}>Close</Text></TouchableOpacity>
          </View>
          {driverLoc || ms?.pickup ? (
            <MapView
              ref={mapRef}
              style={styles.mapFill}
              initialRegion={{
                ...(driverLoc || { latitude: ms?.pickup?.lat || 12.97, longitude: ms?.pickup?.lng || 77.59 }),
                latitudeDelta: 0.05,
                longitudeDelta: 0.05
              }}
            >
              {driverLoc && <Marker coordinate={driverLoc} title="Your cab" />}
              {ms?.pickup?.lat ? <Marker coordinate={{ latitude: ms.pickup.lat, longitude: ms.pickup.lng }} title="Pickup" pinColor={colors.primary} /> : null}
            </MapView>
          ) : (
            <View style={styles.mapEmpty}>
              <Text style={styles.mapEmptyTitle}>Live location unavailable</Text>
              <Text style={styles.mapEmptyBody}>Your driver hasn't started sharing their location yet.</Text>
            </View>
          )}
          <View style={styles.mapBar}>
            <Text style={styles.mapBarText}>{allotment?.sharingLive ? "Cab is moving — live location" : "Waiting for the driver to share live location"}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Action({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.actionIcon}><Text style={{ fontSize: 22 }}>{icon}</Text></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  hero: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  heroGreet: { color: colors.text, fontSize: 22, fontWeight: "800" },
  heroId: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  bellIcon: { fontSize: 20 },
  sectionHead: { paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  tripCard: { padding: spacing.lg },
  tripTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  typePill: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, alignSelf: "flex-start" },
  typePillText: { color: colors.primary, fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  tripTime: { color: colors.text, fontSize: 22, fontWeight: "800" },
  tripDate: { color: colors.textDim, fontSize: 13, marginTop: 6, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tripVehicle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 12 },
  routeRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { color: colors.text, fontSize: 14, flex: 1 },
  routeLine: { width: 2, height: 14, backgroundColor: colors.line, marginLeft: 4, marginTop: 2 },
  driverText: { color: colors.textDim, fontSize: 13, marginTop: 12 },
  tripActions: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  smallBtn: { borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  smallBtnText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  smallBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  smallBtnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  cardLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, fontWeight: "700" },
  emptyCard: { alignItems: "center", paddingVertical: spacing.xl },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 10 },
  emptyBody: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 19, paddingHorizontal: 10 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16 },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  bookCta: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.lg, ...shadow.card },
  bookCtaTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  bookCtaSub: { color: "#B9C6E6", fontSize: 13, marginTop: 4 },
  bookCtaBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16, marginLeft: 12 },
  bookCtaBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg - 6 },
  action: { width: "25%", alignItems: "center", paddingHorizontal: 6, marginBottom: 14 },
  actionIcon: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, ...shadow.card },
  actionLabel: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 8, textAlign: "center" },
  upcomingCard: { flexDirection: "row", alignItems: "center" },
  upcomingTime: { color: colors.text, fontSize: 14, fontWeight: "700" },
  upcomingSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  helpBtn: { marginTop: 10, alignItems: "center", paddingVertical: 10 },
  helpBtnText: { color: colors.coral, fontSize: 13, fontWeight: "700" },
  footerRow: { flexDirection: "row", justifyContent: "space-around", marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  footerLink: { padding: 8 },
  footerLinkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  mapModal: { flex: 1, backgroundColor: colors.bg },
  mapHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  mapTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  mapClose: { color: colors.coral, fontSize: 14, fontWeight: "700" },
  mapFill: { flex: 1 },
  mapEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  mapEmptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  mapEmptyBody: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  mapBar: { backgroundColor: colors.panel, paddingVertical: 14, paddingHorizontal: spacing.lg },
  mapBarText: { color: colors.text, fontSize: 13, fontWeight: "700" }
});
