/**
 * Foreground alert host for RIFQ Muslim.
 *
 * Mounted once inside the router, this component renders:
 *  - the floating banner that appears at the top of the screen while the user is
 *    in the app (title, message, app icon, tap to open the related screen), and
 *  - the full-screen Adhan card when a prayer time arrives with the app open.
 *
 * It listens to the shared bus in lib/foreground.ts, so the notification engine
 * raises exactly one alert per slot and this view never duplicates it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from './Icons';
import { onAdhan, onBanner, type AdhanCall, type ForegroundBanner } from '../lib/foreground';
import { audioState, playAdhan, stopAdhan, subscribeAudio, type AudioSnapshot } from '../lib/notify';

const BANNER_MS = 9000;
const MAX_BANNERS = 3;

const PRAYER_LABEL: Record<string, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export default function ForegroundAlerts() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<ForegroundBanner[]>([]);
  const [call, setCall] = useState<AdhanCall | null>(null);
  const [audio, setAudio] = useState<AudioSnapshot>(() => audioState());
  const timers = useRef<number[]>([]);

  useEffect(() => subscribeAudio(setAudio), []);

  const dismiss = useCallback((id: string) => {
    setBanners((list) => list.filter((banner) => banner.id !== id));
  }, []);

  useEffect(() => {
    const off = onBanner((banner) => {
      setBanners((list) => {
        const rest = list.filter((item) => item.title !== banner.title || item.body !== banner.body);
        return [banner, ...rest].slice(0, MAX_BANNERS);
      });
      const timer = window.setTimeout(() => dismiss(banner.id), BANNER_MS);
      timers.current.push(timer);
    });
    return () => {
      off();
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, [dismiss]);

  useEffect(() => onAdhan(setCall), []);

  const openBanner = (banner: ForegroundBanner) => {
    dismiss(banner.id);
    if (banner.url) navigate(banner.url);
  };

  const prayerName = call ? PRAYER_LABEL[call.prayer] || call.prayer : '';
  const playingThis = !!audio.playing && !!call && audio.soundId === call.sound;

  return (
    <>
      <div className="fg-banners" role="status" aria-live="polite">
        {banners.map((banner) => (
          <div className="fg-banner" key={banner.id}>
            <span className="fg-banner-icon" aria-hidden="true">
              <img src="/icons/icon-192.png" alt="" width={26} height={26} />
            </span>
            <div className="fg-banner-copy">
              <p className="fg-banner-title">{banner.title}</p>
              <p className="fg-banner-body">{banner.body}</p>
              <button className="fg-banner-open" onClick={() => openBanner(banner)}>
                Open
              </button>
            </div>
            <button
              className="fg-banner-close"
              onClick={() => dismiss(banner.id)}
              aria-label="Dismiss notification"
            >
              <AppIcon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>

      {call && (
        <div className="adhan-overlay" role="dialog" aria-modal="true" aria-label={`${prayerName} adhan`}>
          <div className="adhan-card">
            <span className="adhan-kicker">RIFQ Muslim · Adhan</span>
            <div className="adhan-mosque" aria-hidden="true">
              <AppIcon name="mosque" size={40} />
            </div>
            <h2 className="adhan-prayer">{prayerName}</h2>
            <p className="adhan-clock">
              {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="adhan-body">{call.body}</p>

            <div className="adhan-actions">
              <button
                className="btn adhan-play"
                onClick={() => void playAdhan(call.sound)}
                disabled={playingThis}
              >
                <AppIcon name={playingThis ? 'pause' : 'play'} size={16} />
                {playingThis ? 'Playing adhan' : 'Play adhan'}
              </button>
              <button className="btn btn-ghost" onClick={stopAdhan} disabled={!audio.playing}>
                <AppIcon name="close" size={16} /> Stop
              </button>
            </div>

            {audio.error && <p className="tiny np-error">{audio.error}</p>}

            <div className="adhan-footer">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setCall(null);
                  navigate('/athan');
                }}
              >
                Prayer settings
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setCall(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
