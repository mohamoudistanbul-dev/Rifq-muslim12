# RIFQ Muslim — HTTP API contract

Base path: `/api`. The Express server serves both this API and the built client on
the same port (`PORT`, default 3000) and binds `0.0.0.0`.

Authentication is a signed session **cookie** (`httpOnly`). Protected routes return
`401` when the cookie is missing or expired, `403` when the caller lacks the role.

> **Canonical paths matter.** The Quran audio catalogue lives under
> `/api/quran/audio/...`. There is no `/api/quran/reciters` or `/api/quran/surahs`
> route — a request to those paths correctly returns `404`. Every client call site
> (`src/lib/quranAudio.ts`) and the regression script use the paths below.

## Public

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, app, time }` |
| GET | `/api/config` | public runtime config (branding, contact, feature flags) |
| GET | `/api/notices` | published announcements |
| GET | `/api/content` | published content list (`?type=` filter) |
| GET | `/api/content/:slug` | one published content item |
| GET | `/api/community/posts` | moderated feed; each post includes `author_verified` |
| POST | `/api/contact` | contact form (rate limited, real email delivery only when configured) |
| POST | `/api/assistant` | Islamic Q&A; curated referenced answers, model-backed only when a key is set |

## Quran audio (audio only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/quran/audio/surahs` | all 114 surahs with Arabic/Latin names, ayah counts |
| GET | `/api/quran/audio/reciters` | the 10 reciters plus `verifiedAt` (live URL probe result) |
| GET | `/api/quran/audio/:reciter/:surah/info` | size, content type, availability |
| GET | `/api/quran/audio/:reciter/:surah` | streams the mp3; passes `Range` through (`206` + `Content-Range`), `?download=1` sends an attachment |

`:surah` is 1–114; unknown reciters or surahs return `400`.

## Account

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/auth/register` | public (rate limited) |
| POST | `/api/auth/login` | public (rate limited) |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | session |
| PATCH | `/api/auth/profile` | session |
| POST | `/api/auth/password` | session |
| POST | `/api/auth/forgot` | public (rate limited) |
| POST | `/api/auth/reset` | public (rate limited) |
| POST | `/api/auth/verify` | public |
| POST | `/api/auth/resend-verification` | session |
| DELETE | `/api/auth/account` | session |

## Blue verified badge

| Method | Path | Auth | Behaviour |
| --- | --- | --- | --- |
| GET | `/api/badge/request` | session | `{ request }` — the caller's latest request or `null` |
| POST | `/api/badge/request` | session | `201` created; `400` already verified; `409` a pending request exists |

A user request never changes badge state. Only an administrator decision does.

## Personal data

| Method | Path | Auth |
| --- | --- | --- |
| GET/POST | `/api/bookmarks` | session |
| DELETE | `/api/bookmarks/:id` | session |
| GET/POST | `/api/tasbih` | session |
| GET | `/api/tracker` | session |
| POST/GET | `/api/quiz/results` | session |
| POST | `/api/community/posts` | session (rate limited) |
| POST | `/api/community/posts/:id/like` | session |
| POST | `/api/community/report` | session (rate limited) |
| POST | `/api/community/block` | session |

## Administration — mounted at `/api/admin`

Every route requires `requireAdmin`; routes marked **super** require
`requireSuperAdmin`. Admin accounts are never self-registered.

| Method | Path | Role |
| --- | --- | --- |
| GET | `/overview` | admin |
| GET/POST | `/content`, `/content/:id` | admin |
| PATCH/DELETE | `/content/:id`, `/content/:id/publish` | admin |
| GET/POST | `/media`, `/media/:id` | admin |
| GET | `/users` | admin |
| PATCH/DELETE | `/users/:id` | **super** — role, ban and delete (verified at `server/admin.js:371` and `:522`) |
| PATCH | `/users/:id/badge` | **super** — grant/revoke the blue tick; self-grant `403`; writes audit `admin.badge.grant` / `admin.badge.revoke` |
| GET | `/verifications` | admin — badge audit history |
| GET | `/badge-requests?status=pending\|all` | admin |
| PATCH | `/badge-requests/:id` | **super** — `{action:'approve'\|'reject'}`; own request `403`, already decided `409` |
| GET/PATCH/DELETE | `/messages`, `/messages/:id` | admin |
| GET/PATCH | `/reports`, `/reports/:id` | admin |
| GET/PATCH/DELETE | `/posts`, `/posts/:id` | admin |
| GET/POST/DELETE | `/notifications`, `/notifications/:id` | admin |
| GET/PATCH | `/settings` | admin |
| GET | `/audit` | admin — activity log |
| GET | `/security` | admin |
| POST | `/password` | admin — change own password |
| POST | `/sessions/revoke` | admin |
| GET | `/backup` | admin |
| GET/POST/DELETE | `/apk` | admin — upload/replace/remove the Android APK served to the Download button |

## Verification

- `scripts/verify-audio-badge.mjs` asserts the audio catalogue, live reciter
  reachability, `Range`/attachment behaviour, and the full badge permission matrix
  (including the request flow) against a real server process.
- Live deployment checks assert `401` on `/api/badge/request` and
  `/api/admin/badge-requests`, and `200` with reciter data on
  `/api/quran/audio/reciters`.
