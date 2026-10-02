/* Central app configuration for the public website.
 *
 * apps.json is the single source of truth. This module only derives a view
 * model from it so every page (Landing, /apps) behaves identically and no URL
 * is ever hard-coded in a component.
 *
 * iOS behaviour is derived, never hand-set:
 *   iosUrl present  -> iPhone button renders as a real link
 *   iosUrl null     -> iPhone button renders disabled, no href, no placeholder
 */
import appsConfig from './apps.json';

export const RELEASE_VERSION = appsConfig.releaseVersion;
export const ANDROID_MIN = appsConfig.androidMinVersion;
export const DISTRIBUTION_EMAIL = appsConfig.distributionEmail;

export const APP_KEYS = ['employee', 'driver', 'school', 'parent'];

/** Raw config, in a stable order. */
export const APP_CONFIG = APP_KEYS
  .filter((k) => appsConfig.apps[k])
  .map((key) => ({ key, ...appsConfig.apps[key] }));

/**
 * A platform is available only when a real URL exists. This is the single
 * decision point the UI uses, so a null url can never render as a link.
 */
export function platform(app, name) {
  // Android prefers a Google Play listing when one is configured; until then the
  // hosted APK is the install path. Setting playUrl is the only change needed.
  const url = name === 'ios' ? app.iosUrl : (app.playUrl || app.androidUrl);
  const id = name === 'ios' ? app.iosBundleId : app.androidPackage;
  const available = typeof url === 'string' && url.trim().length > 0;
  return {
    name,
    url: available ? url : null,
    id: id || null,
    available,
    fromStore: name === 'android' && !!(app.playUrl && app.playUrl.trim()),
    label: name === 'ios' ? 'iPhone' : (app.playUrl ? 'Google Play' : 'Android APK'),
    // Copy shown next to a platform that is not yet installable.
    pendingNote: name === 'ios' && !available && id
      ? `iPhone build is ready as ${id} \u2014 awaiting App Store release`
      : null
  };
}

export const androidOf = (app) => platform(app, 'android');
export const iosOf = (app) => platform(app, 'ios');

/**
 * Back-compat view model for existing call sites: `app.android.state`,
 * `app.android.url`, `app.ios.*`, `app.web.*`.
 */
export const APP_LINKS = APP_CONFIG.map((app) => ({
  key: app.key,
  name: app.name,
  shortName: app.shortName,
  desc: app.blurb,
  features: app.features,
  // 'coming-soon' hides the install affordances without removing the card, so
  // flipping apps.json back to 'available' is the only change needed to publish.
  status: app.status === 'coming-soon' ? 'coming-soon' : 'available',
  downloadPage: app.downloadPage || `/apps/${app.key}`,
  version: app.version || appsConfig.releaseVersion,
  web: {
    state: app.webUrl ? 'available' : 'coming-soon',
    url: app.webUrl || '',
    label: app.webLabel
  },
  android: {
    state: app.androidUrl || app.playUrl ? 'available' : 'coming-soon',
    url: app.playUrl || app.androidUrl || '',
    label: app.playUrl ? 'Google Play' : 'Android APK',
    pkg: app.androidPackage
  },
  ios: {
    state: app.iosUrl ? 'available' : 'coming-soon',
    url: app.iosUrl || '',
    label: 'iPhone',
    bundleId: app.iosBundleId
  }
}));

export const APP_STATUS_LABEL = {
  available: 'AVAILABLE',
  'coming-soon': 'COMING SOON'
};

/** The three shipped mobile apps, in the order the site lists them. */
export const SHIPPED_APPS = APP_CONFIG.filter((a) => a.androidUrl || a.iosUrl);
