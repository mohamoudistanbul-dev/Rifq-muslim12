/**
 * Quran audio (audio only).
 *
 * Source: the mp3quran.net CDN, which publishes complete surah recitations for
 * free listening and offline download. Nothing here is synthesised or guessed:
 * every reciter base URL is checked with a real ranged HTTP request before the
 * API reports that reciter as available, and the stream endpoint proxies the
 * CDN so browsers can stream and save files without CORS problems.
 *
 * This module deliberately serves audio and surah metadata only. There is no
 * Quran text, translation or tafsir here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { requireItemAccess } from './access.js';
import { Router } from 'express';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let SURAHS = [];
try {
  SURAHS = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'quran-surahs.json'), 'utf8'));
} catch {
  SURAHS = [];
}

/** The ten requested reciters, mapped to their verified mp3quran.net folders. */
export const RECITERS = [
  {
    id: 'alafasy',
    name: 'Mishary Rashid Alafasy',
    arabic: 'مشاري راشد العفاسي',
    base: 'https://cdn.mp3quran.net/audio/mishary-alafasy/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'sudais',
    name: 'Abdul Rahman Al-Sudais',
    arabic: 'عبدالرحمن السديس',
    base: 'https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'muaiqly',
    name: 'Maher Al-Muaiqly',
    arabic: 'ماهر المعيقلي',
    base: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/',
    bitrate: '128 kbps',
  },
  {
    id: 'abdulbasit',
    name: 'Abdul Basit Abdus Samad',
    arabic: 'عبد الباسط عبد الصمد',
    base: 'https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/',
    bitrate: '128 kbps',
  },
  {
    id: 'ghamdi',
    name: 'Saad Al-Ghamdi',
    arabic: 'سعد الغامدي',
    base: 'https://cdn.mp3quran.net/audio/saad-ghamdi/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'rifai',
    name: 'Hani Ar-Rifai',
    arabic: 'هاني الرفاعي',
    base: 'https://cdn.mp3quran.net/audio/hani-rifai/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'dosari',
    name: 'Yasser Al-Dosari',
    arabic: 'ياسر الدوسري',
    base: 'https://cdn.mp3quran.net/audio/yasser-dosari/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'qatami',
    name: 'Nasser Al-Qatami',
    arabic: 'ناصر القطامي',
    base: 'https://cdn.mp3quran.net/audio/nasser-qatami/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'shatri',
    name: 'Abu Bakr Al-Shatri',
    arabic: 'أبو بكر الشاطري',
    base: 'https://cdn.mp3quran.net/audio/abubakr-shatri/r1/',
    bitrate: '128 kbps',
  },
  {
    id: 'minshawi',
    name: 'Muhammad Siddiq Al-Minshawi',
    arabic: 'محمد صديق المنشاوي',
    base: 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r3/',
    bitrate: '128 kbps',
  },
];

const SOURCE = 'mp3quran.net';
const AVAILABILITY_TTL = 6 * 60 * 60 * 1000;
const availability = new Map();

export function reciterById(id) {
  return RECITERS.find((r) => r.id === id) || null;
}

export function surahFile(surah) {
  return `${String(surah).padStart(3, '0')}.mp3`;
}

export function audioUrl(reciterId, surah) {
  const reciter = reciterById(reciterId);
  if (!reciter || !validSurah(surah)) return null;
  return reciter.base + surahFile(surah);
}

export function validSurah(n) {
  return Number.isInteger(n) && n >= 1 && n <= 114;
}

/** Real ranged request against the CDN: proves the URL exists and is audio. */
export async function probeAudio(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: controller.signal });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const contentRange = res.headers.get('content-range') || '';
    const total = Number(contentRange.split('/')[1] || res.headers.get('content-length') || 0) || 0;
    const status = res.status;
    try {
      await res.body?.cancel();
    } catch {
      /* the probe body is not needed */
    }
    const audio = /audio|mpeg|octet-stream/.test(type);
    return {
      ok: (status === 200 || status === 206) && audio,
      status,
      type,
      total,
      reason: (status === 200 || status === 206) && !audio ? `Unexpected content type: ${type || 'unknown'}` : '',
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, status: 0, type: '', total: 0, reason: aborted ? 'The source timed out.' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function reciterStatus(reciter) {
  const cached = availability.get(reciter.id);
  if (cached && Date.now() - cached.at < AVAILABILITY_TTL) return cached.value;
  const probe = await probeAudio(reciter.base + surahFile(1));
  const value = {
    available: probe.ok,
    sampleBytes: probe.total,
    reason: probe.ok ? '' : probe.reason || `The source returned ${probe.status || 'no response'}.`,
  };
  availability.set(reciter.id, { at: Date.now(), value });
  return value;
}

export const quranAudioRouter = Router();

quranAudioRouter.get('/quran/audio/surahs', (_req, res) => {
  if (SURAHS.length !== 114) {
    return res.status(503).json({ error: 'The surah catalogue could not be loaded.' });
  }
  res.json({ surahs: SURAHS, source: SOURCE });
});

quranAudioRouter.get('/quran/audio/reciters', async (_req, res) => {
  const reciters = await Promise.all(
    RECITERS.map(async (reciter) => ({
      id: reciter.id,
      name: reciter.name,
      arabic: reciter.arabic,
      bitrate: reciter.bitrate,
      source: SOURCE,
      /* Branded artwork shipped with the app (no reciter photography exists at the source). */
      artwork: `/reciters/${reciter.id}.png`,
      ...(await reciterStatus(reciter)),
    }))
  );
  res.json({ reciters, source: SOURCE, verifiedAt: new Date().toISOString() });
});

/** Real file size / availability for one surah, used before showing a download. */
quranAudioRouter.get('/quran/audio/:reciter/:surah/info', async (req, res) => {
  const reciter = reciterById(req.params.reciter);
  const surah = Number(req.params.surah);
  if (!reciter) return res.status(404).json({ error: 'Unknown reciter.' });
  if (!validSurah(surah)) return res.status(400).json({ error: 'Surah must be between 1 and 114.' });
  const url = reciter.base + surahFile(surah);
  const probe = await probeAudio(url);
  res.json({
    reciter: reciter.id,
    surah,
    available: probe.ok,
    bytes: probe.total,
    contentType: probe.type,
    source: SOURCE,
    reason: probe.ok ? '' : probe.reason,
  });
});

/**
 * Stream or download one surah. Range requests are passed straight through, so
 * seeking works and interrupted downloads can resume.
 */
quranAudioRouter.get('/quran/audio/:reciter/:surah', requireItemAccess((req) => `quran.surah.${Number(req.params.surah) || 0}`), async (req, res) => {
  const reciter = reciterById(req.params.reciter);
  const surah = Number(req.params.surah);
  if (!reciter) return res.status(404).json({ error: 'Unknown reciter.' });
  if (!validSurah(surah)) return res.status(400).json({ error: 'Surah must be between 1 and 114.' });

  const url = reciter.base + surahFile(surah);
  const range = req.headers.range;
  const download = req.query.download === '1';

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: range ? { Range: range } : {},
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return res.status(502).json({ error: 'The recitation source is unreachable right now. Please try again.' });
  }

  if (upstream.status !== 200 && upstream.status !== 206) {
    try {
      await upstream.body?.cancel();
    } catch {
      /* nothing to release */
    }
    return res.status(502).json({ error: `The recitation source returned ${upstream.status} for this surah.` });
  }

  res.status(upstream.status);
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Audio-Source', SOURCE);
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="RIFQ-Muslim-${reciter.id}-${surahFile(surah)}"`);
  }

  if (!upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  req.on('close', () => {
    try {
      stream.destroy();
    } catch {
      /* client went away */
    }
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});
