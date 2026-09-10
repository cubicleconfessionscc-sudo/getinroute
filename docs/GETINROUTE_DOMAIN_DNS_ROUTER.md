# GetInRoute — Domain, DNS, router port-forwarding and CGNAT

Goal: get `https://www.getinroute.in` to reach this PC from the Internet, with
**no Cloudflare** anywhere in the path.

## 1. Current DNS state (measured 2026-09-10)

- `getinroute.in` and `www.getinroute.in` A records currently point at
  **Cloudflare anycast IPs** (104.21.44.207 / 172.67.203.179).
- The domain's nameservers are `lana.ns.cloudflare.com` / `alberto.ns.cloudflare.com`.
- `https://getinroute.in` currently serves a **Cloudflare 530 error** — nothing
  is live behind the domain today.

Because you do not want Cloudflare, the DNS must be moved OFF Cloudflare at the
registrar (from where the domain was bought/managed). The registrar panel has a
"Nameservers" setting — that is where this happens. You do NOT need to create an
account anywhere else.

## 2. Step-by-step (manual, at the registrar)

1. Log in at your registrar (where `getinroute.in` is registered/managed).
2. Open the DNS / Nameservers settings for the domain.
3. Remove the Cloudflare nameservers. Either:
   - use the registrar's own default nameservers (they will be listed in the
     panel; usually the registrar then shows you its own DNS editor), or
   - add a plain (non-Cloudflare) provider's nameservers and configure A
     records there.
4. In the active DNS editor, create:

| Type | Name | Value |
|---|---|---|
| A | `@` | your router's PUBLIC IPv4 (this PC's connection egressed 103.86.107.157 when measured) |
| A | `www` | the same public IPv4 |

Do not use a Cloudflare IP. Do not enable any proxy/orange-cloud toggle — there
is no Cloudflare in this setup at all.

5. Optional but recommended if your ISP changes IPs often: enable a **Dynamic
   DNS** hostname at the registrar and use it in the A record instead.

6. Wait for propagation (minutes to hours), then:
   ```
   nslookup www.getinroute.in
   ```
   must show an IP that is NOT 104.21.x / 172.67.x.

## 3. Public IPv4 of this connection

Measured: **103.86.107.157** (OPTO, AS147279). Re-check before creating DNS:
```
curl https://api.ipify.org
```
For the router's WAN IP, look on the router status page (http://192.168.1.254).

## 4. CGNAT check (manual — do this before anything else)

1. Log into the router and read its **WAN IP** field.
2. Compare with the egress IP (section 3).
   - Same IP → real public IP, continue to forwarding.
   - Different → **CGNAT**. Public-facing hosting will NOT work via port
     forwarding. Contact the ISP for a public/static IPv4. Do not use insecure
     workarounds.
3. Alternative check on this PC:
   ```
   nslookup myip.opendns.com resolver1.opendns.com
   ```

If CGNAT blocks you, the system remains fully functional on the LAN at
`http://127.0.0.1:4000` while you arrange a public IP.

## 5. Router port forwarding (manual)

1. Open the router admin page (`http://192.168.1.254`; the sticker shows it).
2. **DHCP reservation / static lease**: fix this PC's LAN IP at `192.168.1.79`
   so forwarding never breaks.
3. **Port Forwarding / Virtual Server**:
   - WAN TCP **80**  → `192.168.1.79` TCP 80
   - WAN TCP **443** → `192.168.1.79` TCP 443
4. Save/apply.

These two are the ONLY public ports. Never forward 4000 (Node), 3000/3001,
587, any SQLite or debug port.

## 6. Windows Firewall

Allow inbound 80 + 443 only:
```
netsh advfirewall firewall add rule name="GetInRoute HTTPS" dir=in action=allow protocol=TCP localport=443
netsh advfirewall firewall add rule name="GetInRoute HTTP"  dir=in action=allow protocol=TCP localport=80
```

## 7. Verify from outside

After DNS + router + firewall + Caddy are done, from a phone on **mobile data
(not your Wi-Fi)** open `https://www.getinroute.in/health` → expect
`200 {"ok":true,...}`. That is the definition of "production-ready" for the
external path.