import React, { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { qiblaBearing } from '../lib/prayer';

type OrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

const KAABA = { lat: 21.4225, lon: 39.8262 };

/** Great-circle distance in km. */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export default function Qibla() {
  const { t, place, detectLocation, locState } = useStore();
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);

  const attach = () => {
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;
    const handler = (event: Event) => {
      const e = event as OrientationEvent;
      const compass =
        typeof e.webkitCompassHeading === 'number'
          ? e.webkitCompassHeading
          : e.alpha !== null
            ? 360 - e.alpha
            : null;
      if (compass === null) return;
      setHeading(compass);
      if (typeof e.webkitCompassAccuracy === 'number') setAccuracy(e.webkitCompassAccuracy);
    };

    if (!('DeviceOrientationEvent' in window)) {
      setSupported(false);
      return;
    }
    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handler, true);
      window.removeEventListener('deviceorientation', handler, true);
    };
  }, [active]);

  useEffect(() => {
    const anyWin = window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    };
    if (anyWin.DeviceOrientationEvent?.requestPermission) {
      setPermissionNeeded(true);
    } else if (!('DeviceOrientationEvent' in window)) {
      setSupported(false);
    } else {
      attach();
    }
  }, []);

  const requestPermission = async () => {
    const anyWin = window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    };
    try {
      const result = await anyWin.DeviceOrientationEvent?.requestPermission?.();
      setPermissionNeeded(false);
      if (result === 'granted') attach();
    } catch {
      setPermissionNeeded(false);
    }
  };

  const bearing = place ? qiblaBearing(place.lat, place.lon) : null;
  const distance = useMemo(
    () => (place ? distanceKm(place.lat, place.lon, KAABA.lat, KAABA.lon) : null),
    [place?.lat, place?.lon]
  );
  const rotation = heading !== null && bearing !== null ? bearing - heading : bearing ?? 0;

  const cardinal = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };

  const sensorNote = () => {
    if (heading !== null) return null;
    if (permissionNeeded) {
      return (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            {t('Allow motion access to use the live compass needle.')}
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => void requestPermission()}>
            {t('Allow compass')}
          </button>
        </>
      );
    }
    if (!supported) {
      return (
        <p className="small" style={{ margin: 0 }}>
          {t(
            'This device does not expose a compass sensor. The bearing above is still exact for your coordinates — align your phone with a physical compass.'
          )}
        </p>
      );
    }
    return (
      <p className="small" style={{ margin: 0 }}>
        {t(
          'No compass reading yet. The bearing above is exact for your coordinates; the needle appears as soon as the sensor reports a heading.'
        )}
      </p>
    );
  };

  return (
    <Page
      title="Qibla"
      subtitle={
        place ? `${place.city} · ${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}` : t('Location unavailable')
      }
    >
      {!place ? (
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>{t('The Qibla direction needs your coordinates.')}</p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => void detectLocation()}
            disabled={locState === 'locating'}
          >
            <AppIcon name="location" size={16} />{' '}
            {locState === 'locating' ? t('Locating…') : t('Use my location')}
          </button>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            {t('You can also pick a city in Settings if location permission is blocked.')}
          </p>
        </div>
      ) : null}

      {place && bearing !== null ? (
        <div className="card center stack">
          <div className="compass" aria-hidden>
            <div className="compass-dial">
              {['N', 'E', 'S', 'W'].map((d, i) => (
                <span key={d} className={`compass-label c${i}`}>{d}</span>
              ))}
              <div className="compass-needle" style={{ transform: `rotate(${rotation}deg)` }}>
                <span className="compass-arrow" />
              </div>
            </div>
          </div>

          <p className="section-title" style={{ margin: '6px 0 0' }}>
            {bearing.toFixed(1)}° {cardinal(bearing)}
          </p>
          <p className="tiny muted" style={{ margin: 0 }}>
            {t('Direction of the Kaaba from your position')}
          </p>

          <div className="grid grid-2" style={{ width: '100%', marginTop: 10 }}>
            <div className="stat">
              {distance !== null ? Math.round(distance).toLocaleString() : '—'}
              <div className="muted tiny">{t('km to Makkah')}</div>
            </div>
            <div className="stat">
              {heading !== null ? `${heading.toFixed(0)}°` : '—'}
              <div className="muted tiny">{t('device heading')}</div>
            </div>
          </div>

          {heading !== null ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              {accuracy !== null
                ? `${t('compass accuracy')} ±${accuracy.toFixed(0)}°`
                : t('Compass accuracy is not reported by this device')}
            </p>
          ) : null}

          <div className="notice" style={{ width: '100%' }}>
            {sensorNote()}
          </div>

          <button
            className="btn btn-soft btn-sm"
            onClick={() => void detectLocation()}
            disabled={locState === 'locating'}
          >
            <AppIcon name="refresh" size={16} />{' '}
            {locState === 'locating' ? t('Refreshing…') : t('Refresh my location')}
          </button>
          <p className="tiny muted" style={{ margin: 0 }}>
            {t(
              'The bearing and distance recalculate automatically when you travel and the app picks up a new city.'
            )}
          </p>
        </div>
      ) : null}

      <div className="card">
        <h3 className="section-title">{t('Calibration guidance')}</h3>
        <ul className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.7 }}>
          <li>{t('Move away from metal objects, magnets, speakers and laptops.')}</li>
          <li>{t('Hold the phone flat and move it in a figure-eight three times.')}</li>
          <li>{t('Remove magnetic phone cases and car mounts.')}</li>
          <li>{t('Compare with a known direction such as sunrise to confirm the sensor.')}</li>
        </ul>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {t(
            'The Qibla bearing is calculated from the great-circle route to the Kaaba (21.4225°N, 39.8262°E) using your coordinates.'
          )}
        </p>
      </div>

      <p className="tiny muted center">
        {t('If the needle disagrees with a trusted local Qibla direction, prefer the local mosque.')}
      </p>
    </Page>
  );
}
