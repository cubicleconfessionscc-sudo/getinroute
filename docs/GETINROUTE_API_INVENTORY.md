# GETINROUTE — API INVENTORY

> Read-only audit. Source: `backend/server.js` (Express, 5,347 lines). **~237 route definitions, ~203 unique paths.** All routes return JSON unless noted. Body limit 2 MB.
> Status legend — **VERIFIED** = exercised by the 196/196 e2e suite and/or a live probe on https://www.getinroute.in; **CODE** = present in code but no live automation yet; **LIVE** = confirmed against the deployed Railway app.

---

## 0. AUTHENTICATION MODEL (shared)

- JWT `{id, role}`, `expiresIn: '7d'` (`server.js:199`). Secret = `JWT_SECRET` env, else random-per-boot fallback.
- `auth` middleware: Bearer token only; reloads user each request; rejects if signed role ≠ DB role; rejects `status != 'active'`.
- `role('admin') / role('employee') / role('driver') / role('vendor')` + combos (`role('admin','vendor')`, `role('employee','admin')`). `ownerOnly` = `emp_id === 'ADMIN'`.
- Separate guards: `vendorAuth` (vendor table or vendor mirror-user), `schoolAdmin`, `schoolParent`; a global middleware hard-blocks `/api/admin/*` for school-vertical users.
- Rate limits (`guard`): login 120/15m, register 30/1h, forgot/reset 60/1h, company onboard 20/1h, parent register 30/1h, vendor login 60/15m. Fifth failed login locks (IP+identifier) for 15m.

---

## 1. PUBLIC / INFRA (no auth)

| # | Method | Path | Line | Status | Purpose |
|---|---|---|---|---|---|
| 1 | GET | /apk | 91 | LIVE | Download GetInRoute.apk (versioned name) |
| 2 | GET | /apk/school | 104 | LIVE | School APK (falls back to main APK) |
| 3 | GET | /health | 121 | LIVE | DB liveness probe |
| 4 | GET | /manifest.webmanifest | 5255 | CODE | PWA manifest |
| 5 | ALL | /download/* (static) | 5244 | CODE | APK/IPA/AAB downloads |
| 6 | GET | * (SPA fallback) | 5262/5271 | LIVE | Serves admin SPA + website (skips /api /socket.io) |

## 2. AUTH / ACCOUNT

| # | Method | Path | Line | Guard | Status |
|---|---|---|---|---|---|
| 7 | POST | /api/auth/login | 416 | guard(120,15m) | LIVE |
| 8 | POST | /api/auth/register | 507 | guard(30,1h) | LIVE |
| 9 | POST | /api/auth/forgot-password | 551 | guard(60,1h) | CODE |
| 10 | POST | /api/auth/reset-password | 586 | guard(60,1h) | CODE |
| 11 | GET | /api/auth/me | 604 | auth | LIVE |
| 12 | POST | /api/auth/change-password | 610 | auth | CODE |
| 13 | POST | /api/auth/parent/register | 4559 | guard(30,1h) | LIVE (school-api suite) |

## 3. COMPANY / ONBOARDING

| # | Method | Path | Line | Guard | Status |
|---|---|---|---|---|---|
| 14 | POST | /api/company/onboard | 620 | guard(20,1h) | CODE |
| 15 | GET | /api/company/lookup | 4042 | public | CODE |
| 16 | GET | /api/company/me | 4061 | auth | CODE |
| 17 | GET | /api/company/me/nodal-points | 1232 | auth | CODE |
| 18 | POST | /api/company/me/nodal-points | 1237 | auth,admin | CODE |
| 19 | PUT | /api/company/me/nodal-points/:id | 1245 | auth,admin | CODE |
| 20 | DELETE | /api/company/me/nodal-points/:id | 1254 | auth,admin | CODE |

## 4. OWNER (platform) — `auth,admin,ownerOnly`

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 21 | GET | /api/owner/stats | 715 | LIVE (probe 200) |
| 22 | GET | /api/owner/all-users | 739 | CODE |
| 23 | GET | /api/owner/login-activity | 758 | CODE |
| 24 | GET | /api/owner/data/users | 789 | CODE |
| 25 | GET | /api/owner/data/vehicles | 798 | CODE |
| 26 | GET | /api/owner/data/schedules | 802 | CODE |
| 27 | GET | /api/owner/data/checkins | 813 | CODE |
| 28 | GET | /api/owner/data/trips | 827 | CODE |
| 29 | GET | /api/owner/tracking | 2270 | CODE |
| 30 | GET | /api/owner/realtime-health | 2289 | CODE |
| 31 | GET | /api/owner/schools | 4347 | CODE |
| 32 | POST | /api/owner/schools | 4364 | CODE |
| 33 | POST | /api/owner/schools/:id/approve | 4386 | CODE |
| 34 | POST | /api/owner/schools/:id/status | 4398 | CODE |
| 35 | DELETE | /api/owner/schools/:id | 4407 | CODE |

## 5. ADMIN — FLEET & COMPANY (guards per column)

| # | Method | Path | Line | Guard | Status |
|---|---|---|---|---|---|
| 36 | GET | /api/admin/stats | 640 | admin,vendor | LIVE |
| 37 | GET | /api/admin/routes | 858 | admin,vendor | LIVE (e2e) |
| 38 | PUT | /api/admin/routes/:id/employees | 877 | admin | LIVE (e2e) |
| 39 | DELETE | /api/admin/routes/:id/employees/:employeeId | 897 | admin | LIVE (e2e) |
| 40 | POST | /api/admin/routes | 901 | admin | LIVE (e2e) |
| 41 | PUT | /api/admin/routes/:id | 910 | admin | LIVE (e2e) |
| 42 | DELETE | /api/admin/routes/:id | 922 | admin | LIVE (e2e) |
| 43 | GET | /api/admin/vehicles | 927 | admin,vendor | LIVE (e2e+vendor) |
| 44 | POST | /api/admin/vehicles | 937 | admin,vendor | LIVE (e2e) |
| 45 | PUT | /api/admin/vehicles/:id | 962 | admin,vendor | LIVE (e2e) |
| 46 | PUT | /api/admin/vehicles/:id/position | 983 | admin,vendor | CODE |
| 47 | PUT | /api/admin/vehicles/:id/route | 991 | admin,vendor | CODE |
| 48 | PUT | /api/admin/vehicles/:id/speed-limit | 1002 | admin,vendor | CODE |
| 49 | DELETE | /api/admin/vehicles/:id | 1012 | admin,vendor | CODE |
| 50 | GET | /api/admin/employees | 1021 | admin,vendor | CODE |
| 51 | GET | /api/admin/drivers | 1033 | admin,vendor | CODE |
| 52 | PUT | /api/admin/users/:id | 1041 | admin,vendor | CODE |
| 53 | DELETE | /api/admin/users/:id | 1054 | admin | CODE |
| 54 | GET | /api/admin/approvals | 1059 | admin | LIVE (e2e) |
| 55 | GET | /api/admin/pending-companies | 1066 | admin | CODE |
| 56 | POST | /api/admin/pending-companies/:id/approve | 1070 | admin | CODE |
| 57 | POST | /api/admin/pending-companies/:id/reject | 1078 | admin | CODE |
| 58 | GET | /api/admin/admins | 1087 | admin,ownerOnly | CODE |
| 59 | POST | /api/admin/admins | 1109 | admin,ownerOnly | CODE |
| 60 | DELETE | /api/admin/admins/:id | 1120 | admin,ownerOnly | CODE |
| 61 | PUT | /api/admin/admins/:id/toggle-status | 1127 | admin,ownerOnly | CODE |
| 62 | POST | /api/admin/approvals/:id | 1136 | admin | LIVE (e2e) |
| 63 | GET | /api/admin/schedules | 1158 | admin,vendor | LIVE (e2e) |
| 64 | GET | /api/admin/settings | 1181 | admin | CODE |
| 65 | PATCH | /api/admin/settings | 1195 | admin | CODE |
| 66 | POST | /api/admin/change-password | 1219 | admin | CODE |
| 67 | GET | /api/admin/users | 1261 | admin,vendor | LIVE (e2e) |
| 68 | POST | /api/admin/users/:id/unlock | 1284 | admin | CODE |
| 69 | GET | /api/admin/checkin-logs | 1293 | admin,vendor | CODE |
| 70 | GET | /api/admin/no-shows | 1331 | admin,vendor | CODE |
| 71 | GET | /api/admin/runs | 1364 | admin,vendor | CODE |
| 72 | GET | /api/admin/runs/export | 1422 | admin | CODE |
| 73 | POST | /api/admin/schedules | 1887 | admin,vendor | LIVE (e2e) |
| 74 | PUT | /api/admin/schedules/:id | 1934 | admin,vendor | CODE |
| 75 | DELETE | /api/admin/schedules/:id | 1961 | admin | CODE |
| 76 | POST | /api/admin/schedules/:id/approve | 1968 | admin,vendor | CODE |
| 77 | POST | /api/admin/schedules/:id/reject | 2018 | admin,vendor | CODE |
| 78 | POST | /api/admin/schedules/:id/cancel | 2039 | admin,vendor | CODE |
| 79 | GET | /api/admin/cancel-requests | 2062 | admin,vendor | CODE |
| 80 | POST | /api/admin/cancel-requests/:id | 2087 | admin,vendor | CODE |
| 81 | PUT | /api/admin/speed-limit/:routeId | 2121 | admin,vendor | CODE |
| 82 | DELETE | /api/admin/speed-events/:id | 2131/3937 | admin | CODE |
| 83 | GET | /api/admin/notifications | 2136 | admin,vendor | CODE |
| 84 | POST | /api/admin/notifications/read | 2139 | admin,vendor | CODE |
| 85 | DELETE | /api/admin/notifications/:id | 2143 | admin,vendor | CODE |
| 86 | DELETE | /api/admin/notifications | 2147 | admin,vendor | CODE |
| 87 | GET | /api/admin/sms-log | 2152 | admin,vendor | CODE |
| 88 | POST | /api/admin/sms/test | 2166 | admin | CODE |
| 89 | GET | /api/admin/tracking | 2266 | admin,vendor | LIVE |
| 90 | GET | /api/admin/realtime-health | 2286 | admin | CODE |
| 91 | GET | /api/admin/parking-lines | 2713 | admin,vendor | CODE |
| 92 | GET | /api/admin/export/:kind | 2813 | admin | CODE |
| 93 | GET | /api/admin/export/employees-all | 3990 | admin | CODE |
| 94 | GET | /api/admin/safety | 1752 | admin,vendor | CODE |
| 95 | POST | /api/admin/safety/:id/resolve | 1733 | admin,vendor | CODE |
| 96 | GET | /api/admin/address-updates | 3867 | admin | LIVE (pg-smoke) |
| 97 | POST | /api/admin/address-updates/:id/approve | 3888 | admin | LIVE (pg-smoke) |
| 98 | POST | /api/admin/address-updates/:id/reject | 3902 | admin | CODE |
| 99 | DELETE | /api/admin/speed-events | 3941 | admin | CODE |
| 100 | DELETE | /api/admin/sms-log/:id | 3948 | admin | CODE |
| 101 | DELETE | /api/admin/sms-log | 3952 | admin | CODE |
| 102 | POST | /api/admin/employees | 3959 | admin,vendor | CODE |
| 103 | POST | /api/admin/users/:id/reactivate | 3972 | admin | CODE |
| 104 | GET | /api/admin/vendors | 3537 | admin | CODE |
| 105 | POST | /api/admin/vendors | 3541 | admin | CODE |
| 106 | PUT | /api/admin/vendors/:id | 3556 | admin | CODE |
| 107 | POST | /api/admin/vendors/:id/regenerate-code | 3565 | admin | CODE |
| 108 | POST | /api/admin/vendors/:id/revoke-access | 3573 | admin | CODE |
| 109 | DELETE | /api/admin/vendors/:id | 3588 | admin | CODE |
| 110 | POST | /api/admin/vendors/:id/reset-password | 3594 | admin | CODE |
| 111 | POST | /api/admin/vendors/:id/toggle-status | 3603 | admin | CODE |

## 6. EMPLOYEE / RIDES / SAFETY — `auth` combos

| # | Method | Path | Line | Guard | Status |
|---|---|---|---|---|---|
| 112 | GET | /api/schedules/mine | 1491 | employee,admin | CODE |
| 113 | GET | /api/schedules/config | 1516 | auth | CODE |
| 114 | GET | /api/schedules/allotments/live | 1529 | employee,admin | CODE |
| 115 | GET | /api/schedules/allotments | 1585 | employee,admin | CODE |
| 116 | POST | /api/schedules/allotments/:id/checkin | 1626 | employee,admin | CODE |
| 117 | POST | /api/schedules/allotments/:id/checkout | 1649 | employee,admin | CODE |
| 118 | GET | /api/employee/safety/my | 1684 | employee | CODE |
| 119 | GET | /api/employee/safety/:scheduleId | 1690 | employee,admin | CODE |
| 120 | POST | /api/employee/safety/confirm | 1699 | employee,admin | CODE |
| 121 | POST | /api/employee/safety/not-reached | 1714 | employee,admin | CODE |
| 122 | GET | /api/trips/history | 1768 | employee,admin | CODE |
| 123 | GET | /api/feedback | 1784 | admin | CODE |
| 124 | POST | /api/feedback | 1793 | auth | CODE |
| 125 | POST | /api/schedules | 1802 | auth | LIVE (e2e) |
| 126 | DELETE | /api/schedules/:id | 1879 | auth | CODE |
| 127 | GET | /api/employee/schedule | 2441 | employee,admin | CODE |
| 128 | GET | /api/employee/cab | 2451 | employee,admin | CODE |
| 129 | POST | /api/employee/checkin | 2462 | employee,admin | CODE |
| 130 | GET | /api/employee/history | 2506 | employee,admin | CODE |
| 131 | POST | /api/employee/feedback | 2517 | employee,admin | CODE |
| 132 | GET | /api/employee/export-history | 2814 | employee,admin | CODE |
| 133 | GET | /api/me/notifications | 2735 | auth | CODE |
| 134 | POST | /api/me/notifications/read | 2738 | auth | CODE |
| 135 | GET | /api/me/address-updates | 3852 | auth | CODE |
| 136 | POST | /api/me/address-update | 3856 | employee,admin | CODE |
| 137 | POST | /api/alerts | 3920 | auth | CODE |
| 138 | GET | /api/location/profile | 4014 | auth | LIVE (pg-smoke) |
| 139 | PUT | /api/location/profile | 4016 | auth | LIVE (pg-smoke) |
| 140 | POST | /api/support/contact | 4075 | auth | CODE |
| 141 | GET | /api/support/config | 4084 | auth | CODE |
| 142 | GET | /api/trips/mine | 4099 | employee,admin | CODE |
| 143 | GET | /api/trips/mine/export | 4120 | employee,admin | CODE |
| 144 | POST | /api/trips/:id/checkin | 4127 | employee,admin | CODE |
| 145 | POST | /api/trips/:id/checkout | 4135 | employee,admin | CODE |
| 146 | POST | /api/trips/:id/safedrop | 4145 | auth | CODE |
| 147 | GET | /api/trips/:id | 4162 | auth | CODE |

## 7. CHAT (all `auth`)

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 148 | GET | /api/chat/trip/:tripId | 2362 | CODE |
| 149 | GET | /api/chat/conversations | 2369 | CODE |
| 150 | GET | /api/chat/with/:userId | 2407 | CODE |
| 151 | POST | /api/chat/read/:userId | 2418 | CODE |
| 152 | POST | /api/chat/send | 2423 | CODE |

## 8. DRIVER — `auth,role('driver')`

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 153 | GET | /api/driver/today | 2530 | CODE |
| 154 | POST | /api/driver/confirm-checkin | 2558 | CODE |
| 155 | POST | /api/driver/trip | 2592 | CODE |
| 156 | PUT | /api/driver/status | 2636 | CODE |
| 157 | POST | /api/driver/notify-passengers | 2652 | CODE |
| 158 | GET | /api/driver/feedback | 2665 | CODE |
| 159 | POST | /api/driver/feedback | 2668 | CODE |
| 160 | GET | /api/driver/standing-point | 2677 | CODE |
| 161 | PUT | /api/driver/standing-point | 2682 | CODE |
| 162 | POST | /api/driver/parking-line | 2694 | CODE |
| 163 | GET | /api/driver/parking-line | 2706 | CODE |
| 164 | GET | /api/trips/assigned | 4147 | CODE |
| 165 | GET | /api/schedules/allotments/driver | 4171 | CODE |
| 166 | POST | /api/schedules/allotments/:id/complete | 4260 | CODE |
| 167 | POST | /api/schedules/allotments/:id/checkin-otp | 4287 | CODE |
| 168 | POST | /api/schedules/allotments/:id/checkout-otp | 4318 | CODE |
| 169 | POST | /api/driver/student/:scheduleId/:action | 5013 | CODE |

## 9. SUPPORT TICKETS / CS (all `auth` unless noted; DELETE admin)

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 170 | GET | /api/tickets | 3177 | CODE |
| 171 | POST | /api/tickets | 3198 | CODE |
| 172 | GET | /api/tickets/:id | 3213 | CODE |
| 173 | PUT | /api/tickets/:id | 3231 | CODE |
| 174 | POST | /api/tickets/:id/comment | 3254 | CODE |
| 175 | POST | /api/tickets/:id/escalate | 3268 | CODE |
| 176 | POST | /api/tickets/:id/resolve | 3283 | CODE |
| 177 | POST | /api/tickets/:id/close | 3292 | CODE |
| 178 | POST | /api/tickets/:id/reopen | 3300 | CODE |
| 179 | DELETE | /api/tickets/:id | 3312 (admin) | CODE |
| 180 | POST | /api/tickets/diagnose | 3321 (admin) | CODE |
| 181 | GET | /api/cs/tickets | 3385 | CODE |
| 182 | GET | /api/cs/stats | 3402 | CODE |

## 10. VENDOR PORTAL — `vendorAuth`

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 183 | POST | /api/vendor/login | 3499 | CODE |
| 184 | GET | /api/vendor/me | 3514 | CODE |
| 185 | GET | /api/vendor/employees | 3518 | CODE |
| 186 | GET | /api/vendor/routes | 3580 | CODE |
| 187 | GET | /api/vendor/vehicles | 3615 | CODE |
| 188 | POST | /api/vendor/vehicles | 3619 | CODE |
| 189 | PUT | /api/vendor/vehicles/:id | 3631 | CODE |
| 190 | DELETE | /api/vendor/vehicles/:id | 3642 | CODE |
| 191 | GET | /api/vendor/drivers | 3650 | CODE |
| 192 | POST | /api/vendor/drivers | 3654 | CODE |
| 193 | PUT | /api/vendor/drivers/:id | 3664 | CODE |
| 194 | GET | /api/vendor/trips | 3672 | CODE |
| 195 | GET | /api/vendor/dashboard | 3681 | CODE |

## 11. SCHOOL VERTICAL — `auth,schoolAdmin` (except noted)

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 196 | GET | /api/school/me | 4420 | LIVE (school-api) |
| 197 | PATCH | /api/school/settings | 4442 | LIVE (school-api) |
| 198 | GET | /api/school/students | 4454 | LIVE (school-api) |
| 199 | POST | /api/school/students | 4485 | LIVE (school-api) |
| 200 | POST | /api/school/students/import | 4494 | LIVE (school-api) |
| 201 | PUT | /api/school/students/:id | 4502 | LIVE (school-api) |
| 202 | POST | /api/school/students/:id/password | 4521 | LIVE (school-api) |
| 203 | DELETE | /api/school/students/:id | 4534 | LIVE (school-api) |
| 204 | GET | /api/school/parents | 4546 | LIVE (school-api) |
| 205 | GET | /api/school/sos | 4715 | LIVE (school-api) |
| 206 | POST | /api/school/sos/:id/resolve | 4727 | LIVE (school-api) |
| 207 | GET | /api/school/geofence | 4736 | LIVE (school-api) |
| 208 | GET | /api/school/routes | 4751 | LIVE (school-api) |
| 209 | POST | /api/school/routes | 4756 | LIVE (school-api) |
| 210 | PUT | /api/school/routes/:id | 4770 | LIVE (school-api) |
| 211 | DELETE | /api/school/routes/:id | 4781 | LIVE (school-api) |
| 212 | GET | /api/school/vehicles | 4787 | LIVE (school-api) |
| 213 | POST | /api/school/vehicles | 4797 | LIVE (school-api) |
| 214 | PUT | /api/school/vehicles/:id | 4812 | LIVE (school-api) |
| 215 | DELETE | /api/school/vehicles/:id | 4826 | LIVE (school-api) |
| 216 | GET | /api/school/drivers | 4844 | LIVE (school-api) |
| 217 | POST | /api/school/drivers | 4848 | LIVE (school-api) |
| 218 | PUT | /api/school/drivers/:id/verify | 4860 | LIVE (school-api) |
| 219 | DELETE | /api/school/drivers/:id | 4868 | LIVE (school-api) |
| 220 | GET | /api/school/nodal-points | 4878 | LIVE (school-api) |
| 221 | POST | /api/school/nodal-points | 4882 | LIVE (school-api) |
| 222 | PUT | /api/school/nodal-points/:id | 4890 | LIVE (school-api) |
| 223 | DELETE | /api/school/nodal-points/:id | 4900 | LIVE (school-api) |
| 224 | GET | /api/school/schedules | 4908 | LIVE (school-api) |
| 225 | POST | /api/school/schedules | 4927 | LIVE (school-api) |
| 226 | PUT | /api/school/schedules/:id | 4962 | LIVE (school-api) |
| 227 | DELETE | /api/school/schedules/:id | 4977 | LIVE (school-api) |
| 228 | GET | /api/school/tracking | 4983 | LIVE (school-api) |
| 229 | GET | /api/school/stats | 4997 | LIVE (school-api) |

## 12. PARENT — `auth,schoolParent`

| # | Method | Path | Line | Status |
|---|---|---|---|---|
| 230 | POST | /api/parent/link | 4585 | LIVE (school-api) |
| 231 | DELETE | /api/parent/link/:studentId | 4603 | LIVE (school-api) |
| 232 | GET | /api/parent/me | 4610 | LIVE (school-api) |
| 233 | GET | /api/parent/children | 4660 | LIVE (school-api) |
| 234 | GET | /api/parent/child/:id | 4665 | LIVE (school-api) |
| 235 | POST | /api/parent/child/:id/drop-confirm | 4671 | LIVE (school-api) |
| 236 | POST | /api/parent/sos | 4690 | LIVE (school-api) |

## 13. WEBSOCKET SUBPROTOCOL (socket.io on same origin, path `/`)

- Handshake: JWT in `handshake.auth.token`; must be active user.
- Rooms: `user:{id}`, `role:{role}`, chat conversations, `trip:{id}`, run rooms.
- Client events: `chat:send`, `trip:join`, `trip:leave`, `location:update` (driver GPS, auth-checked to assigned driver), `location:push` (user GPS), `chat:message`, `trip:statusUpdate`, `allotment:statusUpdate`, `disconnect`.
- Server events: `notification`, `cab:update`, `tracking`, `alert`, `tracking:config` (adaptive), `realtime:health`, `location:broadcast`, `chat:broadcast`, `trip:statusBroadcast`, `allotment:statusBroadcast`, `run:nextStop`, `run:completed`, `school:dropAwaitingOtp`, `school:dropConfirmed`, `sos:new`, `geofence`, `chat:incoming`, `location:approval`.

## 14. TERMINATORS

- 404 handler (`server.js:5278`) + JSON error handler (`server.js:5279`).
- `/api/admin/*` hard-block for school-vertical users (`server.js:318`).

## 15. BACKWARD-COMPATIBILITY NOTES

- No endpoint was removed or changed during this audit. All 237 route definitions remain as-is.
- Vendor legacy tokens are explicitly rejected in favor of mirror-user tokens (breaking change ALREADY shipped pre-audit — documented for awareness, not rolled back).