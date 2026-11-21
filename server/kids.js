import express from 'express';
import { db, newId, nowIso, auditLog } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { KIDS_LESSONS } from './kids-data.js';

/**
 * Kid Academy.
 *
 * The catalogue is static and verified (see kids-data.js); what a child does is
 * stored per account in kids_progress so progress survives a new phone. Stars
 * are awarded server-side from the lesson's own rules, so a client cannot post
 * "1000 stars".
 */

const router = express.Router();

const KIND_LABEL = {
  letter: 'Arabic letters',
  surah: 'Short surahs',
  pillar: 'Five pillars',
  manner: 'Good manners',
  story: 'Prophet stories',
};

/** Lesson id → lesson definition. */
const CATALOG = new Map(KIDS_LESSONS.map((l) => [l.id, l]));

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Seed the editable table once so an admin can later disable a lesson. */
function ensureSeeded() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM kids_lessons').get();
  if (n > 0) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO kids_lessons (id, kind, title, body, active, sort) VALUES (?,?,?,?,?,?)'
  );
  for (const lesson of KIDS_LESSONS) {
    insert.run(lesson.id, lesson.kind, JSON.stringify(lesson.title), JSON.stringify(lesson.body), 1, lesson.sort);
  }
}

/** Active lesson ids, honouring admin disable flags. */
function activeIds() {
  ensureSeeded();
  const rows = db.prepare('SELECT id, active, sort FROM kids_lessons ORDER BY sort').all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return KIDS_LESSONS.filter((l) => byId.get(l.id)?.active !== 0).map((l) => l.id);
}

/** Deterministic badge rules, evaluated from stored progress. */
export function badgesFor({ doneIds, stars }) {
  const done = new Set(doneIds);
  const countKind = (kind) => KIDS_LESSONS.filter((l) => l.kind === kind && done.has(l.id)).length;
  const letters = countKind('letter');
  const surahs = countKind('surah');
  const pillars = countKind('pillar');
  const manners = countKind('manner');
  const stories = countKind('story');

  return [
    { id: 'first-step', title: ['First step', 'الخطوة الأولى', 'Tallaabo koowaad'], earned: done.size >= 1, rule: 'Finish 1 lesson' },
    { id: 'letter-explorer', title: ['Letter explorer', 'مستكشف الحروف', 'Sahaaraha xarfaha'], earned: letters >= 10, rule: '10 letters' },
    { id: 'letter-master', title: ['Letter master', 'حافظ الحروف', 'Fahanka xarfaha'], earned: letters >= 28, rule: 'All 28 letters' },
    { id: 'surah-friend', title: ['Friend of surahs', 'صديق السور', 'Saaxiibka suuradaha'], earned: surahs >= 3, rule: '3 surahs' },
    { id: 'surah-keeper', title: ['Keeper of surahs', 'حافظ السور', 'Ilaaliyaha suuradaha'], earned: surahs >= 6, rule: 'All short surahs' },
    { id: 'pillar-proud', title: ['Pillar proud', 'عارف الأركان', 'Aqoonyahan tiirarka'], earned: pillars >= 5, rule: 'All five pillars' },
    { id: 'kind-heart', title: ['Kind heart', 'قلب رحيم', 'Qalbi naxariis leh'], earned: manners >= 6, rule: 'All manners' },
    { id: 'story-teller', title: ['Story teller', 'راوي القصص', 'Sheekhaale'], earned: stories >= 4, rule: 'All prophet stories' },
    { id: 'star-collector', title: ['Star collector', 'جامع النجوم', 'Ururiye xiddigaha'], earned: stars >= 25, rule: '25 stars' },
    { id: 'graduate', title: ['Academy graduate', 'متخرج الأكاديمية', 'Qalinjebiye'], earned: done.size >= 20, rule: '20 lessons' },
  ];
}

function progressFor(userId) {
  const rows = userId
    ? db.prepare('SELECT lesson_id, done, stars FROM kids_progress WHERE user_id = ?').all(userId)
    : [];
  const map = {};
  let stars = 0;
  for (const r of rows) {
    map[r.lesson_id] = { done: Boolean(r.done), stars: r.stars };
    stars += r.stars;
  }
  return { map, stars, doneIds: rows.filter((r) => r.done).map((r) => r.lesson_id) };
}

/** Optional auth: lessons are readable signed-out, progress is not. */
function optionalUser(req) {
  try {
    return req.user || null;
  } catch {
    return null;
  }
}

router.get('/kids/lessons', (req, res) => {
  ensureSeeded();
  const user = optionalUser(req);
  const { map, stars, doneIds } = progressFor(user?.id);
  const rows = db.prepare('SELECT id, active, sort FROM kids_lessons').all();
  const flags = new Map(rows.map((r) => [r.id, r]));

  const lessons = KIDS_LESSONS.filter((l) => flags.get(l.id)?.active !== 0).map((l) => ({
    id: l.id,
    kind: l.kind,
    kindLabel: KIND_LABEL[l.kind] || l.kind,
    sort: l.sort,
    title: l.title,
    body: l.body,
    progress: map[l.id] || { done: false, stars: 0 },
  }));

  res.json({
    ok: true,
    lessons,
    kinds: Object.entries(KIND_LABEL).map(([id, label]) => ({ id, label })),
    stats: {
      lessons: lessons.length,
      completed: doneIds.length,
      stars,
      percent: lessons.length ? Math.round((doneIds.length / lessons.length) * 100) : 0,
    },
    badges: badgesFor({ doneIds, stars }),
  });
});

router.get('/kids/progress', requireAuth, (req, res) => {
  const ids = activeIds();
  const { map, stars, doneIds } = progressFor(req.user.id);
  res.json({
    ok: true,
    progress: map,
    stars,
    completed: doneIds.length,
    total: ids.length,
    percent: ids.length ? Math.round((doneIds.length / ids.length) * 100) : 0,
    badges: badgesFor({ doneIds, stars }),
    certificates: db
      .prepare('SELECT id, child_name, stars, lessons, issued_at FROM kids_certificates WHERE user_id = ? ORDER BY issued_at DESC')
      .all(req.user.id)
      .map((c) => ({ id: c.id, childName: c.child_name, stars: c.stars, lessons: c.lessons, issuedAt: c.issued_at })),
  });
});

/**
 * Complete a lesson. Stars come from the lesson type:
 * letters/pillars/manners 1 star, surahs 2 (they are longer), stories 2.
 * Repeating a lesson keeps the best score and never duplicates rows.
 */
router.post('/kids/complete', requireAuth, (req, res) => {
  const lessonId = String(req.body?.lessonId || '');
  const lesson = CATALOG.get(lessonId);
  if (!lesson) return res.status(400).json({ ok: false, error: 'unknown_lesson' });
  if (!activeIds().includes(lessonId)) return res.status(409).json({ ok: false, error: 'lesson_disabled' });

  const base = lesson.kind === 'surah' || lesson.kind === 'story' ? 2 : 1;
  const requested = Number(req.body?.stars);
  const stars = Number.isFinite(requested) ? Math.max(1, Math.min(base, Math.round(requested))) : base;

  const existing = db
    .prepare('SELECT stars FROM kids_progress WHERE user_id = ? AND lesson_id = ?')
    .get(req.user.id, lessonId);
  const best = Math.max(existing?.stars || 0, stars);

  db.prepare(
    `INSERT INTO kids_progress (user_id, lesson_id, done, stars, updated_at) VALUES (?,?,1,?,?)
     ON CONFLICT(user_id, lesson_id) DO UPDATE SET done = 1, stars = ?, updated_at = ?`
  ).run(req.user.id, lessonId, best, nowIso(), best, nowIso());

  const { stars: totalStars, doneIds } = progressFor(req.user.id);
  res.json({ ok: true, lessonId, stars: best, totalStars, badges: badgesFor({ doneIds, stars: totalStars }) });
});

router.post('/kids/reset', requireAuth, (req, res) => {
  db.prepare('DELETE FROM kids_progress WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true, stars: 0, completed: 0 });
});

/** Save the child's name for the certificate without touching the account name. */
router.post('/kids/name', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
  db.prepare('UPDATE users SET kids_name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ ok: true, name });
});

/**
 * Issue a certificate. Only granted when the child has actually finished every
 * active lesson — the server checks, the client cannot request one early.
 */
router.post('/kids/certificate', requireAuth, (req, res) => {
  const ids = activeIds();
  const { stars, doneIds } = progressFor(req.user.id);
  if (doneIds.length < ids.length) {
    return res.status(409).json({
      ok: false,
      error: 'not_complete',
      remaining: ids.length - doneIds.length,
    });
  }
  const row = db.prepare('SELECT kids_name FROM users WHERE id = ?').get(req.user.id);
  const childName = String(req.body?.childName || row?.kids_name || req.user.name || 'Student').trim().slice(0, 60);
  const id = newId();
  db.prepare('INSERT INTO kids_certificates (id, user_id, child_name, stars, lessons, issued_at) VALUES (?,?,?,?,?,?)').run(
    id, req.user.id, childName, stars, doneIds.length, nowIso()
  );
  auditLog(req.user.id, 'kids.certificate', id);
  res.json({ ok: true, certificate: { id, childName, stars, lessons: doneIds.length, issuedAt: nowIso() } });
});

/* ------------------------------- admin ---------------------------------- */

router.get('/kids/admin/lessons', requireAdmin, (req, res) => {
  ensureSeeded();
  const rows = db.prepare('SELECT id, kind, title, body, active, sort FROM kids_lessons ORDER BY sort').all();
  res.json({
    ok: true,
    lessons: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: parseJson(r.title, []),
      body: parseJson(r.body, {}),
      active: Boolean(r.active),
      sort: r.sort,
    })),
  });
});

router.patch('/kids/admin/lessons/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  ensureSeeded();
  const row = db.prepare('SELECT id FROM kids_lessons WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

  if (typeof req.body?.active === 'boolean') {
    db.prepare('UPDATE kids_lessons SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
  }
  if (Array.isArray(req.body?.title) && req.body.title.length === 3) {
    db.prepare('UPDATE kids_lessons SET title = ? WHERE id = ?').run(JSON.stringify(req.body.title.map((t) => String(t).slice(0, 120))), id);
  }
  if (Number.isFinite(Number(req.body?.sort))) {
    db.prepare('UPDATE kids_lessons SET sort = ? WHERE id = ?').run(Math.round(Number(req.body.sort)), id);
  }
  auditLog(req.user.id, 'kids.lesson.update', id);
  res.json({ ok: true });
});

export default router;
