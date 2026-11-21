import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * SQLite persistence via sql.js (WebAssembly SQLite).
 *
 * Chosen because it needs no native compilation: the exact same engine runs in
 * development and in the deployed container. The database lives in a real
 * SQLite file on the persistent disk (/data/rifq.db) and is written atomically
 * after every mutation, so records survive restarts and redeploys.
 */
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const BUNDLED_DATA = path.join(process.cwd(), 'data');

/** True when `dir` exists (or can be created) and accepts a real write. */
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.rifq-write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Durable data directory.
 *
 * The container filesystem is replaced on every publish, so the SQLite file and
 * uploaded files must live on the persistent disk (mounted at /data) instead of
 * inside the image. DATA_DIR overrides the location; if the disk is missing or
 * read-only the app keeps working from the bundled folder rather than failing.
 */
function resolveDataDir() {
  const preferred = String(process.env.DATA_DIR || '').trim();
  const candidates = preferred ? [preferred] : ['/data'];
  for (const dir of candidates) {
    if (writable(dir)) return dir;
  }
  return BUNDLED_DATA;
}

export const DATA_DIR = resolveDataDir();
export const DATA_DURABLE = path.resolve(DATA_DIR) !== path.resolve(BUNDLED_DATA);
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'rifq.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/*
 * First boot on a fresh disk: bring the shipped database across so existing
 * accounts, content and settings are not lost when the disk is attached.
 * Set SEED_BUNDLED_DB=0 to start from an empty database instead.
 */
const bundledDb = path.join(BUNDLED_DATA, 'rifq.db');
if (
  process.env.SEED_BUNDLED_DB !== '0' &&
  !fs.existsSync(DB_PATH) &&
  fs.existsSync(bundledDb) &&
  path.resolve(bundledDb) !== path.resolve(DB_PATH)
) {
  try {
    fs.copyFileSync(bundledDb, DB_PATH);
    console.log(`[db] copied the bundled database to ${DB_PATH}`);
  } catch (err) {
    console.error('[db] could not copy the bundled database:', err.message);
  }
}

console.log(`[db] data directory: ${DATA_DIR} (${DATA_DURABLE ? 'persistent disk' : 'container filesystem'})`);

const SQL = await initSqlJs({
  locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file),
});

const existing = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
const raw = existing ? new SQL.Database(existing) : new SQL.Database();

/* ------------------------------ persistence ------------------------------ */

let saveTimer = null;
let dirty = false;

function writeNow() {
  if (!dirty) return;
  dirty = false;
  const bytes = Buffer.from(raw.export());
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, DB_PATH);
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeNow();
    } catch (err) {
      console.error('[db] save failed:', err.message);
    }
  }, 120);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function flushAndExit(code) {
  try {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    dirty = true;
    writeNow();
  } catch {
    /* ignore */
  }
  process.exit(code);
}
process.on('SIGINT', () => flushAndExit(0));
process.on('SIGTERM', () => flushAndExit(0));
process.on('beforeExit', () => {
  try {
    writeNow();
  } catch {
    /* ignore */
  }
});

/* --------------------------- better-sqlite3-ish API ---------------------- */

class Statement {
  constructor(sql) {
    this.sql = sql;
  }

  all(...params) {
    const stmt = raw.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...params) {
    return this.all(...params)[0];
  }

  run(...params) {
    const stmt = raw.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = raw.getRowsModified();
    let lastInsertRowid = null;
    try {
      const res = raw.exec('SELECT last_insert_rowid() AS id');
      lastInsertRowid = res[0]?.values?.[0]?.[0] ?? null;
    } catch {
      lastInsertRowid = null;
    }
    scheduleSave();
    return { changes, lastInsertRowid };
  }
}

export const db = {
  prepare: (sql) => new Statement(sql),
  exec: (sql) => {
    raw.run(sql);
    scheduleSave();
  },
  run: (sql, params) => {
    raw.run(sql, params);
    scheduleSave();
  },
  raw,
  flush: () => writeNow(),
};

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  reset_token TEXT,
  reset_exp INTEGER,
  lang TEXT NOT NULL DEFAULT 'en',
  theme TEXT NOT NULL DEFAULT 'dark',
  prefs TEXT NOT NULL DEFAULT '{}',
  banned INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  surah INTEGER,
  ayah INTEGER,
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS tasbih (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dhikr TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  target INTEGER NOT NULL DEFAULT 33,
  day TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, dhikr, day)
);

CREATE TABLE IF NOT EXISTS tracker (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  prayers TEXT NOT NULL DEFAULT '{}',
  quran_pages INTEGER NOT NULL DEFAULT 0,
  dhikr INTEGER NOT NULL DEFAULT 0,
  fasting INTEGER NOT NULL DEFAULT 0,
  deeds TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, day)
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  likes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  reporter_id TEXT,
  reporter_email TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS blocks (
  user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  PRIMARY KEY (user_id, blocked_user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  email_delivered INTEGER NOT NULL DEFAULT 0,
  email_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  admin_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracker_user ON tracker(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at);

/* Admin CMS: everything the Super Admin publishes lives here. */
CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  author_email TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_slug ON content(slug);
CREATE INDEX IF NOT EXISTS idx_content_type ON content(type, status);
/*
 * Verification requests: a user asks for the blue tick, a Super Admin decides.
 * The badge itself is never granted here — approving writes users.badge_verified
 * through the same server-side path as a direct grant, with an audit entry.
 */
CREATE TABLE IF NOT EXISTS badge_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_badge_requests_status ON badge_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at);

/*
 * Downloads and visitors analytics (Admin -> Analytics).
 *
 * One row per counted event. The visitor column is a salted HMAC of
 * ip+ua+day, never an IP address, and UNIQUE(kind, visitor, bucket) is what
 * makes the counting idempotent: a refresh, a double-fired beacon or a retried
 * request collapses onto the existing row instead of adding a second event.
 */
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT 'unknown',
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  visitor TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(kind, visitor, bucket)
);

CREATE INDEX IF NOT EXISTS idx_analytics_kind_day ON analytics_events(kind, day);
CREATE INDEX IF NOT EXISTS idx_analytics_day ON analytics_events(day);

/*
 * Premium subscriptions.
 *
 * premium_plans is the admin-editable catalogue. A subscription row is only
 * ever written after the server has verified a purchase with Google Play or
 * the App Store (or a Super Admin made an explicit manual grant). The client
 * never sends an expiry date and never grants access by itself: entitlement is
 * derived from these rows on every request.
 */
CREATE TABLE IF NOT EXISTS premium_plans (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  period TEXT NOT NULL DEFAULT 'month',
  product_id TEXT NOT NULL DEFAULT '',
  benefits TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  plan_code TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  purchase_token TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  expires_at TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(provider, purchase_token)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);

/*
 * Islamic quiz. Questions live in the database so an administrator can edit
 * them, and every answer key stays on the server: the client only ever receives
 * questions and options, never the correct index.
 */
CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'quran',
  level INTEGER NOT NULL DEFAULT 1,
  reference TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '[]',
  answer INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'mixed',
  level INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  percent INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'practice',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_results_user ON quiz_results(user_id, created_at);

/* Kid Academy lessons and per-child progress. */
CREATE TABLE IF NOT EXISTS kids_lessons (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kids_progress (
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 1,
  stars INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS kids_certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  child_name TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  lessons INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expires_at);

/* Quiz and Kid Academy content: seeded from verified banks, then admin-editable. */
CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  answer INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  i18n TEXT NOT NULL DEFAULT '{}',
  premium INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_category ON quiz_questions(category, level, active);

CREATE TABLE IF NOT EXISTS kids_lessons (
  id TEXT PRIMARY KEY,
  track TEXT NOT NULL,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audio TEXT NOT NULL DEFAULT '',
  quiz TEXT NOT NULL DEFAULT '[]',
  premium INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kids_track ON kids_lessons(track, sort);

CREATE TABLE IF NOT EXISTS kids_progress (
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
`);

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function auditLog(actor, action, detail = '') {
  db.prepare('INSERT INTO audit (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)').run(
    newId(),
    actor?.id || null,
    actor?.email || null,
    action,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
    nowIso()
  );
}

/* ---------------------- blue verified badge (server-side) -------------------- */

/**
 * The badge is a separate column from `verified` (which means "email
 * confirmed"). It defaults to 0 for every existing and new account, so no
 * ordinary account or premium subscriber is ever marked verified by accident.
 * A guarded ALTER keeps existing databases working.
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'badge_verified', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'badge_verified_at', 'TEXT');
ensureColumn('users', 'badge_verified_by', 'TEXT');

/*
 * Kids Academy certificate name. Kept separate from the account name so a
 * parent can print a child's certificate without renaming the account.
 */
ensureColumn('users', 'kids_name', 'TEXT');

export function publicUser(row) {
  if (!row) return null;
  let prefs = {};
  try {
    prefs = JSON.parse(row.prefs || '{}');
  } catch {
    prefs = {};
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    verified: !!row.verified,
    /* Blue verified tick: granted only by a Super Admin, stored server-side. */
    badgeVerified: !!row.badge_verified,
    badgeVerifiedAt: row.badge_verified_at || null,
    badgeVerifiedBy: row.badge_verified_by || null,
    lang: row.lang,
    theme: row.theme,
    prefs,
    createdAt: row.created_at,
    lastLogin: row.last_login,
  };
}
