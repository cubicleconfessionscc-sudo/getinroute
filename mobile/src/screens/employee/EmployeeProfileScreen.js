import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { colors, spacing, radius, shadow } from "../../theme";
import EmployeeBottomNav from "../../components/EmployeeBottomNav";

function Row({ icon, label, sub, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.rowIcon}><Text style={{ fontSize: 18 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.coral }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {!danger && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

export default function EmployeeProfileScreen({ navigation }) {
  const { user, logout } = useAuth();
  const empId = user?.emp_id || user?.id || "—";

  const confirmLogout = () => {
    Alert.alert("Sign out?", "You will need to sign in again to book trips.", [
      { text: "Stay", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout }
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.fill} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.header}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || "E")[0]}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name || "Employee"}</Text>
            <Text style={styles.meta}>Employee ID {empId}</Text>
            {user?.department ? <Text style={styles.meta}>{user.department}</Text> : null}
          </View>
        </View>

        <Text style={styles.groupTitle}>Support</Text>
        <View style={styles.card}>
          <Row icon="🎫" label="Support Requests" onPress={() => navigation.navigate("Help")} />
          <Row icon="📜" label="Trip History" onPress={() => navigation.navigate("EmployeeHistory")} />
          <Row icon="💬" label="Help & Feedback" onPress={() => navigation.navigate("Feedback")} />
        </View>

        <Text style={styles.groupTitle}>Preferences</Text>
        <View style={styles.card}>
          <Row icon="📅" label="Weekly Offs" sub="Choose your rest days" onPress={() => navigation.navigate("EmployeeSchedule")} />
          <Row icon="🏠" label="My Address" sub="Pickup & drop locations" onPress={() => navigation.navigate("EmployeeLocations")} />
        </View>

        <Text style={styles.groupTitle}>More</Text>
        <View style={styles.card}>
          <Row icon="🔔" label="Notifications" onPress={() => navigation.navigate("Settings")} />
          <Row icon="⚙️" label="Settings" onPress={() => navigation.navigate("Settings")} />
          <Row icon="📄" label="Terms of Usage" onPress={() => Linking.openURL("https://www.getinroute.in/terms").catch(() => {})} />
          <Row icon="🚪" label="Sign out" danger onPress={confirmLogout} />
        </View>

        <Text style={styles.version}>GetInRoute · v1.0.0</Text>
      </ScrollView>

      <EmployeeBottomNav navigation={navigation} active="profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: spacing.lg, backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 26, fontWeight: "800" },
  name: { color: colors.text, fontSize: 20, fontWeight: "800" },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  groupTitle: { color: colors.textDim, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: 8, marginHorizontal: spacing.lg },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, marginHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.card },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 22, fontWeight: "300" },
  version: { textAlign: "center", color: colors.textDim, fontSize: 12, marginTop: spacing.xl }
});
