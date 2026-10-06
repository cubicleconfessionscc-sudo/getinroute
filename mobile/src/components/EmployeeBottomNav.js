import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, radius } from "../theme";

// Persistent bottom navigation for the employee app.
// Home | Trips | + (Book) | Profile  — Track lives inside the trip details.
export default function EmployeeBottomNav({ navigation, active }) {
  const items = [
    { key: "home", label: "Home", icon: "🏠", route: "EmployeeHome" },
    { key: "trips", label: "Trips", icon: "🎫", route: "EmployeeHistory" },
    { key: "book", label: "Book", icon: "+", route: "EmployeeSchedule", plus: true },
    { key: "profile", label: "Profile", icon: "👤", route: "EmployeeProfile" }
  ];
  return (
    <View style={styles.bar}>
      {items.map((it) =>
        it.plus ? (
          <TouchableOpacity key={it.key} style={styles.plusWrap} onPress={() => navigation.navigate(it.route)} activeOpacity={0.85}>
            <View style={styles.plus}><Text style={styles.plusText}>{it.icon}</Text></View>
            <Text style={styles.plusLabel}>{it.label}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity key={it.key} style={styles.item} onPress={() => navigation.navigate(it.route)} activeOpacity={0.85}>
            <Text style={styles.icon}>{it.icon}</Text>
            <Text style={[styles.label, active === it.key && styles.active]}>{it.label}</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around",
    backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line,
    paddingTop: 8, paddingBottom: 10, paddingHorizontal: 8
  },
  item: { alignItems: "center", justifyContent: "center", flex: 1 },
  icon: { fontSize: 20 },
  label: { fontSize: 11, color: colors.textDim, fontWeight: "700", marginTop: 3 },
  active: { color: colors.primary },
  plusWrap: { alignItems: "center", justifyContent: "center", flex: 1, marginTop: -22 },
  plus: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6
  },
  plusText: { color: "#fff", fontSize: 30, fontWeight: "300", lineHeight: 32, marginTop: -2 },
  plusLabel: { fontSize: 11, color: colors.primary, fontWeight: "800", marginTop: 3 }
});
