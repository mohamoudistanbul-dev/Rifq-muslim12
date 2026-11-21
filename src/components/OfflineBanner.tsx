import React, { useEffect, useState } from 'react';
import { useConnectivity } from '../lib/connectivity';

/**
 * Slim connectivity banner.
 *
 * It never takes the app away from the user: it is a strip at the top, so saved
 * Quran pages, bookmarks and prayer times stay usable while it is visible. It
 * disappears by itself as soon as the API answers again.
 */
export default function OfflineBanner() {
  const { state, check } = useConnectivity();
  const [dismissed, setDismissed] = useState(false);

  // A restored connection clears a dismissal, so the next outage is announced
  // again instead of staying hidden for the rest of the session.
  useEffect(() => {
    if (state === 'online') setDismissed(false);
  }, [state]);

  if (state === 'online' || dismissed) return null;

  const offline = state === 'offline';
  const title = offline ? 'No internet connection' : 'Internet connected, server unavailable';
  const detail = offline
    ? 'Saved Quran pages, bookmarks and prayer times still work.'
    : 'RIFQ Muslim is retrying. Saved content is still available.';

  return (
    <div
      className={`offline-banner ${offline ? 'is-offline' : 'is-server'}`}
      role="status"
      aria-live="polite"
      data-state={state}
    >
      <span className="offline-icon" aria-hidden="true">
        {offline ? '📴' : '⚠️'}
      </span>
      <span className="offline-text">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <button type="button" className="offline-retry" onClick={check}>
        Retry
      </button>
      <button
        type="button"
        className="offline-close"
        aria-label="Dismiss connection notice"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
