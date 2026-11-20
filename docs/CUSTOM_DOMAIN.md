# Custom domain for RIFQ Muslim

The app currently answers on the platform URL
`https://pqjm8aoyzd.dev.onappjet.com`. Serving it on your own domain is a
two-part job: **you** add the domain and its DNS records, then the app is
already prepared to follow it — no code change is needed when the domain
changes.

## 1. Which hostname to use

| Requested form              | Status                                                                 |
| --------------------------- | ---------------------------------------------------------------------- |
| `com.rifqmuslim.app`        | This is the Android **package id** written in reverse. As a hostname it would be a *subdomain* of `rifqmuslim.app`, not a registrable domain. |
| `rifqmuslim.app`            | Valid, if you own that `.app` domain. `.app` is HTTPS-only, which suits this app. |
| `www.rifq-muslim.com`       | Valid, if you own `rifq-muslim.com`. Recommended primary host.         |

Pick **one** primary host, for example `www.rifq-muslim.com`, and (optionally)
redirect the bare domain (`rifq-muslim.com`) to it.

## 2. Add the domain in AppJet

1. Open **Settings → Domains** (custom domains are included on the Starter plan).
2. Add the hostname exactly as you will type it, e.g. `www.rifq-muslim.com`.
3. Settings shows the DNS records to create — typically a `CNAME` for `www`
   (or an `A` record for an apex domain) plus a `TXT` record that proves
   ownership. **Use the values shown there**; they are tied to this deployment.
4. Create those records at your registrar / DNS provider.
5. Wait for propagation (usually minutes, up to a few hours) and press
   **Verify** in Settings.

TLS is issued automatically once DNS resolves to the deployment.

## 3. Tell the app its public address

Set one environment variable in **Settings → Environment variables**:

```
PUBLIC_APP_URL=https://www.rifq-muslim.com
```

That single value drives:

- invitation links and the QR code on **Invite Friends**,
- the canonical and Open Graph/Twitter tags in the page head (so WhatsApp,
  Facebook and Telegram previews show the official domain),
- email verification and password-reset links sent by the backend.

Without it, the app falls back to the hostname each visitor used, so both the
custom domain and the platform URL keep working during the transition.

Redeploy after changing it (any deployment picks the value up at start).

## 4. Point the Android shell at the domain

`android/gradle.properties`:

```properties
rifq.appUrl=https://www.rifq-muslim.com
```

It is compiled into `BuildConfig.RIFQ_APP_URL` and must stay HTTPS — cleartext
HTTP is disabled in `android/app/src/main/res/xml/network_security_config.xml`,
which lists the official domains. Override per build without editing files:

```bash
./gradlew assembleRelease -Prifq.appUrl=https://your.domain
```

The GitHub Actions workflow exposes the same value as the `app_url` input.

## 5. Verify

```bash
# DNS points at the deployment
dig +short www.rifq-muslim.com

# HTTPS + certificate
curl -sI https://www.rifq-muslim.com | head -1

# canonical tag follows the domain
curl -s https://www.rifq-muslim.com | grep -o '<link rel="canonical"[^>]*>'

# invite link uses the domain
curl -s https://www.rifq-muslim.com/api/config | jq -r .publicUrl
```

All four should mention your domain, not the platform host. Then open
**Invite Friends** and confirm the printed link and QR code use it too.
