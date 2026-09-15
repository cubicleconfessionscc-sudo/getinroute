import React, { useEffect } from "react";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "./src/context/AuthContext";
import ErrorBoundary from "./src/components/ErrorBoundary";
import StartupGate from "./src/components/StartupGate";
import RootNavigator from "./src/navigation/RootNavigator";
import SchoolApp from "./src/school/SchoolApp";
import { registerGlobalErrorHandlers } from "./src/services/globalErrors";
import { startSyncLoop } from "./src/services/offlineQueue";

// The build variant is baked into the app config at build time by eas.json
// (company => GetInRoute, driver => GetInRoute Driver, school => GetInRoute
// School). Selecting the root from the on-device config keeps this a single
// codebase but genuinely separate apps. Company and driver builds share the
// role-based RootNavigator (employees land on employee screens, drivers on
// driver screens); school mounts its own dedicated root.
const VARIANT = Constants.expoConfig?.extra?.appVariant || "company";

function CompanyApp() {
  useEffect(() => {
    const unregister = registerGlobalErrorHandlers();
    const timer = startSyncLoop();
    return () => { if (unregister) unregister(); if (timer) clearInterval(timer); };
  }, []);

  return (
    <ErrorBoundary>
      <StartupGate>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </StartupGate>
    </ErrorBoundary>
  );
}

function SchoolAppRoot() {
  useEffect(() => {
    const unregister = registerGlobalErrorHandlers();
    return unregister;
  }, []);

  // SchoolApp brings its own ErrorBoundary + AuthProvider. StartupGate only
  // adds the startup pipeline + recovery/update surfaces on top.
  return (
    <StartupGate>
      <SchoolApp />
    </StartupGate>
  );
}

export default function App() {
  if (VARIANT === "school") {
    return <SchoolAppRoot />;
  }
  return <CompanyApp />;
}