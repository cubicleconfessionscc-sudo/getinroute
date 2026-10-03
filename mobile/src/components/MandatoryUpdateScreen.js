import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from "react-native";
import { colors, radius, spacing, font } from "../theme";

// Shown when the backend reports a MANDATORY update (the installed binary can
// no longer talk to the API safely). The user is told clearly that a store
// update is required and is given the store link — never forced to reinstall
// or left with a blank screen.
export default function MandatoryUpdateScreen({ config, onRetry }) {
  const latest = config?.latestVersion || "a newer version";
  const url =
    Platform.OS === "android"
      ? config?.storeUrls?.android
      : config?.storeUrls?.ios;
  const androidUrl = config?.storeUrls?.android;
  const iosUrl = config?.storeUrls?.ios;

  const openStore = () => {
    const target = Platform.OS === "android" ? androidUrl : iosUrl;
    if (target) Linking.openURL(target).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>GetInRoute</Text>
      <Text style={styles.title}>Update required</Text>
      <Text style={styles.body}>
        This version ({config?.latestVersion ? `v${config.latestVersion}` : ""}) is no longer
        supported. Please update to {latest} to keep using GetInRoute. Your data stays safe.
      </Text>

      {config?.releaseNotes ? (
        <View style={styles.notesBox}>
          <Text style={styles.notesLabel}>What's new</Text>
          <Text style={styles.notes}>{config.releaseNotes}</Text>
        </View>
      ) : null}

      {url ? (
        <TouchableOpacity style={styles.primaryButton} onPress={openStore}>
          <Text style={styles.primaryButtonText}>Update from {Platform.OS === "android" ? "Google Play" : "the App Store"}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.footnote}>The store link was not configured yet — please check for updates in your app store.</Text>
      )}

      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Check again</Text>
      </TouchableOpacity>

      <Text style={styles.footnote}>
        {Platform.OS === "android" && androidUrl ? "Android store: " + androidUrl : ""}
        {Platform.OS === "ios" && iosUrl ? "iOS store: " + iosUrl : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  brand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: spacing.lg,
  },
  body: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 21, marginTop: spacing.sm, maxWidth: 320 },
  notesBox: {
    width: "100%",
    marginTop: spacing.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  notesLabel: { ...font.label, color: colors.textDim, marginBottom: 6 },
  notes: { color: colors.text, fontSize: 12.5, lineHeight: 17 },
  primaryButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 28,
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
