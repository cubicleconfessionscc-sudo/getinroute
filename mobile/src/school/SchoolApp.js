import React from "react";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../context/AuthContext";
import ErrorBoundary from "../components/ErrorBoundary";
import SchoolRootNavigator from "../navigation/SchoolRootNavigator";

// Dedicated root for the School build (APP_VARIANT=school). Completely
// separate from the company App: its own navigator, branding, login and
// dashboard, so the School product never surfaces "Employee" screens
// (Issue #2).
export default function SchoolApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <StatusBar style="dark" />
        <SchoolRootNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}