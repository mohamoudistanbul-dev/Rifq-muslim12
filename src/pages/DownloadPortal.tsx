import React, { useEffect, useMemo, useState } from 'react';
import { AppIcon, type IconName } from '../components/Icons';
import ShareChannels from '../components/ShareChannels';
import { get } from '../lib/api';
import { APK_PATH, fetchApkInfo, formatBytes, type ApkInfo } from '../lib/download';
import { copyText, detectPlatform, inviteMessage, portalUrl, type Platform } from '../lib/portal';

interface PortalConfig {
  appName?: string;
  tagline?: string;
  developer?: string;
  portalUrl?: string;
  portalHeadline?: string;
  portalDescription?: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  shareUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}

const GOLD = '#d4af37';
const CREAM = '#f6f1e4';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'mosque', title: 'Prayer times', text: 'Fajr to Isha from your own location, with a live countdown.' },
  { icon: 'quran', title: 'Holy Quran', text: 'All 114 surahs in Uthmani script, plus audio reciters.' },
  { icon: 'book', title: 'Authentic Hadith', text: 'The six major collections with narrator and grading.' },
  { icon: 'heart', title: 'Duas & Adhkar', text: 'Morning, evening and daily supplications with sources.' },
  { icon: 'compass', title: 'Qibla compass', text: 'The true direction to the Kaaba from your GPS position.' },
  { icon: 'beads', title: 'Tasbih', text: 'A digital counter with targets and daily totals.' },
  { icon: 'chart', title: 'Zakat calculator', text: 'Nisab, gold, silver, savings and business assets.' },
  { icon: 'kids', title: 'Kids Academy', text: 'Arabic letters, short surahs and quizzes for children.' },
];

const SHOTS: { src: string; label: string }[] = [
  { src: '/screenshots/home.webp', label: 'Home' },
  { src: '/screenshots/quran.webp', label: 'Quran' },
  { src: '/screenshots/prayer.webp', label: 'Prayer times' },
];

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,.045)',
  border: '1px solid rgba(212,175,55,.28)',
  borderRadius: 20,
  padding: 16,
  marginTop: 14,
};

const heading: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: '0 0 8px',
  color: CREAM,
};

/**
 * Public RIFQ Muslim download page (/download).
 *
 * Opened from an invitation on WhatsApp, Facebook or Telegram, with no account
 * and no app chrome. It shows the real Android installation file the owner
 * uploaded, the App Store listing when one is configured, and honest wording
 * when a store is still missing — it never invents a download address and never
 * offers an APK to an iPhone.
 */
export default function DownloadPortal() {
  const [config, setConfig] = useState<PortalConfig>({});
  const [apk, setApk] = useState<ApkInfo | null>(null);
  const [platform, setPlatform] = useState<Platform>(() =>
    detectPlatform(window.location.search, navigator.userAgent || '', navigator.maxTouchPoints || 0)
  );
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    get<PortalConfig>('/config')
      .then((res) => {
        if (alive && res) setConfig(res);
      })
      .catch(() => undefined);
    void fetchApkInfo().then((res) => {
      if (alive) setApk(res);
    });
    return () => {
      alive = false;
    };
  }, []);

  const url = portalUrl(config.portalUrl);
  const message = inviteMessage(url);
  const appStore = String(config.appStoreUrl || '').trim();
  const apkReady = !!apk?.configured;
  const apkSize = formatBytes(apk?.size ?? null);
  const email = String(config.contactEmail || 'rifqmuslim@gmail.com');
  const phone = String(config.contactPhone || '+252612215593');
  const whatsapp = `https://wa.me/${phone.replace(/\D/g, '')}`;

  const choose = (next: 'android' | 'ios') => {
    setPlatform(next);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('platform', next);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* the switch still works without updating the address */
    }
  };

  const detected = useMemo(() => {
    if (platform === 'android') return 'Android device detected — install the app below.';
    if (platform === 'ios') return 'iPhone or iPad detected.';
    return 'Choose your device to get the right download.';
  }, [platform]);

  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'RIFQ Muslim', text: message });
        setStatus('Invitation handed to the share sheet.');
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          setStatus('Sharing cancelled.');
          return;
        }
      }
    }
    const ok = await copyText(message);
    setStatus(ok ? 'No share sheet in this browser, so the invitation was copied.' : 'Copy the link below to share it.');
  };

  const copy = async () => {
    const ok = await copyText(url);
    setCopied(ok);
    setStatus(ok ? 'Download link copied.' : 'Copying is blocked here — long-press the link below to copy it.');
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  };

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    color: active ? '#08281d' : CREAM,
    background: active ? GOLD : 'rgba(255,255,255,.06)',
    border: `1px solid ${active ? GOLD : 'rgba(212,175,55,.35)'}`,
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 20% 0%, #0f5138 0%, #08281d 45%, #04160f 100%)',
        color: CREAM,
        padding: '22px 16px 40px',
      }}
    >
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <header style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <img
            src="/icons/icon-192.png"
            width={64}
            height={64}
            alt="RIFQ Muslim logo"
            style={{ borderRadius: 18, border: `2px solid rgba(212,175,55,.6)`, background: '#08281d' }}
          />
          <div>
            <h1 style={{ fontSize: 26, margin: 0, letterSpacing: '.3px' }}>
              {config.appName || 'RIFQ Muslim'}
            </h1>
            <p style={{ margin: '2px 0 0', color: GOLD, fontWeight: 600, fontSize: 14 }}>
              {config.tagline || 'Your Faith, Your Daily Companion'}
            </p>
          </div>
        </header>

        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, rgba(212,175,55,.7), transparent)', margin: '18px 0' }} />

        <section style={{ ...card, marginTop: 0, borderColor: 'rgba(212,175,55,.5)' }}>
          <h2 style={{ fontSize: 21, margin: '0 0 6px', lineHeight: 1.25 }}>
            {config.portalHeadline || 'Install RIFQ Muslim on your phone'}
          </h2>
          <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, color: 'rgba(246,241,228,.86)' }}>
            {config.portalDescription ||
              'Prayer times, the Holy Quran, authentic Hadith, Duas, Qibla and daily worship in one app.'}
          </p>

          <p
            style={{ margin: '0 0 4px', fontSize: 12.5, color: GOLD, fontWeight: 600 }}
            data-testid="device-status"
          >
            {detected}
          </p>

          <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }} data-testid="platform-switch">
            <button type="button" style={pill(platform === 'android')} onClick={() => choose('android')}>
              Android
            </button>
            <button type="button" style={pill(platform === 'ios')} onClick={() => choose('ios')}>
              iPhone / iPad
            </button>
          </div>

          {platform !== 'ios' &&
            (apk === null ? (
              <button className="btn btn-soft btn-block" style={{ marginTop: 12 }} disabled>
                <AppIcon name="download" size={18} /> Checking the Android file…
              </button>
            ) : apkReady ? (
              <a
                className="btn btn-primary btn-block"
                style={{ marginTop: 12, textAlign: 'center' }}
                href={apk?.url || APK_PATH}
                download={apk?.filename || 'RIFQ-Muslim.apk'}
                onClick={() => setStatus('Download started. Follow the install steps below.')}
                data-testid="android-download"
              >
                <AppIcon name="download" size={18} /> Download for Android{apkSize ? ` · ${apkSize}` : ''}
              </a>
            ) : (
              <button
                className="btn btn-soft btn-block"
                style={{ marginTop: 12, opacity: 0.75 }}
                disabled
                data-testid="android-unavailable"
              >
                <AppIcon name="download" size={18} /> Android file not published yet
              </button>
            ))}

          {appStore ? (
            <a
              className="btn btn-soft btn-block"
              style={{ marginTop: 8, textAlign: 'center' }}
              href={appStore}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="iphone-download"
            >
              <AppIcon name="download" size={18} /> Download for iPhone
            </a>
          ) : (
            <button
              className="btn btn-soft btn-block"
              style={{ marginTop: 8, opacity: 0.75 }}
              disabled
              data-testid="iphone-unavailable"
            >
              <AppIcon name="download" size={18} /> iPhone version not published yet
            </button>
          )}

          {platform === 'ios' && (
            <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'rgba(246,241,228,.75)' }}>
              The Android file is for Android phones only. On iPhone and iPad the App Store listing is used.
            </p>
          )}

          {!appStore && (
            <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'rgba(246,241,228,.75)' }}>
              The App Store listing is not configured yet. You can still use the full RIFQ Muslim app in your
              browser — <a href="/" style={{ color: GOLD }}>open the web app</a>.
            </p>
          )}

          {apk && !apkReady && (
            <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'rgba(246,241,228,.75)' }}>
              The Android installation file has not been uploaded by the owner yet. The link is permanent, so it
              starts working as soon as the APK is published.
            </p>
          )}

          <p role="status" aria-live="polite" style={{ margin: '10px 0 0', fontSize: 12, minHeight: 16, color: GOLD }}>
            {status}
          </p>
        </section>

        <section style={card} id="install">
          <h2 style={heading}>
            <AppIcon name="check" size={16} /> How to install on Android
          </h2>
          <ol style={{ margin: '0 0 0 18px', padding: 0, fontSize: 13.5, lineHeight: 1.7, color: 'rgba(246,241,228,.88)' }}>
            <li>Tap “Download for Android”. The file saves as RIFQ-Muslim.apk.</li>
            <li>Open your notifications, or Files → Downloads, and tap RIFQ-Muslim.apk.</li>
            <li>
              If Android asks, allow installs from your browser or file manager (Settings → Install unknown
              apps).
            </li>
            <li>Tap Install, then Open. RIFQ Muslim appears in your app drawer.</li>
          </ol>
          <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.55, color: 'rgba(246,241,228,.65)' }}>
            The permission prompt comes from Android itself, because the app is installed outside Google Play.
          </p>
        </section>

        <section style={card}>
          <h2 style={heading}>Inside the app</h2>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {SHOTS.map((shot) => (
              <figure key={shot.src} style={{ margin: 0, flex: '0 0 auto' }}>
                <img
                  src={shot.src}
                  alt={`RIFQ Muslim ${shot.label} screen`}
                  loading="lazy"
                  style={{
                    width: 176,
                    borderRadius: 16,
                    border: '1px solid rgba(212,175,55,.35)',
                    display: 'block',
                    background: '#08281d',
                  }}
                />
                <figcaption style={{ textAlign: 'center', fontSize: 11.5, marginTop: 6, color: 'rgba(246,241,228,.7)' }}>
                  {shot.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section style={card}>
          <h2 style={heading}>Key features</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {FEATURES.map((feature) => (
              <div key={feature.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 34,
                    height: 34,
                    flex: '0 0 auto',
                    borderRadius: 10,
                    color: GOLD,
                    background: 'rgba(212,175,55,.12)',
                    border: '1px solid rgba(212,175,55,.3)',
                  }}
                >
                  <AppIcon name={feature.icon} size={17} />
                </span>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{feature.title}</strong>
                  <p style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, color: 'rgba(246,241,228,.72)' }}>
                    {feature.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={card}>
          <h2 style={heading}>Invite friends</h2>
          <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.55, color: 'rgba(246,241,228,.8)' }}>
            Send this page to your family and friends — it gives them the right download for their phone.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => void share()} data-testid="share-app">
            <AppIcon name="share" size={17} /> Share App
          </button>
          <button className="btn btn-soft btn-block" style={{ marginTop: 8 }} onClick={() => void copy()} data-testid="copy-link">
            <AppIcon name="copy" size={17} /> {copied ? 'Link copied' : 'Copy Link'}
          </button>
          <ShareChannels url={url} message={message} />
          <p style={{ margin: '10px 0 0', fontSize: 11.5, wordBreak: 'break-all', color: 'rgba(246,241,228,.6)' }} data-testid="portal-url">
            {url}
          </p>
        </section>

        <footer style={{ marginTop: 22, textAlign: 'center', fontSize: 12, color: 'rgba(246,241,228,.6)', lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>{config.developer || 'Made by Eng Mohamud Yusuf'}</p>
          <p style={{ margin: 0 }}>
            <a href={`mailto:${email}`} style={{ color: GOLD }}>Email</a> ·{' '}
            <a href={`tel:${phone}`} style={{ color: GOLD }}>Call</a> ·{' '}
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" style={{ color: GOLD }}>WhatsApp</a>
          </p>
          <p style={{ margin: 0 }}>
            <a href="/privacy" style={{ color: GOLD }}>Privacy</a> ·{' '}
            <a href="/" style={{ color: GOLD }}>Open the app</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
