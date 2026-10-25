import React from "react";
import { TouchableOpacity, Text, View, StyleSheet, ActivityIndicator, StatusBar, Platform } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";
import { withScreenHeader } from "../components/ScreenHeader";

import UnsupportedRoleScreen from "../screens/shared/UnsupportedRoleScreen";
import LoginScreen from "../screens/auth/LoginScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";
import PendingApprovalScreen from "../screens/auth/PendingApprovalScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import ResetPasswordScreen from "../screens/auth/ResetPasswordScreen";

// Screens are imported directly. React.lazy + Suspense around the map-bearing
// screens previously left the screen area blank (native-stack renders the
// header while the lazy chunk is pending, and a rejected/hung dynamic import
// left an empty white body). react-native-maps is now a linked native module,
// so a direct import is safe and the app can never show a blank body here.
import EmployeeHomeScreen from "../screens/employee/EmployeeHomeScreen";
import EmployeeHistoryScreen from "../screens/employee/EmployeeHistoryScreen";
import EmployeeScheduleScreen from "../screens/employee/EmployeeScheduleScreen";
import EmployeeLocationsScreen from "../screens/employee/EmployeeLocationsScreen";
import EmployeeLocationPickerScreen from "../screens/employee/EmployeeLocationPickerScreen";
import EmployeeAddressMapScreen from "../screens/employee/EmployeeAddressMapScreen";
import EmployeeProfileScreen from "../screens/employee/EmployeeProfileScreen";
import DriverHomeScreen from "../screens/driver/DriverHomeScreen";
import DriverEndTripScreen from "../screens/driver/DriverEndTripScreen";
import ChatScreen from "../screens/shared/ChatScreen";
import FeedbackScreen from "../screens/shared/FeedbackScreen";
import HelpScreen from "../screens/shared/HelpScreen";
import SettingsScreen from "../screens/shared/SettingsScreen";
import PendingSyncScreen from "../screens/shared/PendingSyncScreen";
import NotificationsScreen from "../screens/shared/NotificationsScreen";

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.panel, text: colors.text, border: colors.line }
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.panel },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  // Push every header below the Android status bar so the title/back button can
  // never overlap the system status area (edge-to-edge builds report 0 inset).
  headerStatusBarHeight: Platform.OS === "android" ? (StatusBar.currentHeight || 24) : undefined
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

// All pushed screens use the custom SafeAreaView header (headerShown:false) so
// the title/back button always sits below the Android status bar.
function EmployeeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EmployeeHome" component={withScreenHeader(EmployeeHomeScreen, null, { back: false })} />
      <Stack.Screen name="EmployeeSchedule" component={withScreenHeader(EmployeeScheduleScreen, "Book cab")} />
      <Stack.Screen name="EmployeeHistory" component={withScreenHeader(EmployeeHistoryScreen, "Trip history")} />
      <Stack.Screen name="EmployeeLocations" component={withScreenHeader(EmployeeLocationsScreen, "My Address")} />
      <Stack.Screen name="EmployeeAddressMap" component={withScreenHeader(EmployeeAddressMapScreen, null, { back: false })} />
      <Stack.Screen name="EmployeeLocationPicker" component={withScreenHeader(EmployeeLocationPickerScreen, "Company location")} />
      <Stack.Screen name="EmployeeProfile" component={withScreenHeader(EmployeeProfileScreen, "Profile")} />
      <Stack.Screen name="Notifications" component={withScreenHeader(NotificationsScreen, "Notifications")} />
      <Stack.Screen name="Chat" component={withScreenHeader(ChatScreen, "Chat")} />
      <Stack.Screen name="Feedback" component={withScreenHeader(FeedbackScreen, "Feedback")} />
      <Stack.Screen name="Help" component={withScreenHeader(HelpScreen, "Help")} />
      <Stack.Screen name="Settings" component={withScreenHeader(SettingsScreen, "Settings")} />
      <Stack.Screen name="PendingSync" component={withScreenHeader(PendingSyncScreen, "Pending Sync")} />
    </Stack.Navigator>
  );
}

// Driver login lands straight on the home/trip screen. Trip/Line/Stand
// selection is NOT part of authentication and is only collected in the
// end-of-trip (logout) procedure via the DriverEndTrip screen.
function DriverStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="DriverHome">
      <Stack.Screen name="DriverHome" component={withScreenHeader(DriverHomeScreen, null, { back: false })} />
      <Stack.Screen name="DriverEndTrip" component={withScreenHeader(DriverEndTripScreen, "End of trip")} />
      <Stack.Screen name="Notifications" component={withScreenHeader(NotificationsScreen, "Notifications")} />
      <Stack.Screen name="Chat" component={withScreenHeader(ChatScreen, "Chat")} />
      <Stack.Screen name="Feedback" component={withScreenHeader(FeedbackScreen, "Feedback")} />
      <Stack.Screen name="Help" component={withScreenHeader(HelpScreen, "Help")} />
      <Stack.Screen name="Settings" component={withScreenHeader(SettingsScreen, "Settings")} />
      <Stack.Screen name="PendingSync" component={withScreenHeader(PendingSyncScreen, "Pending Sync")} />
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
      {!user && <AuthStack />}
      {(user?.role === "employee" || user?.role === "admin") && <EmployeeStack />}
      {user?.role === "driver" && <DriverStack />}
      {user && !["employee", "admin", "driver"].includes(user.role) && <UnsupportedRoleScreen />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  splashBrand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  splashSpinner: { marginTop: spacing.lg }
});
