# GetInRoute — Technical Writeup (Based on the Actual Codebase)

**Purpose:** A plain-English but technically accurate explanation of how the GetInRoute employee cab/tracking platform is built and deployed. Written so that someone learning full-stack development (and a manager or HR person who wants to understand it) can read it, understand it, and repeat it confidently.

> Everything below is drawn from the real code in this repository — the exact frameworks, table names, endpoint paths, and folder structures — not from a generic tutorial.

---

## Part 1 — Tech Stack Overview

### Frontend (the "admin panel" + employee/driver web apps + marketing site)

**What it is:** **React 18** with **Vite** as the build tool, using **react-router-dom** for navigation.

- Frontend code lives in `frontend/`. The entry file is `frontend/src/main.jsx`, and the whole app is written in JSX components (`.jsx` files).
- **Vite** is the "compiler." When you write React, the browser can't run it directly, so Vite bundles all of it into fast static files during `npm run build`. In development, Vite runs a live server on port 5173 so changes appear instantly.
- Key libraries used:
  - **Leaflet + react-leaflet** — the map. Leaflet shows the OpenStreetMap tiles and draws vehicle/employee markers, route lines, and popups.
  - **recharts** — the dashboard charts (graphs of trips, usage, speed alerts, etc.).
  - **lucide-react** — the icon set for buttons and menus.
  - **socket.io-client** — connects to the backend's real-time WebSocket channel (live tracking, chat, notifications).
- Tests use **Vitest** + Testing Library (there are 19 frontend tests covering parts like the vendors page, settings page, and company profile).

**Why React makes sense for this app:** getInRoute is heavily interactive and *stateful* — a live map that updates every few seconds, dashboards with charts, many distinct screens per user role. React's model of "re-render the UI when data changes" makes that kind of constantly-updating dashboard very natural, and the huge ecosystem means building a component like an address-search modal or a swipe button is quick. Vite keeps builds fast.

> Note: The same React codebase produces *several* UIs that share one login system (a detail a lot of people don't realize): the marketing Landing page, the Admin/Owner/Vendor console (`/admin`), the Employee app (`/app`), and the Driver app (`/driver`). One React app, different sets of screens depending on who logs in.

### Backend (the server / API)

**What it is:** **Node.js** with **Express 4**.

- The backend code is `backend/server.js` (about 2,570 lines — a single big file), with helper modules `backend/db.js`, `backend/mailer.js`, `backend/sms.js`, and a seed script `backend/seed.js`.
- Express is the web framework. Its job is to *listen for incoming requests* and decide what to do with each one. Every "endpoint" (like `/api/auth/login` or `/api/admin/vehicles`) is registered with Express.
- **Socket.IO** is layered on top to give real-time, two-way communication (this is how live tracking and chat work — see Part 2).
- The backend also **serves the frontend**. The built React files are copied into `backend/public/admin` and `backend/public/website`, and Express hands out those files (this is the "static frontend" section near the end of `server.js`). So one deployed Node process serves both the API and the web UI.
- Other backend libraries: **bcryptjs** (password hashing), **jsonwebtoken** (login tokens), **nodemailer** (emails), **twilio** (SMS/texting), **cors** (allows the frontend to call the API), and **node:sqlite** (the database driver — see below).

### Database

**What it is:** **SQLite**, a single-file relational database. The file is `backend/getinroute.db`, accessed through the built-in Node module `node:sqlite`.

- "Relational" means data is stored in **tables with rows and columns**, and tables are linked together by IDs.
- Every important piece of business data has a table. These are the real tables (from `backend/db.js`):

| Table | What it stores |
|---|---|
| `users` | Everyone who logs in: **employees, drivers, admins, vendors** (a `role` column distinguishes them). |
| `vendors` | The transport provider companies (e.g. PTT Travels, LUPL) who run cabs. Has its own login and password. |
| `routes` | The cab routes — name, start/end points, list of stops (with GPS lat/lng), and a speed limit. |
| `vehicles` | The cabs — plate, type, driver, capacity, current GPS position + speed + live status. |
| `schedules` | Who is assigned to which vehicle/route on which date, plus pickup/drop times. |
| `checkins` | The check-in / check-out records (swipe or OTP) — who, when, where, and by which method. |
| `tickets` + `ticket_comments` + `ticket_history` | The support/helpdesk ticket system, with comments and an audit history. |
| `chat_messages` | Driver/employee/admin in-app chat. |
| `feedback` | Employee and driver feedback/ratings. |
| `notifications` | Per-user push/in-app notifications. |
| `speed_events` | Records of when a vehicle exceeded the route speed limit. |
| `sms_log` | A log of every SMS sent (via Twilio or simulated). |
| `address_updates` | Employee home-address change requests that need admin approval. |
| `settings` | Company-wide configuration (office points, cab cutoff times, login shift times, speed limits, etc.). |
| `nodal_points` | Office/nodal pickup points with a GPS location and radius. |
| `users` extra columns | Locked-out timestamps, home GPS/home address, invite codes, `vendor_id`, etc. |

**Why SQLite here:** this is a single-deployment app (one server), and SQLite is zero-setup and lives in one file that's easy to back up and move. For GetInRoute's traffic scale it's more than enough, and it avoids the operational overhead of running a separate database server. (There's no separate DB service on Railway — the `.db` file travels with the backend.)

### Mobile app (the Android/iOS employee + driver app)

**What it is:** **React Native** built with **Expo SDK 51** (`getinroute/mobile`).

- React Native lets you write a phone app in React/JavaScript and run it on Android and iOS. **Expo** is the toolchain around it that handles building, packages, and running it.
- The native app structure mirrors the web one: `App.js` → an `AuthProvider` → a `RootNavigator` that chooses screens by role (`employee` stack vs `driver` stack vs login/auth stack).
- Key Expo packages used:
  - **expo-location** — gets the phone's GPS position.
  - **react-native-maps** — draws the live map on the phone.
  - **expo-secure-store** — stores the login token securely (instead of the browser's localStorage).
  - **expo-notifications** — push notifications.
  - **socket.io-client** — the app's real-time link to the backend.
  - **axios** — the app's HTTP client for calling the API.
- There are built binaries in the repo: `GetInRoute.apk` (Android) and `GetInRoute.aab` (the Google Play upload bundle), produced using Expo's EAS build service (`eas.json`). The backend even has a `/apk` route that can serve the APK file for download.

> **Which app do employees actually use?** Employees and drivers use the **React Native mobile app**. Managers/ops/admins/vendors use the **React web app**. Both talk to the same backend and the same database.

### Third-party services integrated

- **Google Maps / Places API** — used by the web admin "Search & select location" picker (`frontend/src/lib/gmaps.js`, `MapPicker.jsx`, `AddressPicker.jsx`) to suggest addresses and geocode. **OpenStreetMap/Nominatim** is used as the actual map rendering and as an automatic fallback so the feature still works when Google's is unavailable. *(Note: our Google Cloud project has no billing enabled, so Google geocoding errors out in production — the OSM fallback is what keeps it working.)*
- **Twilio** (`backend/sms.js`) — sending SMS/text messages (e.g. speed-limit breach alerts to admins). If Twilio isn't configured, it falls back to a "simulated" mode that just logs the message.
- **Nodemailer / SMTP** (`backend/mailer.js`) — sending email (password reset links, notifications). If no SMTP is configured it uses an Ethereal test inbox or just logs to console.
- **Google / Expo services** — Google Play build/upload for the Android app; Expo EAS for building binaries.
- **JSON Web Tokens (JWT)** — not a separate vendor, but the auth mechanism (its own implementation using the `jsonwebtoken` library).

---

## Part 2 — Architecture Explanation

### How the pieces connect

The entire system is one **Node.js backend** on one server (Railway). That single backend exposes:
1. **REST API endpoints** (e.g. `/api/admin/vehicles`) — for regular request/response data.
2. **A Socket.IO WebSocket** — for live, push-based data (locations, chat, notifications).
3. **Static web files** — the built React admin/employee/driver apps.

All clients — the web app and the mobile app — talk to this same backend:

```
                            ┌────────────────────────────────────────────────┐
                            │              RAILWAY (one server)               │
                            │                                                 │
                            │  ┌─────────────── backend/server.js ─────────┐  │
                            │  │  Express REST API  (/api/...)             │  │
                            │  │  Socket.IO realtime (live tracking/chat)  │  │
                            │  │  Static React files (public/admin, website)│  │
                            │  └───────────────┬───────────────────────────┘  │
                            │                   │ reads/writes               │
                            │              ┌────▼─────┐                      │
                            │              │SQLite db │  getinroute.db        │
                            │              └──────────┘                      │
                            └────────────────────────────────────────────────┘
```

```
  Employee/Driver phone               Admin Manager (web)                  Vendor Company (web)
  (React Native + Expo)               (React app, /admin)                  (React app, /admin, vendor role)
        │                                    │                                    │
        └────────▶  https://getinroute.in  ◀──┴────────────────────────────────────┘
                    (REST /api + Socket.IO to the same domain)
                                    │
                              SQLite database
```

**What each client can do:**

- **Employee/Driver mobile app** ↦ calls `/api/auth/*` to log in, `/api/schedules/mine` and `/api/employee/*` for their schedule, `/api/trips/*` to check in/out, and streams location over Socket.IO.
- **Admin web panel** ↦ calls `/api/admin/*` (routes, vehicles, employees, schedules, settings, tickets, live tracking).
- **Vendor web portal** ↦ authenticates with its *own* login (`/api/vendor/login`, token checked by `vendorAuth`), then reads vendor-scoped data via `/api/vendor/routes`, `/api/vendor/vehicles`, `/api/vendor/drivers`, `/api/vendor/trips`, `/api/vendor/dashboard`. Vendors are scoped to *only their* zones/routes/vehicles/employees (see RBAC below).

### Authentication & the role system (in plain terms)

**How a login works (the core idea):**
1. The client sends `email/identifier + password` to the backend.
2. The backend **hashes** the password (a one-way scramble) and compares it to what's stored — it never keeps the real password.
3. If it matches, the backend creates a **JWT** — a small, cryptographically-signed "stamp" containing the user's `id` and `role`. It's returned to the client.
4. On every future request, the client sends that stamp in an `Authorization: Bearer <token>` header. The backend verifies the signature and looks up the user.
5. The token expires after **7 days** (web/backend). The mobile app additionally tracks the expiry and shows how many days are left in the session.

**The four roles** (stored in the `role` column of `users`):

| Role | How they log in | What they can access |
|---|---|---|
| **Admin** | Web `/admin` (also the Owner, identified by emp_id `ADMIN`) | Everything: all `/api/admin/*` and `/api/owner/*` endpoints, plus manage vendors, approve companies, etc. |
| **Vendor** | Own login at `/vendor-login` (email **or** Vendor ID/code) | Only `/api/vendor/*` + a whitelist of `/api/admin/*` paths (`VENDOR_ALLOWED_PREFIXES`), **scoped** to their zones/routes/vehicles/employees via `vendorCtx()` + `vendorOwnsUser()`. |
| **Employee** | Mobile app (and web `/app`) | Their own schedule, check-in/out, trips, feedback, tickets. |
| **Driver** | Mobile app (and web `/driver`) | Their today's trips, status, notify passengers, feedback. |

**The guard chain (how the backend enforces access):** every protected endpoint is wrapped by three middleware functions in order:
- `auth` — verifies the JWT, loads the user, rejects deactivated accounts.
- `role(...)` — checks the user's `role` is on the allowed list for that endpoint; otherwise 403. Vendor tokens must additionally carry `src: 'users'` (they're mapped into the `users` table as "mirror" users, linking `users.vendor_id` → `vendors.id`).
- `ownerOnly` — restricts to the single owner account.

**Vendor scoping in plain terms:** a vendor can only see *their* employees and vehicles. The backend works this out two ways: (
1) records explicitly tagged with that vendor's `vendor_id`, and (2) employees whose home address falls inside a zone the vendor was assigned (in `vendors.assigned_locations`). `vendorOwnsUser()` and `vendorPeopleIds()` implement this. If a vendor tries to view another vendor's employee, the backend filters it out or denies access.

**On the web, role-based routing is duplicated client-side too:** `frontend/src/App.jsx` has a `Require` guard that only renders admin screens for `admin`/`vendor`, employee screens for `employee`, and driver screens for `driver` — redirecting anyone else. The mobile app does the same in `RootNavigator.js`. This is defense in depth: the UI hides what you shouldn't see, and the backend *enforces* it regardless.

### How live tracking works end-to-end

There are two sources of live position, and both end up on the same map:

**A) Real device GPS (drivers on the mobile app):**
1. The driver starts a trip; `mobile/src/services/location.js` asks the phone for GPS via **expo-location** (works in the background).
2. Every ~4 seconds (or every 20 meters) it emits a **`location:update`** event over **Socket.IO** to the backend: `{ tripId, lat, lng, speedKmph }`.
3. The backend updates the `vehicles` row (lat/lng/speed/status), broadcasts `location:broadcast` to everyone joined to that trip (`trip:<tripId>` room), and pushes a `tracking` event to all admins. It also checks whether the driver exceeded the route's speed limit and, if so, records a `speed_events` row + raises an alert (and optionally SMS's the admin).

**B) Backend simulation (for demo/dev — and the web admin "live tracking"):**
- Because real cabs aren't always running, `server.js` has a simulation loop (`startSimulation`, runs every 3 seconds) that moves active vehicles along their route's GPS stops using a haversine-distance calculation, updates the DB, and emits `tracking` to admins.
- Employees' marker positions are also derived: the app places them near their current or next stop.

**C) Display:**
- The web admin `LiveTracking.jsx` page combines **two data paths**: it polls the REST endpoint `/api/admin/tracking` every 15 seconds, **and** listens to Socket.IO `tracking` / `driver:status` events for instant updates. A Leaflet map (`LiveMap`) draws vehicle markers, employee markers, route polylines, and speed-alert cards in a side panel.

So: **device or simulator → Socket.IO → backend updates DB → backend pushes event → map re-renders.** That's the full loop.

---

## Part 3 — Deployment Explanation

### Where the backend is hosted, and what "deployment" means

**Host:** **Railway** — a cloud platform that runs your code on the internet. Our app is one Railway **service** (ID `ec6cb4eb-...`, project `4c8d0618-...`) that spins up a Node.js process. The live site is **`https://www.getinroute.in`**.

**In simple terms, a "deployment" is a rollout of new code to the running server.** The database server is a giant computer that isn't yours — you ship code to it, and users around the world hit it. When you "deploy," you're telling Railway: *"take this new code and replace the currently running version with it."*

**What happens when we push/deploy (our real pipeline):**
1. **Build the frontend:** `vite build` in `frontend/` — compiles all the React into plain HTML/CSS/JS in `frontend/dist/`.
2. **Ship it to the backend:** the old assets in `backend/public/admin/` are cleared and the new `frontend/dist/*` files are copied in. (This is why you see versioned filenames like `index-BFXMzS9Q.js` — Vite appends a hash so browsers know it's new.)
3. **Deploy to Railway:** from the `backend/` folder, run `railway up --detach`. Railway's config (`backend/railway.json`) tells it to build with **Nixpacks** (a builder that auto-detects Node), start with `npm start` (which runs `seed.js` then `server.js`), and run a **health check** on `/health`. Railway restarts the service, checks it's healthy, and only then considers the deploy complete.

So the "live site update" flow is: *build → copy files → push to Railway → Railway restarts and serves the new code.* Users see the new version after a browser refresh (hard refresh Ctrl+Shift+R clears cached old assets).

### Where the frontend/admin panel is hosted, and how getinroute.in points to it

There is **no separate frontend host.** The React admin panel is served *by the same Node backend* — from `backend/public/admin` — meaning it lives on Railway too. This keeps everything on one server and one domain.

**How the domain works:** `getinroute.in` is a **domain name** (a human-friendly address). It's configured with a **DNS record** (a CNAME/ALIAS record, plus `www.`) that points the name at Railway's server. When someone types `www.getinroute.in`, the DNS system translates that name into Railway's server address; Railway routes it to our service; our service serves either the API or the web app depending on the URL (see the `SPA_ROUTES` logic in `server.js` — e.g. `/admin`, `/vendor-login`, `/vendor-portal` return the React app shell, everything else under `/assets` is static).

### How the database is hosted and how data is persisted

- The database is **SQLite** in a plain file `backend/getinroute.db`, living *inside* the Railway service's disk. Because it's just a file that the single Node process reads/writes, there's no separate database service in the deployment.
- **Persistence / backups:** the `.db` file persists on Railway's attached volume between deploys (that's where all the real users, schedules, trips live). Backing up means copying that `.db` file. We also have a `seed.js` script that resets/loads demo data if needed, and the schema (`CREATE TABLE IF NOT EXISTS ...`) auto-creates tables on startup via `db.js`, so the DB is always in a working state.
- **Important practical caveat (be honest about this):** because it's a single file on the app server, the safest backup practice is to download/copy the `.db` file regularly (or move to a managed DB if the data grows to require zero-downtime scaling). Most of the production hardening so far focuses on the code, not multi-node scaling.

### Environment variables and API keys (a basic-level explanation)

**What an environment variable is:** a **named setting the server reads at startup**, like `PORT=4000` or `JWT_SECRET=...`. In code you write `process.env.PORT`, and the platform injects the real value. The code doesn't hardcode these values.

**Why we don't hardcode secrets in code:**
- **Security:** a secret (Google Maps key, Twilio auth token, JWT secret) written directly into source code gets **copied everywhere** — version control history, build logs, anyone who reads the repo. Better to keep it out.
- **They're configured per-environment:** dev on your laptop uses one set (`frontend/.env.local` with `VITE_GOOGLE_MAPS_API_KEY`, `backend/.env`), production on Railway uses another set (set in the Railway dashboard). The same code runs everywhere with different credentials.
- **Rotation:** if a key leaks, you can change it in one place (the env config) and restart — no code change, no redeploy.

**Examples of secrets/settings that are real env vars here:**
- `JWT_SECRET` (server.js falls back to a dev value if unset — but production must set a strong one, since it signs login tokens).
- `PORT`, `FRONTEND_URL`, `DB_PATH`.
- `SMTP_HOST / SMTP_USER / SMTP_PASS` (email), `TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM` (SMS).
- `VITE_GOOGLE_MAPS_API_KEY` (frontend — note `VITE_` prefix is how Vite exposes a var to browser code).
- `OPENROUTER_API_KEY` / `EDDIE_MODEL` / `OWNER_EMAIL` / `OWNER_EMP_ID` (from `.env.example` — an AI-assistant / owner-config feature).

> The frontend `VITE_GOOGLE_MAPS_API_KEY` is a good teaching example of the *limits* of env vars: the browser must see the key (it's included in the downloaded JS), so it can't be fully secret. That's why we additionally restrict it by **referrer** in Google Cloud so it only works when called from `getinroute.in`. Secret keys that must *never* reach the browser (Twilio auth, JWT secret) stay only on the backend.

---

## Part 4 — Development Process Summary (a narrative you can retell)

> This is how you could describe the build in a conversation, not a changelog.

"It started as a business idea: offices need to manage the cabs that pick up and drop off their employees, and right now that's done with phone calls and spreadsheets — you don't know where a cab is, whether a driver exceeded the speed limit, whether an employee actually boarded, or whether someone who didn't turn up is still marked as riding.

"So we built a platform in layers. First the **data model** — a relational database with users, routes, vehicles, schedules, check-ins, feedback, notifications — because everything else hangs off 'who is riding which cab on which route, and what happened.'

"Then we built the **backend** — a Node/Express server that exposes an API for every action (log in, view routes, create vehicles, check in, log a speed breach) and stores everything in SQLite. We wrapped it in a **role system** so admins, employees, drivers, and later vendors each only see and do what they should.

"Then the **user interfaces**. The admin dashboard in React with a live map (Leaflet) and charts. A mobile app for employees and drivers built with React Native/Expo so it actually runs on phones, reports GPS, and lets drivers stream their live location while employees swipe to check in/out. We wired real-time behavior with Socket.IO — chat, notifications, live tracking — so the map updates by itself instead of you refreshing.

"Then we kept **iterating on real problems**. Every demo and rollout surfaced bugs, and we'd trace them through the stack and fix them — for example, a recent one where Google Maps address search silently failed in production (a bad search radius value plus no billing enabled on Google Cloud), which we fixed by correcting the value and adding an OpenStreetMap fallback so it works regardless. Another was vendor login routing: the vendor login page was being served the marketing homepage instead of the app; we fixed the server's list of app routes.

"Finally we **deployed it**: built the React app, bundled it into the Node server, and pushed it all to **Railway**, pointing the **getinroute.in** domain at it. We tested live end-to-end (real logins, tracking, map search) and shipped the Android app through Expo's build service."

*The way to retell it: idea → data model → API/backend with roles → web + mobile UIs → real-time tracking → iterate on bugs → deploy to Railway behind the domain.*

---

## Part 5 — Simple Glossary

- **API (Application Programming Interface):** the set of "commands" a server understands. Like a restaurant's menu + waitstaff: your app sends a request (e.g. "give me the list of vehicles"), the server processes it against the database and returns a response. In this project, endpoints like `/api/admin/vehicles` are the API.
- **Backend:** the part of the app that runs on a server, not on your device. It holds the logic, talks to the database, enforces security, and serves data. Here: Node.js + Express in `backend/server.js`.
- **Frontend:** the part users actually see and interact with — the screens, buttons, forms, maps. Here: the React apps (web) and React Native app (mobile).
- **Database:** a structured store for the data, in tables of rows and columns. Here: SQLite (file `getinroute.db`). "Reading/writing the database" is how state persists between sessions.
- **Deployment:** the act of shipping your latest code to the server so real users can use it. "The deployment is live" = the new version is running in production.
- **Environment variable:** a named setting the running app reads from its environment rather than hardcoding — e.g. `JWT_SECRET`, `PORT`, `TWILIO_AUTH_TOKEN`. Same code, different values per machine; secrets stay out of source code.
- **Authentication:** proving *who you are* — logging in. Here: email + password, verified via bcrypt hashing, then a signed **JWT token** for later requests.
- **Authorization / Roles:** deciding *what you're allowed to do* once authenticated. Here: the `role` (admin / vendor / employee / driver) gates which endpoints and screens each user reaches.
- **Hashing:** turning a password into an unreadable, one-way "fingerprint" so the real password is never stored. Only re-hashing the entered password and comparing hashes works — you can't reverse it to reveal the original.
- **JWT (JSON Web Token):** a small signed data-stamp (`id` + `role` + expiry) the server gives you at login; you send it on each request to prove you're authenticated. It's the project's login "ticket."
- **WebSocket / Socket.IO:** a persistent two-way connection so the server can *push* updates to the client instantly (live tracking, chat) instead of the client always asking. Socket.IO is the library used here.
- **Client-side vs server-side:** "client-side" = on the user's device (mobile/React), "server-side" = on the backend. Data flows between them over the network.
- **Role-based access control (RBAC):** the pattern of restricting what each role can do. GetInRoute uses `role()` + `vendorCtx()`/`vendorOwnsUser()` in the backend, and role guards on the web and mobile so each role only sees its own screens and data.

---

*End of doc. Accuracy checklist: frameworks, roles, table names, endpoint prefixes, Socket.IO events, and deployment flow are all taken directly from the repository (`frontend/`, `getinroute/mobile/`, `backend/server.js`, `backend/db.js`, `backend/railway.json`, `.env.example`).*
