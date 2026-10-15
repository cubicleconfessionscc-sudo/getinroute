import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Linking, TextInput, Modal, AppState } from "react-native";
import { getAssignedTrips } from "../../api/trips";
import { getMyDriverAllotments, completeRun } from "../../api/schedules";
import { requestCancelRun } from "../../api/driver";
import { getStandingPoint, setStandingPoint } from "../../api/driver";
import { connectSocket, joinTrip, leaveTrip, updateStopStatus, updateAllotmentStop } from "../../services/socket";
import { startDriverTracking, stopDriverTracking, getFreshPosition } from "../../services/location";
import { useActiveScreenAwake } from "../../services/screenAwake";
import { getSupportConfig } from "../../api/support";
import { useAuth } from "../../context/AuthContext";
import SubscriptionStatusBar from "../../components/SubscriptionStatusBar";
import OfflineBanner from "../../components/OfflineBanner";
import { speakTripAssigned } from "../../services/voice";
import { notifyTripAssigned, notifyChatMessage } from "../../services/notifications";
import { scheduleAlarmBefore } from "../../services/alarms";
import { colors, spacing, radius } from "../../theme";
import client from "../../api/client";

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return String(dateStr).slice(0, 10);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const DIR_LABEL = { toOffice: "Login", toHome: "Logout" };
function dirLabel(dir) {
  return DIR_LABEL[dir] || DIR_LABEL.toHome;
}

function fmtTime12(t) {
  if (!t) return "—";
  const [hh, mm] = String(t).split(":").map((n) => parseInt(n, 10) || 0);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${pad(mm)} ${suffix}`;
}

function localPickupDate(dateValue, timeValue, nextDay) {
  const date = String(dateValue || "").slice(0, 10);
  const time = String(timeValue || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (nextDay) result.setDate(result.getDate() + 1);
  return Number.isNaN(result.getTime()) ? null : result;
}

function fmtKm(km) {
  if (km == null) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function fmtEta(minutes, km) {
  if (minutes == null && km == null) return null;
  const parts = [];
  if (minutes != null) parts.push(minutes > 0 ? `~${minutes} min` : "Arriving now");
  if (km != null) parts.push(fmtKm(km));
  return parts.join(" · ");
}

const CHECK_ITEMS = [
  "Fuel/charge level adequate",
  "Tires in good condition",
  "Mirrors and lights working",
  "First aid kit present",
];

export default function DriverHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [trip, setTrip] = useState(null);       // legacy carpool trip, if any
  const [run, setRun] = useState(null);         // the active allotment run, if any
  const [allotted, setAllotted] = useState([]);
  const [tracking, setTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [helpline, setHelpline] = useState("");
  const [otpInputs, setOtpInputs] = useState({});
  const [sosModal, setSosModal] = useState(false);
  const [sosNote, setSosNote] = useState("");
  const [checklistModal, setChecklistModal] = useState(false);
  const [checklistDone, setChecklistDone] = useState(false);
  const [checkedItems, setCheckedItems] = useState({});
  const [standingPoint, setStandingPointState] = useState(null);
  const [standingModal, setStandingModal] = useState(false);
  // Local-only "I've arrived at this pickup" markers for the driver (not persisted;
  // the persisted per-passenger state comes from the backend boarding status).
  const [arrived, setArrived] = useState({});
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const idleTimerRef = useRef(null);
  // Tracks which active run/trip ids we've already announced, so a (re)assigned
  // run only speaks once per session.
  const announcedRunIdsRef = useRef(new Set());
  // Skips announcing on the very first load so an already-existing run isn't
  // spoken the moment the app opens.
  const isFirstLoadRef = useRef(true);

  // Keep the screen awake during an active trip, live tracking and any
  // boarding/OTP/SOS/checklist modal; release it when the trip ends or the app
  // is backgrounded.
  useActiveScreenAwake(!!run || !!trip || sosModal || checklistModal || standingModal || cancelModal);

  useEffect(() => {
    getSupportConfig()
      .then((c) => setHelpline(c.helplinePhone || ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getStandingPoint()
      .then((r) => setStandingPointState(r.standingPoint || null))
      .catch(() => {});
  }, []);

  async function saveStandingPoint(spot) {
    try {
      await setStandingPoint(spot);
      setStandingPointState(spot);
      setStandingModal(false);
      Alert.alert("Standing point saved", `Your cab is parked at ${spot}.`);
    } catch (e) {
      Alert.alert("Could not save", e?.response?.data?.error || "Please try again.");
    }
  }

  function callHelpline() {
    if (!helpline) return;
    Linking.openURL(`tel:${helpline.replace(/[^+\d]/g, "")}`).catch(() => {});
  }

  const loadTrip = useCallback(async () => {
    const [trips, al] = await Promise.all([getAssignedTrips(), getMyDriverAllotments()]);
    const active = trips.find((t) => t.status !== "completed" && t.status !== "cancelled");
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const runnable = (a) => a.status === "assigned" || a.status === "started";
    // Prefer today's run so the driver operates the correct trip when several
    // days are allotted; fall back to the most recent runnable one.
    const activeRun =
      al.find((a) => runnable(a) && String(a.date || "").slice(0, 10) === todayStr) ||
      al.find(runnable);
    setTrip(active || null);
    setRun(activeRun || null);
    setAllotted(al);

    // Schedule one local alarm for the first still-pending pickup in an
    // assigned run. Alarm service deduplicates across foreground refreshes and
    // app restarts; native notification scheduling survives backgrounding.
    if (activeRun) {
      const nextStop = (Array.isArray(activeRun.sequence) ? activeRun.sequence : []).find(
        (stop) => !["picked_up", "reached", "completed", "no_show"].includes(stop.status)
      );
      const pickupAt = localPickupDate(activeRun.date, nextStop?.pickupTime, nextStop?.nextDay);
      if (pickupAt) {
        scheduleAlarmBefore(pickupAt, {
          title: "Driver trip alarm",
          body: `Your first pickup is at ${fmtTime12(nextStop.pickupTime)}.`,
          alarmKey: `driver:${activeRun._id}:${String(activeRun.date || "").slice(0, 10)}`,
        }).catch(() => {});
      }
    }

    // Voice announcement + local notification when a NEW run/trip is assigned.
    // The very first load (app open) only records existing ids (without
    // announcing) so we never speak a run that was already there before this
    // session. Any id that appears later and wasn't seen yet is announced
    // exactly once (guarded here and by voice.js's own dedup).
    const newId = activeRun ? activeRun._id : active ? active._id : null;
    if (newId && !announcedRunIdsRef.current.has(newId)) {
      announcedRunIdsRef.current.add(newId);
      if (!isFirstLoadRef.current) {
        speakTripAssigned(newId);
        notifyTripAssigned();
      }
    }
    isFirstLoadRef.current = false;
  }, []);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  // When the app returns to the foreground after being backgrounded/minimized,
  // re-check for a newly assigned run so the announcement (voice + local
  // notification) fires as soon as the assignment is seen. Dedup keeps it to a
  // single announcement per assignment.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") loadTrip();
    });
    return () => sub.remove();
  }, [loadTrip]);

  const activeId = run ? run._id : trip ? trip._id : null;

  useEffect(() => {
    if (!activeId) return;
    let socket;
    (async () => {
      socket = await connectSocket();
      joinTrip(activeId);
      socket.on("trip:statusBroadcast", () => loadTrip());
      socket.on("allotment:statusBroadcast", () => loadTrip());
    })();
    return () => {
      leaveTrip(activeId);
      socket?.off("trip:statusBroadcast");
      socket?.off("allotment:statusBroadcast");
    };
  }, [activeId, loadTrip]);

  // Chat push notifications (item 9): surface employee-originated messages with
  // a banner + sound even while the driver is on the home screen.
  useEffect(() => {
    let sock;
    (async () => {
      sock = await connectSocket();
      sock.on("chat:incoming", (evt) => {
        if (!evt) return;
        notifyChatMessage(evt.from || (evt.role === "employee" ? "Employee" : "Trip member"), evt.text);
      });
    })();
    return () => {
      sock?.off("chat:incoming");
    };
  }, []);

  async function startRun() {
    try {
      await startDriverTracking(activeId);
      setTracking(true);
      startIdleReminder();
    } catch (err) {
      Alert.alert("Location needed", err.message);
    }
  }

  async function toggleTracking() {
    if (!activeId) return;
    if (tracking) {
      try {
        await stopDriverTracking();
        setTracking(false);
        if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      } catch (err) {
        Alert.alert("Location needed", err.message);
      }
      return;
    }
    if (checklistDone) {
      await startRun();
    } else {
      setChecklistModal(true);
    }
  }

  function confirmChecklist() {
    if (CHECK_ITEMS.filter((i) => checkedItems[i]).length !== CHECK_ITEMS.length) {
      Alert.alert("Checklist incomplete", "Please verify every item before starting.");
      return;
    }
    setChecklistModal(false);
    setChecklistDone(true);
    startRun();
  }

  function startIdleReminder() {
    if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    idleTimerRef.current = setInterval(() => {
      if (run && run.status === "started") {
        Alert.alert("Reminder", "Have you dropped all passengers? Consider ending the trip if done.");
      }
    }, 15 * 60 * 1000);
  }

  async function driverOtpCheckIn(allotmentId, empId) {
    const otp = otpInputs[empId];
    if (!otp || otp.length < 4) {
      Alert.alert("Enter OTP", "Please enter the employee's OTP code.");
      return;
    }
    try {
      await client.post(`/schedules/allotments/${allotmentId}/checkin-otp`, { employeeId: empId, otp });
      setOtpInputs((prev) => ({ ...prev, [empId]: "" }));
      loadTrip();
      Alert.alert("Checked in", "Employee checked in via OTP.");
    } catch (err) {
      Alert.alert("Check-in failed", err.response?.data?.message || "Invalid OTP or network error.");
    }
  }

  // Driver marks the current passenger as a no-show. Captures the driver's fresh
  // GPS for the audit and lets the run advance to the next passenger.
  function confirmNoShow(stop) {
    Alert.alert(
      "Mark as no-show?",
      `Mark ${stop.name || "this passenger"} as a no-show? The trip will move to the next passenger.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm No-Show", style: "destructive", onPress: () => driverNoShow(stop) }
      ]
    );
  }

  async function driverNoShow(stop) {
    if (!run) return;
    try {
      const pos = await getFreshPosition().catch(() => null);
      await client.post(`/schedules/allotments/${run._id}/no-show`, {
        employeeId: stop.employeeId,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null
      });
      setOtpInputs((prev) => ({ ...prev, [stop.employeeId]: "" }));
      await loadTrip();
      Alert.alert("No-show recorded", "The trip has moved to the next passenger.");
    } catch (err) {
      Alert.alert("Could not record no-show", err.response?.data?.message || err.message);
    }
  }

  async function handleSOS() {
    if (!sosNote.trim()) {
      Alert.alert("Add a note", "Please describe the emergency briefly.");
      return;
    }
    try {
      await client.post("/alerts", { tripId: activeId, note: sosNote.trim() });
      setSosModal(false);
      setSosNote("");
      Alert.alert("SOS sent", "Your emergency alert has been sent to the admin.");
    } catch (err) {
      Alert.alert("Failed", "Could not send SOS. Please call the helpline.");
    }
  }

  function markTripStop(stop, status) {
    updateStopStatus(trip._id, stop.employeeId, status);
    setTrip((prev) => ({
      ...prev,
      route: prev.route.map((s) =>
        s.employeeId === stop.employeeId && s.type === stop.type ? { ...s, status } : s
      )
    }));
  }

  function markRunStop(stop, status) {
    updateAllotmentStop(run._id, stop.employeeId, status);
    setRun((prev) => ({
      ...prev,
      sequence: (Array.isArray(prev.sequence) ? prev.sequence : []).map((s) =>
        s.employeeId === stop.employeeId ? { ...s, status } : s
      )
    }));
  }

  async function endRun() {
    if (!run) return;
    Alert.alert(
      "End this trip?",
      "Ending the trip marks the remaining stops as dropped and stops sharing your live location.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End trip",
          style: "destructive",
          onPress: async () => {
            try {
              await completeRun(run._id);
              await stopDriverTracking();
              setTracking(false);
              await loadTrip();
              // Hand off to the end-of-trip procedure (Trip/Line/Stand + Reset).
              navigation.navigate("DriverEndTrip", {
                runId: run._id,
                runName: run.slotLabel || "",
                direction: run.direction
              });
            } catch (err) {
              Alert.alert("Couldn't end trip", err.response?.data?.message || err.message);
            }
          }
        }
      ]
    );
  }

  async function handleCancelTrip() {
    if (!run) return;
    const reason = cancelReason.trim();
    setCancelModal(false);
    setCancelReason("");
    try {
      await requestCancelRun(reason);
      Alert.alert("Cancellation request sent", "Your admin/vendor will review and confirm shortly. All riders have been notified.");
      await loadTrip();
    } catch (err) {
      Alert.alert("Couldn't submit", err.response?.data?.error || err.message);
    }
  }

  function renderAllotment(a) {
    const v = a.vehicle || {};
    const d = a.driver || {};
    return (
      <View key={a._id} style={styles.allotment}>
        <View style={styles.allotTop}>
          <View style={styles.allotBadgeWrap}>
            <Text style={styles.allotBadge}>{fmtDate(a.date)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.allotTitle}>
              {v.vehicleNumber ? `${v.vehicleNumber} · ${v.vehicleType}` : "Vehicle TBD"}
            </Text>
            <Text style={styles.tripIdLine}>
              Trip ID: {String(a._id).slice(-6).toUpperCase()}
              {v.line ? ` · Line ${v.line}` : ""}
            </Text>
            <Text style={styles.allotSub}>
              {dirLabel(a.direction)} · {a.slotLabel || "Shift"} · {a.total} drop{a.total === 1 ? "" : "s"}
              {a.vendorName ? ` · Vendor: ${a.vendorName}` : ""}
              {d.name ? ` · Driver: ${d.name}` : ""}
            </Text>
            {a.isEscort && (
              <View style={styles.escortInline}>
                <Text style={styles.escortInlineText}>🛡️ Escort</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.seq}>
          {(Array.isArray(a.sequence) ? a.sequence : []).map((e) => (
            <View key={String(e.order)} style={styles.seqRow}>
              <View style={styles.seqBadge}>
                <Text style={styles.seqBadgeText}>{e.order + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.seqName}>{e.name}</Text>
                {e.pickupTime ? <Text style={styles.seqTime}>Pickup {fmtTime12(e.pickupTime)}{e.nextDay ? " · next day" : ""}</Text> : null}
                {e.pickup?.address ? <Text style={styles.seqAddress}>Pickup: {e.pickup.address}</Text> : null}
                {e.drop?.address ? <Text style={styles.seqAddress}>Drop: {e.drop.address}</Text> : null}
                {e.etaMinutes != null || e.etaKm != null ? (
                  <Text style={styles.seqEta}>ETA {fmtEta(e.etaMinutes, e.etaKm)}</Text>
                ) : null}
              </View>
              {e.status === "picked_up" || e.status === "reached" || e.status === "completed" ? (
                <Text style={styles.seqPicked}>PICKED</Text>
              ) : null}
            </View>
          ))}
          {a.officeDestination && (
            <View style={[styles.seqRow, styles.seqDest]}>
              <View style={[styles.seqBadge, styles.seqBadgeDest]}>
                <Text style={[styles.seqBadgeText, styles.seqBadgeTextDest]}>{a.officeDestination.order}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.seqName}>{a.officeDestination.label}</Text>
                {a.officeDestination.arrivalTime ? (
                  <Text style={styles.seqTime}>Arrival {fmtTime12(a.officeDestination.arrivalTime)}</Text>
                ) : null}
                {a.officeDestination.address ? <Text style={styles.seqAddress}>{a.officeDestination.address}</Text> : null}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrip();
    setRefreshing(false);
  };

  const stops = run
    ? (Array.isArray(run.sequence) ? run.sequence : [])
    : trip
      ? trip.route.map((s) => ({
          label: s.type === "pickup" ? "Pickup" : "Drop",
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          status: s.status,
          employeeId: s.employeeId,
          pickup: { address: "", lat: null, lng: null },
          drop: { address: s.address, lat: s.lat, lng: s.lng }
        }))
      : [];

  // Navigate to the approved pickup point (or drop as a fallback). Google Maps
  // handles the actual turn-by-turn; tapping opens it with the destination set.
  function openMaps(stop) {
    if (stop.locked) {
      Alert.alert("Location locked", "This passenger's exact pickup location unlocks after the previous passenger's OTP is verified.");
      return;
    }
    const p = stop.pickup && stop.pickup.lat != null ? stop.pickup : stop.drop || stop;
    const lat = p.lat, lng = p.lng;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Location unavailable", "This passenger's pickup coordinates are not available yet.");
      return;
    }
    // Prefer the Google Maps app for turn-by-turn; fall back to the Google Maps
    // web page in a browser. Never opens a blank embedded map.
    const navUrl = `google.navigation:q=${lat},${lng}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(navUrl).catch(() =>
      Linking.openURL(webUrl).catch(() => Alert.alert("Can't open maps", "No maps app or browser is available."))
    );
  }

  function callNumber(phone) {
    if (!phone) return;
    Linking.openURL(`tel:${String(phone).replace(/[^+\d]/g, "")}`).catch(() =>
      Alert.alert("Can't call", "No phone app is available.")
    );
  }

  const mapPoints = stops.filter((s) => {
    const p = s.pickup && s.pickup.lat != null ? s.pickup : s;
    return (
      typeof p.lat === "number" &&
      Number.isFinite(p.lat) &&
      typeof p.lng === "number" &&
      Number.isFinite(p.lng)
    );
  });
  const initialRegion = mapPoints[0]
    ? (() => {
        const p = mapPoints[0].pickup && mapPoints[0].pickup.lat != null ? mapPoints[0].pickup : mapPoints[0];
        return { latitude: p.lat, longitude: p.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 };
      })()
    : { latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  if (!activeId) {
    return (
      <View style={styles.root}>
        <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>No cab run right now</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.headerActionsScroll}
            contentContainerStyle={styles.headerActions}
          >
            {helpline ? <TouchableOpacity onPress={callHelpline}><Text style={styles.link}>✆ Call</Text></TouchableOpacity> : null}
            <TouchableOpacity onPress={() => navigation.navigate("Settings")}><Text style={styles.link}>Settings</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("DriverEndTrip", { runId: activeId, direction: run?.direction })}><Text style={styles.link}>End shift</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("Help")}><Text style={styles.link}>Help</Text></TouchableOpacity>
            <TouchableOpacity onPress={logout}><Text style={styles.logout}>Sign out</Text></TouchableOpacity>
          </ScrollView>
        </View>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.emptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        >
          <Text style={styles.emptyTitle}>No cab run right now</Text>
          <Text style={styles.emptyBody}>Your allotted cab run will appear here once the admin assigns a vehicle and schedule to you.</Text>
          {allotted.length > 0 && (
            <View style={styles.cardFull}>
              <Text style={styles.cardLabel}>Your allotted cab runs</Text>
              {allotted.map((a) => renderAllotment(a))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
      <ScrollView
        style={styles.fill}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{run ? "Your cab run" : "Current trip"}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.headerActionsScroll}
          contentContainerStyle={styles.headerActions}
        >
          {helpline ? <TouchableOpacity onPress={callHelpline}><Text style={styles.link}>✆ Call</Text></TouchableOpacity> : null}
          {activeId ? <TouchableOpacity onPress={() => navigation.navigate("Chat", { tripId: activeId })}><Text style={styles.link}>Chat</Text></TouchableOpacity> : null}
          <TouchableOpacity onPress={() => navigation.navigate("Settings")}><Text style={styles.link}>Settings</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("DriverEndTrip", { runId: activeId, direction: run?.direction })}><Text style={styles.link}>End shift</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Help")}><Text style={styles.link}>Help</Text></TouchableOpacity>
          <TouchableOpacity onPress={logout}><Text style={styles.logout}>Sign out</Text></TouchableOpacity>
        </ScrollView>
      </View>

      {user?.company_id ? (
        <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.xs }}>
          <SubscriptionStatusBar companyId={user.company_id} compact />
        </View>
      ) : null}

      <View style={styles.bannerWrap}>
        <OfflineBanner onOpenSync={() => navigation.navigate("PendingSync")} />
      </View>

      {run && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Allotted cab</Text>
          <Text style={styles.tripIdLine}>
            Trip ID: {String(run._id).slice(-6).toUpperCase()}
            {run.vehicle?.line ? ` · Line ${run.vehicle.line}` : ""}
          </Text>
          <Text style={styles.runTitle}>
            {run.vehicle?.vehicleNumber ? `${run.vehicle.vehicleNumber} · ${run.vehicle.vehicleType}` : "Vehicle TBD"}
          </Text>
          <Text style={styles.runSub}>
            {fmtDate(run.date)} · {dirLabel(run.direction)} · {run.slotLabel || "Shift"} · {run.total} drops
            {run.vendorName ? ` · Vendor: ${run.vendorName}` : ""}
            {run.status === "started" ? " · in progress" : ""}
          </Text>
          {run.isEscort && (
            <View style={styles.escortInline}>
              <Text style={styles.escortInlineText}>🛡️ Escort assigned for this run</Text>
            </View>
          )}
          {run.nextStop && (
            <Text style={styles.nextStop}>
              Next stop: {run.nextStop.name}
              {(run.nextStop.etaMinutes != null || run.nextStop.etaKm != null)
                ? ` · ${fmtEta(run.nextStop.etaMinutes, run.nextStop.etaKm)}`
                : ""}
            </Text>
          )}
          {(run.status === "assigned" || run.status === "started") && (
            <TouchableOpacity style={styles.endTripButton} onPress={endRun}>
              <Text style={styles.endTripButtonText}>End trip</Text>
            </TouchableOpacity>
          )}
          {(run.status === "assigned" || run.status === "started") && (
            <TouchableOpacity style={styles.cancelTripButton} onPress={() => { setCancelReason(""); setCancelModal(true); }}>
              <Text style={styles.cancelTripButtonText}>Request cancellation</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.trackButton, tracking && styles.trackButtonActive]}
        onPress={toggleTracking}
      >
        <View style={[styles.trackDot, tracking && styles.trackDotActive]} />
        <Text style={styles.trackButtonText}>{tracking ? "Sharing live location" : "Start trip & share live location"}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.sosButton} onPress={() => setSosModal(true)}>
        <Text style={styles.sosButtonText}>SOS / Emergency</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Passengers</Text>
        {stops.map((stop, i) => {
          const isLocked = !!stop.locked;
          const boarded = stop.status === "picked_up" || !!stop.boarded;
          const dropped = stop.status === "completed" || !!stop.dropped;
          const noShow = stop.status === "no_show";
          const isArrived = !!arrived[stop.employeeId];
          const statusLabel = noShow ? "NO-SHOW" : dropped ? "DROPPED" : boarded ? "CHECKED IN" : isArrived ? "ARRIVED AT PICKUP" : "WAITING FOR PICKUP";
          return (
            <View key={i} style={[styles.stopCard, isLocked && styles.stopCardLocked]}>
              <View style={styles.stopHeader}>
                <View style={styles.stopIndexWrap}>
                  <Text style={styles.stopIndex}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stopName}>{stop.name || stop.label || "Employee"}</Text>
                  {stop.pickupTime ? (
                    <Text style={styles.stopTime}>
                      {fmtTime12(stop.pickupTime)}{stop.nextDay ? " · next day" : ""}
                    </Text>
                  ) : null}
                  <Text style={[styles.stopStatus, (boarded && !dropped) || dropped ? styles.stopStatusOk : isLocked ? styles.stopStatusMuted : styles.stopStatusWarn]}>
                    {isLocked ? "🔒 " : (boarded || dropped) ? "✓ " : ""}{statusLabel}
                  </Text>
                </View>
                {isLocked && (
                  <View style={styles.lockedBadge}>
                    <Text style={styles.lockedBadgeText}>LOCKED</Text>
                  </View>
                )}
              </View>
              {!isLocked && (
                <>
                  <View style={styles.stopActions}>
                    <TouchableOpacity style={styles.navButton} onPress={() => openMaps(stop)}>
                      <Text style={styles.navButtonText}>Open Google Maps</Text>
                    </TouchableOpacity>
                    {stop.phone ? (
                      <TouchableOpacity style={styles.callButton} onPress={() => callNumber(stop.phone)}>
                        <Text style={styles.callButtonText}>Call</Text>
                      </TouchableOpacity>
                    ) : null}
                    {!boarded && !dropped && !noShow && (
                      <TouchableOpacity
                        style={[styles.stopButton, isArrived && { borderColor: colors.amber }]}
                        onPress={() => setArrived((p) => ({ ...p, [stop.employeeId]: !p[stop.employeeId] }))}
                      >
                        <Text style={styles.stopButtonText}>{isArrived ? "Arrived ✓" : "I've arrived"}</Text>
                      </TouchableOpacity>
                    )}
                    {run && !boarded && !dropped && !noShow && (
                      <TouchableOpacity style={styles.noShowButton} onPress={() => confirmNoShow(stop)}>
                        <Text style={styles.noShowButtonText}>No Show</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {run && !boarded && !dropped && !noShow && (
                    <View style={styles.otpRow}>
                      <TextInput
                        style={styles.otpInput}
                        placeholder="Enter OTP"
                        placeholderTextColor={colors.textDim}
                        keyboardType="number-pad"
                        maxLength={6}
                        value={otpInputs[stop.employeeId] || ""}
                        onChangeText={(t) => setOtpInputs((prev) => ({ ...prev, [stop.employeeId]: t }))}
                      />
                      <TouchableOpacity style={styles.otpCheckInBtn} onPress={() => driverOtpCheckIn(run._id, stop.employeeId)}>
                        <Text style={styles.otpCheckInBtnText}>Verify OTP</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {boarded && !dropped ? (
                    <View style={styles.verifiedRow}>
                      <Text style={styles.verifiedTick}>✓</Text>
                      <Text style={styles.verifiedText}>PASSENGER CHECKED IN</Text>
                    </View>
                  ) : null}
                  <Text style={styles.stopAddress}>
                    Pickup: {stop.pickup?.address || stop.address || "Pickup point"}
                  </Text>
                  <Text style={styles.stopAddressDim}>
                    Drop: {stop.drop?.address || stop.address || "Drop stop"}
                  </Text>
                </>
              )}
            </View>
          );
        })}
        {run?.officeDestination && (
          <View style={[styles.stopCard, styles.destCard]}>
            <View style={styles.stopHeader}>
              <Text style={styles.stopIndex}>{stops.length + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stopName}>{run.officeDestination.label}</Text>
                <Text style={styles.stopTime}>
                  Arrival {fmtTime12(run.officeDestination.arrivalTime)}
                </Text>
                {run.officeDestination.etaMinutes != null || run.officeDestination.etaKm != null ? (
                  <Text style={styles.stopEta}>ETA {fmtEta(run.officeDestination.etaMinutes, run.officeDestination.etaKm)}</Text>
                ) : null}
              </View>
              {run.officeDestination.lat != null && run.officeDestination.lng != null ? (
                <TouchableOpacity style={styles.navButton} onPress={() => openMaps(run.officeDestination)}>
                  <Text style={styles.navButtonText}>Navigate to office</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.stopAddress}>{run.officeDestination.address || "Office"}</Text>
          </View>
        )}
      </View>

      {allotted.length > 0 && (
        <View style={styles.cardFull}>
          <Text style={styles.cardLabel}>Your allotted cab runs</Text>
          {allotted.map((a) => renderAllotment(a))}
        </View>
      )}
      </ScrollView>

      {/* SOS Modal */}
      <Modal visible={sosModal} transparent animationType="fade" onRequestClose={() => setSosModal(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setSosModal(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Emergency SOS</Text>
            <Text style={styles.modalBody}>Describe the emergency. An alert will be sent to the admin immediately.</Text>
            <TextInput
              style={styles.sosInput}
              value={sosNote}
              onChangeText={setSosNote}
              placeholder="What's happening?"
              placeholderTextColor={colors.textDim}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setSosModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sosSendBtn} onPress={handleSOS}>
                <Text style={styles.sosSendBtnText}>Send SOS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Vehicle Checklist Modal */}
      <Modal visible={checklistModal} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Pre-Trip Vehicle Check</Text>
            <Text style={styles.modalBody}>Confirm before starting:</Text>
            {CHECK_ITEMS.map((item) => (
              <TouchableOpacity key={item} style={styles.checkItem} onPress={() => setCheckedItems((p) => ({ ...p, [item]: !p[item] }))}>
                <Text style={styles.checkItemText}>{checkedItems[item] ? "☑" : "☐"} {item}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalConfirm, CHECK_ITEMS.some((i) => !checkedItems[i]) && { opacity: 0.5 }]}
              onPress={confirmChecklist}
            >
              <Text style={styles.modalConfirmText}>Confirm & Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Standing point modal (L1..L60 grid) */}
      <Modal visible={standingModal} transparent animationType="fade" onRequestClose={() => setStandingModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Set standing point</Text>
            <Text style={styles.modalBody}>Where is your cab parked at the office? Tap an L1–L60 slot.</Text>
            <View style={styles.standGrid}>
              {Array.from({ length: 60 }, (_, i) => {
                const spot = `L${i + 1}`;
                const active = standingPoint === spot;
                return (
                  <TouchableOpacity
                    key={spot}
                    style={[styles.standCell, active && styles.standCellActive]}
                    onPress={() => saveStandingPoint(spot)}
                  >
                    <Text style={[styles.standCellText, active && styles.standCellTextActive]}>{spot}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setStandingModal(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* Cancellation request modal */}
      <Modal visible={cancelModal} transparent animationType="fade" onRequestClose={() => setCancelModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Request cancellation</Text>
            <Text style={styles.modalBody}>
              This sends a cancellation request to your admin/vendor. All riders are notified and the trip is only cancelled after approval.
            </Text>
            <TextInput
              style={styles.cancelInput}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.textDim}
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
              maxLength={500}
            />
            <View style={styles.cancelActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCancelModal(false)}>
                <Text style={styles.modalCancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelSubmitButton} onPress={handleCancelTrip}>
                <Text style={styles.cancelSubmitButtonText}>Submit request</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  fill: { flex: 1 },
  bannerWrap: { marginHorizontal: spacing.lg, marginTop: spacing.xs },
  watermark: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -48,
    textAlign: "center",
    fontSize: 110,
    fontWeight: "900",
    letterSpacing: -4,
    color: "rgba(0,217,192,0.055)",
    transform: [{ rotate: "-8deg" }]
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14, paddingRight: 4 },
  headerActionsScroll: { flexShrink: 1, marginLeft: spacing.sm },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  link: { color: colors.teal, fontSize: 13, fontWeight: "600" },
  logout: { color: colors.textDim, fontSize: 13 },
  trackButton: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    marginHorizontal: spacing.lg, padding: 14
  },
  trackButtonActive: { borderColor: colors.teal },
  trackDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.line },
  trackDotActive: { backgroundColor: colors.teal },
  trackButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  mapWrap: { height: 240, marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.lg, overflow: "hidden" },
  mapFill: { flex: 1 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, margin: spacing.lg, marginTop: spacing.sm, padding: spacing.md },
  cardLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  runTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  runSub: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  nextStop: { color: colors.teal, fontSize: 13, fontWeight: "600", marginTop: 8 },
  endTripButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    backgroundColor: colors.coral,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  endTripButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  cancelTripButton: {
    alignSelf: "flex-start",
    marginTop: 10,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.coral,
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 16
  },
  cancelTripButtonText: { color: colors.coral, fontSize: 13, fontWeight: "600" },
  cancelInput: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.text,
    padding: 10,
    minHeight: 72,
    marginTop: 12,
    textAlignVertical: "top"
  },
  cancelActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  cancelSubmitButton: { backgroundColor: colors.coral, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 16 },
  cancelSubmitButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  stopEta: { color: colors.teal, fontSize: 12, fontWeight: "600", marginTop: 2 },
  seqEta: { color: colors.teal, fontSize: 11.5, fontWeight: "600", marginTop: 1 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  stopCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
    padding: spacing.sm,
    marginBottom: spacing.sm
  },
  stopCardLocked: { opacity: 0.85, borderStyle: "dashed" },
  stopLocked: { color: colors.textDim, fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  stopStatus: { fontSize: 12.5, fontWeight: "800", marginTop: 3, letterSpacing: 0.3 },
  stopStatusOk: { color: colors.teal },
  stopStatusWarn: { color: colors.amber },
  stopStatusMuted: { color: colors.textDim },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  verifiedTick: { color: colors.teal, fontSize: 18, fontWeight: "900" },
  verifiedText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  lockedBadge: { backgroundColor: "rgba(15,30,61,0.08)", borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 },
  lockedBadgeText: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  stopHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  stopActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 4 },
  stopIndexWrap: { width: 22, height: 22, borderRadius: 6, backgroundColor: "rgba(139,124,246,0.2)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  stopIndex: { color: colors.violet, fontSize: 11, fontWeight: "700" },
  stopName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  stopTime: { color: colors.amber, fontSize: 13, fontWeight: "700", marginTop: 2 },
  stopAddress: { color: colors.text, fontSize: 13, marginTop: 2 },
  stopAddressDim: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  stopMeta: { color: colors.textDim, fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  pickedBadge: {
    backgroundColor: "rgba(0,217,192,0.14)", borderWidth: 1, borderColor: colors.teal,
    borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8
  },
  pickedBadgeText: { color: colors.teal, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  destCard: { borderColor: colors.violet, backgroundColor: "rgba(139,124,246,0.08)" },
  navButton: {
    backgroundColor: colors.teal,
    borderWidth: 1,
    borderColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  navButtonText: { color: "#02201C", fontSize: 11.5, fontWeight: "700" },
  callButton: {
    backgroundColor: colors.violet,
    borderWidth: 1,
    borderColor: colors.violet,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  callButtonText: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "700" },
  stopButton: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  stopButtonText: { color: colors.teal, fontSize: 11.5, fontWeight: "600" },
  noShowButton: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.coral, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  noShowButtonText: { color: colors.coral, fontSize: 11.5, fontWeight: "700" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyBody: { color: colors.textDim, fontSize: 14, textAlign: "center" },
  cardFull: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, margin: spacing.lg, padding: spacing.md, width: "100%" },
  allotment: { borderWidth: 1, borderColor: colors.violet, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  allotTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  allotBadgeWrap: { alignItems: "flex-start" },
  allotBadge: { color: "#FFFFFF", backgroundColor: colors.violet, fontSize: 11, fontWeight: "700", paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm, overflow: "hidden" },
  allotTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  tripIdLine: { color: colors.teal, fontSize: 12, fontWeight: "700", marginTop: 4, letterSpacing: 0.5 },
  allotSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  seq: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  seqRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  seqBadge: { width: 22, height: 22, borderRadius: 6, backgroundColor: "rgba(139,124,246,0.2)", alignItems: "center", justifyContent: "center" },
  seqBadgeText: { color: colors.violet, fontSize: 11, fontWeight: "700" },
  seqName: { color: colors.text, fontSize: 13, fontWeight: "600" },
  seqTime: { color: colors.amber, fontSize: 12, fontWeight: "700", marginTop: 1 },
  seqAddress: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  seqPicked: { color: colors.teal, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  seqDest: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  seqBadgeDest: { backgroundColor: colors.violet },
  seqBadgeTextDest: { color: "#FFFFFF" },
  escortInline: { backgroundColor: "rgba(0,217,192,0.1)", borderWidth: 1, borderColor: colors.teal, borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: 8, marginTop: 4, alignSelf: "flex-start" },
  escortInlineText: { color: colors.teal, fontSize: 11, fontWeight: "700" },
  otpRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  otpInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, color: colors.text, fontSize: 13, backgroundColor: colors.panel2 },
  otpCheckInBtn: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  otpCheckInBtnText: { color: "#02201C", fontSize: 11, fontWeight: "700" },
  otpCheckOutBtn: { backgroundColor: colors.amber, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  otpCheckOutBtnText: { color: "#02201C", fontSize: 11, fontWeight: "700" },
  sosButton: { marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: "#EF4444", borderRadius: radius.md, padding: 14, alignItems: "center" },
  sosButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: spacing.xl },
  modalSheet: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.line },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  modalBody: { color: colors.textDim, fontSize: 13, marginBottom: 14, lineHeight: 19 },
  sosInput: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: "top", marginBottom: 14 },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancel: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, alignItems: "center" },
  modalCancelText: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  sosSendBtn: { flex: 1, backgroundColor: "#EF4444", borderRadius: radius.md, padding: 14, alignItems: "center" },
  sosSendBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  checkItem: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  checkItemText: { color: colors.text, fontSize: 14 },
  modalConfirm: { backgroundColor: colors.teal, borderRadius: radius.md, padding: 14, alignItems: "center", marginTop: 14 },
  modalConfirmText: { color: "#02201C", fontSize: 14, fontWeight: "700" },
  standRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  standRowText: { color: colors.textDim, fontSize: 13, flex: 1, paddingRight: 8 },
  standRowAction: { color: colors.teal, fontSize: 13, fontWeight: "700" },
  standGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 14, maxHeight: 340 },
  standCell: { width: 58, height: 44, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  standCellActive: { borderColor: colors.teal, backgroundColor: colors.teal },
  standCellText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  standCellTextActive: { color: "#02201C" }
});
