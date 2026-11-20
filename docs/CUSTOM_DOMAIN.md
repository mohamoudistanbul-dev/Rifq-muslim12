# Custom domain for RIFQ Muslim

The app runs on the platform URL `https://pqjm8aoyzd.dev.onappjet.com`.
This document describes how the chosen custom domain
**`https://rifqmuslim.dev.ap-jt.com`** is attached and how to verify it.

## 1. The record (from Settings → Domains)

| Field  | Value |
| ------ | ----- |
| Type   | `CNAME` |
| Name   | `rifqmuslim.dev.ap-jt.com` |
| Target | `ebceba978ee5ff0914a913cd4.edge.onappjet.com` |
| TTL    | 300 seconds (or automatic) |

Create exactly this record at the DNS provider that hosts the `dev.ap-jt.com`
zone. Use a `CNAME` only — never an `A` record, and do not proxy it through a
CDN (the orange-cloud "proxy" toggle in Cloudflare must stay off) because the
target is already a TLS-terminating edge host.

TLS is issued automatically by the platform once the name resolves and the
domain shows **Verified** in Settings → Domains.

## 2. What the application does on its own

Nothing has to be edited when a domain is attached:

- `server/publicUrl.js` resolves the public origin as
  `PUBLIC_APP_URL` → `PUBLIC_URL` → the request host (forced to `https` for
  anything that is not loopback). Invitation links, QR codes, email
  verification and password-reset links all use it.
- The HTML shell is rendered per request with `canonical`, `og:` and `twitter:`
  tags for the host that served it, so WhatsApp/Facebook/Telegram shares show
  the custom domain.
- `GET /api/config` returns the same origin as `publicUrl`.

### Pinning the canonical domain

Setting the environment variable `PUBLIC_APP_URL` makes every share and email
link use the custom domain even when a visitor arrives on the platform URL:

    PUBLIC_APP_URL=https://rifqmuslim.dev.ap-jt.com

Set it in **Settings → Environment variables**, then redeploy.

> Do this only after the CNAME resolves. Pointing `PUBLIC_APP_URL` at a name
> that does not resolve breaks invitation and password-reset links.

## 3. Android

The native app talks to the domain in `android/gradle.properties`:

```properties
rifq.appUrl=https://rifqmuslim.dev.ap-jt.com
```

Override per build without editing the file:

```bash
./gradlew assembleDebug -Prifq.appUrl=https://staging.example.com
```

`android/app/src/main/res/xml/network_security_config.xml` whitelists
`ap-jt.com` (plus `rifq-muslim.com`, `rifqmuslim.app` and the platform preview
host) with cleartext HTTP disabled, so every request travels over HTTPS.

The Android **package id stays `com.rifqmuslim.app`** — it identifies the app in
Google Play and must not follow a web domain change.

## 4. Verification

```bash
# DNS: must print the edge hostname
getent hosts rifqmuslim.dev.ap-jt.com

# HTTPS + metadata: must show the custom host in canonical/og:url
curl -sS -o /dev/null -w '%{http_code}\n' https://rifqmuslim.dev.ap-jt.com/
curl -sS https://rifqmuslim.dev.ap-jt.com/ | grep -o '<link rel="canonical"[^>]*>'

# The API must report the same origin once PUBLIC_APP_URL is set
curl -sS https://rifqmuslim.dev.ap-jt.com/api/config | jq -r .publicUrl
```

Expected: `200`, a canonical link containing `https://rifqmuslim.dev.ap-jt.com`,
and the same value from `/api/config`.

## 5. Troubleshooting

- **Still "No DNS record" after creating the CNAME** — the `dev.ap-jt.com` zone
  must exist at the same provider as `ap-jt.com`; a record added to the parent
  zone is not enough. Wait one TTL (300 s) and re-check.
- **Domain verified but HTTPS fails** — remove any CDN proxy on the record and
  wait a few minutes for certificate issuance.
- **Links still show the platform URL** — `PUBLIC_APP_URL` is unset or the app
  was not redeployed after setting it.
- **Android app cannot reach the API** — confirm the host is listed in
  `network_security_config.xml` and that `rifq.appUrl` matches the live domain.
