import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "../../context/AuthContext";
import { lookupCompany } from "../../api/company";
import { colors, spacing, radius } from "../../theme";

// This build is a genuine separate app. The Employee build only ever registers
// employees; the Driver build only ever registers drivers. The role is fixed by
// the variant (backed up by server-side enforcement) instead of a user toggle,
// so the two apps can never switch roles on device.
const VARIANT = Constants.expoConfig?.extra?.appVariant || "company";
const LOCKED_ROLE = VARIANT === "driver" ? "driver" : null;
const APP_NAME = VARIANT === "driver" ? "GetInRoute Driver" : "GetInRoute";

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [role, setRole] = useState(LOCKED_ROLE || "employee");
  const [gender, setGender] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState(""); // employeeId or driver licenseNumber
  const [inviteCode, setInviteCode] = useState("");
  const [companyHint, setCompanyHint] = useState(null); // { name } | { missing: true }
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Employees join a company by their email domain; show which company (if
  // any) matches so they know their registration goes to the right admin.
  async function checkCompany() {
    const value = email.trim();
    if (!value || !value.includes("@")) {
      setCompanyHint(null);
      return;
    }
    try {
      const res = await lookupCompany({ domain: value });
      setCompanyHint(res?.exists ? { name: res.name } : { missing: true });
    } catch (e) {
      setCompanyHint(null);
    }
  }

  function handleRegister() {
    if (!name || !email || !password || !idNumber) {
      Alert.alert("Missing details", "Fill in all fields to continue.");
      return;
    }
    if (role === "driver" && !inviteCode.trim()) {
      Alert.alert("Invite code needed", "Enter the invite code your transport admin gave you.");
      return;
    }
    setSubmitting(true);
    const payload = {
      name,
      email: email.trim(),
      phone,
      password,
      role,
      ...(gender ? { gender } : {}),
      ...(role === "employee" ? { employeeId: idNumber } : { licenseNumber: idNumber }),
      ...(role === "driver" ? { inviteCode: inviteCode.trim().toUpperCase() } : {})
    };
    register(payload)
      .then(() => navigation.replace("PendingApproval", { email }))
      .catch((err) => {
        const message = err?.response?.data?.message || "Registration failed.";
        Alert.alert("Couldn't register", message);
        setSubmitting(false);
      });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backBtnText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.brand}>Create your account</Text>
      <Text style={styles.tagline}>An admin will review and approve your access.</Text>

      {LOCKED_ROLE ? (
        <View style={styles.lockedRoleWrap}>
          <Text style={styles.lockedRoleText}>Registering as a <Text style={{ color: colors.teal, fontWeight: "700" }}>{LOCKED_ROLE}</Text> for the {APP_NAME} app.</Text>
        </View>
      ) : (
        <View style={styles.roleToggle}>
          <TouchableOpacity
            style={[styles.roleButton, role === "employee" && styles.roleButtonActive]}
            onPress={() => setRole("employee")}
          >
            <Text style={[styles.roleText, role === "employee" && styles.roleTextActive]}>Employee</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, role === "driver" && styles.roleButtonActive]}
            onPress={() => setRole("driver")}
          >
            <Text style={[styles.roleText, role === "driver" && styles.roleTextActive]}>Driver</Text>
          </TouchableOpacity>
        </View>
      )}

      {role === "employee" && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Gender (for SafeDrop)</Text>
          <View style={styles.roleToggle}>
            {["female", "male", "other"].map((g) => (
              <TouchableOpacity
                key={g}
                style={[styles.roleButton, gender === g && styles.roleButtonActive]}
                onPress={() => setGender(g)}
              >
                <Text style={[styles.roleText, gender === g && styles.roleTextActive]}>{g[0].toUpperCase() + g.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.genderHint}>Female employees get SafeDrop — a confirm-safe-arrival check after every cab drop-off.</Text>
        </View>
      )}

      <Field label="Full name" value={name} onChangeText={setName} placeholder="Asha Nair" />
      <Field label="Email" value={email} onChangeText={setEmail} onBlur={checkCompany} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" />
      {role === "employee" && companyHint && (
        <Text style={companyHint.missing ? styles.hintError : styles.hintOk}>
          {companyHint.missing
            ? "No company is registered for this email domain. Registration will fail — check with your transport admin."
            : `You'll be joining ${companyHint.name}.`}
        </Text>
      )}
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+91 98450 XXXXX" keyboardType="phone-pad" />
      <Field
        label={role === "employee" ? "Employee ID" : "Driver license number"}
        value={idNumber}
        onChangeText={setIdNumber}
        placeholder={role === "employee" ? "EMP-08841" : "DL-1420XXXXXXXXX"}
      />
      {role === "driver" && (
        <>
          <Field
            label="Company invite code"
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="e.g. K2QX7A"
            autoCapitalize="characters"
          />
          <Text style={styles.hintDim}>Ask your transport admin for your company's invite code.</Text>
        </>
      )}
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />

      <TouchableOpacity
        style={[styles.primaryButton, submitting && styles.buttonDisabled]}
        onPress={handleRegister}
        disabled={submitting}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Submitting..." : "Submit for approval"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Login")}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textDim} {...inputProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  backBtn: { marginBottom: spacing.md },
  backBtnText: { color: colors.teal, fontSize: 15, fontWeight: "600" },
  brand: { color: colors.text, fontSize: 24, fontWeight: "700" },
  tagline: { color: colors.textDim, fontSize: 13, marginTop: 6, marginBottom: spacing.lg },
  lockedRoleWrap: {
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: spacing.lg
  },
  lockedRoleText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  roleToggle: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    marginBottom: spacing.lg
  },
  roleButton: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center" },
  roleButtonActive: { backgroundColor: colors.panel2 },
  roleText: { color: colors.textDim, fontWeight: "600", fontSize: 13 },
  roleTextActive: { color: colors.teal },
  field: { marginBottom: spacing.md },
  genderHint: { color: colors.textDim, fontSize: 12, marginTop: 6, lineHeight: 17 },
  hintOk: { color: colors.teal, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.sm },
  hintError: { color: colors.coral, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.sm },
  hintDim: { color: colors.textDim, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.sm },
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
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.sm
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#1A1400", fontWeight: "700", fontSize: 15 },
  link: { color: colors.teal, fontSize: 13, fontWeight: "600", marginTop: spacing.lg, textAlign: "center", marginBottom: spacing.xl }
});
