/**
 * Hadith data for the six canonical collections.
 *
 * Source of truth: the hadith-api dataset (fawazahmed0/hadith-api), which ships
 * the Arabic matn of each collection plus published translations, served over
 * jsDelivr. Nothing is generated here:
 *  - Arabic text is passed through exactly as published;
 *  - a translation that the dataset does not contain is returned as an empty
 *    string and flagged, never machine-invented;
 *  - grading strings come from the dataset's own `grades` array, with the
 *    scholar who graded it.
 *
 * The dataset is large (Bukhari alone is ~7 000 entries), so each edition is
 * fetched once and kept in memory with a long TTL.
 */
import { Router } from 'express';
import { requireItemAccess } from './access.js';

const BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
const DAY = 24 * 60 * 60 * 1000;

export const HADITH_COLLECTIONS = [
  {
    key: 'bukhari',
    name: 'Sahih al-Bukhari',
    arabicName: 'صحيح البخاري',
    order: 1,
    imam: 'Imam Muhammad ibn Ismaʿil al-Bukhari (d. 256 AH)',
    imamArabic: 'الإمام محمد بن إسماعيل البخاري',
  },
  {
    key: 'muslim',
    name: 'Sahih Muslim',
    arabicName: 'صحيح مسلم',
    order: 2,
    imam: 'Imam Muslim ibn al-Hajjaj al-Naysaburi (d. 261 AH)',
    imamArabic: 'الإمام مسلم بن الحجاج النيسابوري',
  },
  {
    key: 'abudawud',
    name: 'Sunan Abu Dawud',
    arabicName: 'سنن أبي داود',
    order: 3,
    imam: 'Imam Abu Dawud al-Sijistani (d. 275 AH)',
    imamArabic: 'الإمام أبو داود السجستاني',
  },
  {
    key: 'tirmidhi',
    name: "Jami' at-Tirmidhi",
    arabicName: 'جامع الترمذي',
    order: 4,
    imam: 'Imam Abu ʿIsa Muhammad al-Tirmidhi (d. 279 AH)',
    imamArabic: 'الإمام أبو عيسى محمد الترمذي',
  },
  {
    key: 'nasai',
    name: "Sunan an-Nasa'i",
    arabicName: 'سنن النسائي',
    order: 5,
    imam: "Imam Ahmad ibn Shu'ayb al-Nasa'i (d. 303 AH)",
    imamArabic: 'الإمام أحمد بن شعيب النسائي',
  },
  {
    key: 'ibnmajah',
    name: 'Sunan Ibn Majah',
    arabicName: 'سنن ابن ماجه',
    order: 6,
    imam: 'Imam Muhammad ibn Yazid Ibn Majah (d. 273 AH)',
    imamArabic: 'الإمام محمد بن يزيد ابن ماجه',
  },
];

/**
 * The dataset publishes the Arabic matn and translations but no separate
 * narrator column. The published English translation of Bukhari/Muslim and the
 * Sunan begins with the isnad, e.g. "Narrated 'Umar bin Al-Khattab: …". The
 * narrator is therefore read out of that published sentence, never inferred or
 * guessed; when the sentence is absent the field stays empty and the UI says the
 * narrator is not stated in this dataset.
 */
const NARRATOR_RE = /^\s*(?:narrated|narrated by|it was narrated that)\s+([^:]{2,140}?)\s*:/i;

export function narratorFromEnglish(english) {
  const text = String(english || '').replace(/\s+/g, ' ').trim();
  const match = NARRATOR_RE.exec(text);
  if (!match) return '';
  return match[1].replace(/\s+/g, ' ').trim();
}

const cache = new Map();

async function fetchJson(url, ttlMs, timeoutMs = 30000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'RIFQ-Muslim/1.0' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const value = await res.json();
    cache.set(url, { at: Date.now(), ttl: ttlMs, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

const loaded = new Map();

async function loadCollection(key) {
  if (loaded.has(key)) return loaded.get(key);
  const meta = HADITH_COLLECTIONS.find((c) => c.key === key);
  if (!meta) throw new Error(`Unknown collection "${key}"`);

  const [ara, eng] = await Promise.all([
    fetchJson(`${BASE}/ara-${key}.min.json`, 7 * DAY),
    fetchJson(`${BASE}/eng-${key}.min.json`, 7 * DAY).catch(() => null),
  ]);

  // Somali exists only for some collections in the dataset. It is requested
  // separately and reported as unavailable when the edition does not exist.
  const som = await fetchJson(`${BASE}/som-${key}.min.json`, 7 * DAY).catch(() => null);

  const engMap = new Map((eng?.hadiths || []).map((h) => [h.hadithnumber, h.text]));
  const somMap = new Map((som?.hadiths || []).map((h) => [h.hadithnumber, h.text]));
  const sections = ara.metadata?.sections || eng?.metadata?.sections || {};

  const items = (ara.hadiths || []).map((h) => {
    const book = h.reference?.book ?? null;
    return {
      number: h.hadithnumber,
      arabic: h.text,
      english: engMap.get(h.hadithnumber) || '',
      somali: somMap.get(h.hadithnumber) || '',
      book,
      section: book != null ? sections[String(book)] || '' : '',
      grades: (h.grades || [])
        .filter((g) => g && g.grade)
        .map((g) => ({ grade: g.grade, scholar: g.name || '' })),
      collection: meta.name,
      collectionArabicName: meta.arabicName,
      imam: meta.imam || '',
      imamArabic: meta.imamArabic || '',
      narrator: narratorFromEnglish(engMap.get(h.hadithnumber) || ''),
      narratorSource: 'Narrator as stated in the published English translation',
    };
  });

  const result = {
    ...meta,
    items,
    sections: Object.entries(sections).map(([number, name]) => ({ number: Number(number), name })),
    somaliAvailable: somMap.size > 0,
    englishAvailable: engMap.size > 0,
    source: `hadith-api (fawazahmed0) — ${meta.name}`,
  };
  loaded.set(key, result);
  return result;
}

export const hadithRouter = Router();

hadithRouter.get('/hadith/collections', (_req, res) => {
  res.json({
    collections: HADITH_COLLECTIONS,
    source: 'hadith-api (fawazahmed0) on jsDelivr',
  });
});

/** Hadith of the day — deterministic per UTC day, so every client agrees. */
hadithRouter.get('/hadith/daily', async (_req, res) => {
  const day = Math.floor(Date.now() / DAY);
  const pick = HADITH_COLLECTIONS[day % HADITH_COLLECTIONS.length];
  try {
    const all = await loadCollection(pick.key);
    if (!all.items.length) throw new Error('Collection is empty');
    const item = all.items[(day * 37) % all.items.length];
    res.json({
      collection: pick.name,
      collectionKey: pick.key,
      arabicName: pick.arabicName,
      ...item,
      source: all.source,
    });
  } catch (err) {
    res.status(502).json({ error: `Hadith of the day is unavailable: ${err.message}` });
  }
});

hadithRouter.get('/hadith/:collection/sections', async (req, res) => {
  try {
    const all = await loadCollection(req.params.collection);
    const counts = new Map();
    for (const item of all.items) counts.set(item.book, (counts.get(item.book) || 0) + 1);
    res.json({
      collection: all.name,
      sections: all.sections.map((s) => ({ ...s, count: counts.get(s.number) || 0 })),
      somaliAvailable: all.somaliAvailable,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

hadithRouter.get('/hadith/:collection', requireItemAccess((req) => `hadith.collection.${req.params.collection}`), async (req, res) => {
  try {
    const all = await loadCollection(req.params.collection);
    // `size` is accepted as an alias: the Home screen already asks for it that way.
    const requested = Number(req.query.pageSize || req.query.size) || 20;
    const pageSize = Math.min(Math.max(requested, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const section = req.query.section ? Number(req.query.section) : null;
    const q = String(req.query.q || '').trim().toLowerCase();

    let items = all.items;
    if (section != null && !Number.isNaN(section)) items = items.filter((i) => i.book === section);
    if (q) {
      items = items.filter(
        (i) =>
          i.arabic.includes(q) ||
          i.english.toLowerCase().includes(q) ||
          i.somali.toLowerCase().includes(q) ||
          String(i.number) === q
      );
    }

    const start = (page - 1) * pageSize;
    res.json({
      collection: all.name,
      name: all.name,
      collectionKey: all.key,
      arabicName: all.arabicName,
      total: items.length,
      page,
      pageSize,
      pages: Math.max(Math.ceil(items.length / pageSize), 1),
      somaliAvailable: all.somaliAvailable,
      englishAvailable: all.englishAvailable,
      sections: all.sections,
      items: items.slice(start, start + pageSize),
      source: all.source,
    });
  } catch (err) {
    res.status(404).json({ error: `Collection unavailable: ${err.message}` });
  }
});

/** Search across one collection or all six. */
hadithRouter.get('/hadith/search/query', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) {
    res.status(400).json({ error: 'Type at least two characters to search.' });
    return;
  }
  const keys = req.query.collection
    ? HADITH_COLLECTIONS.filter((c) => c.key === req.query.collection).map((c) => c.key)
    : HADITH_COLLECTIONS.map((c) => c.key);

  const matches = [];
  const failures = [];
  for (const key of keys) {
    try {
      const all = await loadCollection(key);
      const meta = HADITH_COLLECTIONS.find((c) => c.key === key);
      for (const item of all.items) {
        if (matches.length >= 60) break;
        if (
          item.arabic.includes(q) ||
          item.english.toLowerCase().includes(q) ||
          item.somali.toLowerCase().includes(q) ||
          String(item.number) === q
        ) {
          matches.push({ collection: meta.name, collectionKey: key, ...item });
        }
      }
    } catch (err) {
      failures.push(`${key}: ${err.message}`);
    }
  }

  res.json({
    query: q,
    matches,
    count: matches.length,
    truncated: matches.length >= 60,
    failures,
    source: 'hadith-api (fawazahmed0) on jsDelivr',
  });
});
