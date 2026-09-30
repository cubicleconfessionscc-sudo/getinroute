# App Store / TestFlight submission

Target Apple distribution account: **cubicleconfessionscc@gmail.com**
Apps: `com.getinroute.employee`, `com.getinroute.driver`, `com.getinroute.school`

> The EAS account currently used by this project is a **different** team
> (`clementedwins-team` / `edwinclement71@gmail.com`). Nothing may be signed or
> submitted under that team. Complete "Step 1" before running any build.

## Step 1 - connect the correct Apple team (required, manual)

EAS never needs your password, private key, or 2FA code in this repository or in
a chat message. Authenticate interactively in your own terminal:

```bash
cd mobile
npx eas-cli whoami                 # confirm the current account
npx eas-cli logout
npx eas-cli login                  # sign in as cubicleconfessionscc@gmail.com
```

`eas login` prints a one-time code and opens a browser. Complete it there. Then:

```bash
npx eas-cli whoami                 # must show the intended account/team
```

If the account is not yet an EAS organisation member, create/join the org at
https://expo.dev/accounts and invite `cubicleconfessionscc@gmail.com`, or ask the
existing org owner to invite it.

Separately, in **Apple Developer** (developer.apple.com) the same Apple ID must
have:

- an active paid **Apple Developer Program** membership,
- the three App IDs registered: `com.getinroute.employee`,
  `com.getinroute.driver`, `com.getinroute.school`,
- **App Store Connect** access, and accepted **Tax/Banking** agreements,
  otherwise submissions are rejected automatically.

## Step 2 - set the mobile maps key (required for store builds)

`mobile/app.config.js` now reads `GOOGLE_MAPS_API_KEY` from the environment and
**fails a production build** if it is missing. See `docs/MOBILE_MAPS_SETUP.md`.

```bash
npx eas-cli env:create --environment production \
  --name GOOGLE_MAPS_API_KEY --visibility plaintext
```

## Step 3 - register credentials (interactive only)

```bash
npx eas-cli build --platform ios --profile ios-archive-employee
```

EAS stops and offers to set up signing interactively. Run it in a terminal that
can complete Apple ID + 2FA. It will create the distribution certificate and the
App Store provisioning profile, and store them in EAS. Non-interactive builds
fail with "Distribution Certificate is not validated for non-interactive builds"
until this is done.

## Step 4 - build and upload to TestFlight

```bash
npx eas-cli build --platform ios --profile ios-archive-employee --non-interactive
npx eas-cli build --platform ios --profile ios-archive-driver   --non-interactive
npx eas-cli build --platform ios --profile ios-archive-school   --non-interactive
```

`distribution: "store"` uploads to **TestFlight**. (Profiles with
`distribution: "internal"` produce ad-hoc builds that never reach TestFlight.)

Build numbers: `ios.buildNumber` is `1` for all three apps. iOS requires a
strictly increasing build number per version per app, so bump `iosb` before any
re-submission after a rejection.

## Step 5 - App Store Connect metadata (per app)

- App name, subtitle, description, keywords, support URL, marketing URL
- **Privacy**: declare collected data - precise location, and any contact or
  user-content data actually collected. Tracking is declared `false`
  (`NSPrivacyTracking` in the build). Answer the App Privacy Questions.
- **Age rating** questionnaire
- **Screenshots** - at least one 6.9"/6.7" iPhone set per localisation
- Export compliance: already set to non-exempt (`usesNonExemptEncryption: false`)
- A **PrivacyInfo.xcprivacy** privacy manifest is required if any bundled SDK
  uses required-reason APIs. Expo ships one per SDK; confirm the final app
  contains it after the first archive.

## Step 6 - TestFlight testing, then submission

Distribute to internal testers, then submit for App Review. Only after approval
does a genuine `apps.apple.com` URL exist.

## Step 7 - enable the website iPhone buttons

Only when a real App Store or TestFlight link exists, edit
**only** `frontend/src/config/apps.json`:

```json
"iosUrl": "https://apps.apple.com/app/id<APP_ID>"
```

then run:

```bash
node scripts/sync-site-apps.mjs          # regenerate the static page
node scripts/verify-site-config.mjs      # gate
```

The iPhone buttons enable automatically. Never hand-edit
`backend/public/website/index.html`, and never invent an `apps.apple.com` URL to
make the page look complete.

## Current blocking state

Blocked at **Step 1**: the correct Apple team is not authenticated, and no
Apple distribution certificate, provisioning profile, or App Store Connect key
exists. Nothing is signed or submitted until that is resolved.