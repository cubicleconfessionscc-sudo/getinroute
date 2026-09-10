import React from "react";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "./src/context/AuthContext";
import ErrorBoundary from "./src/components/ErrorBoundary";
import RootNavigator from "./src/navigation/RootNavigator";
import SchoolApp from "./src/school/SchoolApp";

// The build variant is baked into the app config at build time by eas.json
// (preview/production => "company", school => "school"). Selecting the root
// from the on-device config keeps this a single codebase but two real apps.
const VARIANT = Constants.expoConfig?.extra?.appVariant || "company";

export default function App() {
  if (VARIANT === "school") {
    return <SchoolApp />;
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}