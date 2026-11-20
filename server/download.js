/**
 * Android APK delivery for RIFQ Muslim.
 *
 * The APK itself lives in the owner's Cloudflare R2 bucket. Browsers do not
 * honour a custom filename from a third-party object URL, and an R2 public
 * bucket may be slow or unavailable, so this route streams the object through
 * the app and always answers with:
 *
 *   Content-Disposition: attachment; filename="RIFQ-Muslim.apk"
 *   Content-Type: application/vnd.android.package-archive
 *
 * Range requests are forwarded untouched so Android's Download Manager can
 * resume an interrupted download instead of starting over.
 */
import express from 'express';
import { Readable } from 'node:stream';
import { getSetting } from './db.js';

export const APK_FILENAME = 'RIFQ-Muslim.apk';
export const APK_PATH = `/download/${APK_FILENAME}`;
export const APK_MIME = 'application/vnd.android.package-archive';

const isHttpUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());

/** The APK address: APK_DOWNLOAD_URL wins, otherwise the admin's download_url. */
export function apkSource() {
  const fromEnv = String(process.env.APK_DOWNLOAD_URL || '').trim();
  if (isHttpUrl(fromEnv)) return fromEnv;

  const fromSetting = String(getSetting('download_url', '') || '').trim();
  if (!isHttpUrl(fromSetting)) return '';
  // Never point the route at itself: that would loop instead of downloading.
  if (/\/download\/rifq-muslim\.apk$/i.test(fromSetting)) return '';
  return fromSetting;
}

const attachment = `attachment; filename="${APK_FILENAME}"; filename*=UTF-8''${encodeURIComponent(APK_FILENAME)}`;

async function apkHandler(req, res) {
  const source = apkSource();
  if (!source) {
    return res.status(503).json({
      error: 'The Android APK download link is not published yet. Please try again soon.',
      code: 'apk_not_configured',
    });
  }

  const range = req.headers.range;
  let upstream;
  try {
    upstream = await fetch(source, {
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

/** Size and availability for the download card, without exposing the bucket. */
async function apkInfo(_req, res) {
  const source = apkSource();
  if (!source) {
    return res.json({ configured: false, filename: APK_FILENAME, url: APK_PATH, size: null });
  }
  let size = null;
  try {
    const head = await fetch(source, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
    const length = head.headers.get('content-length');
    if (length) size = Number(length) || null;
  } catch {
    /* size is a nicety; the download itself still works */
  }
  res.json({ configured: true, filename: APK_FILENAME, url: APK_PATH, size });
}

export const downloadRouter = express.Router();
downloadRouter.get(APK_PATH, apkHandler);
downloadRouter.head(APK_PATH, apkHandler);
downloadRouter.get('/api/download/info', apkInfo);
