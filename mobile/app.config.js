// Dynamic app config: the same Expo project ships as genuinely separate
// builds. APP_VARIANT is baked at build time by eas.json ('company' => the
// GetInRoute employee + driver app, 'driver' => GetInRoute Driver, 'school' =>
// GetInRoute School). Each variant gets its own identity: distinct display
// name, Android package / iOS bundle id and runtime data. The runtime entry
// (App.js) reads extra.appVariant to mount the matching root, so each build is
// a real, separate app and never shows another variant's branding.
const VARIANT = (process.env.APP_VARIANT || 'company').toLowerCase();

// 'company' and 'employee' are the same build (the employee app); eas.json uses
// both spellings. A typo must never silently fall through to the employee
// build, because that would publish the wrong app to the App Store under the
// employee bundle id. Validate before anything is generated.
const KNOWN_VARIANTS = ['company', 'employee', 'driver', 'school'];
if (process.env.EAS_BUILD_PROFILE === 'production' && !KNOWN_VARIANTS.includes(VARIANT)) {
  throw new Error(
    `Unknown APP_VARIANT "${process.env.APP_VARIANT}". Expected one of: ` +
      KNOWN_VARIANTS.join(', ')
  );
}
const IS_SCHOOL = VARIANT === 'school';
const IS_DRIVER = VARIANT === 'driver';
const VERSION = '1.0.5';

// Google Maps is genuinely required on mobile: DriverHomeScreen and
// EmployeeHomeScreen render react-native-maps, which uses the Google provider.
// Expo writes this value into AndroidManifest as com.google.android.geo.API_KEY,
// so a store build without it renders a blank map instead of failing loudly.
//
// The key is read from the environment instead of being committed. Note that a
// mobile maps key is not a secret in the usual sense - it is shipped inside
// every APK/IPA binary and can be extracted from it. Restricting it in the
// Google Cloud console (Android package + signing certificate, iOS bundle id,
// and only the Maps SDK for iOS/Android + Places APIs) is the actual
// mitigation; see docs/MOBILE_MAPS_SETUP.md.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// EAS sets EAS_BUILD_PROFILE for hosted builds. Only a release build is
// required to have the key, so local development and preview builds are
// unaffected, but a store build can never silently ship a broken map.
if (process.env.EAS_BUILD_PROFILE === 'production' && !GOOGLE_MAPS_API_KEY) {
  throw new Error(
    'GOOGLE_MAPS_API_KEY is required for a production (store) build. Set it in ' +
      'EAS: eas env:create --environment production --name GOOGLE_MAPS_API_KEY ' +
      '--visibility plaintext. Do not commit the key to git.'
  );
}

// `vc` is the Android versionCode and `iosb` is the iOS CFBundleVersion. They
// are tracked separately because Android has a long release history while iOS
// ships its first build now. iOS must increment `iosb` on every App Store
// submission; never lower either number.
const identity = IS_SCHOOL
  ? { name: 'GetInRoute School', pkg: 'com.getinroute.school', vc: 2, iosb: 1, bg: '#0F766E' }
  : IS_DRIVER
    ? { name: 'GetInRoute Driver', pkg: 'com.getinroute.driver', vc: 2, iosb: 1, bg: '#10141A' }
    : { name: 'GetInRoute', pkg: 'com.getinroute.employee', vc: 24, iosb: 1, bg: '#10141A' };

// Splash image support is opt-in: it activates only when an approved asset is
// actually present, so nothing breaks today and no branding is invented. Drop a
// 1242x2436 (or larger, same 9:19.5 ratio) PNG named splash.png (all apps) or
// school-splash.png (School only) into mobile/assets/ and it is picked up
// automatically on the next build. See docs/MOBILE_BRANDING_ASSETS.md.
const SPLASH_FILE = ['school-splash.png', 'splash.png'].find((f) =>
  require('fs').existsSync(require('path').join(__dirname, 'assets', f))
);

module.exports = {
  expo: {
    name: identity.name,
    slug: 'clement',
    version: VERSION,
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    updates: {
      url: 'https://u.expo.dev/25f0833c-90f8-426f-bacb-0e2e12527a3e',
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      runtimeVersion: VERSION
    },
    icon: IS_SCHOOL ? './assets/school-icon.png' : './assets/icon.png',
    splash: SPLASH_FILE
      ? { image: `./assets/${SPLASH_FILE}`, resizeMode: 'contain', backgroundColor: identity.bg }
      : { backgroundColor: identity.bg },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: identity.pkg,
      buildNumber: String(identity.iosb),
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'GetInRoute needs your location to track your commute and, for drivers, to share live position with employees and admins.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'GetInRoute needs background location during an active trip so live tracking keeps working while the app is minimized.',
        // React Native's template turns this on to reach a Metro dev server on
        // the LAN. A release build must not carry the local-network exemption.
        NSAppTransportSecurity: { NSAllowsLocalNetworking: false },
        // iOS suspends location updates when the app is backgrounded unless the
        // capability is declared. The driver app shares live position with the
        // employee app and admins for the whole trip, so this is required for the
        // feature to work at all on a real device.
        UIBackgroundModes: ['location'],
        // The app collects location and delivers it to the operator's own
        // backend. It does not track the user across apps/websites owned by
        // other companies, so tracking must be declared false. See
        // docs/APP_STORE_SUBMISSION.md for the remaining App Store Connect
        // privacy declarations that are answered in App Store Connect rather
        // than in Info.plist.
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: []
      },
      runtimeVersion: VERSION
    },
    android: {
      package: identity.pkg,
      compileSdkVersion: 36,
      targetSdkVersion: 36,
      runtimeVersion: VERSION,
      adaptiveIcon: {
        foregroundImage: IS_SCHOOL ? './assets/school-adaptive-icon.png' : './assets/adaptive-icon.png',
        backgroundColor: identity.bg
      },
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        // notifications.js uses expo-notifications (requestPermissionsAsync and
        // scheduleNotificationAsync). Android 13 / API 33 silently drops
        // scheduled notifications unless this is declared. The expo-notifications
        // config plugin adds it today, but relying on a transitive plugin means
        // an unattended dependency change could quietly break notifications, so
        // it is declared explicitly here.
        'POST_NOTIFICATIONS'
      ],
      config: {
        googleMaps: { apiKey: GOOGLE_MAPS_API_KEY }
      },
      versionCode: identity.vc
    },
    extra: {
      appVariant: VARIANT,
      eas: { projectId: '25f0833c-90f8-426f-bacb-0e2e12527a3e' }
    },
    owner: 'clementedwins-team'
  }
};