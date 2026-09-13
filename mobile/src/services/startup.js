import { Platform } from "react-native";
import Constants from "expo-constants";
import client, { API_BASE_URL, getToken, clearToken } from "../api/client";

// Startup pipeline (spec: splash/boot -> environment validation -> local
// storage validation -> API health check -> configuration loading ->
// authentication restoration -> main application). Each stage is isolated so
// a single failure is diagnosed at the stage level and surfaced as a
// recovery action, never as a blank white screen.

export const STARTUP_STAGES = [
  "env",
  "storage",
  "health",
  "config",
];

export const STARTUP_STATE = {
  RUNNING: "running",
  READY: "ready",
  NETWORK_ERROR: "network_error",
  STORAGE_ERROR: "storage_error",
  CONFIG_ERROR: "config_error",
  MANDATORY_UPDATE: "mandatory_update",
};

const DEFAULT_CONFIG = {
  available: true,
  latestVersion: Constants.expoConfig?.version || "1.0.0",
  minimumSupportedVersion: Constants.expoConfig?.version || "1.0.0",
  recommendedVersion: Constants.expoConfig?.version || "1.0.0",
  mandatoryUpdate: false,
  recommendedUpdate: false,
  updateUrl: null,
  releaseNotes: "",
  apiCompatibilityVersion: "1",
  storeUrls: {
    android: null,
    ios: null,
  },
};

function appId() {
  const variant = Constants.expoConfig?.extra?.appVariant || "company";
  // Company build serves both employee and driver roles; the natural
  // store identity is the single "GetInRoute" app.
  if (variant === "school") return "school";
  return "employee";
}

function log(level, tag, message) {
  try {
    const line = `[startup:${tag}] ${message}`;
    if (level === "error") console.error(line);
    else console.log(line);
  } catch {
    // Logging must never break startup.
  }
}

async function checkHealth(timeoutMs = 10000) {
  // A dedicated axios instance with a short timeout so the health probe
  // never blocks startup for long on a flaky network.
  const { default: axios } = await import("axios");
  const probe = axios.create({
    baseURL: API_BASE_URL,
    timeout: timeoutMs,
    validateStatus: (s) => s < 500,
  });
  const res = await probe.get("/health");
  if (res.status !== 200) {
    throw new Error("health:unavailable");
  }
  return res.data || {};
}

async function fetchAppConfig(timeoutMs = 10000) {
  const { default: axios } = await import("axios");
  const probe = axios.create({ baseURL: API_BASE_URL, timeout: timeoutMs });
  try {
    const res = await probe.get(`/api/mobile/app-config?app=${appId()}`);
    return (res && res.data) || {};
  } catch {
    // Old backend without the endpoint: treat as no-gating update policy.
    return {};
  }
}

// Runs the full startup pipeline. Returns the final startup state plus any
// metadata the recovery screen needs (e.g. mandatory update details).
export async function runStartupPipeline() {
  const result = { state: STARTUP_STATE.RUNNING, stage: null, error: null, config: DEFAULT_CONFIG };

  // 1) Environment validation.
  result.stage = "env";
  if (!API_BASE_URL || !/^https?:\/\//.test(API_BASE_URL)) {
    result.state = STARTUP_STATE.CONFIG_ERROR;
    result.error = "API endpoint is not configured on this build.";
    log("error", "env", "invalid API_BASE_URL");
    return result;
  }
  const os = Platform.OS;
  const sdk = Constants.expoConfig?.sdkVersion || Constants.expoConfig?.version || null;
  log("info", "env", `os=${os} sdk=${sdk} api=${API_BASE_URL}`);

  // 2) Local storage validation and corrupted-storage recovery.
  result.stage = "storage";
  try {
    const token = await getToken();
    if (token !== null && typeof token !== "string") {
      // A token that isn't a string means corrupted storage — reset cleanly.
      await clearToken();
      log("warn", "storage", "corrupted token cleared");
    }
  } catch (err) {
    // SecureStore unreadable: try to clear so the app can proceed to login.
    try {
      await clearToken();
    } catch {
      // Storage entirely unavailable — surface as a recoverable warning.
    }
    result.state = STARTUP_STATE.STORAGE_ERROR;
    result.error = "Local storage could not be validated.";
    log("error", "storage", err && err.message);
    return result;
  }

  // 3) API health check.
  result.stage = "health";
  try {
    const health = await checkHealth();
    log("info", "health", `db=${health && health.db}`);
  } catch (err) {
    // Network / server down. Never a blank screen: return a NETWORK_ERROR so
    // the recovery screen can offer Retry / Check connection / Continue offline.
    result.state = STARTUP_STATE.NETWORK_ERROR;
    result.error = "Could not reach the GetInRoute server.";
    log("error", "health", err && err.message);
    return result;
  }

  // 4) Configuration / update availability.
  result.stage = "config";
  try {
    const cfg = await fetchAppConfig();
    const merged = { ...DEFAULT_CONFIG, ...(cfg && typeof cfg === "object" ? cfg : {}) };
    result.config = merged;
    if (merged.mandatoryUpdate) {
      result.state = STARTUP_STATE.MANDATORY_UPDATE;
      log("warn", "config", `mandatory update ${merged.latestVersion}`);
      return result;
    }
  } catch (err) {
    // Config fetch failure is non-fatal for ordinary usage.
    log("warn", "config", err && err.message);
  }

  // 5) Authentication restoration happens in AuthProvider (already wired).
  //    When we get here the app is safe to initialise.
  result.state = STARTUP_STATE.READY;
  return result;
}