# GetInRoute Setup

## Backend

1. Install Node.js >= 22.5 and npm.
2. `cd backend`
3. `npm install`
4. Copy `.env.example` to `.env` and configure database/JWT settings.
5. Run `npm start`.

For local SQLite, leave `DATABASE_URL` empty and set `DB_PATH`. Production uses
PostgreSQL via `DATABASE_URL`.

## Google Maps Company Address picker

Set `GOOGLE_MAPS_API_KEY` in the backend environment. Enable the Google Maps
JavaScript API and Places API, and restrict the browser key by the deployed
HTTP referrers. The key is delivered to the browser at runtime through
`/api/config/public`; never hardcode it or commit a real key. If it is absent,
the picker shows **“Google Maps key not configured”**.

## Admin web bundle

1. `cd frontend && npm install && npm run build`
2. Copy `frontend/dist/*` to `backend/public/admin/`.
3. Deploy the backend from `backend/` using the configured Railway service.

See `backend/.env.example` and `docs/` for the full environment and deployment
configuration.
