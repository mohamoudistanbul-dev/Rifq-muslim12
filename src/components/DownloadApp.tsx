import React, { useEffect, useState } from 'react';
import { AppIcon } from './Icons';
import { useStore } from '../lib/store';
import { APK_PATH, fetchApkInfo, formatBytes, startApkDownload, type ApkInfo } from '../lib/download';

type Status = 'idle' | 'preparing' | 'started' | 'unavailable' | 'inapp';

/**
 * WhatsApp, Facebook, Instagram and Telegram open links in their own built-in
 * browser, which blocks APK downloads on many Android phones. Detect it so we
 * can hand the user a working route (Chrome, or a copied link) instead of
 * leaving them with a button that silently does nothing.
 */
function inAppBrowser(): string | null {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/Line\//i.test(ua)) return 'Line';
  return null;
}

/**
 * The official Android download card.
 *
 * Tapping the button navigates to /download/RIFQ-Muslim.apk. The server streams
 * the APK the owner uploaded (or the configured URL) with
 * `Content-Disposition: attachment`, so Android hands it to the Download
 * Manager and saves it as RIFQ-Muslim.apk.
 */
export default function DownloadApp({ compact = false, href }: { compact?: boolean; href?: string }) {
  const { t } = useStore();
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [copied, setCopied] = useState(false);
  const host = inAppBrowser();
  // When the caller supplies its own official link (the Invite Friends page),
  // the button opens that URL directly and the APK-file status below is skipped.
  const external = href?.trim() || null;

  useEffect(() => {
    let alive = true;
    void fetchApkInfo().then((res) => {
      if (alive) setInfo(res);
    });
    return () => {
      alive = false;
    };
  }, []);

  const download = () => {
    if (info && !info.configured) {
      setStatus('unavailable');
      return;
    }
    // Inside a social app's browser a navigation would replace the page with a
    // blank view, so show the working alternative instead.
    if (host) {
      setStatus('inapp');
      return;
    }
    setStatus('preparing');
    startApkDownload(info?.url || APK_PATH);
    // The browser owns the actual progress (Download Manager notification).
    window.setTimeout(() => setStatus('started'), 800);
  };

  const openInChrome = () => {
    const { host: h, origin } = window.location;
    const fallback = `${origin}${APK_PATH}`;
    window.location.href =
      `intent://${h}${APK_PATH}#Intent;scheme=${window.location.protocol.replace(':', '')};` +
      `package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  };

  const copyLink = async () => {
    const link = `${window.location.origin}${APK_PATH}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t('Copy this link'), link);
    }
  };

  const size = formatBytes(info?.size ?? null);
  const notPublished = !!info && !info.configured;

  const smallButton: React.CSSProperties = {
    flex: 1,
    minWidth: 130,
    padding: '9px 12px',
    borderRadius: 12,
    border: '1px solid rgba(212,175,55,.55)',
    background: 'rgba(212,175,55,.10)',
    color: 'inherit',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <section className="card gold-edge">
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <span className="tile-icon" aria-hidden="true">
          <AppIcon name="download" size={20} />
        </span>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>{t('Get RIFQ Muslim for Android')}</h3>
          <p className="tiny muted" style={{ margin: '2px 0 0' }}>
            {size ? `Android APK · ${size}` : t('Android APK · installs outside Google Play')}
          </p>
        </div>
      </div>

      {!compact && (
        <p className="small" style={{ margin: '10px 0 0', lineHeight: 1.55 }}>
          {t('Install the full app on your phone for prayer notifications, offline Quran and the Qibla compass.')}
        </p>
      )}

      {external ? (
        <a
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          href={external}
          target="_blank"
          rel="noopener noreferrer"
          data-download-url={external}
        >
          <AppIcon name="download" size={17} /> {t('DOWNLOAD RIFQ MUSLIM')}
        </a>
      ) : (
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          onClick={download}
          aria-describedby="rifq-download-status"
        >
          <AppIcon name="download" size={17} /> {t('DOWNLOAD RIFQ MUSLIM')}
        </button>
      )}

      {status === 'inapp' && (
        <div style={{ marginTop: 10 }}>
          <p className="small" style={{ margin: '0 0 8px', lineHeight: 1.55 }}>
            {t('You opened this page inside')} {host}. {t('Its browser blocks APK downloads. Open the page in Chrome and the download starts normally.')}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button style={smallButton} onClick={openInChrome}>
              {t('Open in Chrome')}
            </button>
            <button style={smallButton} onClick={() => void copyLink()}>
              {copied ? t('Link copied') : t('Copy download link')}
            </button>
          </div>
        </div>
      )}

      {!external && (
      <p
        id="rifq-download-status"
        role="status"
        aria-live="polite"
        className="tiny"
        style={{ margin: '8px 0 0', minHeight: 16 }}
      >
        {status === 'idle' &&
          (notPublished ? t('The Android file is not available yet.') : `RIFQ-Muslim.apk${size ? ` · ${size}` : ''}`)}
        {status === 'preparing' && t('Starting your download…')}
        {status === 'started' &&
          t('Download started. Open your notifications or Downloads to install RIFQ-Muslim.apk.')}
        {status === 'unavailable' &&
          t('The Android file is not available yet. Please try again soon.')}
      </p>
      )}
    </section>
  );
}
