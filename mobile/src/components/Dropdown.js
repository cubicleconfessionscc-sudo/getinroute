import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { colors, spacing, radius } from "../theme";

/**
 * Clean dropdown selector used for Trip / Line / Stand selection. Options may be
 * plain strings or { value, label } objects. The chosen value is highlighted with
 * a tick, and the closed field shows the current selection or a placeholder.
 */
export default function Dropdown({ label, placeholder = "Select…", value, options = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        disabled={disabled}
        activeOpacity={0.85}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label || "Select"}</Text>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {options.map((opt) => {
                const val = typeof opt === "string" ? opt : opt.value;
                const text = typeof opt === "string" ? opt : opt.label;
                const on = String(value) === String(val);
                return (
                  <TouchableOpacity
                    key={String(val)}
                    style={[styles.opt, on && styles.optOn]}
                    onPress={() => { onChange(val); setOpen(false); }}
                  >
                    <Text style={[styles.optText, on && styles.optTextOn]}>{text}</Text>
                    {on ? <Text style={styles.tick}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.panel,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14
  },
  fieldDisabled: { opacity: 0.5 },
  value: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  placeholder: { color: colors.textDim, fontWeight: "500" },
  chevron: { color: colors.primary, fontSize: 14, fontWeight: "800", marginLeft: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.line },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 10 },
  list: { maxHeight: 340 },
  opt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.line },
  optOn: {},
  optText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  optTextOn: { color: colors.primary, fontWeight: "800" },
  tick: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  cancel: { marginTop: 12, alignItems: "center", paddingVertical: 12 },
  cancelText: { color: colors.textDim, fontSize: 14, fontWeight: "700" }
});
