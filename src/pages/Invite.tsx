import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get } from '../lib/api';
import { APK_PATH, fetchApkInfo, formatBytes, type ApkInfo } from '../lib/download';
import {
  INVITE_MESSAGE,
  detectPlatform,
  fetchApkFile,
  saveApkFile,
  shareApkFile,
  type ApkProgress,
} from '../lib/apkShare';

interface Config {
  tagline?: string;
}

const DEFAULT_TAGLINE = 'Your Faith, Your Daily Companion';

type Phase = 'idle' | 'loading' | 'saving' | 'done' | 'error';

/**
 * Invite Friends.
 *
 * This section deals in the installation file itself, never in links: the
 * Download App button streams the real APK from /download/RIFQ-Muslim.apk with
 * live progress, and Invite Friends hands that same file to the Android share
 * sheet so it can travel over WhatsApp, Telegram, Bluetooth or anything else
 * installed on the phone. There is no QR code and no URL on this page.
 *
 * iPhones and iPads are excluded on purpose: an Android APK cannot be installed
 * on iOS, so offering it there would be a broken invitation.
 */
export default function Invite() {
  const { t, toast } = useStore();
  const [tagline, setTagline] = useState(DEFAULT_TAGLINE);
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ApkProgress | null>(null);
  const [message, setMessage] = useState('');
  const blobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ios = useMemo(detectPlatform, []) === 'ios';
  const busy = phase === 'loading' || phase === 'saving';
  const size = formatBytes(info?.size ?? null);
  const unavailable = !!info && !info.configured;

  useEffect(() => {
    let alive = true;

    void fetchApkInfo().then((res) => {
      if (alive) setInfo(res);
    });

    // Only the tagline is read here; no address is ever displayed on this page.
    get<Config>('/config')
      .then((res) => {
        if (alive && typeof res?.tagline === 'string' && res.tagline.trim()) setTagline(res.tagline);
      })
      .catch(() => {
        /* keep the default tagline */
      });

    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const inviteText = useMemo(() => `RIFQ Muslim — ${tagline}\n${INVITE_MESSAGE}`, [tagline]);

  /** Fetches the APK once and reuses those bytes for both actions. */
  const ensureApk = async (): Promise<Blob> => {
    if (blobRef.current) return blobRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ received: 0, total: info?.size ?? 0, percent: 0 });
    const blob = await fetchApkFile(setProgress, controller.signal);
    blobRef.current = blob;
    return blob;
  };

  const fail = (err: unknown) => {
    if ((err as { name?: string })?.name === 'AbortError') {
      setPhase('idle');
      setMessage('');
      return;
    }
    const text =
      err instanceof Error && err.message
        ? err.message
        : t('The app file could not be downloaded. Please try again.');
    setPhase('error');
    setMessage(text);
    toast(text, 'error');
  };

  const handleDownload = async () => {
    if (ios || busy || unavailable) return;
    setPhase('loading');
    setMessage(t('Preparing the app file…'));
    try {
      const blob = await ensureApk();
      setPhase('saving');
      setMessage(t('Saving RIFQ-Muslim.apk…'));

      if (saveApkFile(blob)) {
        const savedSize = formatBytes(blob.size);
        setPhase('done');
        setMessage(
          `${t('Downloaded')} RIFQ-Muslim.apk${savedSize ? ` · ${savedSize}` : ''} — ` +
            t('open your Downloads or notifications to install it.')
        );
        toast(t('Download complete'), 'success');
      } else {
        // A WebView that cannot save a Blob: let the server's attachment response
        // reach the platform download manager instead of leaving a dead button.
        setPhase('done');
        setMessage(t('Your browser is fetching RIFQ-Muslim.apk in its download manager.'));
        window.location.assign(APK_PATH);
      }
    } catch (err) {
      fail(err);
    }
  };

  const handleInvite = async () => {
    if (ios || busy || unavailable) return;
    setPhase('loading');
    setMessage(t('Preparing the app file to share…'));
    try {
      const blob = await ensureApk();
      setPhase('saving');
      setMessage(t('Opening the share sheet…'));

      const mode = await shareApkFile(blob, inviteText);
      setPhase('done');
      setMessage(
        mode === 'file'
          ? t('The RIFQ Muslim installation file and your invitation were handed to the share sheet.')
          : t('This device cannot attach files, so only the invitation message was shared. Use Download App to send the file yourself.')
      );
      toast(mode === 'file' ? t('Invitation shared') : t('Invitation message shared'), 'success');
    } catch (err) {
      if ((err as Error)?.message === 'share-unsupported') {
        setPhase('error');
        setMessage(t('This browser cannot open the share sheet. Use Download App instead.'));
        return;
      }
      fail(err);
    }
  };

  const pct = progress?.percent ?? 0;
  const indeterminate = !progress?.total;

  return (
    <Page title="Invite Friends" subtitle={t('Share the RIFQ Muslim app itself with your family and friends')}>
      <section className="card gold-edge">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span className="tile-icon" aria-hidden="true">
            <AppIcon name="share" size={20} />
          </span>
          <div>
            <h3 className="section-title" style={{ margin: 0 }}>
              {t('Invite Friends')}
            </h3>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}>
              {ios
                ? t('Android app · not available for iPhone or iPad yet')
                : `Android APK${size ? ` · ${size}` : ''}`}
            </p>
          </div>
        </div>

        {ios ? (
          <p className="small" style={{ margin: '12px 0 0', lineHeight: 1.55 }}>
            {t('The RIFQ Muslim app for iPhone and iPad is not available yet. This page sends the Android installation file, which cannot be installed on iOS, so it is not offered here. An iOS release will use the official App Store distribution.')}
          </p>
        ) : (
          <>
            <p className="small" style={{ margin: '12px 0 0', lineHeight: 1.55 }}>
              {t('Your invitation sends the real RIFQ Muslim installation file, so your friend installs the app directly. WhatsApp, Telegram, Bluetooth and every other app on your phone appear in the share sheet. There are no links to copy.')}
            </p>

            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              onClick={() => void handleInvite()}
              disabled={busy || unavailable}
            >
              <AppIcon name="share" size={17} /> {t('INVITE FRIENDS')}
            </button>

            <button
              className="btn btn-soft btn-block"
              style={{ marginTop: 8 }}
              onClick={() => void handleDownload()}
              disabled={busy || unavailable}
            >
              <AppIcon name="download" size={17} /> {t('DOWNLOAD APP')}
            </button>

            {phase === 'loading' && (
              <div style={{ marginTop: 12 }}>
                <div
                  role="progressbar"
                  aria-label={t('Download progress')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={indeterminate ? 0 : pct}
                  style={{
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    background: 'rgba(212,175,55,.18)',
                    border: '1px solid rgba(212,175,55,.4)',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${indeterminate ? 12 : pct}%`,
                      background: 'linear-gradient(90deg,#0f6b4f,#d4af37)',
                      transition: 'width .25s ease',
                    }}
                  />
                </div>
                <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                  {indeterminate
                    ? t('Connecting to the app file…')
                    : `${pct}% · ${formatBytes(progress?.received ?? 0)}${
                        progress?.total ? ` / ${formatBytes(progress.total)}` : ''
                      }`}
                </p>
              </div>
            )}
          </>
        )}

        <p role="status" aria-live="polite" className="tiny" style={{ margin: '10px 0 0', minHeight: 16 }}>
          {message}
        </p>
      </section>

      {!ios && (
        <div className="notice">
          <p className="small" style={{ margin: 0 }}>
            {unavailable
              ? t('The Android app file is not published yet. Please try again soon.')
              : t('This is the official RIFQ Muslim app file. Some chat apps block .apk attachments — Download App always works, and Android asks you to allow installs from this source the first time.')}
          </p>
        </div>
      )}
    </Page>
  );
}
