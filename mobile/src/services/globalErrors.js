import { LogBox } from "react-native";

// Global error resilience (spec: global error boundaries, unhandled promise
// rejection handling, startup exception handling). Registered once from the
// app root. Its job is to make sure an uncaught JS error NEVER produces a
// silent blank screen — it always logs and, where the ErrorBoundary can't
// catch it (errors outside the React tree), at least surfaces them clearly.

let registered = false;

const LOG_PREFIX = "[GetInRoute:global-error]";

function safeLog(message) {
  try {
    console.error(LOG_PREFIX, message);
  } catch {
    // Swallow - logging must never throw.
  }
}

export function registerGlobalErrorHandlers() {
  if (registered) return () => {};
  registered = true;

  const cleanup = [];

  // 1) Uncaught JS errors that escape the React tree.
  if (global.ErrorUtils && typeof global.ErrorUtils.setGlobalHandler === "function") {
    const prev = global.ErrorUtils.getGlobalHandler
      ? global.ErrorUtils.getGlobalHandler()
      : null;
    global.ErrorUtils.setGlobalHandler((error, isFatal) => {
      safeLog((isFatal ? "FATAL" : "non-fatal") + " error: " + (error && error.message));
      if (error && error.stack) safeLog(error.stack.split("\n").slice(0, 12).join("\n"));
      // Always forward to the previous handler so default behaviour (and any
      // downstream logging) still runs.
      if (prev) {
        try {
          prev(error, isFatal);
        } catch {
          // ignore
        }
      }
    });
    cleanup.push(() => {
      registered = false;
      if (prev && global.ErrorUtils.setGlobalHandler) {
        try {
          global.ErrorUtils.setGlobalHandler(prev);
        } catch {
          // ignore
        }
      }
    });
  } else {
    safeLog("ErrorUtils unavailable — global JS handler not installed");
  }

  // 2) Unhandled promise rejections.
  if (global.__unhandledPromiseRejectionHandler) {
    // Some environments install their own; prefer not to clobber it.
  }
  const unhandledListener = (reason) => {
    safeLog("unhandled promise rejection: " + (reason && (reason.message || reason)));
    if (reason && reason.stack) safeLog(reason.stack.split("\n").slice(0, 8).join("\n"));
  };
  if (typeof global.addEventListener === "function") {
    global.addEventListener("unhandledrejection", unhandledListener);
    cleanup.push(() => {
      try {
        global.removeEventListener("unhandledrejection", unhandledListener);
      } catch {
        // ignore
      }
    });
  }

  // 3) Keep React Native dev warnings from flooding real crash logs.
  try {
    LogBox.ignoreLogs(["Require cycle:", "Setting a timer"]);
  } catch {
    // ignore
  }

  return () => cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}