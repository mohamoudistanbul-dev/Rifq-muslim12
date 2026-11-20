import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';

/**
 * RIFQ Muslim — reading zoom.
 *
 * Applies to reading content only (Quran text and its translation), never to
 * the app chrome. The scale is a CSS `zoom`, so text reflows at the new size
 * instead of being clipped or pushing the layout sideways, and normal vertical
 * scrolling keeps working.
 */

export const MIN_ZOOM = 0.85;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.15;

const STORAGE_KEY = 'rifq.reader.zoom';

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function readStored(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return 1;
    return clampZoom(Number(raw));
  } catch {
    return 1;
  }
}

export function useReaderZoom(storageKey: string = STORAGE_KEY) {
  const [zoom, setZoom] = useState<number>(() => readStored(storageKey));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(zoom));
    } catch {
      /* storage unavailable (private mode): zoom still works for this session */
    }
  }, [zoom, storageKey]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_STEP)), []);
  const reset = useCallback(() => setZoom(1), []);

  return {
    zoom,
    setZoom: (value: number) => setZoom(clampZoom(value)),
    zoomIn,
    zoomOut,
    reset,
    atMin: zoom <= MIN_ZOOM + 1e-9,
    atMax: zoom >= MAX_ZOOM - 1e-9,
  };
}

function touchDistance(touches: React.TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Wraps reading content. Two-finger pinch adjusts the scale; one finger keeps
 * scrolling because `touch-action: pan-y` leaves vertical panning to the page.
 */
export function ZoomSurface({
  zoom,
  onZoom,
  className,
  children,
}: {
  zoom: number;
  onZoom: (value: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const handleTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      pinch.current = { distance: touchDistance(event.touches), zoom };
    }
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !pinch.current) return;
    const start = pinch.current;
    if (start.distance <= 0) return;
    onZoom(clampZoom(start.zoom * (touchDistance(event.touches) / start.distance)));
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (event.touches.length < 2) pinch.current = null;
  };

  return (
    <div
      className={`zoom-surface${className ? ` ${className}` : ''}`}
      style={{ zoom }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {children}
    </div>
  );
}

/** Visible Zoom Out / Zoom In / Reset controls for supported content. */
export function ZoomControls({
  zoom,
  zoomIn,
  zoomOut,
  reset,
  atMin,
  atMax,
}: {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  atMin: boolean;
  atMax: boolean;
}) {
  const { t } = useStore();
  return (
    <div className="zoom-bar" role="group" aria-label={t('Reading zoom')}>
      <span className="zoom-label">{t('Zoom')}</span>
      <button
        type="button"
        className="zoom-btn"
        onClick={zoomOut}
        disabled={atMin}
        aria-label={t('Zoom out')}
        title={t('Zoom out')}
      >
        −
      </button>
      <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className="zoom-btn"
        onClick={zoomIn}
        disabled={atMax}
        aria-label={t('Zoom in')}
        title={t('Zoom in')}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-btn zoom-reset"
        onClick={reset}
        aria-label={t('Reset zoom')}
        title={t('Reset zoom')}
      >
        {t('Reset')}
      </button>
    </div>
  );
}
