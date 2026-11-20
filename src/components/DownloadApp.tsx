import React, { useEffect, useState } from 'react';
import { AppIcon } from './Icons';
import { useStore } from '../lib/store';
import { APK_PATH, fetchApkInfo, formatBytes, startApkDownload, type ApkInfo } from '../lib/download';

type Status = 'idle' | 'preparing' | 'started' | 'unavailable';

/**
 * The official Android download card.
 *
 * Tapping the button navigates to /download/RIFQ-Muslim.apk, which streams the
 * owner's Cloudflare R2 file with `Content-Disposition: attachment`, so Android
 * hands it to the Download Manager and saves it as RIFQ-Muslim.apk.
 */
export default function DownloadApp({ compact = false }: { compact?: boolean }) {
  const { t } = useStore();
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [status, setStatus] = useState<Status>('idle');

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
    setStatus('preparing');
    startApkDownload(info?.url || APK_PATH);
    // The browser owns the actual progress (Download Manager notification).
    window.setTimeout(() => setStatus('started'), 800);
  };

  const size = formatBytes(info?.size ?? null);
  const notPublished = !!info && !info.configured;

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

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 12 }}
        onClick={download}
        aria-describedby="rifq-download-status"
      >
        <AppIcon name="download" size={17} /> {t('DOWNLOAD RIFQ MUSLIM')}
      </button>

      <p
        id="rifq-download-status"
        role="status"
        aria-live="polite"
        className="tiny"
        style={{ margin: '8px 0 0', minHeight: 16 }}
      >
        {status === 'idle' &&
          (notPublished ? t('The APK link is not published yet.') : `RIFQ-Muslim.apk${size ? ` · ${size}` : ''}`)}
        {status === 'preparing' && t('Starting your download…')}
        {status === 'started' &&
          t('Download started. Open your notifications or Downloads to install RIFQ-Muslim.apk.')}
        {status === 'unavailable' &&
          t('The APK link is not published yet. Please try again soon or contact support.')}
      </p>
    </section>
  );
}
