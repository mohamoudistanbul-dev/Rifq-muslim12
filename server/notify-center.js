/**
 * Notification centre for RIFQ Muslim.
 *
 * One module owns three things the rest of the app asks about:
 *  1. The categories a user can switch on or off (prayer times, Quran, Quran
 *     Radio, Kid Academy, Adhkar/Duas, general announcements) and the in-app
 *     route each one opens, so a tap always lands on the right screen.
 *  2. Each account's preferences: master switch, per-category switch and the
 *     language the notification should be written in (Arabic / Somali / English).
 *  3. The wording of notifications the server raises by itself, in all three
 *     languages, with the Arabic variants marked right-to-left.
 *
 * The server is the enforcement point. sendPushToUsers() asks this module which
 * recipients actually accept a category, so switching a category off stops both
 * the inbox row and the device notification.
 */
import { db, nowIso } from './db.js';
import { fcmStatus } from './push-fcm.js';

export const LANGS = [
  { id: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { id: 'so', label: 'Somali', native: 'Soomaali', dir: 'ltr' },
  { id: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl' },
];
export const LANG_IDS = LANGS.map((l) => l.id);
export const DEFAULT_LANG = 'en';

/** Categories are stable ids; the UI never invents its own list. */
export const CATEGORIES = [
  {
    id: 'prayer',
    emoji: '🕌',
    route: '/athan',
    defaultEnabled: true,
    label: { en: 'Prayer times & Adhan', so: 'Waqtiyada salaadda & Adhaan', ar: 'أوقات الصلاة والأذان' },
    hint: {
      en: 'The five daily prayers at your location.',
      so: 'Shanta salaadood ee maalinlaha ah.',
      ar: 'الصلوات الخمس في موقعك.',
    },
  },
  {
    id: 'prayer_reminders',
    emoji: '⏰',
    route: '/athan',
    defaultEnabled: true,
    label: { en: 'Reminders before prayer', so: 'Xusuusin salaadda ka hor', ar: 'تذكير قبل الصلاة' },
    hint: {
      en: 'A quiet reminder 15–30 minutes before prayer.',
      so: 'Xusuusin aamusnaan 15–30 daqiiqo ka hor.',
      ar: 'تنبيه هادئ قبل الصلاة بـ15–30 دقيقة.',
    },
  },
  {
    id: 'quran',
    emoji: '📖',
    route: '/quran',
    defaultEnabled: true,
    label: { en: 'Quran reading', so: 'Akhriska Quraanka', ar: 'تلاوة القرآن' },
    hint: {
      en: 'Daily reading reminder and the ayah of the day.',
      so: 'Xusuusinta akhriska maalinlaha ah.',
      ar: 'تذكير الورد اليومي وآية اليوم.',
    },
  },
  {
    id: 'quran_radio',
    emoji: '📻',
    route: '/quran/audio',
    defaultEnabled: true,
    label: { en: 'Quran Radio & audio', so: 'Raadiyaha Quraanka', ar: 'إذاعة القرآن' },
    hint: {
      en: 'New programmes, live recitations and new reciters.',
      so: 'Barnaamijyo cusub iyo qaariyiin cusub.',
      ar: 'برامج جديدة وتلاوات مباشرة وقُرّاء جدد.',
    },
  },
  {
    id: 'kids',
    emoji: '🧒',
    route: '/kids',
    defaultEnabled: true,
    label: { en: 'Kid Academy', so: 'Akadeemiyada Carruurta', ar: 'أكاديمية الأطفال' },
    hint: {
      en: 'New lessons, stories and Arabic activities for children.',
      so: 'Casharro iyo sheekooyin cusub carruurta.',
      ar: 'دروس وقصص وأنشطة جديدة للأطفال.',
    },
  },
  {
    id: 'adhkar',
    emoji: '🌙',
    route: '/duas',
    defaultEnabled: true,
    label: { en: 'Adhkar & Duas', so: 'Adhkaar & Ducooyin', ar: 'الأذكار والأدعية' },
    hint: {
      en: 'Morning and evening Adhkar and the dua of the day.',
      so: 'Adhkaarta subaxa iyo galabta.',
      ar: 'أذكار الصباح والمساء ودعاء اليوم.',
    },
  },
  {
    id: 'announcements',
    emoji: '📣',
    route: '/notifications',
    defaultEnabled: true,
    label: { en: 'Announcements', so: 'Ogeysiisyada', ar: 'الإعلانات' },
    hint: {
      en: 'App updates, new features and important news.',
      so: 'Cusboonaysiin, astaamo cusub iyo warar muhiim ah.',
      ar: 'تحديثات التطبيق والميزات الجديدة والأخبار المهمة.',
    },
  },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const PRAYER_NAMES = {
  fajr: { en: 'Fajr', so: 'Fajr', ar: 'الفجر' },
  dhuhr: { en: 'Dhuhr', so: 'Dhuhr', ar: 'الظهر' },
  asr: { en: 'Asr', so: 'Asr', ar: 'العصر' },
  maghrib: { en: 'Maghrib', so: 'Maghrib', ar: 'المغرب' },
  isha: { en: 'Isha', so: 'Isha', ar: 'العشاء' },
};

/** Server-raised notifications. Admin-written messages supply their own text. */
export const TEMPLATES = {
  prayer: {
    en: { title: '{prayer} — time to pray', body: 'It is time for {prayer} prayer.' },
    so: { title: '{prayer} — waqtigii salaadda', body: 'Waa waqtigii salaadda {prayer}. Alle ha aqbalo.' },
    ar: { title: '{prayer} — حان وقت الصلاة', body: 'حان الآن وقت صلاة {prayer}.' },
  },
  prayer_reminders: {
    en: { title: '{prayer} in {minutes} minutes', body: 'Get ready for {prayer} prayer.' },
    so: { title: '{prayer} {minutes} daqiiqo ka dib', body: 'Isku diyaari salaadda {prayer}.' },
    ar: { title: 'باقٍ {minutes} دقيقة على {prayer}', body: 'استعد لصلاة {prayer}.' },
  },
  quran: {
    en: { title: 'Your Quran reading', body: 'Continue from where you stopped today.' },
    so: { title: 'Akhriskaaga Quraanka', body: 'Sii wad maanta halkii aad ka joogsatay.' },
    ar: { title: 'وردك من القرآن', body: 'أكمل اليوم من حيث توقفت.' },
  },
  quran_radio: {
    en: { title: 'New on Quran Radio', body: 'A new recitation is ready to listen.' },
    so: { title: 'Cusub Raadiyaha Quraanka', body: 'Tilaawaad cusub ayaa diyaar ah.' },
    ar: { title: 'جديد إذاعة القرآن', body: 'تلاوة جديدة جاهزة للاستماع.' },
  },
  kids: {
    en: { title: 'New in Kid Academy', body: 'A new Islamic lesson is waiting.' },
    so: { title: 'Cusub Akadeemiyada Carruurta', body: 'Cashar cusub ayaa sugaya.' },
    ar: { title: 'جديد أكاديمية الأطفال', body: 'درس إسلامي جديد بانتظارك.' },
  },
  adhkar: {
    en: { title: 'Adhkar of the day', body: 'Take a moment for today’s remembrance.' },
    so: { title: 'Adhkaarta maanta', body: 'Waxtar u qaado adhkaarta maanta.' },
    ar: { title: 'أذكار اليوم', body: 'خصّص لحظة لأذكار اليوم.' },
  },
  announcements: {
    en: { title: 'RIFQ Muslim', body: 'You have a new message.' },
    so: { title: 'RIFQ Muslim', body: 'Fariin cusub ayaad haysataa.' },
    ar: { title: 'رِفْق مسلم', body: 'لديك رسالة جديدة.' },
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'en',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_category_prefs (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, category)
);
`);

/* -------------------------------- helpers ---------------------------------- */

export function normalizeLang(value) {
  const lang = String(value || '').toLowerCase().slice(0, 2);
  return LANG_IDS.includes(lang) ? lang : DEFAULT_LANG;
}

export function isCategory(id) {
  return CATEGORY_BY_ID.has(String(id || ''));
}

export function categoryDef(id) {
  return CATEGORY_BY_ID.get(String(id || '')) || null;
}

export function routeFor(category) {
  return categoryDef(category)?.route || '/notifications';
}

export function dirFor(lang) {
  return normalizeLang(lang) === 'ar' ? 'rtl' : 'ltr';
}

/** Picks one language out of a {en,so,ar} field, falling back to English then anything. */
export function localize(value, lang) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const want = normalizeLang(lang);
  return String(value[want] || value.en || value.so || value.ar || '');
}

export function renderTemplate(category, lang, vars = {}) {
  const group = TEMPLATES[category] || TEMPLATES.announcements;
  const chosen = group[normalizeLang(lang)] || group.en;
  const prayer = PRAYER_NAMES[String(vars.prayer || '').toLowerCase()];
  const fill = (text) =>
    String(text || '')
      .replace(/\{prayer\}/g, (prayer && prayer[normalizeLang(lang)]) || prayer?.en || vars.prayer || '')
      .replace(/\{minutes\}/g, String(vars.minutes ?? ''))
      .replace(/\{city\}/g, String(vars.city || ''))
      .trim();
  return { title: fill(chosen.title), body: fill(chosen.body), lang: normalizeLang(lang), dir: dirFor(lang) };
}

/* ------------------------------- preferences -------------------------------- */

export function getPrefs(userId) {
  const row = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(userId);
  const rows = db.prepare('SELECT category, enabled FROM notification_category_prefs WHERE user_id = ?').all(userId);
  const overrides = new Map(rows.map((r) => [r.category, Number(r.enabled) === 1]));
  const categories = {};
  for (const category of CATEGORIES) {
    categories[category.id] = overrides.has(category.id) ? overrides.get(category.id) : category.defaultEnabled;
  }
  return {
    language: normalizeLang(row?.language),
    enabled: row ? Number(row.enabled) === 1 : true,
    categories,
    updatedAt: row?.updated_at || null,
  };
}

/** Validates and stores preferences. Unknown categories/languages are rejected, not guessed. */
export function savePrefs(userId, input = {}) {
  const current = getPrefs(userId);
  const at = nowIso();
  const language = input.language === undefined ? current.language : normalizeLang(input.language);
  if (input.language !== undefined && !LANG_IDS.includes(String(input.language).toLowerCase().slice(0, 2))) {
    return { error: 'Choose Arabic, Somali or English.' };
  }
  const enabled = input.enabled === undefined ? current.enabled : !!input.enabled;

  if (input.categories !== undefined) {
    if (typeof input.categories !== 'object' || input.categories === null) {
      return { error: 'categories must be an object of category → on/off.' };
    }
    for (const [key, value] of Object.entries(input.categories)) {
      if (!isCategory(key)) return { error: `Unknown notification category: ${key}` };
      if (typeof value !== 'boolean') return { error: `Category ${key} must be true or false.` };
    }
  }

  db.prepare(
    `INSERT INTO notification_settings (user_id, language, enabled, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(userId, language, enabled ? 1 : 0, at);

  if (input.categories) {
    const stmt = db.prepare(
      `INSERT INTO notification_category_prefs (user_id, category, enabled, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, category) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    );
    for (const [key, value] of Object.entries(input.categories)) stmt.run(userId, key, value ? 1 : 0, at);
  }

  return { prefs: getPrefs(userId) };
}

export function languageOf(userId) {
  return getPrefs(userId).language;
}

/** True when this account accepts this category right now. */
export function categoryEnabled(userId, category) {
  if (!isCategory(category)) return true;
  const prefs = getPrefs(userId);
  return prefs.enabled && prefs.categories[category] === true;
}

/**
 * Splits recipients into those who accept `category` and those who do not.
 * Returns the language of each accepted recipient so the caller can send the
 * right wording to each group.
 */
export function allowedUserIds(userIds, category) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!isCategory(category)) return { allowed: ids, blocked: [], languages: new Map(ids.map((id) => [id, DEFAULT_LANG])) };
  const allowed = [];
  const blocked = [];
  const languages = new Map();
  for (const userId of ids) {
    const prefs = getPrefs(userId);
    if (prefs.enabled && prefs.categories[category] === true) {
      allowed.push(userId);
      languages.set(userId, prefs.language);
    } else {
      blocked.push(userId);
    }
  }
  return { allowed, blocked, languages };
}

/* --------------------------------- routes ---------------------------------- */

export function registerNotifyCenterRoutes(app, requireAuth, requireAdmin) {
  /** Category + language catalogue for the settings screen. Contains no user data. */
  app.get('/api/notifications/catalog', (req, res) => {
    res.json({ languages: LANGS, categories: CATEGORIES, defaultLanguage: DEFAULT_LANG });
  });

  app.get('/api/notifications/prefs', requireAuth, (req, res) => {
    res.json({ prefs: getPrefs(req.user.id), languages: LANGS, categories: CATEGORIES });
  });

  app.put('/api/notifications/prefs', requireAuth, (req, res) => {
    const result = savePrefs(req.user.id, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ prefs: result.prefs });
  });

  /**
   * Owner-only delivery overview: what the server can actually reach right now,
   * and what it has delivered. Counts come from stored rows, never estimates.
   */
  app.get('/api/admin/push/overview', requireAdmin, (req, res) => {
    const web = db.prepare('SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM push_devices').get();
    const delivery = db
      .prepare('SELECT push_status AS status, COUNT(*) AS count FROM notifications WHERE push_status IS NOT NULL GROUP BY push_status')
      .all();
    const statusCounts = {};
    for (const row of delivery) statusCounts[row.status] = Number(row.count);
    const announcements = db.prepare('SELECT status, COUNT(*) AS count FROM announcements GROUP BY status').all();
    const announcementCounts = {};
    for (const row of announcements) announcementCounts[row.status] = Number(row.count);
    const optedOut = db
      .prepare('SELECT category, COUNT(*) AS count FROM notification_category_prefs WHERE enabled = 0 GROUP BY category')
      .all();

    res.json({
      web: { devices: Number(web?.devices || 0), users: Number(web?.users || 0) },
      fcm: fcmStatus(),
      delivery: statusCounts,
      announcements: announcementCounts,
      optOuts: Object.fromEntries(optedOut.map((row) => [row.category, Number(row.count)])),
      languages: LANGS,
      categories: CATEGORIES,
    });
  });
}
