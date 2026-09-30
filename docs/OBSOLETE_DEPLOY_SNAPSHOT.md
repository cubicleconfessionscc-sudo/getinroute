# Obsolete: the `deploy/getinroute-update/` snapshot (removed)

**Status: obsolete, no longer referenced by anything, and removed from the
working tree on 2026-09-30. This document is the record of what it was and why it
was safe to delete.**

## What it was

A hand-assembled deployment package dated **2026-09-10**, produced before the
project moved to automated deployments. It was meant to be copied file-by-file
onto a separate live checkout at `D:\Default Project Portable\Project` by hand,
following `docs/GETINROUTE_DEPLOY_TO_LIVE.md` and a `DEPLOY_NOW.md` that sat
beside it. Roughly 6 MB across 23 files, containing a copy of `backend/server.js`,
`db.js`, `env.js`, `raw-import.js`, `seed.js`, `package.json`, the website static
page, and a prebuilt admin SPA bundle.

## Why it was obsolete

Production is no longer deployed that way. The current and only automated path is:

```
.github/workflows/deploy.yml
  -> actions/checkout
  -> npm ci + build   (working-directory: frontend)
  -> railway up       (working-directory: backend)
```

Verified before removal:

- No CI workflow, npm script, Railway config, `Dockerfile`, `Procfile`, or
  `railwayignore` referenced `deploy/` or `getinroute-update`. The only two files
  in the repository that mentioned it were its own `DEPLOY_NOW.md` and
  `docs/GETINROUTE_DEPLOY_TO_LIVE.md`.
- Its admin SPA bundle `index-MxKihUk4.js` was **not** referenced by the live
  `backend/public/admin/index.html`, which loads `index-D0tFCK7R.js`. The bundle
  was dead.
- The live Railway deployment is produced by the GitHub Actions pipeline
  (`c8626c27-189b-4fbc-88d0-f5653031bcdb`, `SUCCESS`), not from this package.

## Two hazards it carried

1. **It would have downgraded the backend.** The snapshot's `backend/server.js`
   was 4,617 lines against the current 6,151. Following the old runbook would
   have replaced current code with older code and silently dropped later fixes.

2. **It embedded a leaked Google Maps key.**
   `backend/public/admin/assets/index-MxKihUk4.js` contained the Google Maps API
   key that has since been removed from tracked source
   (`mobile/app.config.js`, `mobile/app.json.example`). The key is also present in
   git history and inside the already-published APK/AAB binaries, so **deleting
   the folder did not and could not remove the exposure**. The effective
   mitigation is restricting the key in the Google Cloud console, or rotating it.
   See `docs/MOBILE_MAPS_SETUP.md`.

## What replaced it

The key now lives only in the EAS production environment as
`GOOGLE_MAPS_API_KEY`, and `mobile/app.config.js` fails a `production` profile
build when it is missing, so a release cannot ship with the generic key silently
missing.

## Related

- `docs/MOBILE_MAPS_SETUP.md` - key restrictions that actually matter
- `docs/GETINROUTE_DEPLOY_TO_LIVE.md` - retained but banner-marked as the same
  superseded manual procedure
