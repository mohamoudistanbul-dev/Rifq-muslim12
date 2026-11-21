import { useEffect, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import {
  detectPlatform,
  hasNativeReview,
  loadStoreLinks,
  markPrompted,
  requestNativeReview,
  type Platform,
  type StoreLinks,
} from '../lib/rateUs';

/**
 * Rate Us.
 *
 * The buttons only exist when the Super Admin has saved a real store listing in
 * Admin → Website settings. Until then the screen says so plainly and offers the
 * feedback channels that do work today, instead of sending people to a dead link.
 */
export default function RateUs() {
  const [links, setLinks] = useState<StoreLinks | null>(null);
  const [platform, setPlatform] = useState<Platform>('other');
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setPlatform(detectPlatform());
    let alive = true;
    loadStoreLinks()
      .then((next) => {
        if (alive) setLinks(next);
      })
      .catch(() => {
        if (alive) setLoadError('Could not load the store links. Check your connection and try again.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const preferred = platform === 'ios' ? links?.appStoreUrl : links?.playStoreUrl;
  const native = hasNativeReview();

  const openNative = () => {
    if (requestNativeReview()) {
      markPrompted();
      setStatus(
        'The in-app review dialog was requested. The store decides whether it is shown, and it never asks twice for the same version.'
      );
    } else {
      setStatus('The in-app review dialog is not available in this build. Use the store button below.');
    }
  };

  return (
    <Page title="Rate Us" subtitle="Your rating helps other Muslims find RIFQ Muslim">
      <div className="card stack">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <AppIcon name="star" size={22} />
          <div>
            <strong>Enjoying RIFQ Muslim?</strong>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}>
              A short, honest review takes a minute and helps the app reach more people.
            </p>
          </div>
        </div>

        {native ? (
          <button type="button" className="btn btn-primary" onClick={openNative}>
            <AppIcon name="star" size={16} /> Rate in the app
          </button>
        ) : null}

        {links?.playStoreUrl ? (
          <a
            className="btn btn-primary"
            href={links.playStoreUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={markPrompted}
          >
            <AppIcon name="star" size={16} /> Rate on Google Play
          </a>
        ) : null}

        {links?.appStoreUrl ? (
          <a
            className="btn btn-primary"
            href={links.appStoreUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={markPrompted}
          >
            <AppIcon name="star" size={16} /> Rate on the App Store
          </a>
        ) : null}

        {!links?.playStoreUrl && !links?.appStoreUrl && !native ? (
          <div className="card" style={{ background: 'rgba(201,162,39,0.10)' }}>
            <strong>RIFQ Muslim is not published on a store yet</strong>
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              No official Google Play or App Store listing is configured, so there is nothing to rate
              yet. Once the listing exists, the Super Admin adds its URL in Admin → Website settings
              and the store buttons appear here automatically.
            </p>
          </div>
        ) : null}

        {preferred ? null : null}

        {loadError ? <p className="tiny error">{loadError}</p> : null}
        {status ? <p className="tiny muted">{status}</p> : null}

        <a
          className="btn btn-soft"
          href={`mailto:${links?.contactEmail || 'rifqmuslim@gmail.com'}?subject=${encodeURIComponent(
            'RIFQ Muslim feedback'
          )}`}
        >
          <AppIcon name="mail" size={16} /> Send feedback by email
        </a>

        <p className="tiny muted">
          Rating is always optional. RIFQ Muslim never blocks a feature behind a review request.
        </p>
      </div>
    </Page>
  );
}
