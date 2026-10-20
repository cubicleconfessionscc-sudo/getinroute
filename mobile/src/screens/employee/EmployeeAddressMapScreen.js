import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator
} from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { geoSearch, geoReverse } from "../../api/geo";
import { colors, spacing, radius } from "../../theme";

/* Full-screen "pick a location on the map" for the employee app.
   Search an address (backend Photon/OSM — free, no key in the binary),
   drop or drag the pin, then Confirm. The result is handed back to
   EmployeeLocationsScreen, which keeps storing latitude/longitude internally
   exactly as before — only the display is human-readable.

   Map tiles come from react-native-maps (Google on Android, Apple on iOS),
   the same provider the app already uses for maps — this screen adds no new
   Google API usage: search and reverse-geocode both go through our own
   /api/geo endpoints. */

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
const DEFAULT_DELTA = { latitudeDelta: 0.02, longitudeDelta: 0.02 };

export default function EmployeeAddressMapScreen({ navigation, route }) {
  const target = route?.params?.target === "home" ? "home" : "pickup";
  const p = route?.params || {};
  const [selected, setSelected] = useState({
    address: p.address || "",
    lat: typeof p.lat === "number" ? p.lat : null,
    lng: typeof p.lng === "number" ? p.lng : null
  });
  const [naming, setNaming] = useState(false);
  const [query, setQuery] = useState("");
  const [sugg, setSugg] = useState([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [locating, setLocating] = useState(false);
  const mapRef = useRef(null);
  const revSeq = useRef(0);
  const searchTimer = useRef(null);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const region = {
    latitude: selected.lat ?? BENGALURU.latitude,
    longitude: selected.lng ?? BENGALURU.longitude,
    ...DEFAULT_DELTA
  };

  async function namePoint(lat, lng) {
    const seq = ++revSeq.current;
    setNaming(true);
    let address = "";
    try {
      const r = await geoReverse(lat, lng);
      if (r && r.address) address = r.address;
    } catch (e) { /* try the device geocoder next */ }
    if (!address) {
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        address = [place?.name, place?.district, place?.city, place?.region].filter(Boolean).join(", ");
      } catch (e) { /* fall through to the coordinate string */ }
    }
    if (!address) address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (seq !== revSeq.current) return; // a newer pick superseded this lookup
    setSelected((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...prev, address } : prev));
    setNaming(false);
  }

  const movePin = useCallback((lat, lng, address = "") => {
    revSeq.current += 1; // invalidate any in-flight naming job
    setSelected({ address: address || "", lat, lng });
    if (address) { setNaming(false); return; }
    void namePoint(lat, lng);
  }, []);

  const flyTo = (lat, lng, delta = 0.008) => {
    if (!mapRef.current) return;
    mapRef.current.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }, 350);
  };

  function onQuery(text) {
    setQuery(text);
    setErr("");
    setSugg([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (q.length < 3) { setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await geoSearch(q);
        setSugg(rows);
        if (!rows.length) setErr("No match found — try a nearby landmark, or drag the pin on the map.");
      } catch (e) {
        setErr("Address lookup failed. Check your connection and try again.");
      } finally {
        setSearching(false);
      }
    }, 450);
  }

  function chooseSuggestion(s) {
    if (!s || s.lat == null || s.lng == null) return;
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    movePin(lat, lng, s.address || s.label || "");
    flyTo(lat, lng);
    setSugg([]);
    setQuery(s.address || s.label || "");
  }

  async function useMyLocation() {
    if (locating) return;
    setLocating(true);
    setErr("");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error("Location permission is required to drop the pin where you are.");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      movePin(lat, lng);
      flyTo(lat, lng);
    } catch (e) {
      Alert.alert("Location unavailable", e.message || String(e));
    } finally {
      setLocating(false);
    }
  }

  const hasPoint = selected.lat != null && selected.lng != null
    && !Number.isNaN(selected.lat) && !Number.isNaN(selected.lng);
  const canConfirm = hasPoint && !!selected.address && !naming;

  function confirm() {
    if (!hasPoint || !selected.address) {
      Alert.alert("Pick a point", "Search for an address or drop a pin on the map, then Confirm.");
      return;
    }
    navigation.navigate({
      name: "EmployeeLocations",
      merge: true,
      params: {
        mapResult: {
          target,
          address: selected.address,
          lat: selected.lat,
          lng: selected.lng,
          ts: Date.now()
        }
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onQuery}
          placeholder="Search address, landmark, area…"
          placeholderTextColor={colors.textDim}
        />
        <TouchableOpacity style={styles.locateBtn} onPress={useMyLocation} disabled={locating}>
          <Text style={styles.locateText}>{locating ? "…" : "My location"}</Text>
        </TouchableOpacity>
      </View>

      {searching ? <Text style={styles.hint}>Searching…</Text> : null}
      {err ? <Text style={styles.error}>{err}</Text> : null}
      {sugg.length ? (
        <View style={styles.suggestBox}>
          {sugg.map((s, i) => (
            <TouchableOpacity
              key={String(s.provider_id || `${s.lat},${s.lng},${i}`)}
              style={styles.suggestRow}
              onPress={() => chooseSuggestion(s)}
            >
              <Text style={styles.suggestTitle}>{s.label || s.address || "Location"}</Text>
              {s.address && s.address !== s.label ? <Text style={styles.suggestAddress}>{s.address}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
          onPress={(e) => {
            const c = e.nativeEvent.coordinate;
            if (c) movePin(c.latitude, c.longitude);
          }}
        >
          {hasPoint ? (
            <Marker
              coordinate={{ latitude: selected.lat, longitude: selected.lng }}
              draggable
              onDragEnd={(e) => {
                const c = e.nativeEvent.coordinate;
                if (c) movePin(c.latitude, c.longitude);
              }}
              title={selected.address || "Selected point"}
            />
          ) : null}
        </MapView>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>
          {target === "home" ? "Home address" : "Pickup point"}
        </Text>
        <Text style={styles.panelAddress} numberOfLines={3}>
          {hasPoint
            ? (naming ? "Naming this point…" : (selected.address || "Not named yet"))
            : "Search an address or tap the map to drop a pin."}
        </Text>
        <View style={styles.panelActions}>
          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} disabled={!canConfirm}>
            <Text style={[styles.confirmText, !canConfirm && styles.confirmTextOff]}>Confirm location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14
  },
  locateBtn: {
    borderWidth: 1,
    borderColor: colors.teal,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    justifyContent: "center"
  },
  locateText: { color: colors.teal, fontSize: 12, fontWeight: "700" },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 6, marginHorizontal: spacing.lg },
  error: { color: colors.coral, fontSize: 12, marginTop: 6, marginHorizontal: spacing.lg },
  suggestBox: { marginHorizontal: spacing.lg, marginTop: spacing.sm },
  suggestRow: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: 6
  },
  suggestTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  suggestAddress: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  mapWrap: {
    flex: 1,
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line
  },
  panel: {
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: spacing.md
  },
  panelLabel: { color: colors.textDim, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  panelAddress: { color: colors.text, fontSize: 14, fontWeight: "600", marginTop: 4, lineHeight: 20 },
  panelActions: { flexDirection: "row", marginTop: spacing.sm },
  confirmBtn: {
    flex: 1,
    backgroundColor: colors.amber,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    opacity: 1
  },
  confirmText: { color: "#1A1400", fontWeight: "800", fontSize: 15 },
  confirmTextOff: { opacity: 0.45 }
});
