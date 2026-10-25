import * as Location from "expo-location";
import { Alert } from "react-native";
import { sendLocationUpdate, getTrackingIntervalMs, onTrackingConfig } from "./socket";

let watchSubscription = null;
let activeTripId = null;
let stopConfigListener = null;

// Remembers that the driver already declined background location so the OS
// dialog is never repeated on every trip. Stored outside the secure store
// because it is a non-sensitive UX preference (falls back silently).
const BG_DECLINED_KEY = "gir_bg_location_declined";
let bgDeclinedCache = null;
async function readBgDeclined() {
  if (bgDeclinedCache != null) return bgDeclinedCache;
  try {
    const SecureStore = require("expo-secure-store");
    bgDeclinedCache = (await SecureStore.getItemAsync(BG_DECLINED_KEY)) === "1";
  } catch {
    bgDeclinedCache = false;
  }
  return bgDeclinedCache;
}
async function writeBgDeclined() {
  bgDeclinedCache = true;
  try {
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync(BG_DECLINED_KEY, "1");
  } catch { /* best-effort */ }
}

/**
 * Shows Google's required prominent-disclosure dialog before requesting
 * background location. Returns true if the user tapped Allow, false on Cancel.
 */
export function showLocationDisclosure() {
  return new Promise((resolve) => {
    Alert.alert(
      "Background location access",
      "GetInRoute needs background location during active cab trips so that live GPS tracking continues to work when your phone screen is off or the app is in the background. This lets employees see your cab's real-time position on the map while they wait for pickup.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Allow", onPress: () => resolve(true) }
      ]
    );
  });
}

/**
 * Returns a FRESH device GPS fix at the moment of a check-in / check-out so the
 * action is geotagged with where the passenger actually was. Falls back to a
 * very recent last-known position only if a live fix cannot be obtained within
 * the timeout. Returns null (never a stale/wrong coordinate) when location is
 * unavailable or permission is denied — callers must handle that explicitly.
 */
export async function getFreshPosition(timeoutMs = 12000) {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== "granted") return null;
    }
    // Only ever use a live fix obtained NOW. A cached / last-known position is
    // deliberately NOT used, because a check-in/check-out must be geotagged
    // with where the passenger actually was at that moment. If no fresh fix is
    // available we return null and the caller tells the user to retry — we
    // never silently attach a stale or fake coordinate.
    let timer = null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]).catch(() => null);
    if (timer) clearTimeout(timer);
    if (!pos || !pos.coords) return null;
    const { latitude, longitude, accuracy } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    // Reject a fix the OS marked as stale (older than 15s) if the provider
    // reports an age — expo-location exposes `mocked` but not age on all
    // platforms, so this is best-effort.
    if (pos.mocked) return null;
    return { lat: latitude, lng: longitude, accuracy: accuracy ?? null };
  } catch (_) {
    return null;
  }
}

/**
 * Returns the device position WITHOUT ever showing a permission prompt.
 * Used to geotag sign-in/sign-out when the user has already allowed location
 * (which the employee/driver flows require anyway). Returns null when the
 * permission is not granted or no fix is available in time.
 */
export async function getQuietPosition() {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60 * 1000 }).catch(() => null);
    if (last && last.coords && Number.isFinite(last.coords.latitude) && Number.isFinite(last.coords.longitude)) {
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    let timer = null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 4000); })
    ]).catch(() => null);
    if (timer) clearTimeout(timer);
    if (!pos || !pos.coords) return null;
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lng: longitude };
  } catch (_) {
    return null;
  }
}

/**
 * Starts watching the driver's GPS position and streams lat/lng + current
 * speed (converted from m/s to km/h) to the server every ~4 seconds or
 * every 20 meters, whichever comes first. This is what powers both the
 * live map and the speed-limit alert on the backend.
 *
 * Uses BACKGROUND location so tracking continues when the driver locks
 * their phone while driving.
 */
export async function startDriverTracking(tripId) {
  // Foreground permission (always needed first)
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    throw new Error("Location permission is required to start a trip.");
  }

  // Background permission is asked at most once. If the driver declines, we
  // continue with foreground tracking (the screen is kept awake during a trip)
  // instead of re-showing the same OS dialog on every single trip.
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== "granted" && !(await readBgDeclined())) {
    const allowed = await showLocationDisclosure();
    if (allowed) {
      const bgResult = await Location.requestBackgroundPermissionsAsync();
      if (bgResult.status !== "granted") await writeBgDeclined();
    } else {
      await writeBgDeclined();
    }
  }

  await stopDriverTracking(); // avoid double subscriptions

  // Use the adaptive GPS ping interval (ms) published by the server via
  // "tracking:config". The server raises it under load to keep the free-tier
  // realtime budget healthy, and lowers it when few drivers are online.
  activeTripId = tripId;
  await startWatch(tripId, getTrackingIntervalMs());

  // If the server adjusts the interval mid-trip (load changed), silently
  // restart the watcher at the new rate so the ping stays in sync.
  stopConfigListener = onTrackingConfig(() => {
    const interval = getTrackingIntervalMs();
    if (activeTripId && watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
      startWatch(activeTripId, interval).catch(() => {});
    }
  });
}

async function startWatch(tripId, intervalMs) {
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
  }
  watchSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: intervalMs,
      distanceInterval: 20
    },
    (position) => {
      const { latitude, longitude, speed } = position.coords;
      // expo-location reports speed in meters/second; convert to km/h.
      const speedKmph = speed && speed > 0 ? Math.round(speed * 3.6) : 0;
      sendLocationUpdate(tripId, latitude, longitude, speedKmph);
    }
  );
}

export async function stopDriverTracking() {
  if (stopConfigListener) {
    stopConfigListener();
    stopConfigListener = null;
  }
  activeTripId = null;
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
  }
}
