import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, newId, nowIso, auditLog, publicUser, getSetting, setSetting, DATA_DIR } from './db.js';
import {
  requireAdmin,
  requireSuperAdmin,
  hashPassword,
  verifyPassword,
  passwordProblem,
  emailOk,
  signSession,
  COOKIE,
  cookieOptions,
} from './auth.js';
import { mailConfigured } from './mail.js';
import { APK_DIR, APK_FILE, APK_MAX_BYTES, apkInfoSnapshot, apkStatus } from './download.js';

/**
 * Super Admin control surface.
 *
 * Every route is guarded server-side: `requireAdmin` for editorial work and
 * `requireSuperAdmin` for ownership-level actions (people, settings, backups).
 * The client is never trusted to decide who may do what.
 */
export const adminRouter = express.Router();

// Uploaded media lives on the persistent disk so it survives a redeploy.
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CONTENT_TYPES = ['article', 'page', 'banner', 'announcement'];
const CONTENT_STATUS = ['draft', 'published'];

const SETTING_DEFAULTS = {
  contact_email: 'rifqmuslim@gmail.com',
  contact_phone: '+252612215593',
  whatsapp: '+252612215593',
  download_url: '',
  paypal_donate_url: '',
  paypal_currency: 'USD',
  community_enabled: 'true',
  app_name: 'RIFQ Muslim',
  tagline: 'Your Faith, Your Daily Companion',
  announcement_text: '',
  announcement_active: 'false',
  // Official installation links used by Invite Friends. Empty means "not
  // configured yet" — the app then shares its own live address instead of
  // inventing a store listing.
  play_store_url: '',
  app_store_url: '',
  // Public download portal copy, edited in Admin -> Website settings. The page
  // itself lives at /download and is the one address every invitation shares.
  portal_headline: 'RIFQ Muslim — Your Faith, Your Daily Companion',
  portal_description:
    'Prayer times, the Holy Quran, authentic Hadith, Duas, Qibla and daily worship in one app. Install RIFQ Muslim on your Android phone, or open it on any device.',
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
};
const MAX_UPLOAD = 6 * 1024 * 1024;

const count = (sql, ...params) => Number(db.prepare(sql).get(...params)?.c || 0);

const shapeContent = (r) =>
  r && {
    id: r.id,
    type: r.type,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    body: r.body,
    image: r.image,
    category: r.category,
    status: r.status,
    featured: !!r.featured,
    sort: Number(r.sort || 0),
    views: Number(r.views || 0),
    authorEmail: r.author_email || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
  };

const shapeMedia = (r) => ({
  id: r.id,
  url: r.url,
  filename: r.filename,
  originalName: r.original_name,
  mime: r.mime,
  size: Number(r.size || 0),
  alt: r.alt,
  createdAt: r.created_at,
});

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

function uniqueSlug(base, ignoreId = null) {
  let slug = base;
  for (let i = 2; ; i += 1) {
    const row = db.prepare('SELECT id FROM content WHERE slug = ?').get(slug);
    if (!row || row.id === ignoreId) return slug;
    slug = `${base}-${i}`.slice(0, 88);
  }
}

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

function magicMatches(buf, mime) {
  switch (mime) {
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
    case 'image/avif':
      return buf.slice(4, 8).toString('ascii') === 'ftyp';
    case 'application/pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    default:
      // Audio/video containers vary; the MIME type is stored and replayed on read.
      return true;
  }
}

/* --------------------------------- overview -------------------------------- */

adminRouter.get('/overview', requireAdmin, (_req, res) => {
  res.json({
    users: count('SELECT COUNT(*) AS c FROM users'),
    verifiedUsers: count('SELECT COUNT(*) AS c FROM users WHERE verified = 1'),
    admins: count("SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','superadmin')"),
    posts: count('SELECT COUNT(*) AS c FROM posts'),
    openReports: count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    newMessages: count("SELECT COUNT(*) AS c FROM messages WHERE status = 'new'"),
    bookmarks: count('SELECT COUNT(*) AS c FROM bookmarks'),
    trackerEntries: count('SELECT COUNT(*) AS c FROM tracker'),
    quizAttempts: count('SELECT COUNT(*) AS c FROM quiz_results'),
    notifications: count('SELECT COUNT(*) AS c FROM broadcasts'),
    content: count('SELECT COUNT(*) AS c FROM content'),
    publishedContent: count("SELECT COUNT(*) AS c FROM content WHERE status = 'published'"),
    drafts: count("SELECT COUNT(*) AS c FROM content WHERE status = 'draft'"),
    media: count('SELECT COUNT(*) AS c FROM media'),
    mediaBytes: count('SELECT COALESCE(SUM(size),0) AS c FROM media'),
    emailConfigured: mailConfigured(),
    assistantMode: process.env.OPENAI_API_KEY ? 'model' : 'knowledge-base',
    recent: db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 8').all(),
    topContent: db
      .prepare('SELECT id, title, type, status, views FROM content ORDER BY views DESC, updated_at DESC LIMIT 5')
      .all(),
  });
});

/* ---------------------------------- content -------------------------------- */

adminRouter.get('/content', requireAdmin, (req, res) => {
  const type = CONTENT_TYPES.includes(String(req.query.type)) ? String(req.query.type) : null;
  const status = CONTENT_STATUS.includes(String(req.query.status)) ? String(req.query.status) : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const where = [];
  const params = [];
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(lower(title) LIKE ? OR lower(body) LIKE ? OR lower(category) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = `SELECT * FROM content ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY featured DESC, COALESCE(published_at, created_at) DESC LIMIT 300`;
  res.json({ content: db.prepare(sql).all(...params).map(shapeContent) });
});

adminRouter.get('/content/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That content no longer exists.' });
  res.json({ item: shapeContent(row) });
});

adminRouter.post('/content', requireAdmin, (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 160);
  if (title.length < 3) return res.status(400).json({ error: 'Please enter a title of at least 3 characters.' });
  const type = CONTENT_TYPES.includes(String(req.body?.type)) ? String(req.body.type) : 'article';
  const status = CONTENT_STATUS.includes(String(req.body?.status)) ? String(req.body.status) : 'draft';
  const id = newId();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO content (id,type,title,slug,excerpt,body,image,category,status,featured,sort,author_id,author_email,views,created_at,updated_at,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    type,
    title,
    uniqueSlug(slugify(req.body?.slug || title)),
    String(req.body?.excerpt || '').trim().slice(0, 400),
    String(req.body?.body || '').slice(0, 20000),
    String(req.body?.image || '').slice(0, 500),
    String(req.body?.category || '').trim().slice(0, 60),
    status,
    req.body?.featured ? 1 : 0,
    Number(req.body?.sort) || 0,
    req.user.id,
    req.user.email,
    0,
    ts,
    ts,
    status === 'published' ? ts : null
  );
  auditLog(req.user, 'admin.content.create', `${type} "${title}" (${status})`);
  res.status(201).json({ item: shapeContent(db.prepare('SELECT * FROM content WHERE id = ?').get(id)) });
});

adminRouter.patch('/content/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That content no longer exists.' });

  const title = req.body?.title === undefined ? row.title : String(req.body.title).trim().slice(0, 160);
  if (title.length < 3) return res.status(400).json({ error: 'Please enter a title of at least 3 characters.' });
  const type = CONTENT_TYPES.includes(String(req.body?.type)) ? String(req.body.type) : row.type;
  const status = CONTENT_STATUS.includes(String(req.body?.status)) ? String(req.body.status) : row.status;
  const publishedAt =
    status === 'published' ? row.published_at || nowIso() : status === 'draft' ? null : row.published_at;

  db.prepare(
    `UPDATE content SET title=?, slug=?, type=?, excerpt=?, body=?, image=?, category=?, status=?, featured=?, sort=?, updated_at=?, published_at=? WHERE id=?`
  ).run(
    title,
    req.body?.slug ? uniqueSlug(slugify(req.body.slug), row.id) : row.slug,
    type,
    req.body?.excerpt === undefined ? row.excerpt : String(req.body.excerpt).trim().slice(0, 400),
    req.body?.body === undefined ? row.body : String(req.body.body).slice(0, 20000),
    req.body?.image === undefined ? row.image : String(req.body.image).slice(0, 500),
    req.body?.category === undefined ? row.category : String(req.body.category).trim().slice(0, 60),
    status,
    req.body?.featured === undefined ? row.featured : req.body.featured ? 1 : 0,
    req.body?.sort === undefined ? row.sort : Number(req.body.sort) || 0,
    nowIso(),
    publishedAt,
    row.id
  );
  auditLog(req.user, 'admin.content.update', `"${title}" (${status})`);
  res.json({ item: shapeContent(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)) });
});

adminRouter.post('/content/:id/publish', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That content no longer exists.' });
  const publish = req.body?.published !== false;
  const ts = nowIso();
  db.prepare('UPDATE content SET status=?, published_at=?, updated_at=? WHERE id=?').run(
    publish ? 'published' : 'draft',
    publish ? row.published_at || ts : null,
    ts,
    row.id
  );
  auditLog(req.user, publish ? 'admin.content.publish' : 'admin.content.unpublish', row.title);
  res.json({ item: shapeContent(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)) });
});

adminRouter.delete('/content/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That content no longer exists.' });
  db.prepare('DELETE FROM content WHERE id = ?').run(row.id);
  auditLog(req.user, 'admin.content.delete', `${row.type} "${row.title}"`);
  res.json({ ok: true });
});

/* ----------------------------------- media --------------------------------- */

adminRouter.get('/media', requireAdmin, (_req, res) => {
  res.json({
    media: db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 200').all().map(shapeMedia),
    maxUploadBytes: MAX_UPLOAD,
  });
});

adminRouter.post('/media', requireAdmin, (req, res) => {
  const mime = String(req.body?.mime || '').toLowerCase();
  if (!MIME_EXT[mime]) {
    return res.status(400).json({
      error: 'Unsupported file type. Upload a PNG, JPEG, WebP, GIF, AVIF, PDF, MP3, M4A or MP4 file.',
    });
  }
  const raw = String(req.body?.data || '');
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'That file could not be read.' });
  }
  if (!buf.length) return res.status(400).json({ error: 'That file is empty.' });
  if (buf.length > MAX_UPLOAD) {
    return res.status(413).json({ error: 'Files must be smaller than 6 MB.' });
  }
  if (!magicMatches(buf, mime)) {
    return res.status(400).json({ error: 'The file contents do not match its declared type.' });
  }

  const id = newId();
  const filename = `${id}.${MIME_EXT[mime]}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  } catch (err) {
    return res.status(500).json({ error: `The file could not be stored: ${err.message}` });
  }
  db.prepare(
    'INSERT INTO media (id,filename,original_name,mime,size,url,alt,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    filename,
    String(req.body?.name || filename).slice(0, 160),
    mime,
    buf.length,
    `/uploads/${filename}`,
    String(req.body?.alt || '').slice(0, 200),
    req.user.id,
    nowIso()
  );
  auditLog(req.user, 'admin.media.upload', filename);
  res.status(201).json({ item: shapeMedia(db.prepare('SELECT * FROM media WHERE id = ?').get(id)) });
});

adminRouter.patch('/media/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That file no longer exists.' });
  db.prepare('UPDATE media SET alt = ? WHERE id = ?').run(String(req.body?.alt || '').slice(0, 200), row.id);
  res.json({ item: shapeMedia(db.prepare('SELECT * FROM media WHERE id = ?').get(row.id)) });
});

adminRouter.delete('/media/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That file no longer exists.' });
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  try {
    const target = path.join(UPLOAD_DIR, path.basename(row.filename));
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    /* the record is gone even if the file was already removed */
  }
  auditLog(req.user, 'admin.media.delete', row.filename);
  res.json({ ok: true });
});

/* ----------------------------------- users --------------------------------- */

adminRouter.get('/users', requireAdmin, (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  const rows = db
    .prepare('SELECT * FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 200')
    .all(q, q);
  res.json({ users: rows.map((u) => ({ ...publicUser(u), banned: !!u.banned })) });
});

adminRouter.patch('/users/:id', requireSuperAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'superadmin' && target.id !== req.user.id) {
    return res.status(403).json({ error: 'The Super Admin account cannot be modified from here.' });
  }
  if (target.id === req.user.id && req.body?.role && req.body.role !== 'superadmin') {
    return res.status(400).json({ error: 'You cannot remove your own Super Admin access.' });
  }
  const role = ['user', 'admin', 'superadmin'].includes(String(req.body?.role)) ? req.body.role : target.role;
  const banned = req.body?.banned === undefined ? target.banned : req.body.banned ? 1 : 0;
  const verified = req.body?.verified === undefined ? target.verified : req.body.verified ? 1 : 0;
  db.prepare('UPDATE users SET role = ?, banned = ?, verified = ?, token_version = token_version + 1 WHERE id = ?').run(
    role,
    banned,
    verified,
    target.id
  );
  auditLog(req.user, 'admin.user.update', `${target.email} role=${role} banned=${banned} verified=${verified}`);
  res.json({ ok: true });
});

/* ------------------------------ verified badge ----------------------------- */

import { notify, recordVerificationDecision, syncStaffBadges } from './db.js';
import { VERIFY_DIR, shapeRequest, notifyVerificationDecision } from './verification.js';

/**
 * Direct grant or revoke of the blue tick from the user list.
 *
 * Permissions are checked here, on the server, and never in the browser: only
 * an administrator role reaches this handler, nobody can change their own
 * badge, and staff verification (Owner and admins) is permanent. A revoke must
 * carry a reason, and every decision is written to the history table.
 */
adminRouter.patch('/users/:id/badge', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) {
    return res.status(403).json({ error: 'You cannot change your own verification badge.' });
  }
  if (req.body?.verified === undefined) {
    return res.status(400).json({ error: 'Send verified: true or verified: false.' });
  }
  const grant = req.body.verified === true;
  const reason = String(req.body?.reason || '').trim().slice(0, 600);
  if (!grant && ['admin', 'superadmin'].includes(String(target.role))) {
    return res.status(403).json({
      error: 'The Owner and administrator accounts are verified by role and cannot be unverified.',
    });
  }
  if (!grant && reason.length < 4) {
    return res.status(400).json({ error: 'Please record a short reason for removing verification.' });
  }
  const at = nowIso();
  db.prepare('UPDATE users SET badge_verified = ?, badge_verified_at = ?, badge_verified_by = ? WHERE id = ?').run(
    grant ? 1 : 0,
    grant ? at : null,
    grant ? req.user.email : null,
    target.id
  );
  recordVerificationDecision({
    userId: target.id,
    action: grant ? 'grant' : 'revoke',
    reason,
    actor: req.user,
  });
  auditLog(req.user, grant ? 'admin.badge.grant' : 'admin.badge.revoke', {
    userId: target.id,
    email: target.email,
    by: req.user.email,
    reason,
  });
  /* A direct revoke is not a rejected request, so it gets its own wording. */
  notify(
    target.id,
    grant
      ? {
          kind: 'verification',
          title: 'Your account is verified',
          body: 'The blue verified tick is now shown next to your name across RIFQ Muslim.',
          link: '/profile',
        }
      : {
          kind: 'verification',
          title: 'Your verified badge was removed',
          body: reason
            ? `An administrator removed the blue tick from your account. Reason: ${reason}`
            : 'An administrator removed the blue tick from your account.',
          link: '/profile',
        }
  );
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
});

/** Verified accounts plus the badge audit trail, for the admin dashboard. */
adminRouter.get('/verifications', requireAdmin, (_req, res) => {
  /* Cheap and idempotent: staff always carry the tick, even after a role change. */
  syncStaffBadges();
  const verified = db
    .prepare('SELECT * FROM users WHERE badge_verified = 1 ORDER BY badge_verified_at DESC LIMIT 200')
    .all()
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatar_url || '',
      verifiedAt: u.badge_verified_at,
      verifiedBy: u.badge_verified_by,
    }));
  const decisions = db
    .prepare(
      `SELECT d.*, u.name, u.email FROM verification_decisions d
         LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.created_at DESC LIMIT 100`
    )
    .all();
  const history = db
    .prepare("SELECT * FROM audit WHERE action IN ('admin.badge.grant','admin.badge.revoke') ORDER BY created_at DESC LIMIT 100")
    .all();
  res.json({ verified, decisions, history });
});

/**
 * Verification requests. A signed-in user asks for the blue tick; only a Super
 * Admin can decide, and approving writes exactly the same badge state and audit
 * entry as a direct grant. A Super Admin can never decide their own request.
 */
adminRouter.get('/badge-requests', requireAdmin, (req, res) => {
  syncStaffBadges();
  const status = String(req.query.status || 'pending');
  const rows = db
    .prepare(
      `SELECT r.*, u.name, u.email, u.role, u.badge_verified, u.avatar_url AS user_avatar
         FROM badge_requests r JOIN users u ON u.id = r.user_id
        WHERE (? = 'all' OR r.status = ?)
        ORDER BY r.created_at DESC LIMIT 200`
    )
    .all(status, status);
  const counts = db.prepare('SELECT status, COUNT(*) AS c FROM badge_requests GROUP BY status').all();
  res.json({
    counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.c)])),
    requests: rows.map((r) => ({
      ...shapeRequest(r, { includeDocuments: true }),
      name: r.name,
      email: r.email,
      role: r.role,
      accountAvatar: r.user_avatar || '',
      badgeVerified: !!r.badge_verified,
    })),
  });
});

adminRouter.patch('/badge-requests/:id', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM badge_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been decided.' });
  }
  const action = String(req.body?.action || '');
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: "Send action: 'approve' or 'reject'." });
  }
  if (request.user_id === req.user.id) {
    return res.status(403).json({ error: 'You cannot decide your own verification request.' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user_id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const approve = action === 'approve';
  const reason = String(req.body?.reason || '').trim().slice(0, 600);
  const at = nowIso();
  if (approve) {
    db.prepare('UPDATE users SET badge_verified = 1, badge_verified_at = ?, badge_verified_by = ? WHERE id = ?').run(
      at,
      req.user.email,
      target.id
    );
  }
  db.prepare(
    'UPDATE badge_requests SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?'
  ).run(approve ? 'approved' : 'rejected', at, req.user.email, reason, request.id);
  recordVerificationDecision({
    requestId: request.id,
    userId: target.id,
    action: approve ? 'approve' : 'reject',
    reason,
    actor: req.user,
  });
  auditLog(req.user, approve ? 'admin.badge.grant' : 'admin.badge.request.reject', {
    userId: target.id,
    email: target.email,
    by: req.user.email,
    requestId: request.id,
    source: 'request',
    reason,
  });
  notifyVerificationDecision(target.id, { approved: approve, reason });
  res.json({
    ok: true,
    status: approve ? 'approved' : 'rejected',
    user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)),
  });
});

/**
 * A private supporting document. Only an administrator session can read it, the
 * file is never under /uploads, and the response is marked private/no-store so
 * no shared cache keeps a copy.
 */
adminRouter.get('/badge-requests/:id/documents/:docId', requireAdmin, (req, res) => {
  const doc = db
    .prepare('SELECT * FROM verification_documents WHERE id = ? AND request_id = ?')
    .get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'That document no longer exists.' });
  const file = path.join(VERIFY_DIR, path.basename(doc.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'That document is no longer stored.' });
  const safeName = String(doc.original_name || 'document').replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'document';
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.type(doc.mime || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

adminRouter.delete('/users/:id', requireSuperAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'superadmin' || target.id === req.user.id) {
    return res.status(403).json({ error: 'The Super Admin account cannot be deleted.' });
  }
  for (const table of ['bookmarks', 'tasbih', 'tracker', 'quiz_results', 'post_likes', 'blocks']) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(target.id);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  auditLog(req.user, 'admin.user.delete', target.email);
  res.json({ ok: true });
});

/* --------------------------------- messages -------------------------------- */

adminRouter.get('/messages', requireAdmin, (_req, res) => {
  res.json({ messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 200').all() });
});

adminRouter.patch('/messages/:id', requireAdmin, (req, res) => {
  const status = ['new', 'read', 'replied', 'archived'].includes(String(req.body?.status)) ? req.body.status : 'read';
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, req.params.id);
  auditLog(req.user, 'admin.message.update', `${req.params.id} ${status}`);
  res.json({ ok: true });
});

adminRouter.delete('/messages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  auditLog(req.user, 'admin.message.delete', req.params.id);
  res.json({ ok: true });
});

/* ---------------------------- community moderation ------------------------- */

adminRouter.get('/reports', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, p.body AS post_body, p.author AS post_author FROM reports r
       LEFT JOIN posts p ON p.id = r.post_id ORDER BY r.created_at DESC LIMIT 200`
    )
    .all();
  res.json({ reports: rows });
});

adminRouter.patch('/reports/:id', requireAdmin, (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(String(req.body?.status)) ? req.body.status : 'resolved';
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  if (req.body?.hidePost && req.body?.postId) {
    db.prepare("UPDATE posts SET status = 'hidden' WHERE id = ?").run(req.body.postId);
  }
  auditLog(req.user, 'admin.report.update', `${req.params.id} ${status}`);
  res.json({ ok: true });
});

adminRouter.get('/posts', requireAdmin, (_req, res) => {
  res.json({ posts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 200').all() });
});

adminRouter.patch('/posts/:id', requireAdmin, (req, res) => {
  const status = ['published', 'hidden'].includes(String(req.body?.status)) ? req.body.status : 'published';
  db.prepare('UPDATE posts SET status = ? WHERE id = ?').run(status, req.params.id);
  auditLog(req.user, 'admin.post.moderate', `${req.params.id} ${status}`);
  res.json({ ok: true });
});

adminRouter.delete('/posts/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  auditLog(req.user, 'admin.post.delete', req.params.id);
  res.json({ ok: true });
});

/* ------------------------------ notifications ------------------------------ */

adminRouter.get('/notifications', requireAdmin, (_req, res) => {
  res.json({ notifications: db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 100').all() });
});

adminRouter.post('/notifications', requireAdmin, (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const body = String(req.body?.body || '').trim().slice(0, 1000);
  if (title.length < 3 || body.length < 3) return res.status(400).json({ error: 'Title and message are required.' });
  const id = newId();
  db.prepare('INSERT INTO broadcasts (id, title, body, audience, admin_id, created_at) VALUES (?,?,?,?,?,?)').run(
    id,
    title,
    body,
    'all',
    req.user.id,
    nowIso()
  );
  auditLog(req.user, 'admin.notification.create', title);
  res.status(201).json({ item: db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id) });
});

adminRouter.delete('/notifications/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM broadcasts WHERE id = ?').run(req.params.id);
  auditLog(req.user, 'admin.notification.delete', req.params.id);
  res.json({ ok: true });
});

/* --------------------------------- settings -------------------------------- */

adminRouter.get('/settings', requireAdmin, (_req, res) => {
  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = getSetting(key, SETTING_DEFAULTS[key]);
  res.json({ settings });
});

adminRouter.put('/settings', requireSuperAdmin, (req, res) => {
  for (const key of SETTING_KEYS) {
    if (req.body?.[key] === undefined) continue;
    const value = String(req.body[key]).slice(0, 500);
    if (key === 'contact_email' && value && !emailOk(value)) {
      return res.status(400).json({ error: 'Contact email is not valid.' });
    }
    if (key === 'download_url' && value && !/^https?:\/\//.test(value)) {
      return res.status(400).json({ error: 'Download URL must start with http:// or https://' });
    }
    if ((key === 'play_store_url' || key === 'app_store_url') && value && !/^https?:\/\/[^\s]+$/i.test(value)) {
      return res.status(400).json({ error: 'Store links must start with http:// or https://' });
    }
    setSetting(key, value);
  }
  auditLog(req.user, 'admin.settings.update');
  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = getSetting(key, SETTING_DEFAULTS[key]);
  res.json({ ok: true, settings });
});

/* ----------------------------------- audit --------------------------------- */

adminRouter.get('/audit', requireAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json({ audit: db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT ?').all(limit) });
});

/* --------------------------------- security -------------------------------- */

adminRouter.get('/security', requireAdmin, (req, res) => {
  const admins = db
    .prepare("SELECT id, email, name, role, last_login, created_at FROM users WHERE role IN ('admin','superadmin')")
    .all();
  res.json({
    email: req.user.email,
    role: req.user.role,
    name: req.user.name,
    createdAt: req.user.created_at,
    lastLogin: req.user.last_login,
    admins,
    emailConfigured: mailConfigured(),
    passwordScheme: 'scrypt (N=16384, 64-byte key, per-user salt)',
    sessionNote: 'Sessions are signed, HTTP-only cookies. Changing the password or revoking sessions signs out every other device.',
  });
});

adminRouter.post('/password', requireAdmin, (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (!verifyPassword(current, req.user.pass_hash)) {
    return res.status(400).json({ error: 'Your current password is not correct.' });
  }
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (current === next) return res.status(400).json({ error: 'Please choose a password different from the current one.' });

  db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(
    hashPassword(next),
    req.user.id
  );
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.cookie(COOKIE, signSession(fresh), cookieOptions(req));
  auditLog(fresh, 'admin.password.change');
  res.json({ ok: true, message: 'Your password has been changed.' });
});

adminRouter.post('/sessions/revoke', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.cookie(COOKIE, signSession(fresh), cookieOptions(req));
  auditLog(fresh, 'admin.sessions.revoke');
  res.json({ ok: true, message: 'All other sessions have been signed out.' });
});

adminRouter.get('/backup', requireSuperAdmin, (_req, res) => {
  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = getSetting(key, SETTING_DEFAULTS[key]);
  const payload = {
    exportedAt: nowIso(),
    app: 'RIFQ Muslim',
    note: 'Content, settings and public profile data. Passwords and session secrets are never exported.',
    content: db.prepare('SELECT * FROM content ORDER BY created_at').all(),
    settings,
    users: db.prepare('SELECT id, email, name, role, verified, created_at, last_login FROM users').all(),
    counts: {
      content: count('SELECT COUNT(*) AS c FROM content'),
      media: count('SELECT COUNT(*) AS c FROM media'),
      messages: count('SELECT COUNT(*) AS c FROM messages'),
    },
  };
  res.setHeader('Content-Disposition', 'attachment; filename="rifq-muslim-backup.json"');
  res.json(payload);
});

/* ------------------------------ android APK -------------------------------- */

/** Status of the Android download: source, size and whether it is ready. */
adminRouter.get('/apk', requireAdmin, async (_req, res) => {
  res.json(await apkStatus());
});

/**
 * Stores the APK the owner uploads from the dashboard.
 *
 * The body is streamed straight to disk (no full-file buffer in memory) and the
 * first four bytes are checked, so a renamed image or HTML page is rejected
 * instead of being served to phones as a broken APK.
 */
adminRouter.put('/apk', requireSuperAdmin, (req, res) => {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared && declared > APK_MAX_BYTES) {
    return res.status(413).json({ error: 'The APK must be smaller than 200 MB.' });
  }

  try {
    fs.mkdirSync(APK_DIR, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: `The APK folder could not be created: ${err.message}` });
  }

  const temp = path.join(APK_DIR, `.upload-${newId()}.tmp`);
  const out = fs.createWriteStream(temp);
  let bytes = 0;
  let magic = Buffer.alloc(0);
  let aborted = false;

  const fail = (status, message) => {
    if (aborted) return;
    aborted = true;
    out.destroy();
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      /* nothing to clean up */
    }
    if (!res.headersSent) res.status(status).json({ error: message });
  };

  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (magic.length < 4) magic = Buffer.concat([magic, chunk.subarray(0, 4 - magic.length)]);
    if (bytes > APK_MAX_BYTES) {
      fail(413, 'The APK must be smaller than 200 MB.');
      req.destroy();
    }
  });
  req.on('aborted', () => {
    aborted = true;
    out.destroy();
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      /* nothing to clean up */
    }
  });
  out.on('error', () => fail(500, 'The APK could not be stored on the server.'));

  out.on('finish', () => {
    if (aborted) return;
    if (!bytes) return fail(400, 'The uploaded file was empty.');
    // Every APK is a ZIP archive, so it must start with "PK\x03\x04".
    if (magic.length < 4 || magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 0x03 || magic[3] !== 0x04) {
      return fail(400, 'That file is not an Android APK. Upload the .apk file itself.');
    }
    try {
      fs.renameSync(temp, APK_FILE);
    } catch (err) {
      return fail(500, `The APK could not be stored: ${err.message}`);
    }
    auditLog(req.user, 'admin.apk.upload', `${bytes} bytes`);
    return res.status(201).json(apkInfoSnapshot());
  });

  req.pipe(out);
});

adminRouter.delete('/apk', requireSuperAdmin, (_req, res) => {
  try {
    if (fs.existsSync(APK_FILE)) fs.unlinkSync(APK_FILE);
  } catch (err) {
    return res.status(500).json({ error: `The APK could not be removed: ${err.message}` });
  }
  res.json(apkInfoSnapshot());
});
