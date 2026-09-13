import React, { useState, useCallback, useRef } from "react";
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { colors, spacing, radius } from "../theme";
import client from "../api/client";

export default function LocationPickerMobile({ onSelect, placeholder }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);

  const search = useCallback(
    (q) => {
      setQuery(q);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!q || q.length < 3) {
        setResults([]);
        return;
      }
      timerRef.current = setTimeout(() => {
        setLoading(true);
        client
          .get("/v3/location/search", { params: { q } })
          .then((r) => r.data)
          .then((r) => {
            const items = Array.isArray(r) ? r : r?.results || [];
            setResults(items);
          })
          .catch(() => setResults([]))
          .finally(() => setLoading(false));
      }, 350);
    },
    []
  );

  const pick = (item) => {
    const loc = {
      lat: parseFloat(item.lat || item.latitude),
      lng: parseFloat(item.lon || item.longitude),
      name: item.display_name || item.name || query,
    };
    setSelected(loc);
    setResults([]);
    if (onSelect) onSelect(loc);
  };

  const clear = () => {
    setQuery("");
    setResults([]);
    setSelected(null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={search}
          placeholder={placeholder || "Search location..."}
          placeholderTextColor={colors.textDim}
        />
        {query ? (
          <TouchableOpacity onPress={clear} style={styles.clearBtn}>
            <Text style={styles.clearText}>x</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.teal} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}

      {results.length > 0 && (
        <FlatList
          data={results.slice(0, 8)}
          keyExtractor={(_, i) => String(i)}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resultItem} onPress={() => pick(item)}>
              <Text style={styles.resultText} numberOfLines={2}>
                {item.display_name || item.name || `${item.lat}, ${item.lon}`}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {selected && (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedLabel}>
            Selected: {selected.name}
          </Text>
          <Text style={styles.selectedCoords}>
            {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 50 },
  inputRow: { flexDirection: "row", alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
  },
  clearBtn: { position: "absolute", right: 12, padding: 4 },
  clearText: { color: colors.textDim, fontSize: 16, fontWeight: "700" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.xs },
  loadingText: { color: colors.textDim, fontSize: 12 },
  list: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  resultItem: {
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  resultText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  selectedRow: { marginTop: spacing.xs },
  selectedLabel: { color: colors.teal, fontSize: 12, fontWeight: "600" },
  selectedCoords: { color: colors.textDim, fontSize: 11, marginTop: 2 },
});
