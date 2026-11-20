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
import { getSetting } from './db.js';

export const APK_FILENAME = 'RIFQ-Muslim.apk';
export const APK_PATH = `/download/${APK_FILENAME}`;
export const APK_MIME = 'application/vnd.android.package-archive';
export const APK_DIR = path.join(process.cwd(), 'data', 'apk');
export const APK_FILE = path.join(APK_DIR, APK_FILENAME);
export const APK_MAX_BYTES = 200 * 1024 * 1024;

const isHttpUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());

const attachment = `attachment; filename="${APK_FILENAME}"; filename*=UTF-8''${encodeURIComponent(APK_FILENAME)}`;

/** Where the APK currently comes from, or null when nothing is configured. */
export function apkSource() {
  const fromEnv = String(process.env.APK_DOWNLOAD_URL || '').trim();
  if (isHttpUrl(fromEnv)) return { kind: 'url', url: fromEnv, origin: 'environment' };

  const fromSetting = String(getSetting('download_url', '') || '').trim();
  if (isHttpUrl(fromSetting) && !/\/download\/rifq-muslim\.apk$/i.test(fromSetting)) {
    return { kind: 'url', url: fromSetting, origin: 'setting' };
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
  return source.kind === 'file' ? streamLocal(req, res, source) : streamRemote(req, res, source);
}

async function apkInfoHandler(_req, res) {
  const snapshot = apkInfoSnapshot();
  if (snapshot.source === 'url') {
    const source = apkSource();
    try {
      const head = await fetch(source.url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
      const length = head.headers.get('content-length');
      if (length) snapshot.size = Number(length) || null;
    } catch {
      /* size is a nicety; the download itself still works */
    }
  }
  res.json(snapshot);
}

export const downloadRouter = express.Router();
downloadRouter.get(APK_PATH, apkHandler);
downloadRouter.head(APK_PATH, apkHandler);
downloadRouter.get('/api/download/info', apkInfoHandler);
