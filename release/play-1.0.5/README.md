# GetInRoute v1.0.5 — Google Play upload set

Retained for a future Play Console upload. **Not uploaded to Play.**

These are release-signed app bundles (signed with the shared release key, not a
debug or local-development key), built with `NODE_ENV=production` and an embedded
production JS bundle. Each was verified before being written here; re-verify with
`scripts/verify-aab.ps1` if ever in doubt.

| File | Application ID | versionName | versionCode | Size | SHA-256 |
|---|---|---|---|---|---|
| `GetInRoute-Employee-1.0.5.aab` | `com.getinroute.employee` | 1.0.5 | 24 | 48,518,110 | `a350f9317668eb11947d332bc6c8332001549518d13404fb42ccc845d58093e3` |
| `GetInRoute-Driver-1.0.5.aab` | `com.getinroute.driver` | 1.0.5 | 2 | 48,518,140 | `7094f0ebb290f956936b876f6e520cdb7d3cb6b52d051d9a5c02652bea05b8ce` |
| `GetInRoute-School-1.0.5.aab` | `com.getinroute.school` | 1.0.5 | 2 | 48,518,136 | `00aff675c5844e67eaa92022ba30531ab0c34deda7167cdd043527611d09d9e9` |

## Signing

All three bundles are signed with the same certificate:

- SHA-256: `8288c21371d0e1491502261c712c18949fc0a9b6f446301d5ff771d4805af5f6`
- DN: `CN=GetInRoute, OU=Mobile, O=GetInRoute, L=IN, ST=IN, C=IN`
- Validity: 2026-09-27 → 2054-02-12
- Keystore: `secrets/getinroute-release.jks` (never commit or upload this)

**Signing continuity:** none of these apps has ever been published on Google Play,
so this is the first and only upload. If Play later manages its own upload key
(App Signing), the certificate above is the *app signing* key and Play holds the
upload key going forward — keep a copy of it. The legacy v1.0.4 sideloaded
Driver/School builds were signed with different certificates and are not
updatable in place; those users must uninstall once.

## Before uploading

1. versionCode must be **strictly greater** than anything already published. These
   values are only valid as a first upload; bump them for any later release.
2. `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS` and `SYSTEM_ALERT_WINDOW`
   each require a declaration and a justification form in the Play Console.
3. `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` are no-ops on modern Android
   and Play may prompt to remove them.
4. There are no App Links (no `autoVerify` https intent filter), so no
   `assetlinks.json` is needed yet.
5. Native debug symbols are already embedded under
   `BUNDLE-METADATA/com.android.tools.build.debugsymbols/` in each bundle, so NDK
   symbol uploads are available if you later need them for crash de-obfuscation.

## Re-verifying

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-aab.ps1 `
  -File release\play-1.0.5\GetInRoute-Employee-1.0.5.aab `
  -ExpectPackage com.getinroute.employee -ExpectVersionCode 24 `
  -ExpectVersionName 1.0.5 -ExpectTargetSdk 36 `
  -ExpectCertSha256 8288c21371d0e1491502261c712c18949fc0a9b6f446301d5ff771d4805af5f6
```
