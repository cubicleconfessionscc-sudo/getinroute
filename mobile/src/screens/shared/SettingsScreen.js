import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ScrollView, TouchableOpacity, Alert } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "../../context/AuthContext";
import { getVoiceEnabled, setVoiceEnabled } from "../../services/voice";
import {
  ALARM_MINUTE_OPTIONS,
  getAlarmSettings,
  setAlarmEnabled,
  setAlarmMinutesBefore,
  setAlarmSound,
  testAlarm,
  cancelAllTripAlarms,
} from "../../services/alarms";
import { subscribeSync, pendingList } from "../../services/offlineQueue";
import { colors, spacing, radius } from "../../theme";

// Real version info from the build: prefer the NATIVE app version / build
// number (expo-constants), and fall back to the embedded app config's version
// and android.versionCode. Never a hardcoded/fake number.
const buildDisplay = (() => {
  const cfg = Constants.expoConfig || {};
  const ver = Constants.nativeAppVersion || cfg.version || "?";
  const build =
    Constants.nativeBuildVersion ||
    (cfg.android && cfg.android.versionCode != null ? String(cfg.android.versionCode) : null) ||
    "?";
  return `v${ver} (build ${build})`;
})();

export default function SettingsScreen({ navigation }) {
  const { user } = useAuth() || {};
  const role = user?.role === "driver" ? "driver" : "employee";
  const [voiceEnabled, setVoice] = useState(true);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState(null);
  const [alarmEnabled, setAlarm] = useState(true);
  const [alarmMinutes, setAlarmMinutes] = useState(15);
  const [alarmSound, setSound] = useState(true);
  const [alarmReady, setAlarmReady] = useState(false);
  const [alarmMsg, setAlarmMsg] = useState("");

  useEffect(() => {
    (async () => {
      const current = await getVoiceEnabled();
      setVoice(current);
      setReady(true);
      try {
        const a = await getAlarmSettings();
        setAlarm(a.enabled);
        setAlarmMinutes(a.minutesBefore);
        setSound(a.sound);
      } catch {}
      setAlarmReady(true);
    })();
    const unsub = subscribeSync((s) => setSync(s));
    return unsub;
  }, []);

  async function toggleVoice(value) {
    setVoice(value);
    try {
      await setVoiceEnabled(value);
    } catch {
      // Persist is best-effort; revert in-memory value on failure.
      setVoice(!value);
    }
  }

  async function toggleAlarm(value) {
    setAlarm(value);
    try {
      await setAlarmEnabled(value);
      setAlarmMsg(value ? "Trip alarms ON." : "Trip alarms OFF.");
    } catch {
      setAlarm(!value);
    }
  }

  async function pickMinutes(m) {
    setAlarmMinutes(m);
    try {
      await setAlarmMinutesBefore(m);
      setAlarmMsg(`Alarm will ring ${m} min before pickup.`);
    } catch {}
  }

  async function toggleSound(value) {
    setSound(value);
    try {
      await setAlarmSound(value);
    } catch {
      setSound(!value);
    }
  }

  async function onTestAlarm() {
    setAlarmMsg("Test alarm in 5 sec — keep the app open…");
    const r = await testAlarm();
    if (r?.ok) {
      setAlarmMsg("Test alarm scheduled — you should hear/see it in 5 sec.");
    } else if (r?.reason === "permission-denied") {
      Alert.alert("Notifications blocked", "Allow notifications in Settings to hear trip alarms.");
      setAlarmMsg("Permission denied — enable notifications and retry.");
    } else {
      setAlarmMsg("Could not schedule alarm on this device.");
    }
  }

  async function onCancelAlarms() {
    await cancelAllTripAlarms();
    setAlarmMsg("All scheduled trip alarms cancelled.");
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.group}>
        <Text style={styles.rowLabel}>⏰ Trip alarm ({role === "driver" ? "Driver" : "Employee"})</Text>
        <Text style={styles.rowHint}>
          {role === "driver"
            ? "Rings before your assigned trip starts, with sound + banner."
            : "Rings before your pickup, with sound + banner."}
        </Text>
        {alarmReady && (
          <>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Alarm ON/OFF</Text>
                <Text style={styles.rowHint}>Turn pickup/trip reminders on or off.</Text>
              </View>
              <Switch
                value={alarmEnabled}
                onValueChange={toggleAlarm}
                trackColor={{ false: colors.line, true: colors.teal }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              {ALARM_MINUTE_OPTIONS.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => pickMinutes(m)}
                  style={[styles.chip, alarmMinutes === m && styles.chipActive]}
                >
                  <Text style={[styles.chipText, alarmMinutes === m && styles.chipTextActive]}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Alarm sound</Text>
                <Text style={styles.rowHint}>Play sound with the alarm banner.</Text>
              </View>
              <Switch
                value={alarmSound}
                onValueChange={toggleSound}
                trackColor={{ false: colors.line, true: colors.teal }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <TouchableOpacity onPress={onTestAlarm} style={[styles.btn, styles.btnPrimary]}>
                <Text style={styles.btnPrimaryText}>Test alarm (5 sec)</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onCancelAlarms} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostText}>Cancel all</Text>
              </TouchableOpacity>
            </View>
            {!!alarmMsg && <Text style={styles.rowHint}>{alarmMsg}</Text>}
          </>
        )}
      </View>

      <View style={styles.group}>
        <TouchableOpacity
          style={styles.syncRow}
          onPress={() => navigation && navigation.navigate("PendingSync")}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Pending sync</Text>
            <Text style={styles.rowHint}>
              {sync == null
                ? "Checking queued offline actions…"
                : sync.pending > 0
                  ? `${sync.pending} offline action${sync.pending === 1 ? "" : "s"} waiting. Tap to review and sync.`
                  : "All caught up — nothing waiting."}
            </Text>
          </View>
          <Text style={{ color: sync && sync.pending > 0 ? colors.amber : colors.textDim, fontSize: 16, fontWeight: "700" }}>
            {sync != null && sync.pending > 0 ? `${sync.pending} ›` : "✓"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.group}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Voice announcements</Text>
            <Text style={styles.rowHint}>
              Play a spoken confirmation at key trip events, like when your
              schedule is created (employees) or a trip is assigned (drivers).
            </Text>
          </View>
          {ready && (
            <Switch
              value={voiceEnabled}
              onValueChange={toggleVoice}
              trackColor={{ false: colors.line, true: colors.teal }}
              thumbColor="#FFFFFF"
            />
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{`GetInRoute ${buildDisplay}`}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: spacing.lg },
  group: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  syncRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowHint: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, backgroundColor: colors.panel },
  chipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: "#FFFFFF" },
  btn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginRight: 8, marginTop: 4 },
  btnPrimary: { backgroundColor: colors.teal },
  btnPrimaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  btnGhostText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  footer: { marginTop: spacing.xl, alignItems: "center" },
  footerText: { color: colors.textDim, fontSize: 12 }
});