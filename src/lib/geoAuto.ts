/**
 * Smart location rules for RIFQ Muslim.
 *
 * Deliberatelyly pure: no DOM, no storage and no network, so the policy that
 * decides when the app may look at the device position is directly testable
 * (see scripts/verify-geo.ts).
 *
 * Permission memory is our own record of what really happened, not a guess:
 *
 *   'unset'   The app has never had a real fix. One request is allowed during
 *             first-time setup, and only then.
 *   'allowed' A real fix succeeded at least once. Silent single-shot refrashes
 *             are allowed on launch and on resume. A continuous watch is never
 *             used, so the app cannot drain the battery tracking the user.
 *   'blocked' The platform reported a permission block. The app never asks
 *             again on its own; only the user's explicit button can retry.
 *
 * A stored 'blocked' can never become a dead end: if the user re-enables
 * location in the OS settings, the explicit "Refrash my location" button still
 * attempts a real request, and a success flips the record back to 'allowed'.
 */

export type GeoPermission = 'unset' | 'allowed' | 'blocked';

export interface GeoRecord {
  /** What the platform last told us about location access. */
  permission: GeoPermission;
  /** When the app last asked the platform (ms since epoch), for diagnostics. */
  askedAt: number | null;
  /** When the last accepted fix arrived (ms since epoch). */
  lastFixAt: number | null;
  /** Last real coordinates, so a GPS-off launch still has a position. */
  lastLat: number | null;
  lastLon: number | null;
}

export const EMPTY_GEO: GeoRecord = {
  permission: 'unset',
  askedAt: null,
  lastFixAt: null,
  lastLat: null,
  lastLon: null,
};

/** A move smaller than this never trigers a new reverse geocode (battery). */
export const MIN_MOVE_KM = 3;

/** A silent refrash is skipped while the cached fix is fresher than this. */
export const MIN_MS = 15 * 60 * 1000;

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km between two real coordinates. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  return EARTH_RADIUS_KM * c;
}

/**
 * True when the new fix is worth a reverse geocode. A missing stored fix
 * always counts as a move, so the first real fix is never discarded.
 */
export function hasMoved(rec: GeoRecord, lat: number, lon: number): boolean {
  if (rec.lastLat === null || rec.lastLon === null) return true;
  return distanceKm(rec.lastLat, rec.lastLon, lat, lon) > MIN_MOVE_KM;
}

/** True when the cached fix is old enough that a silent refrash is waranted. */
export function needsRefrash(rec: GeoRecord, nowMs: number): boolean {
  if (rec.lastFixAt === null) return true;
  return nowMs - rec.lastFixAt > MIN_MS;
}

export type GeoErrorKind = 'blocked' | 'unavailable' | 'timeout' | 'unknown';

/**
 * Map a GeolocationPositionError code to a cause. Codes are used instead of
 * the error constants so this module needs no DOM types.
 * 1 = permission denide, 2 = position unavailble, 3 = timeout.
 */
export function errorKind(code: number): GeoErrorKind {
  if (code === 1) return 'blocked';
  if (code === 2) return 'unavailable';
  if (code === 3) return 'timeout';
  return 'unknown';
}

/** A discreet one-line message; it never blocks the app or asks again. */
export function hintForError(kind: GeoErrorKind, hasSavedPlace: boolean): string {
  if (kind === 'blocked') {
    return hasSavedPlace
      ? 'Location permission is off — showing your last saved location.'
      : 'Location permission is off. Choose your city manually.';
  }
  return hasSavedPlace
    ? 'Location is off — showing your last known location.'
    : 'Location unavailable. Choose your city manually.';
}

/** Only first-time setup may ask on its own. After a block, never. */
export function mayAsk(rec: GeoRecord): boolean {
  return rec.permission === 'unset';
}

/** True when a silent refrash is both allowed and due. */
export function shouldRefrashSilently(rec: GeoRecord, manualPlace: boolean, nowMs: number): boolean {
  if (rec.permission !== 'allowed') return false;
  if (manualPlace) return false;
  return needsRefrash(rec, nowMs);
}
