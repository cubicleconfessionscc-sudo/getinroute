import * as Location from "expo-location";
import { Alert } from "react-native";
import { sendLocationUpdate, getTrackingIntervalMs, onTrackingConfig } from "./socket";

let watchSubscription = null;
let activeTripId = null;
let stopConfigListener = null;

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
export async function getFreshPosition(timeoutMs = 9000) {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== "granted") return null;
    }
    let timer = null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]).catch(() => null);
    if (timer) clearTimeout(timer);
    let p = pos;
    if (!p) {
      // Only accept a last-known fix if it is very recent (< 20s).
      p = await Location.getLastKnownPositionAsync({ maxAge: 20000 }).catch(() => null);
    }
    if (!p || !p.coords) return null;
    const { latitude, longitude, accuracy } = p.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lng: longitude, accuracy: accuracy ?? null };
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

  // Check if we already have background permission
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    // Show the prominent disclosure dialog (Google Play requirement)
    const allowed = await showLocationDisclosure();
    if (!allowed) {
      throw new Error("Background location is needed so cab tracking works when your phone is locked.");
    }
    // Now request the actual OS background permission
    const bgResult = await Location.requestBackgroundPermissionsAsync();
    if (bgResult.status !== "granted") {
      throw new Error("Background location permission denied. Cab tracking will stop when your screen turns off.");
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
