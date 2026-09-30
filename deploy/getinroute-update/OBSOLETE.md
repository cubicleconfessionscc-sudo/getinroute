# OBSOLETE - do not use this folder for deployment

**Status: superseded. Kept only as a historical record. Nothing in here is used by
any automated process. Do not overlay it onto any live system.**

## What this folder is

A hand-assembled deployment package dated **2026-09-10**, produced before the
project moved to automated deployments. It was meant to be copied file-by-file
onto a separate live checkout (`D:\Default Project Portable\Project`) by hand,
following `docs/GETINROUTE_DEPLOY_TO_LIVE.md` and the `DEPLOY_NOW.md` that sits
beside this file.

## Why it is obsolete

Production is no longer deployed that way. The current and only automated path is:

```
.github/workflows/deploy.yml
  -> git checkout
  -> npm ci / build (frontend)
  -> railway up   (working-directory: backend)
```

Verified on 2026-09-30:

- No CI workflow, npm script, Railway config, Dockerfile, Procfile, or
  `railwayignore` references `deploy/` or `getinroute-update`. The only two files
  in the repository that mention `getinroute-update` are the two runbooks named
  above.
- The admin SPA bundle in this snapshot is `index-MxKihUk4.js`. The live
  `backend/public/admin/index.html` references `index-D0tFCK7R.js` and has no
  reference to `index-MxKihUk4.js`. This bundle is dead.
- Production Railway deployment is `c8626c27-189b-4fbc-88d0-f5653031bcdb`
  (`SUCCESS`), which comes from the GitHub Actions pipeline, not from this
  package.

## Two concrete hazards - do not run the old runbooks

1. **It would downgrade the backend.** The snapshot's `backend/server.js` is
   4,617 lines. The current `backend/server.js` is 6,151 lines. Copying this
   snapshot over a live tree replaces current code with older code, silently
   losing later fixes.

2. **It contains a leaked API key.** `backend/public/admin/assets/index-MxKihUk4.js`
   embeds the Google Maps API key that has since been removed from tracked
   source (`mobile/app.config.js`). Because the key also exists in git history
   and inside the already-published APK/AAB binaries, deleting this folder does
   **not** remove the exposure. The only effective mitigations are to restrict
   the key in the Google Cloud console, or rotate it.

   See `docs/MOBILE_MAPS_SETUP.md` for the required restrictions.

## What was done about it

- The key was removed from tracked source (`mobile/app.config.js`,
  `mobile/app.json.example`) and is now supplied through the EAS production
  environment.
- This folder was left in place deliberately rather than deleted blind. It is
  still tracked in git, so the key remains in history regardless.

## Safe removal

This folder is no longer referenced by any process. If you choose to remove it:

```bash
git rm -r deploy/getinroute-update
```

Also consider retiring `docs/GETINROUTE_DEPLOY_TO_LIVE.md`, which documents the
same superseded manual procedure. Neither change affects production.
