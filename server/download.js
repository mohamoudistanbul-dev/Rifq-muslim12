/**
 * Android APK delivery for RIFQ Muslim.
 *
 * Three real sources, in priority order:
 *   1. APK_DOWNLOAD_URL          — hosting environment variable (Cloudflare R2)
 *   2. the admin setting          — Admin -> Settings -> APK download URL
 *   3. an uploaded APK file       — Admin -> Settings -> Upload APK file
 *
 * Source 3 means the download works without any external bucket: the file is
 * stored inside the app and streamed from here. Every source answers with
 *
 *   Content-Disposition: attachment; filename="RIFQ-Muslim.apk"
 *   Content-Type: application/vnd.android.package-archive
 *
 * Range requests are honoured so Android's Download Manager can resume an
 * interrupted download instead of starting over on mobile data.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getSetting, DATA_DIR } from './db.js';

export const APK_FILENAME = 'RIFQ-Muslim.apk';
export const APK_PATH = `/download/${APK_FILENAME}`;
export const APK_MIME = 'application/vnd.android.package-archive';
// Uploaded APKs live on the persistent disk so they survive a redeploy.
export const APK_DIR = path.join(DATA_DIR, 'apk');
export const APK_FILE = path.join(APK_DIR, APK_FILENAME);
export const APK_MAX_BYTES = 200 * 1024 * 1024;

const isHttpUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());

const attachment = `attachment; filename="${APK_FILENAME}"; filename*=UTF-8''${encodeURIComponent(APK_FILENAME)}`;

/** Cache of source checks, so a landing page is not re-fetched on every request. */
const PROBE_TTL_MS = 10 * 60 * 1000;
const probeCache = new Map();

const looksLikeHtml = (buf) => {
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i += 1;
  return buf[i] === 0x3c; // '<'
};

/**
 * Check that a saved download URL really serves an APK.
 *
 * File-hosting "share" pages answer 200 with HTML. Proxying that as
 * RIFQ-Muslim.apk hands users a file Android cannot install, so the source is
 * verified first (one small ranged request, cached) and reported as unavailable
 * instead of being advertised as ready.
 */
async function probeRemoteApk(url) {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached;

  let result = { ok: false, reason: 'unreachable', size: null, at: Date.now() };
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-511' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok && res.status !== 206) {
      result.reason = `http_${res.status}`;
    } else {
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      const reader = res.body?.getReader();
      let head = Buffer.alloc(0);
      if (reader) {
        const { value } = await reader.read();
        if (value) head = Buffer.from(value.subarray(0, 512));
        await reader.cancel().catch(() => undefined);
      }
      const declared = res.headers.get('content-range')?.split('/')[1] || res.headers.get('content-length');
      const size = Number(declared) || null;
      if (type.startsWith('text/html') || looksLikeHtml(head)) {
        result.reason = 'html_page';
      } else {
        result = { ok: true, reason: null, size, at: Date.now() };
      }
    }
  } catch {
    result.reason = 'unreachable';
  }
  probeCache.set(url, result);
  return result;
}

/** Where the APK currently comes from, or null when nothing is configured. */
export function apkSource() {
  const fromEnv = String(process.env.APK_DOWNLOAD_URL || '').trim();
  if (isHttpUrl(fromEnv)) return { kind: 'url', url: fromEnv, origin: 'environment' };

  const fromSetting = String(getSetting('download_url', '') || '').trim();
  if (isHttpUrl(fromSetting) && !/\/download\/rifq-muslim\.apk$/i.test(fromSetting)) {
    // A URL the probe already rejected (an HTML share page, a 404) is not an APK
    // source: fall through so an uploaded file can still be served.
    const known = probeCache.get(fromSetting);
    if (!known || known.ok) return { kind: 'url', url: fromSetting, origin: 'setting' };
  }

  try {
    const stat = fs.statSync(APK_FILE);
    if (stat.isFile() && stat.size > 0) return { kind: 'file', file: APK_FILE, size: stat.size, origin: 'upload' };
  } catch {
    /* no uploaded file */
  }
  return null;
}

/** Status used by the download card and the admin panel. */
export function apkInfoSnapshot() {
  const source = apkSource();
  if (!source) {
    return {
      configured: false,
      filename: APK_FILENAME,
      url: APK_PATH,
      size: null,
      source: 'none',
      uploaded: fs.existsSync(APK_FILE),
    };
  }
  if (source.kind === 'file') {
    return {
      configured: true,
      filename: APK_FILENAME,
      url: APK_PATH,
      size: source.size,
      source: 'upload',
      uploaded: true,
    };
  }
  return { configured: true, filename: APK_FILENAME, url: APK_PATH, size: null, source: 'url', uploaded: fs.existsSync(APK_FILE) };
}

/** Snapshot for the download card, the admin panel and /api/config. */
export async function apkStatus() {
  const snapshot = apkInfoSnapshot();
  const source = apkSource();
  if (!source || source.kind !== 'url') return snapshot;

  const probe = await probeRemoteApk(source.url);
  if (!probe.ok) {
    return { ...snapshot, configured: false, source: 'invalid', reason: probe.reason, size: null };
  }
  return { ...snapshot, size: probe.size ?? snapshot.size };
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start;
  let end;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function streamRemote(req, res, source) {
  const range = req.headers.range;
  let upstream;
  try {
    upstream = await fetch(source.url, {
      headers: range ? { Range: String(range) } : {},
      redirect: 'follow',
    });
  } catch {
    return res.status(502).json({ error: 'The APK file could not be reached right now. Please try again.' });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return res.status(502).json({ error: 'The APK file could not be reached right now. Please try again.' });
  }

  res.status(upstream.status === 206 ? 206 : 200);
  res.set({
    'Content-Type': APK_MIME,
    'Content-Disposition': attachment,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  const length = upstream.headers.get('content-length');
  if (length) res.set('Content-Length', length);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) res.set('Content-Range', contentRange);

  if (req.method === 'HEAD' || !upstream.body) {
    await upstream.body?.cancel?.().catch(() => undefined);
    return res.end();
  }

  const body = Readable.fromWeb(upstream.body);
  body.on('error', () => res.destroy());
  req.on('close', () => {
    body.destroy();
    upstream.body?.cancel?.().catch(() => undefined);
  });
  body.pipe(res);
}

function streamLocal(req, res, source) {
  const { size } = source;
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;

  if (req.headers.range && !range) {
    res.status(416).set('Content-Range', `bytes */${size}`);
    return res.end();
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;

  res.status(range ? 206 : 200);
  res.set({
    'Content-Type': APK_MIME,
    'Content-Disposition': attachment,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  if (range) res.set('Content-Range', `bytes ${start}-${end}/${size}`);

  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(source.file, { start, end });
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  return stream.pipe(res);
}

async function apkHandler(req, res) {
  const source = apkSource();
  if (!source) {
    return res.status(503).json({
      error: 'The Android APK has not been uploaded yet. An administrator can add it in Admin -> Settings -> Android APK.',
      code: 'apk_not_configured',
    });
  }
  if (source.kind === 'url') {
    const probe = await probeRemoteApk(source.url);
    if (!probe.ok) {
      return res.status(503).json({
        error: 'The saved Android download link does not serve an APK file. An administrator can upload the .apk in Admin -> Settings -> Android APK.',
        code: 'apk_source_invalid',
        reason: probe.reason,
      });
    }
  }
  return source.kind === 'file' ? streamLocal(req, res, source) : streamRemote(req, res, source);
}

async function apkInfoHandler(_req, res) {
  res.json(await apkStatus());
}

export const downloadRouter = express.Router();
downloadRouter.get(APK_PATH, apkHandler);
downloadRouter.head(APK_PATH, apkHandler);
downloadRouter.get('/api/download/info', apkInfoHandler);
