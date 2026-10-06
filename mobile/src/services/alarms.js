// =============================================================================
// Trip alarm service (local scheduled alarms with sound).
//
// Shared by Employee and Driver apps. Uses expo-notifications LOCAL
// scheduling only - no FCM/APNs, no backend change, no Admin/Vendor change.
//
// Employee: "Pickup alarm" - rings X minutes before pickup.
// Driver: "Trip start alarm" - rings X minutes before trip start.
//
// IMPORTANT (blank-screen protection): expo-notifications / expo-secure-store
// are NATIVE modules. They are acquired lazily via require() in try/catch so
// a missing native disables alarms instead of killing the bundle.
// =============================================================================

const ALARM_ENABLED_KEY = "gir_alarm_enabled";
const ALARM_MINUTES_KEY = "gir_alarm_minutes_before";
const ALARM_SOUND_KEY = "gir_alarm_sound";

export const ALARM_MINUTE_OPTIONS = [5, 15, 30];
export const DEFAULT_ALARM_MINUTES = 15;

let NotificationsModule = null;
let SecureStoreModule = null;

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

function requireSecureStore() {
  if (SecureStoreModule === null) {
    try {
      SecureStoreModule = require("expo-secure-store");
    } catch {
      SecureStoreModule = false;
    }
  }
  return SecureStoreModule;
}

async function storeGet(key) {
  try {
    const store = requireSecureStore();
    if (!store) return null;
    return await store.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeSet(key, value) {
  try {
    const store = requireSecureStore();
    if (!store) return;
    await store.setItemAsync(key, value);
  } catch {
    // best-effort
  }
}

export async function getAlarmEnabled() {
  const raw = await storeGet(ALARM_ENABLED_KEY);
  // Default ON so first-time users get pickup alarms without setup.
  if (raw === null) return true;
  return raw === "true";
}

export async function setAlarmEnabled(enabled) {
  await storeSet(ALARM_ENABLED_KEY, enabled ? "true" : "false");
  return !!enabled;
}

export async function getAlarmMinutesBefore() {
  const raw = await storeGet(ALARM_MINUTES_KEY);
  const n = Number(raw);
  if (ALARM_MINUTE_OPTIONS.includes(n)) return n;
  return DEFAULT_ALARM_MINUTES;
}

export async function setAlarmMinutesBefore(minutes) {
  const n = Number(minutes);
  const safe = ALARM_MINUTE_OPTIONS.includes(n) ? n : DEFAULT_ALARM_MINUTES;
  await storeSet(ALARM_MINUTES_KEY, String(safe));
  return safe;
}

export async function getAlarmSound() {
  const raw = await storeGet(ALARM_SOUND_KEY);
  if (raw === null) return true;
  return raw === "true";
}

export async function setAlarmSound(enabled) {
  await storeSet(ALARM_SOUND_KEY, enabled ? "true" : "false");
  return !!enabled;
}

export async function getAlarmSettings() {
  const [enabled, minutesBefore, sound] = await Promise.all([
    getAlarmEnabled(),
    getAlarmMinutesBefore(),
    getAlarmSound(),
  ]);
  return { enabled, minutesBefore, sound };
}

async function ensureAlarmChannel() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return false;
    const { Platform } = require("react-native");
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("trip-alarms", {
        name: "Trip alarms",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: "#1769E0",
        sound: "default",
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureAlarmPermission() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return false;
    await ensureAlarmChannel();
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

// Schedule a one-shot alarm at an absolute Date. Returns the notification id
// or null when alarms are unavailable/disabled. Never throws.
export async function scheduleTripAlarm(when, title, body, alarmKey = null) {
  try {
    const { enabled, sound } = await getAlarmSettings();
    if (!enabled) return null;
    const Notifications = requireNotifications();
    if (!Notifications) return null;
    const ok = await ensureAlarmPermission();
    if (!ok) return null;
    const key = alarmKey == null ? null : String(alarmKey);
    if (key && typeof Notifications.getAllScheduledNotificationsAsync === "function") {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const existing = scheduled.find((item) => item?.content?.data?.getinrouteAlarm === true && item?.content?.data?.alarmKey === key);
      if (existing) return existing.identifier;
    }
    const date = when instanceof Date ? when : new Date(when);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: String(title || "Trip alarm"),
        body: String(body || "Your trip starts soon."),
        sound: sound ? "default" : undefined,
        data: { getinrouteAlarm: true, alarmKey: key },
      },
      trigger: { type: "date", date },
    });
    return id;
  } catch {
    return null;
  }
}

// Convenience: schedule X minutes before a trip/pickup ISO datetime using the
// user's saved "minutes before" preference. No-op when disabled. Never throws.
export async function scheduleAlarmBefore(tripDateTime, { title, body, alarmKey } = {}) {
  try {
    const { enabled, minutesBefore } = await getAlarmSettings();
    if (!enabled) return null;
    const trip = new Date(tripDateTime);
    if (isNaN(trip.getTime())) return null;
    const when = new Date(trip.getTime() - minutesBefore * 60 * 1000);
    if (when.getTime() <= Date.now()) return null;
    return await scheduleTripAlarm(
      when,
      title || "Pickup alarm",
      body || `Your pickup is in ${minutesBefore} minutes.`,
      alarmKey
    );
  } catch {
    return null;
  }
}

// Test button: fires an alarm in ~5 seconds so the user can hear it.
export async function testAlarm() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return { ok: false, reason: "notifications-unavailable" };
    const ok = await ensureAlarmPermission();
    if (!ok) return { ok: false, reason: "permission-denied" };
    const { sound } = await getAlarmSettings();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Test alarm",
        body: "If you hear/see this, trip alarms work on this phone.",
        sound: sound ? "default" : undefined,
        data: { getinrouteAlarm: true, alarmKey: `test-${Date.now()}` },
      },
      trigger: { type: "timeInterval", seconds: 5 },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

export async function cancelAllTripAlarms() {
  try {
    const Notifications = requireNotifications();
    if (!Notifications) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const alarms = scheduled.filter((item) => item?.content?.data?.getinrouteAlarm === true);
    await Promise.all(alarms.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  } catch {
    // best-effort
  }
}
