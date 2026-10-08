import { useEffect } from "react";
import { AppState } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

// Screen-awake coordinator for active trip / check-in / tracking flows.
//
// Why a coordinator instead of useKeepAwake directly: several components
// (employee home, driver home, live-tracking modal, OTP flow) can each want the
// screen kept on at the same time. A naive activate/deactivate pair would let
// one component release the lock while another still needs it. This module
// reference-counts the requests so the screen stays awake while ANY critical
// operation is active and is released the moment the last one finishes.
//
// The lock is also released whenever the app leaves the foreground, so an
// idle/backgrounded app never holds the screen on (no battery drain).
const TAG = "getinroute-active-trip";
let refCount = 0;
let appActive = true;
let appStateSub = null;

function sync() {
  try {
    if (refCount > 0 && appActive) {
      activateKeepAwakeAsync(TAG).catch(() => {});
    } else {
      deactivateKeepAwake(TAG).catch(() => {});
    }
  } catch (_) {
    // Keep-awake is best-effort; never let it crash the app.
  }
}

function ensureAppStateSub() {
  if (appStateSub) return;
  try {
    appStateSub = AppState.addEventListener("change", (state) => {
      appActive = state === "active";
      sync();
    });
  } catch (_) {}
}

export function acquireScreenAwake() {
  ensureAppStateSub();
  refCount += 1;
  sync();
}

export function releaseScreenAwake() {
  refCount = Math.max(0, refCount - 1);
  sync();
}

/**
 * Keeps the screen awake while `active` is true. Safe to call from multiple
 * components at once (reference counted). Automatically releases on unmount,
 * when `active` becomes false, and while the app is backgrounded.
 */
export function useActiveScreenAwake(active) {
  const on = !!active;
  useEffect(() => {
    if (!on) return undefined;
    acquireScreenAwake();
    return () => releaseScreenAwake();
  }, [on]);
}
