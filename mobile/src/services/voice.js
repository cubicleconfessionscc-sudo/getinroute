// =============================================================================
// Voice announcement (text-to-speech) service.
//
// Uses the platform's native TTS via expo-speech (Android TextToSpeech /
// iOS AVSpeechSynthesizer). Announcements are fire-and-forget and never block
// the UI. The wording is kept in the constants below so it can be changed in
// one place without touching the trigger logic.
//
// The enabled/disabled preference is persisted so it survives restarts and is
// shared across both the Employee and Driver apps (defaults to ON).
//
// IMPORTANT (blank-screen protection): expo-speech / expo-secure-store are
// NATIVE modules. A static `import * as Speech from "expo-speech"` evaluates
// at bundle load time and throws if the installed binary predates the module
// (e.g. an OTA update pushed JS that references a newer native than the APK
// contains). That throw happens below React, so the ErrorBoundary can't catch
// it and the app renders a blank white screen. Every native module below is
// therefore acquired lazily via require() inside try/catch, so a missing
// native simply disables the feature instead of killing the app.
// =============================================================================

export const TRIP_SCHEDULED_MESSAGE = "Your schedule is successfully completed.";

export const TRIP_ASSIGNED_MESSAGE = "Your trip for this day is successfully updated.";

export const BOOKING_SUBMITTED_MESSAGE =
  "Your cab request has been submitted. You will be notified once it's approved.";

const VOICE_ENABLED_KEY = "gir_voice_enabled";

// Cache the toggle so we don't hit disk on every event.
let voiceEnabledCache = null;

// Lazily-acquired native modules. null => unavailable (feature disabled),
// never a hard failure.
let SpeechModule = null;
let SecureStoreModule = null;

function requireSpeech() {
  if (SpeechModule === null) {
    try {
      SpeechModule = require("expo-speech");
    } catch {
      SpeechModule = false;
    }
  }
  return SpeechModule;
}

function requireSecureStore() {
  if (SecureStoreModule === null) {
    try {
      SecureStoreModule = require("expo-secure-store");
    } catch {
      SecureStoreModule = false;
    }
  }
  return SecureStoreModule;
}

export async function getVoiceEnabled() {
  try {
    const store = requireSecureStore();
    if (!store) return false;
    if (voiceEnabledCache == null) {
      const raw = await store.getItemAsync(VOICE_ENABLED_KEY);
      // Default to ON. Only an explicit "false" disables announcements.
      voiceEnabledCache = raw === null ? true : raw === "true";
    }
    return voiceEnabledCache;
  } catch {
    return false;
  }
}

export async function setVoiceEnabled(enabled) {
  try {
    const store = requireSecureStore();
    if (!store) return !!enabled;
    voiceEnabledCache = !!enabled;
    await store.setItemAsync(VOICE_ENABLED_KEY, voiceEnabledCache ? "true" : "false");
    return voiceEnabledCache;
  } catch {
    return !!enabled;
  }
}

// Used by the Settings screen to present the current value immediately.
export function getVoiceEnabledSync() {
  return voiceEnabledCache == null ? true : voiceEnabledCache;
}

// Guard against the same event announcing twice (e.g. once from the local
// notification path and again from an in-app socket/state update). Each unique
// event id is only spoken once per app session.
const announcedEvents = new Set();

function isAlreadyAnnounced(key) {
  if (!key) return false;
  if (announcedEvents.has(key)) return true;
  announcedEvents.add(key);
  return false;
}

// Core fire-and-forget speak. `key` is an optional unique event id used for
// dedup; omit it when the caller wants no dedup. `options` is passed straight
// to expo-speech. Uses the device's default language unless overridden.
async function speak(text, key, options = {}) {
  try {
    const enabled = await getVoiceEnabled();
    if (!enabled) return;
    if (key && isAlreadyAnnounced(key)) return;

    const speech = requireSpeech();
    if (!speech) return;

    // Fire-and-forget: never await speech completion from the caller. Stopping
    // any in-flight utterance first keeps overlapping announcements from
    // stacking on top of one another.
    speech.stop();
    speech.speak(text, {
      language: undefined, // device default language
      rate: options.rate ?? 1.0,
      pitch: options.pitch ?? 1.0,
      ...options
    });
  } catch {
    // TTS is best-effort; a failure must never break the app flow.
  }
}

// Employee: played after a schedule is successfully created.
export function speakTripScheduled() {
  speak(TRIP_SCHEDULED_MESSAGE);
}

// Employee: played right after a cab request is submitted (requests are queued
// for admin approval, so this is the moment the booking is *made*).
export function speakTripBooked() {
  speak(BOOKING_SUBMITTED_MESSAGE, `booked:${Date.now()}`);
}

// Driver: played when a trip/run is assigned or newly updated. `eventId` is a
// unique id for that assignment (e.g. the allotment id) so the same assignment
// never announces twice.
export function speakTripAssigned(eventId) {
  speak(TRIP_ASSIGNED_MESSAGE, `assigned:${eventId}`);
}