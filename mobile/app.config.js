// Dynamic app config: the same Expo project ships as genuinely separate
// builds. APP_VARIANT is baked at build time by eas.json ('company' => the
// GetInRoute employee + driver app, 'driver' => GetInRoute Driver, 'school' =>
// GetInRoute School). Each variant gets its own identity: distinct display
// name, Android package / iOS bundle id and runtime data. The runtime entry
// (App.js) reads extra.appVariant to mount the matching root, so each build is
// a real, separate app and never shows another variant's branding.
const VARIANT = (process.env.APP_VARIANT || 'company').toLowerCase();
const IS_SCHOOL = VARIANT === 'school';
const IS_DRIVER = VARIANT === 'driver';

const identity = IS_SCHOOL
  ? { name: 'GetInRoute School', pkg: 'com.getinroute.school', vc: 1, bg: '#0F766E' }
  : IS_DRIVER
    ? { name: 'GetInRoute Driver', pkg: 'com.getinroute.driver', vc: 1, bg: '#10141A' }
    : { name: 'GetInRoute', pkg: 'com.getinroute.employee', vc: 23, bg: '#10141A' };

module.exports = {
  expo: {
    name: identity.name,
    slug: 'clement',
    version: '1.0.4',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    updates: {
      url: 'https://u.expo.dev/25f0833c-90f8-426f-bacb-0e2e12527a3e',
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      runtimeVersion: { policy: 'appVersion' }
    },
    icon: IS_SCHOOL ? './assets/school-icon.png' : './assets/icon.png',
    splash: {
      backgroundColor: identity.bg
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: identity.pkg,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'GetInRoute needs your location to track your commute and, for drivers, to share live position with employees and admins.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'GetInRoute needs background location during an active trip so live tracking keeps working while the app is minimized.'
      },
      runtimeVersion: { policy: 'appVersion' }
    },
    android: {
      package: identity.pkg,
      compileSdkVersion: 35,
      targetSdkVersion: 35,
      runtimeVersion: { policy: 'appVersion' },
      adaptiveIcon: {
        foregroundImage: IS_SCHOOL ? './assets/school-adaptive-icon.png' : './assets/adaptive-icon.png',
        backgroundColor: identity.bg
      },
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION'],
      config: {
        googleMaps: { apiKey: 'AIzaSyDZ6JqrpMh1o8_zbtR_N1RNjaPDJQKSEgE' }
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