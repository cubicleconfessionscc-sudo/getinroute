import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput } from "react-native";
import { colors, spacing, radius } from "../theme";

/**
 * Clean dropdown selector used for Trip / Line / Stand selection. Options may be
 * plain strings or { value, label } objects. The chosen value is highlighted with
 * a tick, and the closed field shows the current selection or a placeholder.
 */
export default function Dropdown({ label, placeholder = "Select…", value, options = [], onChange, disabled = false, searchable }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelOf = (opt) => (typeof opt === "string" ? opt : opt.label);
  const valueOf = (opt) => (typeof opt === "string" ? opt : opt.value);
  // Long lists (e.g. L1–L60 stands) get a search box so the driver can type to filter.
  const showSearch = searchable != null ? searchable : options.length > 12;
  const filtered = query
    ? options.filter((o) => String(labelOf(o)).toLowerCase().includes(query.toLowerCase()))
    : options;
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        disabled={disabled}
        activeOpacity={0.85}
        onPress={() => { setQuery(""); setOpen(true); }}
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
            {showSearch ? (
              <TextInput
                style={styles.search}
                placeholder="Search…"
                placeholderTextColor={colors.textDim}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            ) : null}
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {filtered.map((opt) => {
                const val = valueOf(opt);
                const text = labelOf(opt);
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
              {filtered.length === 0 ? <Text style={styles.noMatch}>No matches</Text> : null}
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
  search: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, color: colors.text, fontSize: 15, marginBottom: 8 },
  noMatch: { color: colors.textDim, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  list: { maxHeight: 340 },
  opt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.line },
  optOn: {},
  optText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  optTextOn: { color: colors.primary, fontWeight: "800" },
  tick: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  cancel: { marginTop: 12, alignItems: "center", paddingVertical: 12 },
  cancelText: { color: colors.textDim, fontSize: 14, fontWeight: "700" }
});
