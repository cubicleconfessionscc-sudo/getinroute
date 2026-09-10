import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { schoolColors as colors, schoolSpacing as spacing, schoolRadius as radius } from "../../theme-school";

// School-branded login. This build is exclusively for school admins; if the
// signed-in account is not a school vertical account the session is discarded
// and the user is told why (the tolerant behavior of the shared app is not
// acceptable here - this is a separate product).
export default function SchoolLoginScreen() {
  const { login, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      if (user?.vertical !== "school") {
        await logout();
        Alert.alert("Not a school account", "This app is for School admins only. Log in with your school admin email.");
      }
    } catch (err) {
      const message = err?.response?.data?.message || "Login failed. Check your details.";
      Alert.alert("Couldn't log in", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.watermark} numberOfLines={1}>GetInRoute School</Text>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.badgeRow}>
          <View style={styles.capStripe}>
            <Text style={styles.capMark}>✕</Text>
          </View>
        </View>
        <Text style={styles.brand}>GetInRoute School</Text>
        <Text style={styles.tagline}>School transport control room</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>School admin email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="admin@school.edu"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <TouchableOpacity style={[styles.primaryButton, submitting && styles.buttonDisabled]} onPress={handleLogin} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? "Signing in..." : "Sign in to School"}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  watermark: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -48,
    textAlign: "center",
    fontSize: 84,
    fontWeight: "900",
    letterSpacing: -2,
    color: "rgba(13,148,136,0.06)",
    transform: [{ rotate: "-8deg" }]
  },
  container: { flex: 1, padding: spacing.lg, justifyContent: "center" },
  badgeRow: { flexDirection: "row", marginBottom: spacing.md },
  capStripe: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center"
  },
  capMark: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  brand: { color: colors.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.4 },
  tagline: { color: colors.textDim, fontSize: 14, marginTop: 6, marginBottom: spacing.xl },
  field: { marginBottom: spacing.md },
  fieldLabel: { color: colors.textDim, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
    color: colors.text,
    fontSize: 15
  },
  primaryButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.sm
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 }
});