import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { colors, radius, spacing } from "../../theme";

// Company app is for employees and drivers only. Anyone else who signs in
// (admin, vendor, unknown role) gets this screen instead of a blank white
// void - a clear message plus a working sign out, so they can switch to the
// right account or surface the issue instead of staring at nothing.
export default function UnsupportedRoleScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>GetInRoute</Text>
      <Text style={styles.title}>No experience here yet</Text>
      <Text style={styles.body}>
        This app is for employees and drivers. Admins run their transport
        operation from the web portal at getinroute.in.
      </Text>
      {user?.role ? <Text style={styles.role}>Signed in as: {user.role}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={() => logout()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl
  },
  brand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  title: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: spacing.xl },
  body: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 21, marginTop: spacing.sm, maxWidth: 320 },
  role: { color: colors.textDim, fontSize: 12, marginTop: spacing.lg },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: spacing.xl
  },
  buttonText: { color: "#02201C", fontSize: 15, fontWeight: "700" }
});