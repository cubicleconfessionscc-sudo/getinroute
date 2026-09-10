import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import * as authApi from "../../api/auth";
import { colors, spacing, radius } from "../../theme";

export default function ResetPasswordScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email || !token) {
      Alert.alert("Missing details", "Enter your email and the reset code from the email we sent you.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak password", "Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", "Re-enter the same password in both fields.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(email.trim(), token.trim(), password);
      Alert.alert("Password updated", "You can now sign in with your new password.", [
        { text: "OK", onPress: () => navigation.replace("Login") }
      ]);
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        "The reset code is invalid or has expired. Request a new one from the login screen.";
      Alert.alert("Couldn't reset password", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.body}>
          Enter your email, the reset code from the email we sent (it's the token after "token=" in the
          link), and a new password.
        </Text>

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
          <Text style={styles.fieldLabel}>Reset code</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste the token from the email"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>New password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Confirm password</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder="Repeat the new password"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Saving..." : "Update password"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.lg, justifyContent: "center", flexGrow: 1 },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  field: { marginBottom: spacing.md },
  fieldLabel: { color: colors.textDim, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, color: colors.text, fontSize: 15
  },
  primaryButton: { backgroundColor: colors.teal, borderRadius: radius.md, padding: 16, alignItems: "center" },
  primaryButtonText: { color: "#02201C", fontWeight: "700", fontSize: 15 },
  link: { color: colors.amber, fontSize: 13, fontWeight: "600", marginTop: spacing.lg, textAlign: "center" }
});
