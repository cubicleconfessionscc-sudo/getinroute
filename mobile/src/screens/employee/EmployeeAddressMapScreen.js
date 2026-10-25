import React, { useMemo, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity, Alert } from "react-native";
import { WebView } from "react-native-webview";
import { API_BASE_URL } from "../../api/client";
import { colors, spacing, radius } from "../../theme";

/* Full-screen "pick a location on the map" for the employee app.
 *
 * The native Google map could not be authorised: the Google key configured
 * for the apps is an HTTP-referrer browser key, which is rejected by the
 * Android Maps SDK ("Authorization failure"), leaving a blank map. Instead we
 * host the web app's keyless MapLibre picker in a WebView. MapLibre + OSM
 * needs no key, and the page reports the chosen point back through
 * ReactNativeWebView.postMessage. Search / reverse-geocode use our own /api/geo
 * endpoints, exactly as before.
 */

const WEB_BASE = String(API_BASE_URL || "https://www.getinroute.in/api").replace(/\/api\/?$/, "");

export default function EmployeeAddressMapScreen({ navigation, route }) {
  const target = route?.params?.target === "home" ? "home" : "pickup";
  const p = route?.params || {};
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const uri = useMemo(() => {
    const q = new URLSearchParams({ target });
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      q.set("lat", String(p.lat));
      q.set("lng", String(p.lng));
    }
    if (p.address) q.set("address", String(p.address));
    return `${WEB_BASE}/mobile-map?${q.toString()}`;
  }, [target, p.lat, p.lng, p.address]);

  const onMessage = (event) => {
    let data = null;
    try { data = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!data || typeof data !== "object") return;
    if (data.type === "cancel") { navigation.goBack(); return; }
    if (data.type !== "picked") return;
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Couldn't use that point", "Please pick the location again.");
      return;
    }
    navigation.navigate({
      name: "EmployeeLocations",
      merge: true,
      params: {
        mapResult: { target, address: String(data.address || ""), lat, lng, ts: Date.now() }
      }
    });
  };

  return (
    <View style={styles.container}>
      {!ready && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.overlayText}>Loading map…</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Could not load the map. Check your connection.</Text>
          <TouchableOpacity style={styles.retry} onPress={() => { setFailed(false); setReady(false); setReloadKey((k) => k + 1); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <WebView
        key={reloadKey}
        source={{ uri }}
        originWhitelist={["https://www.getinroute.in", "https://getinroute.in", "http://www.getinroute.in"]}
        onMessage={onMessage}
        onLoadEnd={() => setReady(true)}
        onError={() => { setFailed(true); setReady(false); }}
        onHttpError={() => { setFailed(true); setReady(false); }}
        geolocationEnabled
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess={false}
        mixedContentMode="never"
        style={[styles.web, !ready && styles.hidden]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  hidden: { opacity: 0 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg,
    zIndex: 2
  },
  overlayText: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingHorizontal: 24, lineHeight: 19 },
  retry: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 18 },
  retryText: { color: "#fff", fontWeight: "800", fontSize: 13 }
});
