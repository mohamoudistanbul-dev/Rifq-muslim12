import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  db,
  newId,
  nowIso,
  auditLog,
  publicUser,
  getSetting,
  setSetting,
  listNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  unreadNotifications,
} from './db.js';
import {
  attachUser,
  requireAuth,
  requireAdmin,
  signSession,
  verifyPassword,
  hashPassword,
  emailOk,
  passwordProblem,
  token,
  rateLimit,
  COOKIE,
  cookieOptions,
} from './auth.js';
import { sendEmail, mailConfigured } from './mail.js';
import { answerQuestion } from './assistant.js';
import { contentRouter, warmContent } from './content.js';
import { hadithRouter } from './hadith.js';
import { publicBaseUrl, renderIndex } from './publicUrl.js';
import { geoRouter } from './geo.js';
import { adminRouter, UPLOAD_DIR } from './admin.js';
import { downloadRouter, apkSource, apkStatus, APK_PATH, APK_FILENAME } from './download.js';
import { analyticsRouter, visitRouter, recordPortalVisit } from './analytics.js';
import { registerPushRoutes } from './push.js';
import { startAnnouncementScheduler } from './announcements.js';
import { seedSuperAdmin, SUPER_ADMIN_EMAIL } from './seed.js';
import { premiumRouter, premiumAdminRouter } from './premium.js';
import { quizRouter, quizAdminRouter } from './quiz.js';
import kidsRouter from './kids.js';
import { accessRouter, accessAdminRouter, ensureRegistry } from './access.js';
import { mosquesRouter } from './mosques.js';
import { donateUrl, donateCurrency } from './donate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const OWNER_EMAIL = SUPER_ADMIN_EMAIL;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Media uploads arrive as base64 JSON, so they need a larger body limit than the
// rest of the API. Mounted before the global parser so it wins for this path.
app.use('/api/admin/media', express.json({ limit: '9mb' }));
app.use(express.json({ limit: '256kb' }));

// Cookie parsing without an extra dependency.
app.use((req, _res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      try {
        req.cookies[k] = decodeURIComponent(v);
      } catch {
        req.cookies[k] = v;
      }
    }
  }
  next();
});
app.use(attachUser);

// Create (or repair) the Super Admin account and official contact defaults.
seedSuperAdmin();
// Seed the Free/Premium registry from the real catalogues (idempotent).
ensureRegistry();

/* ---------------------------------- config --------------------------------- */

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'RIFQ Muslim', time: nowIso() }));

app.get('/api/config', async (req, res) => {
  const apk = await apkStatus();
  res.json({
    appName: getSetting('app_name', 'RIFQ Muslim'),
    tagline: getSetting('tagline', 'Your Faith, Your Daily Companion'),
    developer: 'Made by Eng Mohamud Yusuf',
    contactEmail: getSetting('contact_email', 'rifqmuslim@gmail.com'),
    contactPhone: getSetting('contact_phone', '+252612215593'),
    whatsapp: getSetting('whatsapp', '+252612215593'),
    // Official website link: the QR code and every share button use this.
    downloadUrl: publicBaseUrl(req),
    publicUrl: publicBaseUrl(req),
    siteUrl: publicBaseUrl(req),
    // The real published address of this app, used by Invite Friends and every
    // share button. It is this deployment's own URL — never a referral link.
    shareUrl: publicBaseUrl(req),
    // The permanent public download page: one address shared by every
    // invitation, QR code and social button. It routes Android visitors to the
    // APK and iPhone visitors to the App Store listing.
    portalUrl: `${publicBaseUrl(req)}/download`,
    portalHeadline: getSetting('portal_headline', 'RIFQ Muslim — Your Faith, Your Daily Companion'),
    portalDescription: getSetting(
      'portal_description',
      'Prayer times, the Holy Quran, authentic Hadith, Duas, Qibla and daily worship in one app. Install RIFQ Muslim on your Android phone, or open it on any device.'
    ),
    // Official store listings, set by the Super Admin in Website settings.
    // Empty means "not configured yet"; the client says so instead of inventing
    // a download address.
    playStoreUrl: getSetting('play_store_url', ''),
    appStoreUrl: getSetting('app_store_url', ''),
    // The APK is streamed by our own route so the saved file is always named
    // RIFQ-Muslim.apk, even though the file itself lives in Cloudflare R2.
    apkUrl: APK_PATH,
    apkFilename: APK_FILENAME,
    apkConfigured: Boolean(apk.configured),
    apkSize: apk.size ?? null,
    communityEnabled: getSetting('community_enabled', 'true') === 'true',
    announcement:
      getSetting('announcement_active', 'false') === 'true'
        ? String(getSetting('announcement_text', '') || '')
        : '',
    emailConfigured: mailConfigured(),
    assistantMode: process.env.OPENAI_API_KEY ? 'model' : 'knowledge-base',
    ownerEmail: OWNER_EMAIL,
    // International donations: the owner's own PayPal link (environment variable
    // or dashboard setting), validated server-side. Empty means "not configured
    // yet" — the app never invents a donation address.
    paypalDonateUrl: donateUrl(),
    paypalCurrency: donateCurrency(),
  });
});

app.get('/api/notices', (req, res) => {
  const rows = db.prepare('SELECT id, title, body, created_at FROM broadcasts ORDER BY created_at DESC LIMIT 5').all();
  res.json({ notices: rows });
});

/* --------------------------- published content (CMS) ----------------------- */

// Only content the Super Admin published is visible to visitors.
const shapePublic = (r) => ({
  id: r.id,
  type: r.type,
  title: r.title,
  slug: r.slug,
  excerpt: r.excerpt,
  body: r.body,
  image: r.image,
  category: r.category,
  featured: !!r.featured,
  views: Number(r.views || 0),
  publishedAt: r.published_at || r.created_at,
  author: 'Eng Mohamud Yusuf',
});

app.get('/api/content', (req, res) => {
  const type = ['article', 'page', 'banner', 'announcement'].includes(String(req.query.type))
    ? String(req.query.type)
    : null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const sql = `SELECT * FROM content WHERE status = 'published' ${type ? 'AND type = ?' : ''}
    ORDER BY featured DESC, COALESCE(published_at, created_at) DESC LIMIT ?`;
  const params = type ? [type, limit] : [limit];
  res.json({ content: db.prepare(sql).all(...params).map(shapePublic) });
});

app.get('/api/content/:slug', (req, res) => {
  const row = db.prepare("SELECT * FROM content WHERE slug = ? AND status = 'published'").get(String(req.params.slug));
  if (!row) return res.status(404).json({ error: 'That page is not available.' });
  db.prepare('UPDATE content SET views = views + 1 WHERE id = ?').run(row.id);
  res.json({ item: shapePublic({ ...row, views: Number(row.views || 0) + 1 }) });
});

/* ----------------------------------- auth ---------------------------------- */

app.post('/api/auth/register', rateLimit({ windowMs: 60_000, max: 8 }), async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const lang = ['en', 'ar', 'so'].includes(req.body?.lang) ? req.body.lang : 'en';

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });

  const id = newId();
  const verifyToken = token();
  const role = email === OWNER_EMAIL ? 'admin' : 'user';
  db.prepare(
    `INSERT INTO users (id, email, name, pass_hash, role, verified, verify_token, lang, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, email, name, hashPassword(password), role, 0, verifyToken, lang, nowIso());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const link = `${publicBaseUrl(req)}/verify?token=${verifyToken}`;
  const delivery = await sendEmail({
    to: email,
    subject: 'Verify your RIFQ Muslim account',
    text: `Assalamu alaikum ${name},\n\nWelcome to RIFQ Muslim. Confirm your email address:\n${link}\n\nIf you did not create this account, ignore this email.`,
  });
  auditLog(user, 'register', `role=${role}`);

  res.cookie(COOKIE, signSession(user), cookieOptions(req));
  res.status(201).json({
    user: publicUser(user),
    verification: delivery.delivered
      ? { sent: true, note: 'A verification email is on its way.' }
      : { sent: false, note: delivery.reason },
  });
});

app.post('/api/auth/login', rateLimit({ windowMs: 60_000, max: 12 }), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!user || !verifyPassword(password, user.pass_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (user.banned) return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(nowIso(), user.id);
  auditLog(user, 'login');
  res.cookie(COOKIE, signSession(user), cookieOptions(req));
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const opts = cookieOptions(req);
  res.clearCookie(COOKIE, { ...opts, maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) : req.user.name;
  const lang = ['en', 'ar', 'so'].includes(req.body?.lang) ? req.body.lang : req.user.lang;
  const theme = ['light', 'dark'].includes(req.body?.theme) ? req.body.theme : req.user.theme;
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });

  let prefs = {};
  try {
    prefs = JSON.parse(req.user.prefs || '{}');
  } catch {
    prefs = {};
  }
  if (req.body?.prefs && typeof req.body.prefs === 'object') {
    prefs = { ...prefs, ...req.body.prefs };
  }
  db.prepare('UPDATE users SET name = ?, lang = ?, theme = ?, prefs = ? WHERE id = ?').run(
    name,
    lang,
    theme,
    JSON.stringify(prefs).slice(0, 8000),
    req.user.id
  );
  auditLog(req.user, 'profile.update');
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (!verifyPassword(current, req.user.pass_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(
    hashPassword(next),
    req.user.id
  );
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.cookie(COOKIE, signSession(fresh), cookieOptions(req));
  auditLog(req.user, 'password.change');
  res.json({ ok: true });
});

app.post('/api/auth/forgot', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = emailOk(email) ? db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email) : null;
  let delivery = { delivered: false, reason: 'Email delivery is not configured yet.' };
  if (user) {
    const resetToken = token();
    db.prepare('UPDATE users SET reset_token = ?, reset_exp = ? WHERE id = ?').run(
      resetToken,
      Date.now() + 1000 * 60 * 60,
      user.id
    );
    const link = `${publicBaseUrl(req)}/reset?token=${resetToken}`;
    delivery = await sendEmail({
      to: user.email,
      subject: 'Reset your RIFQ Muslim password',
      text: `Assalamu alaikum,\n\nReset your password using this link (valid 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
    });
    auditLog(user, 'password.forgot');
  }
  res.json({
    ok: true,
    sent: delivery.delivered,
    note: delivery.delivered
      ? 'If that email is registered, reset instructions have been sent.'
      : `If that email is registered, a reset link was created, but email delivery is unavailable: ${delivery.reason}`,
  });
});

app.post('/api/auth/reset', rateLimit({ windowMs: 60_000, max: 8 }), (req, res) => {
  const resetToken = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(resetToken);
  if (!user || !user.reset_exp || Number(user.reset_exp) < Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }
  db.prepare(
    'UPDATE users SET pass_hash = ?, reset_token = NULL, reset_exp = NULL, token_version = token_version + 1 WHERE id = ?'
  ).run(hashPassword(password), user.id);
  auditLog(user, 'password.reset');
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.cookie(COOKIE, signSession(fresh), cookieOptions(req));
  res.json({ ok: true, user: publicUser(fresh) });
});

app.post('/api/auth/verify', (req, res) => {
  const verifyToken = String(req.body?.token || '');
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(verifyToken);
  if (!user) return res.status(400).json({ error: 'This verification link is invalid or already used.' });
  db.prepare('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
  auditLog(user, 'email.verify');
  res.json({ ok: true });
});

app.post('/api/auth/resend-verification', requireAuth, async (req, res) => {
  if (req.user.verified) return res.json({ sent: false, note: 'Your email is already verified.' });
  const verifyToken = req.user.verify_token || token();
  db.prepare('UPDATE users SET verify_token = ? WHERE id = ?').run(verifyToken, req.user.id);
  const delivery = await sendEmail({
    to: req.user.email,
    subject: 'Verify your RIFQ Muslim account',
    text: `Confirm your email address: ${publicBaseUrl(req)}/verify?token=${verifyToken}`,
  });
  res.json({ sent: delivery.delivered, note: delivery.delivered ? 'Verification email sent.' : delivery.reason });
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  const id = req.user.id;
  for (const table of ['bookmarks', 'tasbih', 'tracker', 'quiz_results', 'posts', 'blocks', 'post_likes']) {
    try {
      const col = table === 'blocks' || table === 'post_likes' ? 'user_id' : 'user_id';
      db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
    } catch {
      /* table without user_id */
    }
  }
  db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  auditLog({ id, email: req.user.email }, 'account.delete');
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
});

/* -------------------------- verification requests -------------------------- */

/*
 * Verification requests, their private documents and in-app notifications live
 * in server/verification.js so the validation rules sit next to the storage
 * they protect. Approval itself stays in the admin routes.
 */
import { verificationRouter } from './verification.js';
import { syncStaffBadges } from './db.js';

/* The Owner and authorized admins carry the tick by role, not by request. */
syncStaffBadges();

app.use('/api', verificationRouter);

/* -------------------------------- bookmarks -------------------------------- */

app.get('/api/bookmarks', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ bookmarks: rows });
});

app.post('/api/bookmarks', requireAuth, (req, res) => {
  const kind = String(req.body?.kind || '').slice(0, 20);
  const ref = String(req.body?.ref || '').slice(0, 120);
  if (!kind || !ref) return res.status(400).json({ error: 'Missing bookmark reference.' });
  const existing = db.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND kind = ? AND ref = ?').get(
    req.user.id,
    kind,
    ref
  );
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
    return res.json({ removed: true });
  }
  const id = newId();
  db.prepare(
    'INSERT INTO bookmarks (id, user_id, kind, ref, surah, ayah, label, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    req.user.id,
    kind,
    ref,
    req.body?.surah ?? null,
    req.body?.ayah ?? null,
    String(req.body?.label || '').slice(0, 200),
    String(req.body?.note || '').slice(0, 500),
    nowIso()
  );
  res.status(201).json({ bookmark: db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) });
});

app.delete('/api/bookmarks/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------------------------------- tasbih --------------------------------- */

/* ------------------------------ notifications ----------------------------- */

/**
 * The signed-in user's real inbox. Every row is written by the server (admin
 * messages, verification decisions, account notices), and a user can only ever
 * read or mark their own rows.
 */
app.get('/api/notifications', requireAuth, (req, res) => {
  res.json({
    notifications: listNotifications(req.user.id, Number(req.query.limit) || 60),
    unread: unreadNotifications(req.user.id),
  });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  const all = req.body?.all === true;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const changed = all ? markAllNotificationsRead(req.user.id) : markNotificationsRead(req.user.id, ids);
  res.json({ changed, unread: unreadNotifications(req.user.id) });
});

/* Device delivery: the browser registers here, and the server pushes to it. */
registerPushRoutes(app, requireAuth);
/* Scheduled announcements are sent by this process, not by a client timer. */
startAnnouncementScheduler();

app.get('/api/tasbih', requireAuth, (req, res) => {
  const day = String(req.query.day || new Date().toISOString().slice(0, 10));
  const rows = db.prepare('SELECT * FROM tasbih WHERE user_id = ? AND day = ?').all(req.user.id, day);
  const totals = db
    .prepare('SELECT day, SUM(count) AS total FROM tasbih WHERE user_id = ? GROUP BY day ORDER BY day DESC LIMIT 30')
    .all(req.user.id);
  res.json({ day, entries: rows, totals });
});

app.post('/api/tasbih', requireAuth, (req, res) => {
  const dhikr = String(req.body?.dhikr || '').slice(0, 200) || 'SubhanAllah';
  const count = Math.max(0, Math.min(1_000_000, Number(req.body?.count) || 0));
  const target = Math.max(1, Math.min(100_000, Number(req.body?.target) || 33));
  const day = String(req.body?.day || new Date().toISOString().slice(0, 10));
  db.prepare(
    `INSERT INTO tasbih (id, user_id, dhikr, count, target, day, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id, dhikr, day) DO UPDATE SET count = excluded.count, target = excluded.target, updated_at = excluded.updated_at`
  ).run(newId(), req.user.id, dhikr, count, target, day, nowIso());
  res.json({ ok: true });
});

/* --------------------------------- tracker --------------------------------- */

app.get('/api/tracker', requireAuth, (req, res) => {
  const day = String(req.query.day || new Date().toISOString().slice(0, 10));
  const row = db.prepare('SELECT * FROM tracker WHERE user_id = ? AND day = ?').get(req.user.id, day);
  const recent = db.prepare('SELECT * FROM tracker WHERE user_id = ? ORDER BY day DESC LIMIT 30').all(req.user.id);
  res.json({ day, entry: row || null, recent });
});

app.put('/api/tracker', requireAuth, (req, res) => {
  const day = String(req.body?.day || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const prayers = JSON.stringify(req.body?.prayers || {});
  const deeds = JSON.stringify(req.body?.deeds || {});
  const quranPages = Math.max(0, Math.min(1000, Number(req.body?.quranPages) || 0));
  const dhikr = Math.max(0, Math.min(100000, Number(req.body?.dhikr) || 0));
  const fasting = req.body?.fasting ? 1 : 0;
  db.prepare(
    `INSERT INTO tracker (id, user_id, day, prayers, quran_pages, dhikr, fasting, deeds) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, day) DO UPDATE SET prayers = excluded.prayers, quran_pages = excluded.quran_pages,
       dhikr = excluded.dhikr, fasting = excluded.fasting, deeds = excluded.deeds`
  ).run(newId(), req.user.id, day, prayers, quranPages, dhikr, fasting, deeds);
  res.json({ ok: true });
});

app.post('/api/quiz/results', requireAuth, (req, res) => {
  const category = String(req.body?.category || 'general').slice(0, 40);
  const score = Math.max(0, Math.min(200, Number(req.body?.score) || 0));
  const total = Math.max(1, Math.min(200, Number(req.body?.total) || 1));
  db.prepare('INSERT INTO quiz_results (id, user_id, category, score, total, created_at) VALUES (?,?,?,?,?,?)').run(
    newId(),
    req.user.id,
    category,
    score,
    total,
    nowIso()
  );
  res.status(201).json({ ok: true });
});

app.get('/api/quiz/results', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  res.json({ results: rows });
});

/* -------------------------------- community -------------------------------- */

const bannedWords = ['kafir scum', 'kill', 'idiot', 'stupid fool'];

app.get('/api/community/posts', (req, res) => {
  if (getSetting('community_enabled', 'true') !== 'true') {
    return res.json({ posts: [], disabled: true });
  }
  const blocked = req.user
    ? db.prepare('SELECT blocked_user_id FROM blocks WHERE user_id = ?').all(req.user.id).map((r) => r.blocked_user_id)
    : [];
  /* The blue tick comes from the author's stored badge flag, joined on the
   * server. The client never decides who is verified. */
  const rows = db
    .prepare(
      `SELECT p.*, u.badge_verified AS author_badge FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.status = 'published' ORDER BY p.created_at DESC LIMIT 60`
    )
    .all()
    .filter((p) => !blocked.includes(p.user_id))
    .map(({ author_badge, ...post }) => ({ ...post, author_verified: !!author_badge }));
  res.json({ posts: rows, disabled: false });
});

app.post('/api/community/posts', requireAuth, rateLimit({ windowMs: 60_000, max: 5 }), (req, res) => {
  if (getSetting('community_enabled', 'true') !== 'true') {
    return res.status(403).json({ error: 'The community area is currently closed by the administrator.' });
  }
  const body = String(req.body?.body || '').trim().slice(0, 1200);
  if (body.length < 8) return res.status(400).json({ error: 'Please write a little more before posting.' });
  const lower = body.toLowerCase();
  if (bannedWords.some((w) => lower.includes(w))) {
    return res.status(400).json({ error: 'This post was blocked by the community guidelines filter.' });
  }
  const links = (body.match(/https?:\/\//g) || []).length;
  if (links > 1) return res.status(400).json({ error: 'Please keep posts free of link spam.' });
  const id = newId();
  db.prepare('INSERT INTO posts (id, user_id, author, body, created_at) VALUES (?,?,?,?,?)').run(
    id,
    req.user.id,
    req.user.name || 'Muslim',
    body,
    nowIso()
  );
  auditLog(req.user, 'post.create', id);
  res.status(201).json({ post: db.prepare('SELECT * FROM posts WHERE id = ?').get(id) });
});

app.post('/api/community/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const liked = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
  if (liked) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    db.prepare('UPDATE posts SET likes = MAX(likes - 1, 0) WHERE id = ?').run(post.id);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').run(post.id, req.user.id);
    db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(post.id);
  }
  res.json({ likes: db.prepare('SELECT likes FROM posts WHERE id = ?').get(post.id).likes, liked: !liked });
});

app.post('/api/community/report', requireAuth, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (reason.length < 4) return res.status(400).json({ error: 'Please describe the problem briefly.' });
  db.prepare('INSERT INTO reports (id, post_id, reporter_id, reporter_email, reason, created_at) VALUES (?,?,?,?,?,?)').run(
    newId(),
    String(req.body?.postId || '').slice(0, 60),
    req.user.id,
    req.user.email,
    reason,
    nowIso()
  );
  auditLog(req.user, 'post.report');
  res.status(201).json({ ok: true, note: 'Thank you. A moderator will review this report.' });
});

app.post('/api/community/block', requireAuth, (req, res) => {
  const target = String(req.body?.userId || '').slice(0, 60);
  if (!target || target === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
  db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?,?)').run(req.user.id, target);
  res.json({ ok: true });
});

/* --------------------------------- contact --------------------------------- */

app.post('/api/contact', rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().slice(0, 120);
  const phone = String(req.body?.phone || '').trim().slice(0, 40);
  const subject = String(req.body?.subject || '').trim().slice(0, 140);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (body.length < 10) return res.status(400).json({ error: 'Please write a little more in your message.' });

  const id = newId();
  const owner = getSetting('contact_email', 'mohamoudistanbul@gmail.com');
  const delivery = await sendEmail({
    to: owner,
    subject: `RIFQ Muslim contact: ${subject || 'New message'}`,
    text: `From: ${name} <${email}>${phone ? `\nPhone: ${phone}` : ''}\n\n${body}`,
  });
  db.prepare(
    'INSERT INTO messages (id, user_id, name, email, phone, subject, body, created_at, email_delivered, email_note) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, req.user?.id || null, name, email, phone, subject, body, nowIso(), delivery.delivered ? 1 : 0, delivery.reason || '');
  auditLog(req.user, 'contact.message', id);
  res.status(201).json({
    stored: true,
    delivered: delivery.delivered,
    note: delivery.delivered
      ? 'Your message was saved and emailed to the RIFQ Muslim team.'
      : `Your message is saved in the RIFQ Muslim inbox, but email delivery is not configured yet (${delivery.reason}). The team will see it in the admin dashboard.`,
  });
});

/* -------------------------------- assistant -------------------------------- */

app.post('/api/assistant', rateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
  const result = await answerQuestion({
    question: req.body?.question,
    lang: req.body?.lang,
    history: Array.isArray(req.body?.history) ? req.body.history : [],
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

/* ------------------------- Quran / hadith / places -------------------------- */

/* ESM imports are hoisted, so binding the audio router here keeps it next to
 * the mount that uses it. Audio-only: surah metadata plus the recitation stream. */
import { quranAudioRouter } from './quran-audio.js';

app.use('/api', geoRouter);
// Mounted before contentRouter so /hadith/daily, /hadith/:c/sections and
// /hadith/search/query win over the legacy single-collection route.
app.use('/api', hadithRouter);
app.use('/api', contentRouter);
app.use('/api', quranAudioRouter);
// Quiz, Kid Academy, Premium and the mosque finder. Public reads only; every
// write below is guarded inside its own router.
app.use('/api', quizRouter);
app.use('/api', kidsRouter);
app.use('/api', premiumRouter);
app.use('/api', mosquesRouter);
// Free/Premium control over existing content. Public reads, staff-only writes.
app.use('/api', accessRouter);

/* ---------------------------------- admin ---------------------------------- */

// Public visit beacon first, then the guarded analytics report, then the rest of
// the admin API. Mount order keeps /api/admin/analytics out of the generic
// admin router so it can never be reached by a wildcard path.
app.use('/api/analytics', visitRouter);
app.use('/api/admin/analytics', analyticsRouter);
// Mounted ahead of the generic admin router so these paths are matched first.
app.use('/api/admin/premium', premiumAdminRouter);
app.use('/api/admin/premium-content', accessAdminRouter);
app.use('/api/admin/quiz', quizAdminRouter);
app.use('/api/admin', adminRouter);

/* -------------------------------- downloads -------------------------------- */

app.use(downloadRouter);

/* --------------------------------- static --------------------------------- */

const dist = path.join(__dirname, '..', 'dist');
// Uploaded media is served from disk with a long cache; filenames are random.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
}
let indexCache = { mtimeMs: 0, html: '' };
const readIndexHtml = (file) => {
  const { mtimeMs } = fs.statSync(file);
  if (indexCache.mtimeMs !== mtimeMs) {
    indexCache = { mtimeMs, html: fs.readFileSync(file, 'utf8') };
  }
  return indexCache.html;
};

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  // Serving the public download portal is the visitor event itself, so the count
  // does not depend on client-side JavaScript running.
  if (req.path === '/download' || req.path === '/download/') recordPortalVisit(req);
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    return res.status(503).json({ error: 'The app is starting up. Please refresh in a moment.' });
  }
  // Canonical and Open Graph tags follow the hostname the visitor used, or the
  // configured PUBLIC_APP_URL once a custom domain is attached.
  res.type('html').set('Cache-Control', 'no-cache').send(renderIndex(readIndexHtml(index), req));
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  console.error('[rifq] error:', err?.message || err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RIFQ Muslim API listening on 0.0.0.0:${PORT}`);
  void warmContent().catch(() => {
    /* warm-up is best effort; requests fall back to on-demand fetching */
  });
});
