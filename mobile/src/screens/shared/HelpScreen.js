import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Linking } from "react-native";
import { sendHelpMessage, getSupportConfig } from "../../api/support";
import { sendSOS } from "../../api/alerts";
import { getSessionDaysLeft } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { colors, spacing, radius } from "../../theme";

// Employee/driver help-line. Messages are emailed to the company's own
// help-line inbox (set by the admin under Company > Create an Email), and
// the helpline phone button dials the number the admin configured.
export default function HelpScreen({ navigation }) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [sending, setSending] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const [helplinePhone, setHelplinePhone] = useState("");
  const [daysLeft, setDaysLeft] = useState(null);

  useEffect(() => {
    getSupportConfig()
      .then((c) => setHelplinePhone(c.helplinePhone || ""))
      .catch(() => {});
    getSessionDaysLeft().then(setDaysLeft);
  }, []);

  async function handleSubmit() {
    if (!message.trim()) {
      Alert.alert("Write a message", "Tell us how we can help.");
      return;
    }
    setSending(true);
    try {
      await sendHelpMessage({
        name: user?.name || "Employee",
        email: email.trim(),
        message: message.trim(),
        companyId: user?.companyId
      });
      Alert.alert("Sent!", "Your message has been emailed to your transport help-line. They'll reply to you here.", [
        { text: "OK", onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert("Couldn't send", err?.response?.data?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  }

  function callHelpline() {
    if (!helplinePhone) return;
    Linking.openURL(`tel:${helplinePhone.replace(/[^+\d]/g, "")}`).catch(() => {});
  }

  async function handleSOS() {
    Alert.alert(
      "Raise an SOS?",
      "This immediately alerts your transport admins with your name and account. Only use it in a genuine emergency.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Raise SOS",
          style: "destructive",
          onPress: async () => {
            setSosSending(true);
            try {
              await sendSOS({ note: `SOS raised from the app by ${user?.name || user?.email || "unknown user"}` });
              Alert.alert("SOS raised", "Your transport admins have been notified. They'll act right away.");
            } catch (err) {
              Alert.alert("Couldn't raise SOS", err?.response?.data?.message || "Please try again.");
            } finally {
              setSosSending(false);
            }
          }
        }
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Need help with your commute?</Text>
      <Text style={styles.subtitle}>
        Type below and it's emailed straight to your company's transport help-line.
      </Text>

      {helplinePhone ? (
        <TouchableOpacity style={styles.callButton} onPress={callHelpline}>
          <Text style={styles.callIcon}>✆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.callLabel}>Call the transport help-line</Text>
            <Text style={styles.callNumber}>{helplinePhone}</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <TextInput
        style={styles.input}
        value={message}
        onChangeText={setMessage}
        placeholder="Describe the problem or question&hellip;"
        placeholderTextColor={colors.textDim}
        multiline
        numberOfLines={5}
      />

      <Text style={styles.label}>Your email (optional, for replies)</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@company.com"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TouchableOpacity
        style={[styles.button, sending && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={sending}
      >
        <Text style={styles.buttonText}>{sending ? "Sending..." : "Send to help-line"}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.sosButton, sosSending && { opacity: 0.6 }]}
        onPress={handleSOS}
        disabled={sosSending}
      >
        <Text style={styles.sosText}>{sosSending ? "Raising..." : "SOS — Emergency"}</Text>
      </TouchableOpacity>
      <Text style={styles.sosNote}>Raises an emergency alert to your transport admins immediately.</Text>

      {daysLeft ? (
        <View style={styles.sessionRow}>
          <Text style={styles.sessionText}>
            Signed in · your session refreshes automatically and stays valid for about {daysLeft} more days.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: spacing.xs },
  subtitle: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  label: { color: colors.textDim, fontSize: 12, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 14, color: colors.text, fontSize: 14, textAlignVertical: "top",
    minHeight: 60, marginBottom: spacing.lg
  },
  callButton: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.teal,
    borderRadius: radius.md, padding: 14, marginBottom: spacing.lg
  },
  callIcon: { color: colors.teal, fontSize: 22, fontWeight: "700" },
  callLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  callNumber: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  button: { backgroundColor: colors.teal, borderRadius: radius.md, padding: 16, alignItems: "center", marginTop: spacing.sm },
  buttonText: { color: "#02201C", fontWeight: "700", fontSize: 15 },
  sosButton: { backgroundColor: colors.coral, borderRadius: radius.md, padding: 16, alignItems: "center", marginTop: spacing.lg },
  sosText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15, letterSpacing: 0.4 },
  sosNote: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: 8 },
  sessionRow: { marginTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md },
  sessionText: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: "center" }
});
