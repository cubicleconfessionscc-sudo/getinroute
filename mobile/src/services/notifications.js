import { Platform } from "react-native";
import { TRIP_ASSIGNED_MESSAGE } from "./voice";

// =============================================================================
// Local notification support for trip events.
//
// Remote push (FCM/APNs) is not configured yet, so we surface assignment
// changes with a LOCAL notification. Because a local notification can only be
// scheduled by code running in the foreground, the DriverHomeScreen schedules
// it the moment it detects a new assignment. This gives a visible banner even
// if the driver then backgrounds the app, alongside the TTS in the foreground.
//
// IMPORTANT (blank-screen protection): expo-notifications is a NATIVE module.
// A static `import * as Notifications from "expo-notifications"` evaluates at
// bundle load and throws if the installed binary predates the module, taking
// down the whole app below React's ErrorBoundary (blank white screen). The
// handler is registered lazily and every native call is guarded, so a missing
// native simply disables notifications instead of killing the app.
// =============================================================================

// Lazily-acquired native module. null => unavailable, false => failed to load.
let NotificationsModule = null;

function requireNotifications() {
  if (NotificationsModule === null) {
    try {
      NotificationsModule = require("expo-notifications");
    } catch {
      NotificationsModule = false;
    }
  }
  return NotificationsModule;
}

// The handler must be registered at app start for local notifications to show.
// Registered defensively so a native-module mismatch can never take down the
// bundle at import time.
function registerNotificationHandler() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false
      })
    });
  } catch {
    // Best-effort: if the native side is unavailable, notifications simply
    // don't show; the rest of the app must keep working.
  }
}

registerNotificationHandler();

export async function ensureNotificationPermission() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return false;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("trips", {
        name: "Trip updates",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#00D9C0"
      });
    }
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    const request = await Notifications.requestPermissionsAsync();
    return request.granted || request.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

// Best-effort local banner for a trip assignment. Never throws; failures are
// silently ignored so they can't disturb the app flow.
export async function notifyTripAssigned() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return;
    const permitted = await ensureNotificationPermission();
    if (!permitted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Trip updated",
        body: TRIP_ASSIGNED_MESSAGE,
        sound: "default"
      },
      trigger: null
    });
  } catch {
    // Local notifications are best-effort.
  }
}

// Best-effort local banner right after a cab request is submitted.
export async function notifyTripBooked() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return;
    const permitted = await ensureNotificationPermission();
    if (!permitted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Booking submitted",
        body: "Your cab request has been submitted for approval.",
        sound: "default"
      },
      trigger: null
    });
  } catch {
    // Local notifications are best-effort.
  }
}

// Best-effort local banner for an incoming chat message (item 9). Called from
// the home screens when the backend emits 'chat:incoming', so chat pings for
// the OTHER direction (driver -> employee, employee -> driver) surface with a
// banner + sound even though remote push (FCM/APNs) is not configured yet.
export async function notifyChatMessage(fromLabel, text) {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return;
    const permitted = await ensureNotificationPermission();
    if (!permitted) return;
    const from = String(fromLabel || "Trip member").slice(0, 40);
    const body = String(text || "").slice(0, 140);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `New message from ${from}`,
        body: body || "Tap to open the trip chat.",
        sound: "default"
      },
      trigger: null
    });
  } catch {
    // Local notifications are best-effort.
  }
}