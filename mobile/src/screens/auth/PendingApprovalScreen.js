import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, spacing, radius } from "../../theme";

export default function PendingApprovalScreen({ navigation, route }) {
  const email = route?.params?.email;

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeIcon}>⏳</Text>
      </View>
      <Text style={styles.title}>Awaiting admin approval</Text>
      <Text style={styles.body}>
        Your registration{email ? ` for ${email}` : ""} has been submitted. You'll get an
        email as soon as your transport admin approves your account — then you can sign in.
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => navigation.replace("Login")}>
        <Text style={styles.buttonText}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  badge: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(255,176,32,0.12)",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg
  },
  badgeIcon: { fontSize: 30 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: spacing.sm, textAlign: "center" },
  body: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 21, marginBottom: spacing.xl },
  button: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 28 },
  buttonText: { color: colors.text, fontWeight: "600", fontSize: 14 }
});
