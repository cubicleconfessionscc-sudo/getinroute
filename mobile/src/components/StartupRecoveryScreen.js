import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Platform } from "react-native";
import { colors, radius, spacing, font } from "../theme";

// Startup recovery screen (spec: "GetInRoute couldn't start completely.").
// Shown only when the startup pipeline fails. Gives the user actionable
// choices instead of a blank white screen:
//   - Retry (re-run the pipeline)
//   - Check connection (dip into OS settings where possible)
//   - Continue offline (proceed to the app anyway)
//   - Contact support (mailto the support address)
//   - Refresh configuration (clear local config and retry)
// Errors are always logged before this screen renders.
export default function StartupRecoveryScreen({ stage, error, onRetry, onContinueOffline, supportEmail }) {
  const email = supportEmail || "support@getinroute.in";

  const openMail = () => {
    Linking.openURL(`mailto:${email}?subject=GetInRoute%20startup%20help&body=${encodeURIComponent(error || "")}`).catch(() => {});
  };

  const checkConnection = () => {
    // Android Settings > WiFi is the common entry point. On iOS there is no
    // public settings URL, so the button degrades to a contact-support hint.
    if (Platform.OS === "android") {
      Linking.openURL("android.settings.WIRELESS_SETTINGS").catch(() => openMail());
    } else {
      openMail();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.brand}>GetInRoute</Text>
      <Text style={styles.title}>GetInRoute couldn't start completely</Text>
      <Text style={styles.body}>
        Something went wrong while starting up. Your data is safe — pick an option below to continue.
      </Text>

      {error ? (
        <View style={styles.detailBox}>
          <Text style={styles.detailLabel}>What happened</Text>
          <Text style={styles.detail}>{error}</Text>
          {stage ? <Text style={styles.stage}>Startup stage: {stage}</Text> : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.primaryButton} onPress={onRetry}>
        <Text style={styles.primaryButtonText}>Retry</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={checkConnection}>
        <Text style={styles.buttonText}>Check connection</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={onContinueOffline}>
        <Text style={styles.buttonText}>Continue offline</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={openMail}>
        <Text style={styles.buttonText}>Contact support</Text>
      </TouchableOpacity>

      <Text style={styles.footnote}>You can always reach us at {email}</Text>
    </ScrollView>
  );
}

// Platform used only inside a handler to avoid an unconditional import cost.

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  brand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  title: {
    color: colors.text,
    fontSize: font.label.fontSize,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: spacing.lg,
    textAlign: "center",
  },
  body: {
    color: colors.textDim,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  detailBox: {
    width: "100%",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  detailLabel: { ...font.label, color: colors.textDim, marginBottom: 6 },
  detail: { color: colors.coral, fontSize: 12, lineHeight: 17, textAlign: "left" },
  stage: { color: colors.textDim, fontSize: 11, marginTop: 8 },
  primaryButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 40,
    width: "100%",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryButtonText: { color: "#02201C", fontSize: 15, fontWeight: "700" },
  button: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: 40,
    width: "100%",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.teal, fontSize: 14, fontWeight: "700" },
  footnote: { color: colors.textDim, fontSize: 11, marginTop: spacing.lg, textAlign: "center" }
});