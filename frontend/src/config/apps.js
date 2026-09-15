/* Central app download configuration for the public website.
   Update links here only — every page (Landing, /apps, footer) reads from this file.
   state: 'available'  -> real, tested download URL exists
          'coming-soon' -> not published yet (show the "Coming Soon" button, never a fake URL)
   web:   real web sign-in route when the app is usable in the browser today.
*/
export const APP_LINKS = {
  employee: {
    key: 'employee',
    name: 'GetInRoute Employee',
    desc: 'Your daily transportation companion.',
    features: [
      'pickup and drop-off information',
      'trip status',
      'live vehicle tracking',
      'boarding',
      'notifications',
      'SOS',
      'support'
    ],
    web: { state: 'available', url: '/employee-login', label: 'Sign in on Web' },
    android: { state: 'available', url: '/download/GetInRoute.apk', label: 'Android APK' },
    ios: { state: 'coming-soon', url: '', label: 'iPhone' }
  },
  driver: {
    key: 'driver',
    name: 'GetInRoute Driver',
    desc: 'Everything a driver needs for the daily journey.',
    features: [
      'assigned trips',
      'daily schedule',
      'passenger list',
      'navigation',
      'boarding',
      'trip start/end',
      'incident reporting',
      'SOS',
      'vehicle information'
    ],
    web: { state: 'available', url: '/driver/login', label: 'Sign in on Web' },
    android: { state: 'available', url: '/download/GetInRouteDriver-v2.apk', label: 'Android APK' },
    ios: { state: 'coming-soon', url: '', label: 'iPhone' }
  },
  parent: {
    key: 'parent',
    name: 'GetInRoute Parent',
    desc: 'Stay connected to your child\u2019s school journey.',
    features: [
      'child information',
      'assigned route',
      'pickup location',
      'bus tracking',
      'pickup/drop-off updates',
      'attendance',
      'notifications',
      'emergency alerts'
    ],
    web: { state: 'available', url: '/parent/login', label: 'Sign in on Web' },
    android: { state: 'coming-soon', url: '', label: 'Android APK' },
    ios: { state: 'coming-soon', url: '', label: 'iPhone' }
  },
  school: {
    key: 'school',
    name: 'GetInRoute School',
    desc: 'A simple command center for school transportation.',
    features: [
      'students',
      'routes',
      'buses',
      'drivers',
      'attendance',
      'live tracking',
      'incidents',
      'notifications'
    ],
    web: { state: 'available', url: '/school/login', label: 'Sign in on Web' },
    android: { state: 'available', url: '/download/GetInRouteSchool.apk', label: 'Android APK' },
    ios: { state: 'coming-soon', url: '', label: 'iPhone' }
  }
};

export const APP_STATUS_LABEL = {
  available: 'AVAILABLE',
  'coming-soon': 'COMING SOON'
};