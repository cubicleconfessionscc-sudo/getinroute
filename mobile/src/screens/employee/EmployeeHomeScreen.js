import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert, Linking, Platform, Modal } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getMyTrips, checkIn, checkOut } from "../../api/trips";
import { getMyLiveAllotment, allotmentCheckIn, allotmentCheckOut, confirmAllotmentSafeDrop } from "../../api/schedules";
import { getLocationProfile } from "../../api/locations";
import { getSupportConfig } from "../../api/support";
import { connectSocket, joinTrip, leaveTrip, getSocket } from "../../services/socket";
import { speakTripAssigned } from "../../services/voice";
import { notifyTripAssigned, notifyChatMessage } from "../../services/notifications";
import { useAuth } from "../../context/AuthContext";
import SwipeButton from "../../components/SwipeButton";
import { colors, spacing, radius } from "../../theme";

export default function EmployeeHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [allotment, setAllotment] = useState(null); // the allotted cab run, if any
  const [trip, setTrip] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [myStop, setMyStop] = useState(null); // this employee's stop within a legacy trip
  const [locationStatus, setLocationStatus] = useState("none");
  const [addressChangeCount, setAddressChangeCount] = useState(0);
  const [helpline, setHelpline] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const mapRef = useRef(null);
  // Announces a newly allotted cab exactly once per session (voice + local
  // notification), mirroring the driver app; never on the very first load.
  const announcedAllotmentRef = useRef(new Set());
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    getSupportConfig()
      .then((c) => setHelpline(c.helplinePhone || ""))
      .catch(() => {});
  }, []);

  function callHelpline() {
    if (!helpline) return;
    Linking.openURL(`tel:${helpline.replace(/[^+\d]/g, "")}`).catch(() => {});
  }

  function callNumber(phone) {
    if (!phone) return;
    Linking.openURL(`tel:${String(phone).replace(/[^+\d]/g, "")}`).catch(() =>
      Alert.alert("Can't call", "No phone app is available.")
    );
  }

  const loadTrip = useCallback(async () => {
    const [requests, live, loc] = await Promise.all([
      getMyTrips(),
      getMyLiveAllotment(),
      getLocationProfile().catch(() => ({ locationStatus: "none", pickupLocation: null, dropLocation: null }))
    ]);
    setLocationStatus(loc?.locationStatus || "none");
    setAddressChangeCount(loc?.addressChangeCount || 0);
    const activeRequest = requests.find((r) => r.trip && r.trip.status !== "completed" && r.trip.status !== "cancelled");
    setTrip(activeRequest?.trip || null);

    const activeAllotment = (live || []).find((a) => a.status === "assigned" || a.status === "started") || null;
    setAllotment(activeAllotment);
    setDriverLocation(activeAllotment?.driverLocation || null);

    // Voice + local notification when a cab is freshly alloted to the employee.
    const newId = activeAllotment ? activeAllotment._id : null;
    if (newId && !announcedAllotmentRef.current.has(newId)) {
      announcedAllotmentRef.current.add(newId);
      if (!isFirstLoadRef.current) {
        speakTripAssigned(newId);
        notifyTripAssigned();
      }
    }
    isFirstLoadRef.current = false;

    const t = activeRequest?.trip;
    if (t) {
      const pickup = t.route.find((s) => s.type === "pickup" && String(s.employeeId) === user?.id);
      setMyStop(pickup || t.route.find((s) => String(s.employeeId) === user?.id));
    } else {
      setMyStop(null);
    }
  }, [user]);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  // Reload the location banner whenever this screen regains focus (e.g. after
  // returning from "My Locations" where the admin may have just approved).
  useEffect(() => {
    const sub = navigation.addListener("focus", () => { loadTrip(); });
    return sub;
  }, [navigation, loadTrip]);

  // Live refresh when the admin approves/rejects an address change while the
  // home screen is open.
  const locRefreshRef = useRef(null);
  useEffect(() => {
    (async () => {
      const sock = await connectSocket();
      sock.on("location:approval", () => loadTrip());
      locRefreshRef.current = sock;
    })();
    return () => {
      locRefreshRef.current?.off("location:approval");
    };
  }, [loadTrip]);

  const activeRoom = allotment ? allotment._id : trip ? trip._id : null;

  // Only the cab marker/region is safe for the map: react-native-maps crashes
  // natively if given a non-number or non-finite coordinate.
  const driverLoc =
    driverLocation &&
    typeof driverLocation.lat === "number" &&
    Number.isFinite(driverLocation.lat) &&
    typeof driverLocation.lng === "number" &&
    Number.isFinite(driverLocation.lng)
      ? { latitude: driverLocation.lat, longitude: driverLocation.lng }
      : null;

  // Fallback anchor for the map marker: the employee's pickup point.
  const pickupCoords =
    allotment?.myStop &&
    typeof allotment.myStop.pickup?.lat === "number" &&
    Number.isFinite(allotment.myStop.pickup.lat) &&
    typeof allotment.myStop.pickup?.lng === "number" &&
    Number.isFinite(allotment.myStop.pickup.lng)
      ? { latitude: allotment.myStop.pickup.lat, longitude: allotment.myStop.pickup.lng }
      : null;

  useEffect(() => {
    if (!activeRoom) return;
    let cancelled = false;
    (async () => {
      const sock = await connectSocket();
      if (cancelled) return;
      sock.on("location:broadcast", (data) => {
        setDriverLocation(data);
        setAllotment((prev) => (prev ? { ...prev, sharingLive: true } : prev));
      });
      sock.on("trip:statusBroadcast", () => loadTrip());
      sock.on("allotment:statusBroadcast", () => loadTrip());
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
  }, [activeRoom, loadTrip]);

  // Chat push notifications (item 9): the backend emits 'chat:incoming' to the
  // receiver's user room for every message not sent by them, so both directions
  // (driver -> employee and employee -> driver) surface a banner + sound.
  useEffect(() => {
    let sock;
    (async () => {
      sock = await connectSocket();
      sock.on("chat:incoming", (evt) => {
        if (!evt) return;
        const fromLabel = evt.role === "driver" ? evt.from : evt.from;
        notifyChatMessage(fromLabel, evt.text);
      });
    })();
    return () => {
      sock?.off("chat:incoming");
    };
  }, []);

  // Keep the map centred on the cab as the driver moves.
  useEffect(() => {
    if (driverLoc) {
      mapRef.current?.animateToRegion(
        { ...driverLoc, latitudeDelta: 0.03, longitudeDelta: 0.03 },
        500
      );
    }
  }, [driverLoc]);

  const menuItems = [
    { label: "Trip history", onPress: () => navigation.navigate("EmployeeHistory") },
    { label: "Book cab", onPress: () => navigation.navigate("EmployeeSchedule") },
    { label: "My Locations", onPress: () => navigation.navigate("EmployeeLocations") },
    { label: "Feedback", onPress: () => navigation.navigate("Feedback", { allotmentId: allotment?._id, tripId: trip?._id }) },
    { label: "Settings", onPress: () => navigation.navigate("Settings") },
    { label: "Help & support", onPress: () => navigation.navigate("Help") },
    { label: "Sign out", onPress: logout }
  ];

  function MenuButton() {
    return (
      <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} style={styles.menuBtn}>
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
      </TouchableOpacity>
    );
  }

  function MenuModal() {
    return (
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>Menu</Text>
            {menuItems.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  item.onPress();
                }}
              >
                <Text style={[styles.menuItemText, item.label === "Sign out" && styles.menuItemLogout]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    );
  }

  async function handleAllotmentCheckIn() {
    if (!allotment) return;
    try {
      await allotmentCheckIn(allotment._id);
      loadTrip();
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      Alert.alert("Check-in not allowed", msg);
      loadTrip();
    }
  }

  async function handleAllotmentCheckOut() {
    if (!allotment) return;
    try {
      await allotmentCheckOut(allotment._id);
      loadTrip();
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      Alert.alert("Check-out not allowed", msg);
      loadTrip();
    }
  }

  async function handleTripCheckIn() {
    if (!trip) return;
    await checkIn(trip._id);
    loadTrip();
  }

  async function handleTripCheckOut() {
    if (!trip) return;
    await checkOut(trip._id);
    loadTrip();
  }

  async function handleSafeDrop() {
    if (!allotment) return;
    try {
      await confirmAllotmentSafeDrop(allotment._id);
      loadTrip();
    } catch (e) {
      Alert.alert("Couldn't confirm", e.response?.data?.message || e.message);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrip();
    setRefreshing(false);
  };

  if (!allotment && !trip) {
    return (
      <View style={styles.root}>
        <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
        <View style={styles.topLinks}>
          <MenuButton />
          {helpline ? <TouchableOpacity onPress={callHelpline}><Text style={styles.link}>✆ Call</Text></TouchableOpacity> : null}
          <TouchableOpacity onPress={() => navigation.navigate("Help")}><Text style={styles.link}>Help</Text></TouchableOpacity>
        </View>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.emptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        >
          <Text style={styles.emptyTitle}>No active ride right now</Text>
          <Text style={styles.emptyBody}>Once the admin allots a cab for your shift, your driver's live location and drop position will show up here.</Text>
          {locationStatus !== "approved" && (
            <View style={[styles.card, styles.pendingCard, styles.waitGateCard]}>
              <View style={styles.pendingIconWrap}>
                <Text style={styles.pendingIcon}>⚠</Text>
              </View>
              <Text style={styles.pendingTitle}>
                {locationStatus === "none"
                  ? "Home address required"
                  : locationStatus === "pending"
                  ? "Address awaiting approval"
                  : "Address update rejected"}
              </Text>
              <Text style={styles.pendingBody}>
                {locationStatus === "none"
                  ? "You need an approved home address before you can book a cab. Submit it below — the transport admin will review it."
                  : locationStatus === "pending"
                  ? "Your address is with the transport admin for review. Bookings unlock as soon as it's approved."
                  : "Your address was rejected. Please correct the details in My Locations and resubmit."}
              </Text>
              <TouchableOpacity style={[styles.bookBtn, styles.waitGateBtn]} onPress={() => navigation.navigate("EmployeeLocations")}>
                <Text style={styles.bookBtnText}>
                  {locationStatus === "none" ? "Submit your address" : "Open My Locations"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {locationStatus === "approved" && (
            <TouchableOpacity style={styles.bookBtn} onPress={() => navigation.navigate("EmployeeSchedule")}>
              <Text style={styles.bookBtnText}>Book your cab</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.bookBtn, styles.locBtn]} onPress={() => navigation.navigate("EmployeeLocations")}>
            <Text style={styles.bookBtnText}>Set pickup &amp; drop</Text>
          </TouchableOpacity>
        </ScrollView>
        <MenuModal />
      </View>
    );
  }

  // --- Legacy trip flow (carpool trips), kept for backwards compatibility ---
  if (trip && !allotment) {
    const canCheckIn = myStop?.type === "pickup" && myStop?.status !== "completed" && trip.status !== "completed";
    const canCheckOut = myStop?.type === "drop" || (myStop?.checkedInAt && trip.status !== "completed");
    return (
      <View style={styles.root}>
        <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
        <ScrollView
          style={styles.fill}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
        >
        <View style={styles.header}>
          <MenuButton />
          <Text style={styles.headerTitle}>Today's ride</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.headerActionsScroll}
            contentContainerStyle={styles.headerActions}
          >
            {trip._id ? <TouchableOpacity onPress={() => navigation.navigate("Chat", { tripId: trip._id })}><Text style={styles.link}>Chat</Text></TouchableOpacity> : null}
            <TouchableOpacity onPress={() => navigation.navigate("EmployeeLocations")}><Text style={styles.link}>My Locations</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("EmployeeSchedule")}><Text style={styles.link}>Book cab</Text></TouchableOpacity>
            {helpline ? <TouchableOpacity onPress={callHelpline}><Text style={styles.link}>✆ Call</Text></TouchableOpacity> : null}
            <TouchableOpacity onPress={() => navigation.navigate("Help")}><Text style={styles.link}>Help</Text></TouchableOpacity>
            <TouchableOpacity onPress={logout}><Text style={styles.logout}>Sign out</Text></TouchableOpacity>
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Status</Text>
          <Text style={styles.statusValue}>{formatStatus(trip.status)}</Text>
        </View>

        {driverLoc && (
          <View style={styles.mapWrap}>
            <MapView
              style={styles.mapFill}
              initialRegion={{ ...driverLoc, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
            >
              <Marker coordinate={driverLoc} title="Your driver" pinColor={colors.teal} />
            </MapView>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Pickup &amp; drop sequence</Text>
          {trip.route.map((stop, i) => (
            <View key={i} style={styles.stopRow}>
              <View style={[styles.stopDot, stop.status === "completed" && { backgroundColor: colors.teal }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.stopAddress}>{stop.address || `${stop.type} stop`}</Text>
                <Text style={styles.stopMeta}>{stop.type === "pickup" ? "Pickup" : "Drop"} · stop {i + 1}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.swipeSection}>
          {canCheckIn && <SwipeButton label="Swipe right to check in" direction="right" color={colors.teal} onConfirm={handleTripCheckIn} />}
          {!canCheckIn && canCheckOut && <SwipeButton label="Swipe out to check out" direction="left" color={colors.amber} onConfirm={handleTripCheckOut} />}
        </View>
      </ScrollView>
      <MenuModal />
      </View>
    );
  }

  // --- Allotment flow: the allotted cab with live driver location ---
  const v = allotment.vehicle || {};
  const d = allotment.driver || {};
  const ms = allotment.myStop || {};
  const sharingLive = !!allotment.sharingLive;
  const canCheckInBase = (ms.status === "pending" || ms.status === "reached") && allotment.status !== "completed";
  const cabReached = !allotment.live_status || ["arrived", "boarding", "dropping", "idle", "completed"].includes(allotment.live_status);
  const canCheckIn = canCheckInBase && cabReached;
  const canCheckOut = ms.status === "picked_up" && allotment.status !== "completed";
  const showSafeDrop = ms.checkedOutAt && ms.safeDropEnabled;

  // Item 6 - Navigate: open the employee's pickup stop in the native maps app
  // via a deep link instead of keeping them on the live map. Falls back to the
  // cab's live location when the drop config has no pickup coordinates.
  const openMapsToStop = () => {
    let lat = ms?.pickup?.lat;
    let lng = ms?.pickup?.lng;
    if ((lat === null || lat === undefined || isNaN(Number(lat))) && driverLocation?.coords) {
      lat = driverLocation.coords.latitude;
      lng = driverLocation.coords.longitude;
    }
    if (lat === null || lat === undefined || isNaN(Number(lat))) {
      Alert.alert("Navigate", "Pickup coordinates aren't available yet. The driver will share them when their cab starts.");
      return;
    }
    const label = ms?.pickup?.address || "Pickup stop";
    const url = Platform.OS === "ios"
      ? `maps:${lat},${lng}?q=${encodeURIComponent(label)}`
      : `geo:${lat},${lng}?q=${encodeURIComponent(label)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Navigate", "Couldn't open maps. Please search the pickup stop manually.");
    });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
      <ScrollView
        style={styles.fill}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
      <View style={styles.header}>
        <MenuButton />
        <Text style={styles.headerTitle}>Your cab</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.headerActionsScroll}
          contentContainerStyle={styles.headerActions}
        >
          {activeRoom ? <TouchableOpacity onPress={() => navigation.navigate("Chat", { tripId: activeRoom, phone: d.phone })}><Text style={styles.link}>Chat</Text></TouchableOpacity> : null}
          {helpline ? <TouchableOpacity onPress={callHelpline}><Text style={styles.link}>✆ Call</Text></TouchableOpacity> : null}
          <TouchableOpacity onPress={() => navigation.navigate("Help")}><Text style={styles.link}>Help</Text></TouchableOpacity>
          <TouchableOpacity onPress={logout}><Text style={styles.logout}>Sign out</Text></TouchableOpacity>
        </ScrollView>
      </View>

      {locationStatus !== "none" && locationStatus !== "approved" && (
        <View style={[styles.card, styles.pendingCard]}>
          <Text style={styles.pendingTitle}>
            {locationStatus === "pending" ? "Pickup/drop awaiting approval" : "Pickup/drop update rejected"}
          </Text>
          <Text style={styles.pendingBody}>
            Drivers can only navigate to approved points. Open My Locations to check the status or resubmit.
          </Text>
        </View>
      )}

      {addressChangeCount > 0 && (
        <View style={styles.addressChangeInfo}>
          <Text style={styles.addressChangeText}>
            Address changes used this month: {addressChangeCount}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Allotted cab</Text>
        <Text style={styles.cabTitle}>{v.vehicleNumber ? `${v.vehicleNumber} · ${v.vehicleType}` : "Vehicle TBD"}</Text>
        <Text style={styles.tripIdLine}>
          {v.line ? `Line ${v.line}` : ""}
          {allotment.myOrder != null && allotment.total ? ` · Cab ${allotment.myOrder} of ${allotment.total}` : ""}
          {allotment._id ? ` · Trip ${String(allotment._id).slice(-6).toUpperCase()}` : ""}
        </Text>
        <Text style={styles.cabSub}>
          {allotment.vendorName ? `${allotment.vendorName} · ` : ""}
          {d.name ? `${d.name}${d.phone ? ` · ${d.phone}` : ""}` : "Driver assigned soon"}
          {"\n"}{dirLabel(allotment.direction)} · drop #{allotment.myOrder} of {allotment.total} · {allotment.slotLabel || "Shift"}
        </Text>
        {allotment.checkinOtp && (
          <View style={styles.otpBox}>
            <Text style={styles.otpLabel}>Check-in code</Text>
            <Text style={styles.otpValue}>{allotment.checkinOtp}</Text>
            <Text style={styles.otpHint}>Share this with your driver if the swipe check-in isn't working.</Text>
          </View>
        )}
        {d.phone ? (
          <TouchableOpacity style={styles.callDriverBtn} onPress={() => callNumber(d.phone)}>
            <Text style={styles.callDriverBtnText}>Call driver</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {allotment.isEscort && (
        <View style={styles.escortBadge}>
          <Text style={styles.escortBadgeText}>🛡️ Escort assigned — safe journey ensured</Text>
        </View>
      )}

      {allotment.eta && (allotment.eta.minutes != null || allotment.eta.km != null) && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Cab ETA</Text>
          <Text style={styles.etaValue}>
            {allotment.eta.minutes != null ? (allotment.eta.minutes > 0 ? `~${allotment.eta.minutes} min` : "Arriving now") : "—"}
          </Text>
          <Text style={styles.etaBody}>
            {(allotment.eta.km != null ? `${fmtKm(allotment.eta.km)} away · ` : "")}
            heading to your {allotment.eta.target === "home" ? "home" : "pickup point"}
          </Text>
        </View>
      )}

      {(ms.pickup?.address || ms.drop?.address) && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your route</Text>
          <View style={styles.stopRow}>
            <View style={[styles.stopDot, { backgroundColor: colors.teal }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stopAddress}>Pickup: {ms.pickup?.address || "—"}</Text>
              <Text style={styles.stopMeta}>where the cab picks you up</Text>
            </View>
          </View>
          <View style={styles.stopRow}>
            <View style={[styles.stopDot, { backgroundColor: colors.violet }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stopAddress}>Drop: {ms.drop?.address || "—"}</Text>
              <Text style={styles.stopMeta}>where the cab drops you</Text>
            </View>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.liveMapBtn} onPress={() => setMapOpen(true)}>
        <Text style={styles.liveMapBtnIcon}>📍</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.liveMapBtnTitle}>{allotment.sharingLive ? "View live map" : "View map"}</Text>
          <Text style={styles.liveMapBtnSub}>
            {allotment.sharingLive
              ? "Driver is sharing their live location"
              : "Driver hasn't started sharing their location yet"}
          </Text>
        </View>
        <Text style={styles.liveMapBtnArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.liveMapBtn} onPress={openMapsToStop}>
        <Text style={styles.liveMapBtnIcon}>🧭</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.liveMapBtnTitle}>Navigate</Text>
          <Text style={styles.liveMapBtnSub}>
            {myStop?.pickup?.address ? "Open maps to your pickup stop" : "Open maps to your pickup point"}
          </Text>
        </View>
        <Text style={styles.liveMapBtnArrow}>→</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Drop sequence</Text>
        {(Array.isArray(allotment.sequence) ? allotment.sequence : []).map((e, i) => (
          <View key={String(e.order)} style={[styles.stopRow, e.isMe && styles.stopRowMe]}>
            <View style={[styles.stopDot, e.status === "completed" && { backgroundColor: colors.teal }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stopAddress}>{e.isMe ? "You" : e.name}</Text>
              <Text style={styles.stopMeta}>Drop {i + 1} · {e.status}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.swipeSection}>
        {canCheckInBase && !cabReached && (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingTitle}>Waiting for driver arrival</Text>
            <Text style={styles.waitingBody}>Your cab hasn't reached your stop yet. The check-in will unlock once the driver marks arrival.</Text>
          </View>
        )}
        {canCheckIn && (
          <>
            <SwipeButton label="Swipe right to check in" direction="right" color={colors.teal} onConfirm={handleAllotmentCheckIn} />
            <Text style={styles.otpFallbackHint}>
              Driver can also check you in via OTP if swipe isn't available
            </Text>
          </>
        )}
        {!canCheckIn && canCheckOut && (
          <>
            <SwipeButton label="Swipe out to check out" direction="left" color={colors.amber} onConfirm={handleAllotmentCheckOut} />
            <Text style={styles.otpFallbackHint}>
              Driver can also check you out via OTP
            </Text>
          </>
        )}
      </View>

      {showSafeDrop && (
        <View style={[styles.card, styles.safeDropCard]}>
          <Text style={styles.safeDropTitle}>SafeDrop</Text>
          <Text style={styles.safeDropBody}>
            {ms.safeDropConfirmedAt
              ? "You confirmed safe arrival — an admin has been notified."
              : "Confirm you reached safely so the transport team knows you got home OK."}
          </Text>
          {ms.safeDropConfirmedAt ? (
            <Text style={styles.safeDropConfirmed}>
              Confirmed at {new Date(ms.safeDropConfirmedAt).toLocaleTimeString()}
            </Text>
          ) : (
            <View style={styles.safeDropSwipe}>
              <SwipeButton
                label="Swipe to confirm safe arrival"
                direction="right"
                color={colors.violet}
                onConfirm={handleSafeDrop}
              />
              <Text style={styles.safeDropDeadline}>
                Window closes at {new Date(ms.safeDropDeadline).toLocaleTimeString()}
              </Text>
            </View>
          )}
        </View>
      )}
      </ScrollView>
      <MenuModal />

      <Modal visible={mapOpen} animationType="slide" onRequestClose={() => setMapOpen(false)}>
        <View style={styles.mapModalWrap}>
          <View style={styles.mapModalHead}>
            <Text style={styles.mapModalTitle}>Live cab location</Text>
            <TouchableOpacity onPress={() => setMapOpen(false)}>
              <Text style={styles.mapModalClose}>Close</Text>
            </TouchableOpacity>
          </View>
          {(() => {
            const initial = driverLoc || pickupCoords || { latitude: 20.5937, longitude: 78.9629 };
            return (
              <MapView
                ref={mapRef}
                style={styles.mapModalFill}
                initialRegion={{ ...initial, latitudeDelta: driverLoc ? 0.03 : 0.5, longitudeDelta: driverLoc ? 0.03 : 0.5 }}
                showsUserLocation={false}
                showsMyLocationButton={false}
              >
                {driverLoc && (
                  <Marker coordinate={driverLoc} title="Your cab" anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={styles.cabMarker}>
                      <Text style={styles.cabMarkerText}>🚕</Text>
                    </View>
                  </Marker>
                )}
                {pickupCoords && (
                  <Marker coordinate={pickupCoords} title="Your pickup point" anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={styles.pickupPin}>
                      <View style={styles.pickupPinDot} />
                    </View>
                  </Marker>
                )}
              </MapView>
            );
          })()}
          <View style={[styles.mapLiveBar, sharingLive && styles.mapLiveBarOn]}>
            <View style={[styles.mapLiveDot, sharingLive && styles.mapLiveDotOn]} />
            <Text style={styles.mapLiveBarText}>
              {sharingLive ? "Cab is moving - live location" : "Driver hasn't started sharing live location yet"}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatStatus(status) {
  return { assigned: "Confirmed", started: "Driver started", in_progress: "On the way", completed: "Completed" }[status] || status;
}

function fmtKm(km) {
  if (km == null) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

const DIR_LABEL = { toOffice: "Login", toHome: "Logout" };
function dirLabel(dir) {
  return DIR_LABEL[dir] || DIR_LABEL.toHome;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  fill: { flex: 1 },
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
  topLinks: { position: "absolute", top: spacing.lg, right: spacing.lg, zIndex: 2 },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  logout: { color: colors.textDim, fontSize: 13 },
  link: { color: colors.teal, fontSize: 13, fontWeight: "600" },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, margin: spacing.lg, marginTop: spacing.sm, padding: spacing.md },
  cardLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  statusValue: { color: colors.teal, fontSize: 17, fontWeight: "700" },
  cabTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  tripIdLine: { color: colors.teal, fontSize: 12, fontWeight: "700", marginTop: 4, letterSpacing: 0.5 },
  cabSub: { color: colors.textDim, fontSize: 13, marginTop: 4, lineHeight: 19 },
  etaValue: { color: colors.teal, fontSize: 24, fontWeight: "800" },
  etaBody: { color: colors.textDim, fontSize: 13, marginTop: 4, lineHeight: 19, textTransform: "none" },
  mapWrap: { height: 220, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden" },
  mapFill: { flex: 1 },
  liveMapBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: spacing.lg, marginTop: spacing.sm,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: spacing.md
  },
  liveMapBtnIcon: { fontSize: 20 },
  liveMapBtnTitle: { color: colors.teal, fontSize: 15, fontWeight: "700" },
  liveMapBtnSub: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
  liveMapBtnArrow: { color: colors.textDim, fontSize: 18, fontWeight: "700" },
  mapModalWrap: { flex: 1, backgroundColor: colors.bg },
  mapModalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  mapModalTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  mapModalClose: { color: colors.coral, fontSize: 14, fontWeight: "600" },
  mapModalFill: { flex: 1 },
  mapLiveBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.panel, paddingVertical: 12, paddingHorizontal: spacing.lg },
  mapLiveBarOn: { backgroundColor: "rgba(0,217,192,0.12)" },
  mapLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textDim },
  mapLiveDotOn: { backgroundColor: colors.teal },
  mapLiveBarText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  mapModalEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  mapModalEmptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  mapModalEmptyBody: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  cabMarker: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.teal,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5
  },
  cabMarkerText: { fontSize: 20 },
  pickupPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.violet,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3
  },
  pickupPinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  stopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 10 },
  stopRowMe: { backgroundColor: "rgba(139,124,246,0.10)", borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 5, marginHorizontal: -6 },
  stopDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.line, marginTop: 5 },
  stopAddress: { color: colors.text, fontSize: 14, fontWeight: "600" },
  stopMeta: { color: colors.textDim, fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  swipeSection: { alignItems: "center", marginVertical: spacing.xl },
  safeDropCard: { borderColor: colors.violet, backgroundColor: "rgba(124,96,227,0.08)", marginTop: 0 },
  safeDropTitle: { color: colors.violet, fontSize: 14, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  safeDropBody: { color: colors.text, fontSize: 13, marginTop: 6, lineHeight: 19 },
  safeDropConfirmed: { color: colors.violet, fontSize: 13, fontWeight: "600", marginTop: 10 },
  safeDropSwipe: { marginTop: spacing.md, alignItems: "center" },
  safeDropDeadline: { color: colors.textDim, fontSize: 12, marginTop: 10 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyBody: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 18 },
  bookBtn: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 28 },
  bookBtnText: { color: "#02201C", fontSize: 15, fontWeight: "700" },
  locBtn: { backgroundColor: colors.amber, marginTop: spacing.sm },
  waitGateCard: { width: "100%", alignItems: "center", borderRadius: radius.lg },
  waitGateBtn: { marginTop: spacing.md },
  pendingIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  pendingIcon: { color: "#1A1400", fontSize: 20, fontWeight: "800" },
  pendingCard: { borderColor: colors.amber, backgroundColor: "rgba(255,176,32,0.08)", marginTop: 0 },
  pendingTitle: { color: colors.amber, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  pendingBody: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  menuBtn: { width: 26, height: 24, justifyContent: "space-between", paddingVertical: 3, paddingRight: 4 },
  menuLine: { height: 3, borderRadius: 2, backgroundColor: colors.text },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.xl },
  menuSheet: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.line },
  menuTitle: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  menuItem: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line },
  menuItemText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  menuItemLogout: { color: colors.coral },
  callDriverBtn: { marginTop: 10, alignSelf: "flex-start", backgroundColor: colors.violet, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 14 },
  callDriverBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  escortBadge: { backgroundColor: "rgba(0,217,192,0.1)", borderWidth: 1, borderColor: colors.teal, borderRadius: radius.md, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: 12 },
  escortBadgeText: { color: colors.teal, fontSize: 13, fontWeight: "600" },
  otpFallbackHint: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: 8, fontStyle: "italic" },
  otpBox: { marginTop: 12, backgroundColor: "rgba(0,217,192,0.08)", borderWidth: 1, borderColor: colors.teal, borderRadius: radius.sm, padding: 12 },
  otpLabel: { color: colors.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "600" },
  otpValue: { color: colors.teal, fontSize: 28, fontWeight: "800", letterSpacing: 6, marginTop: 2 },
  otpHint: { color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  waitingBox: { alignItems: "center", backgroundColor: "rgba(255,176,32,0.10)", borderWidth: 1, borderColor: colors.amber, borderRadius: radius.md, padding: 16, marginHorizontal: spacing.lg },
  waitingTitle: { color: colors.amber, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  waitingBody: { color: colors.textDim, fontSize: 13, textAlign: "center", lineHeight: 18 },
  addressChangeInfo: { backgroundColor: "rgba(255,176,32,0.1)", borderWidth: 1, borderColor: colors.amber, borderRadius: radius.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: 10 },
  addressChangeText: { color: colors.amber, fontSize: 12, fontWeight: "600", textAlign: "center" }
});
