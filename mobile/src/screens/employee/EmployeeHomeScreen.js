import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert, Linking, Modal, ActivityIndicator } from "react-native";
import { getMyTrips } from "../../api/trips";
import {
  getMyLiveAllotment,
  getMySchedules,
  cancelSchedule,
  allotmentCheckIn,
  allotmentCheckOut,
  confirmReachedHome,
  reportNotReachedHome
} from "../../api/schedules";
import { getLocationProfile } from "../../api/locations";
import { getSupportConfig } from "../../api/support";
import { getNotifications } from "../../api/notifications";
import { getFreshPosition } from "../../services/location";
import { useActiveScreenAwake } from "../../services/screenAwake";
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

// Expected arrival clock time from an ETA in minutes.
function etaArrival(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const t = new Date(Date.now() + Number(minutes) * 60000);
  const ampm = t.getHours() >= 12 ? "PM" : "AM";
  const hh = t.getHours() % 12 === 0 ? 12 : t.getHours() % 12;
  return `${String(hh).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} ${ampm}`;
}

// Confirmed-state banner: only claim "confirmed" once a vehicle AND driver are
// actually assigned. Never show "driver assigned soon" once assigned.
function confirmedBanner(allotment) {
  const v = allotment?.vehicle || {};
  const d = allotment?.driver || {};
  const hasVehicle = !!(v.vehicleNumber && v.vehicleNumber !== "Vehicle TBD");
  const hasDriver = !!(d.name);
  if (hasVehicle && hasDriver) return { label: "BOOKING CONFIRMED · DRIVER ASSIGNED", tone: "ok" };
  if (hasVehicle) return { label: "VEHICLE ASSIGNED · AWAITING DRIVER", tone: "ok" };
  return { label: "BOOKING RECEIVED · AWAITING VEHICLE", tone: "warn" };
}

// Open a live position in the device's Google Maps app (geo:), falling back to
// the Google Maps web page in a browser. Never opens a blank embedded map.
function openInGoogleMaps(lat, lng, label) {
  const q = `${Number(lat)},${Number(lng)}`;
  const nativeUrl = `geo:${q}?q=${q}${label ? `(${encodeURIComponent(label)})` : ""}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
  return Linking.openURL(nativeUrl).catch(() => Linking.openURL(webUrl));
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
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [boardingOtp, setBoardingOtp] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isFirstLoadRef = useRef(true);

  // Keep the screen awake whenever the employee has an active trip, and release
  // it the moment the trip finishes.
  useActiveScreenAwake(!!allotment);

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

  useEffect(() => {
    const fetchUnread = () => getNotifications().then((r) => setUnread(Number(r?.unread) || 0)).catch(() => {});
    fetchUnread();
    let sock;
    (async () => { sock = await connectSocket(); sock.on("notification", () => setUnread((u) => u + 1)); })();
    return () => { sock?.off("notification"); };
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

  // Track Driver: open the REAL driver/vehicle live position in Google Maps.
  // Uses the live socket position, falling back to the latest API position.
  function trackDriver() {
    const lat = driverLocation?.lat ?? allotment?.driverLocation?.lat;
    const lng = driverLocation?.lng ?? allotment?.driverLocation?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Driver location unavailable", "Driver location is currently unavailable. Please try again.");
      return;
    }
    openInGoogleMaps(lat, lng, "Your driver").catch(() =>
      Alert.alert("Can't open maps", "No maps app or browser is available.")
    );
  }

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
  const conf = hasLiveTrip ? confirmedBanner(allotment) : null;
  const etaMins = Number(allotment?.etaMinutes);
  const eta = hasLiveTrip && allotment?.sharingLive && Number.isFinite(etaMins)
    ? {
        headline: etaMins <= 1 ? "Driver is arriving now" : `Driver is ${etaMins} min away`,
        detail: `ETA: ${etaMins} min${allotment?.etaAt || etaArrival(etaMins) ? ` · Expected arrival: ${allotment?.etaAt || etaArrival(etaMins)}` : ""}`
      }
    : null;
  const scheduledTime = fmtTime(
    allotment?.slotLabel && String(allotment.slotLabel).includes(":")
      ? allotment.slotLabel
      : allotment?.pickupTime || allotment?.startTime
  );

  // Check-in: capture a fresh device GPS fix at the exact moment of the action
  // (stored against the trip for audit), then show the boarding OTP the driver
  // must enter to complete the boarding gate.
  async function doCheckIn() {
    if (!allotment || actionBusy) return;
    setActionBusy(true);
    try {
      const pos = await getFreshPosition();
      const res = await allotmentCheckIn(allotment._id, { lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      if (res?.otp) setBoardingOtp(res.otp);
      if (!pos) {
        Alert.alert("Unable to get your location", "Unable to get your current location. Please enable location and try again.");
      }
      load();
    } catch (e) {
      Alert.alert("Check-in not allowed", e.response?.data?.error || e.response?.data?.message || e.message);
      load();
    } finally { setActionBusy(false); }
  }
  // Check-out: capture a fresh GPS fix at the drop moment and record it.
  async function doCheckOut() {
    if (!allotment || actionBusy) return;
    setActionBusy(true);
    try {
      const pos = await getFreshPosition();
      const res = await allotmentCheckOut(allotment._id, { lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      if (!pos) {
        Alert.alert("Unable to get your location", "Unable to get your current location. Please enable location and try again.");
      } else if (res?.safety?.required) {
        Alert.alert("Check-out recorded", res.safety.message || "Please confirm you reached home safely.");
      }
      load();
    } catch (e) {
      Alert.alert("Check-out not allowed", e.response?.data?.error || e.response?.data?.message || e.message);
      load();
    } finally { setActionBusy(false); }
  }
  function doCancelSchedule(s) {
    Alert.alert("Cancel this schedule?", "This schedule will no longer be active.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel Schedule",
        style: "destructive",
        onPress: async () => {
          try { await cancelSchedule(s.id || s._id); await load(); Alert.alert("Schedule cancelled successfully."); }
          catch (e) { Alert.alert("Couldn't cancel", e.response?.data?.message || e.message); }
        }
      }
    ]);
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
          <TouchableOpacity style={styles.bell} onPress={() => navigation.navigate("Notifications")}>
            <Text style={styles.bellIcon}>🔔</Text>
            {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
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
              <Text style={styles.tripTime}>{scheduledTime}</Text>
            </View>

            <View style={[styles.confirmBanner, { backgroundColor: conf.tone === "ok" ? colors.primarySoft : "#FFF6E5" }]}>
              <Text style={[styles.confirmBannerText, { color: conf.tone === "ok" ? colors.primary : colors.amber }]}>{conf.label}</Text>
            </View>

            {eta ? (
              <View style={styles.etaRow}>
                <Text style={styles.etaHeadline}>🚕 {eta.headline}</Text>
                <Text style={styles.etaDetail}>{eta.detail}</Text>
              </View>
            ) : (
              <View style={styles.etaRow}>
                <Text style={styles.etaUpdating}>
                  {allotment.sharingLive ? "Updating location…" : "Live tracking starts when your driver sets off."}
                </Text>
              </View>
            )}

            <View style={styles.infoGrid}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>VEHICLE</Text>
                <Text style={styles.infoValue}>{v.vehicleNumber || "Not assigned"}</Text>
                {v.vehicleType ? <Text style={styles.infoSub}>{v.vehicleType}{v.line ? ` · Line ${v.line}` : ""}</Text> : null}
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>DRIVER</Text>
                <Text style={styles.infoValue}>{d.name || "Not assigned"}</Text>
                {d.phone ? <Text style={styles.infoSub}>{d.phone}</Text> : null}
              </View>
            </View>

            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.routeText}>{ms.pickup?.address || locationProfile?.pickupLocation?.address || "Pickup point"}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.violet }]} />
              <Text style={styles.routeText}>{ms.drop?.address || (allotment.direction === "toHome" ? "Home" : "Office")}</Text>
            </View>

            <Text style={styles.schedLine}>Scheduled pickup · {fmtDate(allotment.date)} · {scheduledTime}</Text>

            <View style={styles.tripActions}>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={trackDriver}>
                <Text style={styles.smallBtnPrimaryText}>Track driver</Text>
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
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={() => navigation.navigate("EmployeeSchedule", { editSchedule: nextSchedule })}>
                <Text style={styles.smallBtnPrimaryText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => doCancelSchedule(nextSchedule)}>
                <Text style={[styles.smallBtnText, { color: colors.coral }]}>Cancel</Text>
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

        {/* Boarding — shown while there is an eligible action or a just-completed state */}
        {hasLiveTrip && (canCheckIn || canCheckOut || ms?.safeDropEnabled || ms?.status === "picked_up" || ms?.status === "completed") && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Boarding</Text>
            {canCheckIn && (
              <>
                <Text style={styles.boardHint}>Swipe to check in at your pickup point. Your GPS location is recorded for the trip record.</Text>
                <SwipeButton label={actionBusy ? "Checking in…" : "Swipe right to check in"} direction="right" color={colors.primary} onConfirm={doCheckIn} />
              </>
            )}
            {boardingOtp ? (
              <View style={styles.otpPanel}>
                <Text style={styles.otpPanelTitle}>CHECK-IN SUCCESSFUL</Text>
                <Text style={styles.otpPanelCode}>{boardingOtp}</Text>
                <Text style={styles.otpPanelHint}>Tell this OTP to your driver to confirm boarding.</Text>
                <TouchableOpacity style={styles.otpDismiss} onPress={() => setBoardingOtp(null)}>
                  <Text style={styles.otpDismissText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {ms?.status === "picked_up" && (
              <View style={styles.verifiedRow}>
                <Text style={styles.verifiedTick}>✓</Text>
                <Text style={styles.verifiedText}>CHECK-IN VERIFIED — you are on board</Text>
              </View>
            )}
            {!canCheckIn && canCheckOut && (
              <>
                <Text style={styles.boardHint}>Swipe to check out when you leave the cab. Your drop location is recorded.</Text>
                <SwipeButton label={actionBusy ? "Checking out…" : "Swipe out to check out"} direction="left" color={colors.amber} onConfirm={doCheckOut} />
              </>
            )}
            {ms?.status === "completed" && (
              <View style={styles.verifiedRow}>
                <Text style={[styles.verifiedTick, { color: colors.green }]}>✓</Text>
                <Text style={styles.verifiedText}>CHECK-OUT COMPLETED — thank you for riding</Text>
              </View>
            )}
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
  badge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
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
  confirmBanner: { borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12 },
  confirmBannerText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  etaRow: { marginTop: 12 },
  etaHeadline: { color: colors.text, fontSize: 17, fontWeight: "800" },
  etaDetail: { color: colors.textDim, fontSize: 13, marginTop: 3, fontWeight: "600" },
  etaUpdating: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  infoGrid: { flexDirection: "row", marginTop: 14, gap: 12 },
  infoItem: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line },
  infoLabel: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 4 },
  infoSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  schedLine: { color: colors.textDim, fontSize: 12.5, marginTop: 12, fontWeight: "600" },
  boardHint: { color: colors.textDim, fontSize: 12.5, marginBottom: 10, lineHeight: 18 },
  otpPanel: { marginTop: 14, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 16, alignItems: "center", borderWidth: 1, borderColor: colors.primary },
  otpPanelTitle: { color: colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  otpPanelCode: { color: colors.navy, fontSize: 40, fontWeight: "900", letterSpacing: 8, marginTop: 8 },
  otpPanelHint: { color: colors.textDim, fontSize: 12.5, marginTop: 8, textAlign: "center" },
  otpDismiss: { marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 28 },
  otpDismissText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  verifiedTick: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  verifiedText: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
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
