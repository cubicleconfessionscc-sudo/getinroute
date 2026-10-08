import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { getNotifications, markNotificationsRead } from "../../api/notifications";
import { connectSocket } from "../../services/socket";
import { colors, spacing, radius } from "../../theme";

export default function NotificationsScreen() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getNotifications();
      setItems(Array.isArray(r?.notifications) ? r.notifications : []);
      setUnread(Number(r?.unread) || 0);
    } catch { /* keep last-known */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let sock;
    (async () => { sock = await connectSocket(); sock.on("notification", () => load()); })();
    return () => { sock?.off("notification"); };
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const markAll = async () => { await markNotificationsRead(); load(); };
  const markOne = async (id) => { await markNotificationsRead([id]); load(); };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.headText}>{unread > 0 ? `${unread} unread` : "All caught up"}</Text>
        {unread > 0 && <TouchableOpacity onPress={markAll}><Text style={styles.markAll}>Mark all read</Text></TouchableOpacity>}
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, !item.read && styles.rowUnread]} onPress={() => !item.read && markOne(item.id)} activeOpacity={0.8}>
            <View style={[styles.dot, item.read ? styles.dotRead : styles.dotUnread]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.message}</Text>
              <Text style={styles.time}>{item.created_at}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  markAll: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  row: { flexDirection: "row", gap: 10, backgroundColor: colors.panel, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  rowUnread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
  dotUnread: { backgroundColor: colors.primary },
  dotRead: { backgroundColor: colors.line },
  title: { color: colors.text, fontSize: 14, fontWeight: "800" },
  body: { color: colors.textDim, fontSize: 13, marginTop: 3, lineHeight: 18 },
  time: { color: colors.textDim, fontSize: 11, marginTop: 5 },
  empty: { textAlign: "center", color: colors.textDim, marginTop: 40 }
});
