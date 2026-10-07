import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

// One reusable header used by every pushed screen. It applies the real top
// safe-area inset itself (via useSafeAreaInsets), so it can never overlap the
// Android status bar / notch — regardless of the app being edge-to-edge.
// `title` may be null to render only the safe-area spacer (used by home screens
// that draw their own hero).
export default function ScreenHeader({ title, onBack, right }) {
  const insets = useSafeAreaInsets();
  const padTop = insets.top || 0;
  if (!title && !onBack) {
    return <View style={{ paddingTop: padTop, backgroundColor: colors.bg }} />;
  }
  return (
    <View style={[styles.wrap, { paddingTop: padTop }]}>
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>{title || ""}</Text>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

// Wraps a screen with the header + a full-height body. Used as the `component`
// for every Stack.Screen so the native header can be turned off entirely.
export function withScreenHeader(Screen, title, { back = true } = {}) {
  return function ScreenWithHeader(props) {
    const navigation = props.navigation;
    const canBack = back && navigation && navigation.canGoBack && navigation.canGoBack();
    return (
      <View style={styles.root}>
        <ScreenHeader title={title} onBack={canBack ? () => navigation.goBack() : undefined} />
        <View style={styles.body}>
          <Screen {...props} />
        </View>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  wrap: { backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { height: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg },
  back: { paddingRight: 10 },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "800" },
  right: { flexDirection: "row", alignItems: "center", gap: 10 }
});
