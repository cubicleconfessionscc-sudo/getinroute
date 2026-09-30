# Mobile branding assets - what is needed

Status of the branding on the three shipping apps, and exactly what has to be
supplied. Nothing here is invented: the School artwork does not exist in this
repository, and guessing at a brand for a school-transport product would be
worse than leaving the gap visible.

## What exists today

| File | Size | Used by |
|---|---|---|
| `mobile/assets/icon.png` | 432x432 | Employee + Driver app icon |
| `mobile/assets/adaptive-icon.png` | 432x432 | Employee + Driver Android launcher icon |
| `mobile/assets/school-icon.png` | 432x432 | School app icon |
| `mobile/assets/school-adaptive-icon.png` | 432x432 | School Android launcher icon |

**All four files are byte-identical** (one distinct SHA-256 across all four). The
School app therefore ships the generic GetInRoute mark even though
`mobile/app.config.js` selects the `school-*` files and applies the School teal
`#0F766E` background to the Android adaptive icon. This is verified by
`scripts/verify-mobile-assets.mjs`.

The master brand mark is `frontend/public/icon.svg`: a 512x512 rounded square,
`#0f172a` background, a `#2dd4bf` -> `#0ea5e9` gradient route with two location
pins. Use it as the starting point for the School variant so the two products
read as one family.

## What to supply

### Required before a School store submission

| Asset | Filename | Spec |
|---|---|---|
| School app icon | `mobile/assets/school-icon.png` | 1024x1024 PNG, **no alpha channel** |
| School Android adaptive glyph | `mobile/assets/school-adaptive-icon.png` | 1024x1024 PNG, transparent background allowed, art inside the centre 66% safe zone |

iOS rejects app icons containing transparency, so `school-icon.png` must be fully
opaque. The adaptive icon is masked by Android, so transparency is fine there.

### Recommended before any App Store submission

| Asset | Filename | Spec |
|---|---|---|
| Employee/Driver icon at full size | `mobile/assets/icon.png` | replace with 1024x1024, no alpha |
| Employee/Driver adaptive glyph | `mobile/assets/adaptive-icon.png` | replace with 1024x1024 |

The current 432x432 source works, but Expo upscales it to 1024x1024 for the App
Store record, so the icon is softer than it needs to be.

### Optional

| Asset | Filename | Spec |
|---|---|---|
| Splash, all apps | `mobile/assets/splash.png` | 1242x2688 PNG, aspect ratio ~2.0 |
| Splash, School only | `mobile/assets/school-splash.png` | same; takes precedence |

`mobile/app.config.js` picks up `school-splash.png` first, then `splash.png`, and
only when the file exists. With neither present it falls back to a solid
`backgroundColor`, which is acceptable for TestFlight but looks unpolished on a
real device.

## How to apply

1. Drop the files in with the exact filenames above.
2. Run the check:

```bash
node scripts/verify-mobile-assets.mjs            # report
node scripts/verify-mobile-assets.mjs --strict   # release gate, exits 1 on gaps
```

3. Build. No configuration change is needed - `app.config.js` already points at
   these paths.

## Why the check does not fail the build

`verify-mobile-assets.mjs` reports branding gaps as `WARN` in its default mode so
an unfinished asset cannot block unrelated release work. `--strict` promotes
warnings to errors. Run `--strict` as the final gate before submitting to the
App Store, when the School art is actually in place.

The script fails hard (exit 1 even without `--strict`) only for defects that
would produce a broken build: a missing icon file, a non-square icon, a
transparent `school-icon.png`, or an unreadable PNG.
