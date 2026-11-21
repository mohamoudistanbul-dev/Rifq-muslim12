import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  db,
  newId,
  nowIso,
  auditLog,
  notify,
} from './db.js';
import { requireAuth, rateLimit } from './auth.js';

/**
 * Blue tick verification requests.
 *
 * A user asks; a human decides. Nothing in this module grants the badge — the
 * admin routes in server/admin.js write users.badge_verified after checking the
 * administrator's role. Two storage rules matter here:
 *
 *  - the profile picture becomes the public avatar (stored with media uploads);
 *  - supporting documents are private. They live in their own directory outside
 *    /uploads and are only ever streamed by an authenticated admin route.
 */
export const VERIFY_DIR = path.join(DATA_DIR, 'verification');
export const AVATAR_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(VERIFY_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_DOC = 4 * 1024 * 1024;
const MAX_DOCS = 3;
const MAX_LINKS = 5;

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DOC_EXT = { ...IMAGE_EXT, 'application/pdf': 'pdf' };

/** Magic-byte check so a renamed executable cannot pass as a PDF or image. */
function magicOk(buf, mime) {
  if (!buf || buf.length < 12) return false;
  if (mime === 'image/png') {
    return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/webp') {
    return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  }
  if (mime === 'application/pdf') return buf.slice(0, 5).toString('ascii') === '%PDF-';
  return false;
}

function decodeBase64(raw) {
  const text = String(raw || '');
  const body = text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text;
  return Buffer.from(body, 'base64');
}

/** Data-URL mime, or the explicit mime field when raw base64 was posted. */
function mimeOf(data, declared) {
  const explicit = String(declared || '').toLowerCase();
  if (explicit) return explicit;
  const text = String(data || '');
  if (!text.startsWith('data:')) return '';
  return text.slice(5, text.indexOf(';')).toLowerCase();
}

function httpLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The one shape both the profile and the dashboard read, so a field can never
 * be shown in one place and silently missing in the other. Private document
 * filenames are omitted unless the caller is an administrator.
 */
export function shapeRequest(row, { includeDocuments = false } = {}) {
  if (!row) return null;
  const links = parseJsonArray(row.links);
  const documents = parseJsonArray(row.documents);
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name || '',
    reason: row.reason || row.note || '',
    avatarUrl: row.avatar_url || '',
    links,
    documentCount: documents.length,
    ...(includeDocuments
      ? {
          documents: documents.map((d) => ({
            id: d.id,
            name: d.name || 'document',
            mime: d.mime || '',
            size: Number(d.size || 0),
          })),
        }
      : {}),
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    decisionReason: row.decision_reason || '',
    revokedAt: row.revoked_at || null,
    revokedBy: row.revoked_by || null,
    revokeReason: row.revoke_reason || '',
  };
}

export const verificationRouter = express.Router();

/* ------------------------------ own request ------------------------------- */

verificationRouter.get('/badge/request', requireAuth, (req, res) => {
  const request = db
    .prepare('SELECT * FROM badge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(req.user.id);
  const me = db.prepare('SELECT badge_verified, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json({
    request: shapeRequest(request),
    badgeVerified: !!me?.badge_verified,
    role: me?.role || 'user',
    avatarUrl: me?.avatar_url || '',
  });
});

/**
 * Submit a verification request.
 *
 * Required: full name, a written reason and a profile picture. Optional:
 * supporting links and up to three documents. A pending request blocks a second
 * one, and an already verified account cannot ask again. Nothing here grants
 * the badge — approval happens in the admin routes only.
 */
verificationRouter.post('/badge/request', requireAuth, rateLimit({ windowMs: 10 * 60_000, max: 20 }), (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!me) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (me.badge_verified) {
    return res.status(400).json({ error: 'This account already has the verified badge.' });
  }
  const pending = db
    .prepare("SELECT id FROM badge_requests WHERE user_id = ? AND status = 'pending'")
    .get(me.id);
  if (pending) {
    return res.status(409).json({ error: 'You already have a verification request waiting for review.' });
  }

  const fullName = String(req.body?.fullName || '').trim().slice(0, 120);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (fullName.length < 3) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }
  if (reason.length < 20) {
    return res.status(400).json({ error: 'Please explain in at least 20 characters why this account should be verified.' });
  }

  const links = [];
  const rawLinks = Array.isArray(req.body?.links) ? req.body.links : [];
  for (const value of rawLinks.slice(0, MAX_LINKS + 3)) {
    if (!String(value || '').trim()) continue;
    const url = httpLink(value);
    if (!url) {
      return res.status(400).json({ error: `“${String(value).slice(0, 60)}” is not a valid http(s) link.` });
    }
    if (!links.includes(url)) links.push(url);
  }
  if (links.length > MAX_LINKS) {
    return res.status(400).json({ error: 'Please share at most 5 supporting links.' });
  }

  const avatarData = String(req.body?.avatar || '');
  if (!avatarData) {
    return res.status(400).json({ error: 'A profile picture is required for verification.' });
  }
  const avatarMime = mimeOf(avatarData, req.body?.avatarMime);
  if (!IMAGE_EXT[avatarMime]) {
    return res.status(400).json({ error: 'The profile picture must be a PNG, JPEG or WebP image.' });
  }
  const avatarBuf = decodeBase64(avatarData);
  if (!avatarBuf.length) return res.status(400).json({ error: 'The profile picture is empty.' });
  if (avatarBuf.length > MAX_AVATAR) {
    return res.status(413).json({ error: 'The profile picture must be smaller than 2 MB.' });
  }
  if (!magicOk(avatarBuf, avatarMime)) {
    return res.status(400).json({ error: 'The profile picture does not look like a real image.' });
  }

  const rawDocs = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (rawDocs.length > MAX_DOCS) {
    return res.status(400).json({ error: 'Please attach at most 3 documents.' });
  }
  const prepared = [];
  for (const doc of rawDocs) {
    const data = String(doc?.data || '');
    const mime = mimeOf(data, doc?.mime);
    if (!DOC_EXT[mime]) {
      return res.status(400).json({ error: 'Supporting documents must be PDF, PNG, JPEG or WebP files.' });
    }
    const buf = decodeBase64(data);
    if (!buf.length) return res.status(400).json({ error: 'One of the attached documents is empty.' });
    if (buf.length > MAX_DOC) {
      return res.status(413).json({ error: 'Each document must be smaller than 4 MB.' });
    }
    if (!magicOk(buf, mime)) {
      return res.status(400).json({ error: 'One of the documents does not match its file type.' });
    }
    prepared.push({ mime, buf, name: String(doc?.name || 'document').slice(0, 160) });
  }

  const id = newId();
  const avatarFile = `${id}-avatar.${IMAGE_EXT[avatarMime]}`;
  const stored = [];
  try {
    fs.writeFileSync(path.join(AVATAR_DIR, avatarFile), avatarBuf);
    for (const doc of prepared) {
      const docId = newId();
      const filename = `${docId}.${DOC_EXT[doc.mime]}`;
      fs.writeFileSync(path.join(VERIFY_DIR, filename), doc.buf);
      db.prepare(
        'INSERT INTO verification_documents (id, request_id, user_id, filename, original_name, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(docId, id, me.id, filename, doc.name, doc.mime, doc.buf.length, nowIso());
      stored.push({ id: docId, name: doc.name, mime: doc.mime, size: doc.buf.length });
    }
    db.prepare(
      `INSERT INTO badge_requests
         (id, user_id, note, full_name, reason, avatar_url, links, documents, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      me.id,
      reason,
      fullName,
      reason,
      `/uploads/${avatarFile}`,
      JSON.stringify(links),
      JSON.stringify(stored),
      'pending',
      nowIso()
    );
    /* The picture is the applicant's avatar from now on, verified or not. */
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(`/uploads/${avatarFile}`, me.id);
  } catch (err) {
    return res.status(500).json({ error: `The request could not be stored: ${err.message}` });
  }

  auditLog(me, 'badge.request.create', { requestId: id, documents: stored.length, links: links.length });
  res.status(201).json({
    request: shapeRequest(db.prepare('SELECT * FROM badge_requests WHERE id = ?').get(id), {
      includeDocuments: true,
    }),
  });
});

/* ----------------------------- notifications ------------------------------ */

/*
 * The user inbox lives in server/index.js (GET /api/notifications and
 * POST /api/notifications/read). It used to be implemented here as well, and
 * because this router is mounted on /api before those routes, the older copy
 * silently answered every request with raw database rows — which is why the
 * inbox and read state did not match what the app expected. Keep exactly one
 * implementation: the one in index.js.
 */

/** Used by the admin routes so a decision never silently fails to notify. */
export function notifyVerificationDecision(userId, { approved, reason = '' }) {
  return notify(userId, {
    kind: 'verification',
    title: approved ? 'Your account is verified' : 'Verification request not approved',
    body: approved
      ? 'The blue verified tick is now shown next to your name across RIFQ Muslim.'
      : reason
        ? `Your verification request was reviewed. Reason: ${reason}`
        : 'Your verification request was reviewed and was not approved. You can submit a new request with more details.',
    link: '/profile',
  });
}
