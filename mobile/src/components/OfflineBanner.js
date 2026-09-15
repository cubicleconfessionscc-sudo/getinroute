import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { subscribeSync, pendingList } from "../services/offlineQueue";
import { colors, spacing, radius } from "../theme";

export default function OfflineBanner({ onOpenSync }) {
  const [sync, setSync] = useState(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const unsub = subscribeSync((s) => {
      setSync(s);
      if (!s.syncing) pendingList().then((l) => setCount(l.length)).catch(() => {});
    });
    return unsub;
  }, []);

  if (!sync) return null;
  if (sync.pending > 0) {
    return (
      <TouchableOpacity style={[styles.banner, { backgroundColor: colors.amber }]} onPress={onOpenSync} activeOpacity={0.85}>
        <Text style={styles.strong}>Offline</Text>
        <Text style={styles.text} numberOfLines={2}>
          {count} saved on this device await sync. Tap to review.
        </Text>
      </TouchableOpacity>
    );
  }
  if (!sync.online) {
    return (
      <View style={[styles.banner, { backgroundColor: "#8B93A6" }]}>
        <Text style={styles.strong}>Offline</Text>
        <Text style={styles.text}>Showing last-known data. Reconnecting…</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginBottom: spacing.sm, borderRadius: radius.md },
  strong: { color: "#fff", fontWeight: "800", fontSize: 13 },
  text: { color: "#fff", flex: 1, fontSize: 12, lineHeight: 16 }
});