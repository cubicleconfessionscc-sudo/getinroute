# GetInRoute - AutoSetup Report

- Generated: 2026-10-09 02:53:59
- Machine: DESKTOP-LERORKF  -  OS: Microsoft Windows 10 Pro
- Project root: D:\GetInRoute
- Node: v24.18.1  -  npm: 11.16.0  -  Git: git version 2.54.0.windows.1  -  Java: openjdk version "17.0.20.1" 2026-08-18

| Area | Detail | Status |
|---|---|---|
| Computer | Microsoft Windows 10 Pro / AMD64 | PASS |
| Disk | D: 29.7 GB free | PASS |
| Project root | D:\GetInRoute | PASS |
| Node.js | v24.18.1 (need >= 22.5.0) | PASS |
| npm | present | PASS |
| Git | present | PASS |
| Java/JDK | present (JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\) | PASS |
| Android SDK | ANDROID_HOME not set | WARNING |
| ADB | not found | WARNING |
| backend deps | package.json=True; node_modules=True | PASS |
| frontend deps | package.json=True; node_modules=True | PASS |
| mobile deps | package.json=True; node_modules=True | PASS |
| .env | present | PASS |
| Database | present | WARNING |

## Next steps
1. Confirm all rows are PASS.
2. If Node/Android SDK are WARNING, install them (see the setup guide).
3. Start the backend and open /admin.
4. Build + install the APKs.
