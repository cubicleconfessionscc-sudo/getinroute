import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { saveToken } from "../../api/client";
import { adminLogin, vendorLogin } from "../../api/adminvendor";
import { colors, spacing, radius } from "../../theme";

// First screen of the Admin/Vendor app: choose Admin or Vendor, then sign in.
// Optional location code: when the account is bound to an operational location,
// the code issued for that location (invite code) must be entered to sign in
// scoped to it. The login screen renders immediately; no network/Socket/GPS
// runs before this.
export default function AdminVendorLogin({ onSuccess }) {
  const [mode, setMode] = useState(null); // null | 'admin' | 'vendor'
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (busy) return;
    if (!identifier.trim() || !password) { setErr("Enter your credentials."); return; }
    setBusy(true); setErr("");
    try {
      const code = locationCode.trim().toUpperCase();
      const r = mode === "vendor"
        ? await vendorLogin(identifier.trim(), password, code || undefined)
        : await adminLogin(identifier.trim(), password, code || undefined);
      if (!r || !r.token || !r.user) throw new Error("Login failed: unexpected response.");
      await saveToken(r.token);
      onSuccess(r.user, mode);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Login failed.";
      setErr(msg);
    } finally { setBusy(false); }
  }

  if (!mode) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.center}>
          <Text style={styles.brand}>GetInRoute</Text>
          <Text style={styles.sub}>Admin & Vendor console</Text>
          <TouchableOpacity style={[styles.card, { borderLeftColor: "#4f46e5" }]} onPress={() => { setMode("admin"); setErr(""); }}>
            <Text style={styles.cardTitle}>Admin Login</Text>
            <Text style={styles.cardDesc}>Company admin — employees, drivers, routes, trips, tracking.</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.card, { borderLeftColor: "#db2777" }]} onPress={() => { setMode("vendor"); setErr(""); }}>
            <Text style={styles.cardTitle}>Vendor Login</Text>
            <Text style={styles.cardDesc}>Vendor — your allotted routes, vehicles and drivers.</Text>
          </TouchableOpacity>
          <Text style={styles.foot}>Owner accounts sign in on the owner console, not this app.</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{mode === "vendor" ? "Vendor Login" : "Admin Login"}</Text>
        <Text style={styles.sub}>{mode === "vendor" ? "Use the credentials issued by your company admin." : "Sign in with your Admin ID / email."}</Text>
        {err ? <Text style={styles.error}>{err}</Text> : null}
        <Text style={styles.label}>{mode === "vendor" ? "EMAIL OR VENDOR ID" : "ADMIN ID / EMAIL"}</Text>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          placeholder={mode === "vendor" ? "vendor@company.com or VND-XXXX" : "admin@yourcompany.com"}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={colors.textDim}
          secureTextEntry
        />
        <Text style={styles.label}>LOCATION CODE (OPTIONAL)</Text>
        <TextInput
          style={styles.input}
          value={locationCode}
          onChangeText={(t) => setLocationCode(t.toUpperCase())}
          placeholder="ABCD-EFGH-JKLM"
          placeholderTextColor={colors.textDim}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Text style={styles.codeHint}>Required only if your account is bound to a location. The code is issued by your company admin.</Text>
        <TouchableOpacity style={[styles.primary, busy && styles.off]} disabled={busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Sign in</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setMode(null); setErr(""); setPassword(""); }}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  brand: { color: colors.text, fontSize: 26, fontWeight: "900", textAlign: "center" },
  sub: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: spacing.lg },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, padding: spacing.lg, marginBottom: 12 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  cardDesc: { color: colors.textDim, fontSize: 13, marginTop: 4, lineHeight: 18 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 14, color: colors.text, fontSize: 15 },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: spacing.lg },
  off: { opacity: 0.6 },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.4 },
  back: { color: colors.textDim, textAlign: "center", marginTop: spacing.md, fontWeight: "700" },
  error: { color: colors.coral, backgroundColor: "#fef2f2", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 6 },
  codeHint: { color: colors.textDim, fontSize: 11, marginTop: 6, lineHeight: 15 },
  foot: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: spacing.lg }
});
