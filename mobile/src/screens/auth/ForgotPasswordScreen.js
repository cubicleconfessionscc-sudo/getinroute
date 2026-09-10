import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import * as authApi from "../../api/auth";
import { colors, spacing, radius } from "../../theme";

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert("Enter your email", "We need your email to send the reset link.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      Alert.alert("Invalid email", "Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.forgotPassword(trimmed);
      setSent(true);
    } catch (err) {
      const message = err?.response?.data?.message || "Could not send the reset link. Please try again.";
      Alert.alert("Something went wrong", message);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          If {email.trim()} is registered, we've sent a password reset email with a reset code.
          Open the link to view the code (the part after "token="), then use it on the
          "Set a new password" screen to continue here in the app.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.replace("ResetPassword")}
        >
          <Text style={styles.buttonText}>I have the code — set a new password</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSpacing]}
          onPress={() => navigation.replace("Login")}
        >
          <Text style={styles.buttonText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.body}>Enter the email on your account and we'll send a reset link.</Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@company.com"
        placeholderTextColor={colors.textDim}
      />

      <TouchableOpacity
        style={[styles.primaryButton, submitting && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Sending..." : "Send reset link"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.link}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: "center" },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, color: colors.text, fontSize: 15, marginBottom: spacing.md
  },
  primaryButton: { backgroundColor: colors.teal, borderRadius: radius.md, padding: 16, alignItems: "center" },
  primaryButtonText: { color: "#02201C", fontWeight: "700", fontSize: 15 },
  link: { color: colors.amber, fontSize: 13, fontWeight: "600", marginTop: spacing.lg, textAlign: "center" },
  button: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  buttonSpacing: { marginTop: spacing.md },
  buttonText: { color: colors.text, fontWeight: "600", fontSize: 14 }
});
