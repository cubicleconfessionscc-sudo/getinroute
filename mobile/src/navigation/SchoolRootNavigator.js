import React, { lazy, Suspense } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { schoolColors } from "../theme-school";

const SchoolLoginScreen = lazy(() => import("../screens/school/SchoolLoginScreen"));
const SchoolHomeScreen = lazy(() => import("../screens/school/SchoolHomeScreen"));

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: schoolColors.bg,
    card: schoolColors.panel,
    text: schoolColors.text,
    border: schoolColors.line
  }
};

export default function SchoolRootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashBrand}>GetInRoute School</Text>
        <ActivityIndicator color={schoolColors.teal} style={styles.splashSpinner} />
      </View>
    );
  }

  const isSchoolAdmin = user?.vertical === "school" && user?.role === "admin";

  return (
    <NavigationContainer theme={navTheme}>
      <Suspense
        fallback={
          <View style={styles.splash}>
            <ActivityIndicator color={schoolColors.teal} />
          </View>
        }
      >
        {!isSchoolAdmin && <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="SchoolLogin" component={SchoolLoginScreen} /></Stack.Navigator>}
        {isSchoolAdmin && <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="SchoolHome" component={SchoolHomeScreen} /></Stack.Navigator>}
      </Suspense>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: schoolColors.bg, alignItems: "center", justifyContent: "center" },
  splashBrand: { color: schoolColors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  splashSpinner: { marginTop: 24 }
});