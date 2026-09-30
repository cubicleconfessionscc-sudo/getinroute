# GetInRoute iOS 1.0.5 (build 1)

Production iOS builds for all three apps, 2026-09-30.

## Status

| App | Bundle ID | Version | Build | Artifact |
| --- | --- | --- | --- | --- |
| GetInRoute Employee | `com.getinroute.employee` | 1.0.5 | 1 | verified iOS `.app` |
| GetInRoute Driver | `com.getinroute.driver` | 1.0.5 | 1 | verified iOS `.app` |
| GetInRoute School | `com.getinroute.school` | 1.0.5 | 1 | verified iOS `.app` |

Bundle IDs were **not** invented for this release. `mobile/app.config.js` already
mapped each variant's iOS `bundleIdentifier` to the same string as its Android
package, so the existing identifiers were kept and are stable for future App
Store updates.

## Artifacts

The verified bundles are stored outside git because `artifacts/` is gitignored:

```
artifacts/ios/employee/employee-1.0.5-ios-simulator.app.tar.gz   13,650,070 bytes
  sha256 a00aa49a0011173601951847519fdb26d64f49f2d7a78eae99ac58c36d03bc53
artifacts/ios/driver/driver-1.0.5-ios-simulator.app.tar.gz       13,649,531 bytes
  sha256 753b8834533053b21fc87b6517d8a8beca2a976df338f3f1afc4a22b75ea5e8a
artifacts/ios/school/school-1.0.5-ios-simulator.app.tar.gz       13,649,684 bytes
  sha256 305f55e99c7b8c2d500f986eb83e1b550dafc085992f456ea5dda3daf5dbefa8
```

EAS build IDs:

- Employee `8a871c75-bcdd-4a07-8bce-0ec7113f66ad`
- Driver `131be8d7-75b9-41fe-9d12-d8941991eef5`
- School `c1b99cb9-cce3-415c-b379-cdcd5f0a31c2`

## Verification

`scripts/verify-ios.ps1` runs 39 checks per bundle and all three pass 39/39:
bundle identifier, display name, version/build numbers, `APPL` package type,
App Transport Security (no arbitrary loads, no local-networking exemption),
non-exempt-encryption declaration, both location usage descriptions, compiled
`Assets.car` icon set, splash storyboard, minified embedded JS bundle, no
source map, no OTA update-server dependency, and variant role isolation (the
correct variant marker baked in with no cross-variant leak).

The JS bundle contains exactly one GetInRoute host, `www.getinroute.in`. There is
no loopback or emulator endpoint, no Metro dev-server port (`19000`, `19001`,
`8081`), no `expo-dev-launcher`, and no forced `__DEV__`. The only `localhost`
and `exp.host` strings are React Native / Expo library text in a shared string
table, not reachable endpoints; `scripts/verify-ios.ps1` asserts this by shape
(no loopback host is ever followed by a port or path).

## Blocker: no `.ipa` yet

These are **simulator** bundles. A simulator `.app` cannot be installed on a
real iPhone and is not an App Store submission. Producing an `.ipa` requires
Apple Developer authorization that is not available in this environment:

```
eas build --platform ios --profile ios-archive-employee
  Distribution Certificate is not validated for non-interactive builds.
  Failed to set up credentials.
  Credentials are not set up. Run this command again in interactive mode.
```

The `ios-archive-employee`, `ios-archive-driver` and `ios-archive-school`
profiles are ready in `mobile/eas.json` and use `distribution: store`. Once an
Apple Developer account and a Distribution Certificate plus provisioning profile
are supplied, each command completes the archive with no other change required.

Until then there is no genuine iOS destination for the website, so the iPhone
buttons stay disabled and name the real bundle IDs. No App Store URL was
invented.

## Build profiles

`mobile/eas.json` gained six per-variant iOS profiles. The pre-existing
`ios-testflight` profile had no `APP_VARIANT`, so every variant built through it
would have silently shipped the Employee app; the new profiles set the variant
explicitly:

- `ios-employee`, `ios-driver`, `ios-school` — simulator, Release, used for verification.
- `ios-archive-employee`, `ios-archive-driver`, `ios-archive-school` — `distribution: store`, for App Store submission.
