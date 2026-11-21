import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Connection state for RIFQ Muslim.
 *
 * The app has to distinguish three different situations, because they need
 * different words in front of the user:
 *
 *  - `offline`     — the device has no network at all (`navigator.onLine` false).
 *  - `server-down` — the device is on a network, but the RIFQ Muslim API does not
 *                    answer. Retrying is worthwhile; the device is not the problem.
 *  - `online`      — the API answered.
 *
 * `navigator.onLine` alone is not enough: it reports true on a captive portal or
 * a Wi-Fi network with no internet, so the state is confirmed with a real probe
 * of the API. The probe is deliberately tiny and cached-free.
 */

export type ConnectionState = 'online' | 'offline' | 'server-down';

const PROBE_URL = '/api/config';
const PROBE_TIMEOUT_MS = 6000;
/** How often to re-probe while the API is unreachable. */
const RETRY_MS = 15000;

export async function probeServer(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(PROBE_URL, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Any answer below 500 means the server itself is reachable; a 4xx is a real
    // server reply, not a connectivity failure.
    return res.status < 500;
  } catch {
    return false;
  }
}

export interface Connectivity {
  state: ConnectionState;
  /** Force an immediate re-check (the banner's Retry button). */
  check: () => void;
}

export function useConnectivity(): Connectivity {
  const [state, setState] = useState<ConnectionState>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'
  );
  const [nonce, setNonce] = useState(0);
  const stateRef = useRef<ConnectionState>(state);
  stateRef.current = state;

  useEffect(() => {
    let alive = true;

    const evaluate = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (alive) setState('offline');
        return;
      }
      const ok = await probeServer();
      if (alive) setState(ok ? 'online' : 'server-down');
    };

    void evaluate();

    const onOnline = () => void evaluate();
    const onOffline = () => setState('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Only poll while something is wrong; a healthy connection relies on the
    // browser's own online/offline events instead of constant traffic.
    const timer = window.setInterval(() => {
      if (stateRef.current !== 'online') void evaluate();
    }, RETRY_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [nonce]);

  const check = useCallback(() => setNonce((n) => n + 1), []);
  return { state, check };
}
