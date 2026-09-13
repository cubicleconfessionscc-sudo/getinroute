import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { runStartupPipeline, STARTUP_STATE } from "../services/startup";
import StartupRecoveryScreen from "./StartupRecoveryScreen";
import MandatoryUpdateScreen from "./MandatoryUpdateScreen";

// Wraps the entire app (company + school variants). Runs the startup pipeline
// (splash -> env -> storage -> health -> config) before mounting the real app,
// and owns the two recovery surfaces:
//   - StartupRecoveryScreen for any failed startup
//   - MandatoryUpdateScreen when the backend demands a store update
// "Continue offline" clears the blocking flag and proceeds to the app; the app
// itself (AuthProvider + axios) already tolerates offline gracefully.
export default function StartupGate({ children }) {
  const [state, setState] = useState(STARTUP_STATE.RUNNING);
  const [detail, setDetail] = useState({ stage: null, error: null, config: null });
  const [continueOffline, setContinueOffline] = useState(false);

  const run = useCallback(async () => {
    const result = await runStartupPipeline();
    setState(result.state);
    setDetail({ stage: result.stage, error: result.error, config: result.config });
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  // Running or (offline override) -> show the branded splash or the app.
  if (state === STARTUP_STATE.RUNNING) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashBrand}>GetInRoute</Text>
        <ActivityIndicator color={colors.teal} style={styles.splashSpinner} />
      </View>
    );
  }

  if (state === STARTUP_STATE.MANDATORY_UPDATE && !continueOffline) {
    return <MandatoryUpdateScreen config={detail.config} onRetry={run} />;
  }

  if (
    !continueOffline &&
    (state === STARTUP_STATE.NETWORK_ERROR ||
      state === STARTUP_STATE.STORAGE_ERROR ||
      state === STARTUP_STATE.CONFIG_ERROR)
  ) {
    return (
      <StartupRecoveryScreen
        stage={detail.stage}
        error={detail.error}
        onRetry={run}
        onContinueOffline={() => setContinueOffline(true)}
      />
    );
  }

  return children;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  splashBrand: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  splashSpinner: { marginTop: spacing.lg }
});