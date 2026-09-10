import React, { lazy, Suspense } from "react";
import { TouchableOpacity, Text, View, StyleSheet, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

import UnsupportedRoleScreen from "../screens/shared/UnsupportedRoleScreen";
import LoginScreen from "../screens/auth/LoginScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";
import PendingApprovalScreen from "../screens/auth/PendingApprovalScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import ResetPasswordScreen from "../screens/auth/ResetPasswordScreen";

// These screens statically themselves import react-native-maps at module
// scope. If the installed binary predates the maps native library, that import
// throws during bundle evaluation - below React, so the ErrorBoundary cannot
// catch it and the app would render blank. Loading them lazily moves any such
// failure to FIRST RENDER, where the ErrorBoundary catches it and shows a
// recoverable error screen instead of a white void.
const EmployeeHomeScreen = lazy(() => import("../screens/employee/EmployeeHomeScreen"));
const EmployeeHistoryScreen = lazy(() => import("../screens/employee/EmployeeHistoryScreen"));
const EmployeeScheduleScreen = lazy(() => import("../screens/employee/EmployeeScheduleScreen"));
const EmployeeLocationsScreen = lazy(() => import("../screens/employee/EmployeeLocationsScreen"));
const DriverHomeScreen = lazy(() => import("../screens/driver/DriverHomeScreen"));
const ChatScreen = lazy(() => import("../screens/shared/ChatScreen"));
const FeedbackScreen = lazy(() => import("../screens/shared/FeedbackScreen"));
const HelpScreen = lazy(() => import("../screens/shared/HelpScreen"));
const SettingsScreen = lazy(() => import("../screens/shared/SettingsScreen"));

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.panel, text: colors.text, border: colors.line }
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.panel },
  headerTintColor: colors.text,
  headerShadowVisible: false
};

// Explicit, always-visible back button for pushed screens, so the user can
// always get back home regardless of the OS default arrow behavior.
function BackButton({ navigation }) {
  return (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{ paddingRight: 12 }}
    >
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>‹ Back</Text>
    </TouchableOpacity>
  );
}

function backOptions(navigation) {
  return {
    headerBackVisible: true,
    headerLeft: () => <BackButton navigation={navigation} />
  };
}

// Home screens are stack roots - there is nowhere to go "back" to, so no
// back button is rendered. Signing out happens only via the explicit
// "Sign out" action on each home screen, never via an accidental tap.
function homeOptions(title) {
  return {
    title,
    headerBackVisible: false,
    headerLeft: undefined
  };
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
    </Stack.Navigator>
  );
}

function EmployeeStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="EmployeeHome" component={EmployeeHomeScreen} options={homeOptions("GetInRoute")} />
      <Stack.Screen name="EmployeeSchedule" component={EmployeeScheduleScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Book cab" })} />
      <Stack.Screen name="EmployeeHistory" component={EmployeeHistoryScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Trip history" })} />
      <Stack.Screen name="EmployeeLocations" component={EmployeeLocationsScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "My Locations" })} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Chat" })} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Feedback" })} />
      <Stack.Screen name="Help" component={HelpScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Help" })} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Settings" })} />
    </Stack.Navigator>
  );
}

function DriverStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="DriverHome" component={DriverHomeScreen} options={homeOptions("GetInRoute Driver")} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Chat" })} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Feedback" })} />
      <Stack.Screen name="Help" component={HelpScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Help" })} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={({ navigation }) => ({ ...backOptions(navigation), title: "Settings" })} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  // Branded splash while the stored session is being restored, so the user
  // never stares at a blank/white screen during startup.
  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashBrand}>GetInRoute</Text>
        <ActivityIndicator color={colors.teal} style={styles.splashSpinner} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Suspense
        fallback={
          <View style={styles.splash}>
            <ActivityIndicator color={colors.teal} style={styles.splashSpinner} />
          </View>
        }
      >
        {!user && <AuthStack />}
        {(user?.role === "employee" || user?.role === "admin") && <EmployeeStack />}
        {user?.role === "driver" && <DriverStack />}
        {user && !["employee", "admin", "driver"].includes(user.role) && <UnsupportedRoleScreen />}
      </Suspense>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  splashBrand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  splashSpinner: { marginTop: spacing.lg }
});
