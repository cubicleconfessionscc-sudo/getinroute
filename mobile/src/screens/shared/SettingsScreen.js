import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ScrollView, TouchableOpacity } from "react-native";
import Constants from "expo-constants";
import { getVoiceEnabled, setVoiceEnabled } from "../../services/voice";
import { subscribeSync, pendingList } from "../../services/offlineQueue";
import { colors, spacing, radius } from "../../theme";

const buildDisplay =
  Constants.expoConfig != null
    ? `v${Constants.expoConfig.version} (build ${Constants.nativeBuildVersion || "?"})`
    : "";

export default function SettingsScreen({ navigation }) {
  const [voiceEnabled, setVoice] = useState(true);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState(null);

  useEffect(() => {
    (async () => {
      const current = await getVoiceEnabled();
      setVoice(current);
      setReady(true);
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

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

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
  footer: { marginTop: spacing.xl, alignItems: "center" },
  footerText: { color: colors.textDim, fontSize: 12 }
});