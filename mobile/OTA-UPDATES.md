# GetInRoute — Expo OTA Auto-Update Runbook

This app uses **Expo EAS Update** to push JS/asset changes to installed
Android APKs over the air — no rebuild or reinstall needed for logic/UI
changes (as long as you don't add a new native module).

## What's already configured (done in this session)

- `expo-updates` (`~0.25.28`, SDK 51 compatible) installed.
- `app.json` `expo.updates`:
  - `url`: `https://u.expo.dev/25f0833c-90f8-426f-bacb-0e2e12527a3e`
  - `enabled: true`
  - `checkAutomatically: "ON_LOAD"` — the app checks for a newer update
    each time it loads and falls back to the installed bundle.
  - `fallbackToCacheTimeout: 0` — start as fast as possible, apply update
    when downloaded.
  - `runtimeVersion.policy: "appVersion"` on both iOS and Android — updates
    are tagged to the app version, so a new native build (version bump) is a
    clean break that ignores older OTA updates.
- `eas.json` `update.production.channel: "production"`.
- `extra.eas.projectId`: `25f0833c-90f8-426f-bacb-0e2e12527a3e`

## Prerequisites (one-time, needs YOUR Expo/EAS account)

You must be logged in with the Expo account that owns this project
(`clementedwins-team`, EAS account `cedwinperoli`).

```bash
cd "C:\Users\User\Documents\Default Project\getinroute\mobile"
npx eas login
```

If not already linked, ensure config matches the EAS project id above; the
`owner` field is `clementedwins-team` in `app.json`.

## Publishing a new OTA update

After every change to the JS/TS in `src/` or assets:

```bash
npx eas update --channel production --message "describe the change"
```

That's it. The next time an installed app loads, it pulls the new JS bundle
automatically. To see history / roll back:

```bash
npx eas update:list   # list published updates per group
npx eas update:repair # fix a bad/pending update
```

## When you MUST rebuild a new APK instead

Rebuild + reinstall (`npx eas build --profile preview --platform android`)
only when you:
1. Add/remove a **native** dependency (a new `expo-*` or RN native module),
   change native config in `app.json`, permissions, icons, or the package
   name / versionCode.
2. Need to change `runtimeVersion` (i.e. bump `version` in `app.json`) —
   an OTA update can never cross a runtime version.

Because `runtimeVersion` uses `appVersion`, keep `version` in `app.json`
in sync whenever you bump it, and always publish an OTA update for the new
version so users on the fresh build get the latest JS.

## Verification checklist

- [ ] `npx eas update --channel production` succeeds and lists a new group.
- [ ] An installed APK shows the new UI after reload (check
      `expo-updates` console logs for a fetch).
- [ ] No native module was added without rebuilding.

## Rollback

To force every client back to a known-good update, use
`npx eas update --channel production --message "rollback"` pointing at a
revert commit, or use `eas update:repair` / the EAS web dashboard to
re-point the channel.

## Changelog (this task — pending OTA publish)

These are JS/UI + API-client changes only (no new native modules), so they ship
via `npx eas update --channel production` — a fresh APK build is NOT required.
Backend API changes are already live on https://www.getinroute.in.

- **Employee swipe check-in (SwipeButton):** fixed stale-closure bug that could
  fire an outdated callback and leave the knob stuck; the knob now resets and a
  re-swipe is possible after a failure. (`src/components/SwipeButton.js`)
- **Employee — check-in OTP display:** the allotted-cab card now shows the
  driver's check-in code when present. (`src/screens/employee/EmployeeHomeScreen.js`)
- **Employee — check-in gating:** swipe check-in only unlocks once the cab has
  reached (`arrived`/`boarding`/`dropping`); otherwise a "Waiting for driver
  arrival" notice is shown. Matches the new backend gate. (`EmployeeHomeScreen.js`)
- **Employee — history delete:** cab bookings can be deleted from Trip history
  (calls `DELETE /api/schedules/:id`). (`src/screens/employee/EmployeeHistoryScreen.js`)
- **Driver — request cancellation:** "Request cancellation" button + reason modal
  on the active run card; submits `POST /api/driver/trip action=cancel` which
  files a cancel request for admin/vendor approval. (`DriverHomeScreen.js`)
- **Driver — parking line:** new `api/driver.js` helpers (`setParkingLine`,
  `getParkingLine`) backing the standing-point grid → `POST /api/driver/parking-line`.

> ⚠️ Item 3 (push-deep-link to live driver location) is NOT yet implemented: the
> backend does not serve remote push, and this app has no deep-link URL scheme.
> A partial foundation (local-notification banner on assignment) is in place via
> this task's `src/services/notifications.js`, but true background push needs FCM/APNs
> on the backend + a URL scheme.

---

## Changelog (TTS voice announcements — REQUIRES APK REBUILD)

> ⚠️ **Rebuild needed.** This task adds a new **native module** (`expo-speech`),
> so an OTA update alone will NOT enable speech on already-installed APKs — the
> native code isn't in the existing binary. Rebuild + reinstall:
> `npx eas build --profile preview --platform android` (and iOS), then optionally
> `npx eas update` to refresh JS on top.

- **New: `expo-speech` dependency** (`~12.0.2`, SDK 51 compatible) — cross-platform
  TTS (Android TextToSpeech / iOS AVSpeechSynthesizer). (`package.json`)
- **New `src/services/voice.js`:** TTS engine with a persisted on/off toggle
  (SecureStore, default ON), the announcement text as string constants
  (`TRIP_SCHEDULED_MESSAGE`, `TRIP_ASSIGNED_MESSAGE`), fire-and-forget
  non-blocking speech using the device's default language, and a per-event
  dedup guard so the same event never announces twice.
- **New `src/services/notifications.js`:** expo-notifications handler + permission
  request + a local "Trip updated" banner, so an assignment is surfaced even after
  the driver backgrounds the app.
- **New `src/screens/shared/SettingsScreen.js`:** "Voice announcements" toggle
  (default ON) reachable from both apps.
- **Employee — schedule success voice:** plays
  `"Your schedule is successfully completed."` only when a schedule is genuinely
  created (not on skipped/failed requests). (`src/screens/employee/EmployeeScheduleScreen.js`)
- **Driver — trip assignment voice:** when a new run/trip is assigned (seen via
  loadTrip/socket AppState-foreground refresh), plays
  `"Your trip for this day is successfully updated."` and fires a local
  notification. Dedup by run id so a single assignment announces once — not from
  both a notification path and an in-app state update. (`src/screens/driver/DriverHomeScreen.js`)
- **Navigation:** `Settings` screen registered in both Employee and Driver stacks
  and linked from the home menus. (`src/navigation/RootNavigator.js`, home screens)

Publish/rebuild command (after rebuilding, refresh JS):
```bash
npx eas build --profile preview --platform android --platform ios
npx eas update --channel production --message "TTS voice announcements (employee schedule success + driver trip assigned), voice toggle in Settings"
```

