import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { colors, spacing, radius } from "../../theme";

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
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
      await login(email.trim(), password);
      // Navigation to the right home screen (employee/driver) is handled
      // by the root navigator based on the logged-in user's role.
    } catch (err) {
      const message = err?.response?.data?.message || "Login failed. Check your details.";
      Alert.alert("Couldn't log in", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.watermark} numberOfLines={1}>GetInRoute</Text>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={styles.brand}>GetInRoute</Text>
        <Text style={styles.tagline}>Sign in to continue your commute</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@company.com"
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

        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Signing in..." : "Sign in"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")}>
          <Text style={styles.link}>Forgot password?</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New here? </Text>
          <TouchableOpacity onPress={() => navigation.navigate("Register")}>
            <Text style={styles.link}>Create an account</Text>
          </TouchableOpacity>
        </View>
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
    fontSize: 110,
    fontWeight: "900",
    letterSpacing: -4,
    color: "rgba(0,217,192,0.055)",
    transform: [{ rotate: "-8deg" }]
  },
  container: { flex: 1, padding: spacing.lg, justifyContent: "center" },
  brand: { color: colors.text, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
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
  primaryButtonText: { color: "#02201C", fontWeight: "700", fontSize: 15 },
  link: { color: colors.amber, fontSize: 13, fontWeight: "600", marginTop: spacing.md, textAlign: "center" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  footerText: { color: colors.textDim, fontSize: 13 }
});
