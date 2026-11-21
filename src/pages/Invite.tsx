import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get } from '../lib/api';
import { APK_PATH, fetchApkInfo, formatBytes, type ApkInfo } from '../lib/download';
import { detectPlatform, fetchApkFile, saveApkFile, shareApkFile, type ApkProgress } from '../lib/apkShare';
import ShareChannels from '../components/ShareChannels';
import { inviteMessage, portalUrl } from '../lib/portal';

interface Config {
  /** The permanent public download page address (this deployment's own URL). */
  portalUrl?: string;
  /** The real published address of this deployment (never a referral link). */
  shareUrl?: string;
  /** Official store listings, configured by the Super Admin. Empty = not set. */
  playStoreUrl?: string;
  appStoreUrl?: string;
}

type Phase = 'idle' | 'loading' | 'saving' | 'done' | 'error';

/**
 * Invite Friends.
 *
 * Two independent ways to invite someone:
 *
 *  1. Share App / Copy Link — share the public download page (/download), which
 *     then routes each visitor to the right install option for their phone. It
 *     works on Android and iOS and needs no installation file, so the buttons
 *     never dead-end when the APK is missing.
 *  2. Invite Friends / Download App — hand over the actual Android installation
 *     file with live byte progress, for devices that can install an APK.
 *
 * No link is ever invented: the portal address is built from this deployment's
 * own origin (or PUBLIC_APP_URL), and the admin dashboard shows exactly which
 * store links still have to be added.
 */
export default function Invite() {
  const { t, toast } = useStore();
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ApkProgress | null>(null);
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<{
    shareUrl: string;
    portalUrl: string;
    playStoreUrl: string;
    appStoreUrl: string;
  }>({
    shareUrl: '',
    portalUrl: '',
    playStoreUrl: '',
    appStoreUrl: '',
  });
  const blobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ios = useMemo(detectPlatform, []) === 'ios';
  const busy = phase === 'loading' || phase === 'saving';
  const size = formatBytes(info?.size ?? null);
  const unavailable = !!info && !info.configured;

  /**
   * The link every invitation carries: the public download page, which offers
   * the Android file to Android phones and the App Store listing to iPhones.
   * One permanent address, so a shared link never goes stale.
   */
  const shareLink = useMemo(() => portalUrl(links.portalUrl), [links.portalUrl]);

  useEffect(() => {
    let alive = true;

    void fetchApkInfo().then((res) => {
      if (alive) setInfo(res);
    });

    get<Config>('/config')
      .then((res) => {
        if (!alive) return;
        setLinks({
          shareUrl: String(res?.shareUrl || ''),
          portalUrl: String(res?.portalUrl || ''),
          playStoreUrl: String(res?.playStoreUrl || ''),
          appStoreUrl: String(res?.appStoreUrl || ''),
        });
      })
      .catch(() => {
        // Keep the current tagline; the app's own address is used as a fallback.
        if (alive) setLinks((prev) => ({ ...prev, shareUrl: prev.shareUrl || window.location.origin }));
      });

    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  /** Exact invitation wording, including the public download page address. */
  const inviteText = useMemo(() => inviteMessage(shareLink), [shareLink]);

  /** Clipboard write with a fallback for WebViews that lack the async API. */
  const copyText = async (value: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* fall through to the legacy path */
    }
    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '-1000px';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  };

  const handleShareApp = async () => {
    if (!shareLink) {
      setPhase('error');
      setMessage(t('The app link is not available yet. Please try again in a moment.'));
      return;
    }
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'RIFQ Muslim', text: inviteText });
        setPhase('done');
        setMessage(
          t('The RIFQ Muslim download page was handed to the share sheet — choose WhatsApp, Telegram, Messenger, Bluetooth or any other app.')
        );
        toast(t('Download page shared'), 'success');
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          setMessage(t('Sharing was cancelled.'));
          return;
        }
        // A browser without a usable share sheet: copy the link instead.
      }
    }
    const copied = await copyText(inviteText);
    setPhase(copied ? 'done' : 'error');
    setMessage(
      copied
        ? t('This browser has no share sheet, so the invitation and download link were copied. Paste them into WhatsApp, Telegram or any other app.')
        : t('The invitation could not be shared or copied. Please copy the link manually.')
    );
    if (copied) toast(t('Invitation copied'), 'success');
  };

  const handleCopyLink = async () => {
    if (!shareLink) {
      setPhase('error');
      setMessage(t('The app link is not available yet. Please try again in a moment.'));
      return;
    }
    const copied = await copyText(shareLink);
    setPhase(copied ? 'done' : 'error');
    setMessage(
      copied
        ? t('Download page link copied. Paste it into WhatsApp, Telegram, Messenger, an SMS or anywhere else.')
        : t('Copying is blocked in this browser. Long-press the link below instead.')
    );
    if (copied) toast(t('Download link copied'), 'success');
  };

  /** Fetches the APK once and reuses those bytes for both file actions. */
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
                ? t('Share the official RIFQ Muslim download page')
                : `RIFQ Muslim${size ? ` · Android APK ${size}` : ''}`}
            </p>
          </div>
        </div>

        <p className="small" style={{ margin: '12px 0 0', lineHeight: 1.55 }}>
          {t('Share the official RIFQ Muslim download page with your family and friends. WhatsApp, Telegram, Messenger, Facebook, SMS and every other app on your phone appear in the share sheet.')}
        </p>

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          onClick={() => void handleShareApp()}
        >
          <AppIcon name="share" size={17} /> {t('SHARE APP')}
        </button>

        <button className="btn btn-soft btn-block" style={{ marginTop: 8 }} onClick={() => void handleCopyLink()}>
          <AppIcon name="copy" size={17} /> {t('COPY LINK')}
        </button>

        <ShareChannels url={shareLink} message={inviteText} />

        {ios ? (
          <p className="small" style={{ margin: '14px 0 0', lineHeight: 1.55 }}>
            {t('The download page opens the App Store listing on iPhone and iPad once the owner adds it, and the Android installation file on Android phones. It never sends an Android file to an iPhone.')}
          </p>
        ) : (
          <>
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid rgba(255,255,255,.08)',
              }}
            >
              <p className="tiny muted" style={{ margin: '0 0 8px' }}>
                {t('Prefer sending the installation file itself? Use these on Android.')}
              </p>
              <button
                className="btn btn-soft btn-block"
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
            </div>

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
              ? t('The Android installation file is not published yet, so Share App and Copy Link are the working options right now. The app link always works.')
              : t('This is the official RIFQ Muslim app. Some chat apps block .apk attachments — Share App and Download App always work, and Android asks you to allow installs from this source the first time.')}
          </p>
        </div>
      )}
    </Page>
  );
}
