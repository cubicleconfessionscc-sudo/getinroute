import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { subscribeSync, pendingList, flush, clearPending } from "../../services/offlineQueue";
import { colors, spacing, radius } from "../../theme";

export default function PendingSyncScreen() {
  const [sync, setSync] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await pendingList());
  }, []);

  useEffect(() => {
    const unsub = subscribeSync((s) => setSync(s));
    refresh();
    return unsub;
  }, [refresh]);

  const retryNow = async () => {
    setBusy(true);
    const synced = await flush();
    setBusy(false);
    if (synced > 0) refresh();
    return synced;
  };

  const clearAll = async () => {
    await clearPending();
    await refresh();
  };

  const methodColor = (m) => ({ POST: colors.teal, PUT: "#f59e0b", DELETE: colors.coral }[m] || colors.textDim);
  const [syncDot, setSyncDot] = useState("#94A3B8");

  useEffect(() => {
    const unsub = subscribeSync((s) => {
      setSync(s);
      setSyncDot(s ? (s.pending ? colors.amber : colors.teal) : "#94A3B8");
    });
    refresh();
    return unsub;
  }, [refresh]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.ip}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: syncDot }]} />
          <Text style={styles.statusText}>
            {sync == null
              ? "Checking…"
              : sync.pending > 0
                ? `${sync.pending} action${sync.pending === 1 ? "" : "s"} waiting to sync`
                : "All caught up"}
          </Text>
        </View>
        {sync && sync.pending > 0 && (
          <Text style={styles.hint}>
            These were saved on your device while you were offline. They will send automatically when your connection
            returns; you can also trigger them now.
          </Text>
        )}
      </View>

      {sync && sync.pending > 0 && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={retryNow} disabled={busy || sync.syncing}>
            {busy || sync.syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Sync now</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={clearAll}>
            <Text style={styles.btnGhostText}>Discard pending</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.group}>
        {items.length === 0 ? (
          <Text style={styles.empty}>No offline actions queued.</Text>
        ) : (
          items.map((it) => (
            <View key={it.id} style={styles.row}>
              <View style={styles.left}>
                <Text style={[styles.method, { color: methodColor(it.method) }]}>{it.method}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.url} numberOfLines={1}>{it.url.replace(/^https?:\/\/[^/]+/, "")}</Text>
                  <Text style={styles.meta}>
                    {new Date(it.ts).toLocaleString()} · attempt {it.attempts + 1}
                    {it.attempts >= 6 ? " · give up, retries paused" : ""}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  ip: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 8 },
  actions: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  btn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: radius.md },
  btnPrimary: { backgroundColor: colors.teal },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.line },
  btnGhostText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  group: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.sm },
  row: { padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  left: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  method: { fontSize: 12, fontWeight: "800", fontFamily: "monospace", width: 52 },
  url: { color: colors.text, fontSize: 13 },
  meta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  empty: { color: colors.textDim, fontSize: 14, padding: spacing.md }
});