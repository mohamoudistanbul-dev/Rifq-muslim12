import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get } from '../lib/api';
import DownloadApp from '../components/DownloadApp';
import { INVITE_URL, INVITE_QR_OPTIONS } from '../lib/inviteLink';

interface Config {
  downloadUrl: string;
  siteUrl?: string;
  appName: string;
  tagline: string;
}

const DEFAULT_TAGLINE = 'Your Faith, Your Daily Companion';

export default function Invite() {
  const { t, toast } = useStore();
  const [tagline, setTagline] = useState(DEFAULT_TAGLINE);
  const [qr, setQr] = useState('');

  /**
   * The QR code, the Download App button and every share action below use
   * INVITE_URL, so scanning an invitation always opens the same address the
   * share buttons send. The QR is generated from that constant directly rather
   * than from /api/config, so it stays correct even if the config call fails.
   */
  useEffect(() => {
    let alive = true;

    QRCode.toDataURL(INVITE_URL, INVITE_QR_OPTIONS)
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr('');
      });

    // Only the tagline comes from the server; the link never does.
    get<Config>('/config')
      .then((res) => {
        if (alive && res.tagline) setTagline(res.tagline);
      })
      .catch(() => {
        /* keep the default tagline */
      });

    return () => {
      alive = false;
    };
  }, []);

  const link = INVITE_URL;
  const message = `RIFQ Muslim — ${tagline}\nPrayer times, Quran, Hadith, Qibla and more.\n${link}`;

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'RIFQ Muslim', text: message, url: link });
        return;
      } catch {
        /* the user cancelled sharing */
      }
    }
    void copy();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    toast(t('Invitation link copied'), 'success');
  };

  const actions = [
    { label: 'WhatsApp', icon: 'share' as const, run: () => open(`https://wa.me/?text=${encodeURIComponent(message)}`) },
    { label: 'Facebook', icon: 'share' as const, run: () => open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`) },
    { label: 'Telegram', icon: 'share' as const, run: () => open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`) },
    { label: 'SMS', icon: 'chat' as const, run: () => { window.location.href = `sms:?&body=${encodeURIComponent(message)}`; } },
    { label: 'Copy link', icon: 'copy' as const, run: () => void copy() },
    { label: 'More apps', icon: 'share' as const, run: () => void share() },
  ];

  return (
    <Page title="Invite Friends" subtitle={t('Share RIFQ Muslim with your family and friends')}>
      <div className="card center">
        <p className="section-title" style={{ marginTop: 0 }}>{t('Scan to open RIFQ Muslim')}</p>
        {qr ? <img src={qr} alt={t('Invitation QR code')} data-qr-target={INVITE_URL} width={220} height={220} style={{ borderRadius: 12 }} /> : <p className="tiny muted">{t('Generating QR code…')}</p>}
        <p className="tiny muted" style={{ wordBreak: 'break-all', marginBottom: 0 }}>{link}</p>
      </div>

      <div className="grid grid-2">
        {actions.map((a) => (
          <button key={a.label} className="btn btn-soft" onClick={a.run}>
            <AppIcon name={a.icon} size={16} /> {t(a.label)}
          </button>
        ))}
      </div>

      <div className="notice">
        <p className="small" style={{ margin: 0 }}>
          {t('This is the official RIFQ Muslim download link. The QR code and every share button use it, so an invitation always opens the official download page.')}
        </p>
      </div>

      <DownloadApp compact href={INVITE_URL} />
    </Page>
  );
}
