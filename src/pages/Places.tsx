import React, { useEffect, useState } from 'react';
import { Page, Loading, ErrorBox } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get } from '../lib/api';

/**
 * Mosques and halal places.
 *
 * Mosques come from the server's OpenStreetMap proxy; nothing is invented here.
 * An empty radius and an unreachable provider are reported differently, so the
 * user never mistakes a failed lookup for "no mosques exist".
 */

interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm?: number;
  distanceM?: number;
  address?: string;
  phone?: string;
  website?: string;
  cuisine?: string;
  kind?: string;
}

interface CityHit {
  name: string;
  lat: number;
  lon: number;
  region?: string;
  country?: string;
}

const RADII = [1000, 5000, 10000, 25000];

const kmOf = (p: Place) =>
  typeof p.distanceKm === 'number' ? p.distanceKm : typeof p.distanceM === 'number' ? p.distanceM / 1000 : null;

export default function Places() {
  const { t, place, detectLocation, locState } = useStore();

  const [kind, setKind] = useState<'mosque' | 'halal'>('mosque');
  const [radius, setRadius] = useState(5000);
  const [items, setItems] = useState<Place[] | null>(null);
  const [note, setNote] = useState('');
  const [source, setSource] = useState('');
  const [attribution, setAttribution] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<CityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cityTarget, setCityTarget] = useState<CityHit | null>(null);

  const center = cityTarget || place;

  const load = () => {
    if (!center) return;
    setLoading(true);
    setError('');
    setNote('');
    const request =
      kind === 'mosque'
        ? get<{ mosques: Place[]; note?: string; source?: string; attribution?: string; ok?: boolean; error?: string }>(
            `/mosques?lat=${center.lat}&lon=${center.lon}&radius=${radius}`
          ).then((res) => {
            if (res.ok === false) {
              setItems([]);
              setNote(res.note || t('The OpenStreetMap service could not be reached. This is not an empty result.'));
              setError(res.note ? '' : t('The mosque service could not be reached.'));
              return;
            }
            setItems(res.mosques || []);
            setNote(res.note || '');
            setAttribution(res.attribution || '© OpenStreetMap contributors');
          })
        : get<{ places: Place[]; note?: string; source?: string }>(
            `/places?lat=${center.lat}&lon=${center.lon}&kind=halal&radius=${radius}`
          ).then((res) => {
            setItems(res.places || []);
            setNote(res.note || '');
            setSource(res.source || '');
          });

    request
      .catch((err: Error) => setError(err.message || t('Place search failed.')))
      .finally(() => setLoading(false));
  };

  useEffect(load, [kind, radius, center?.lat, center?.lon]);

  const searchCity = async () => {
    const q = cityQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await get<{ places: CityHit[] }>(`/mosques/search?q=${encodeURIComponent(q)}`);
      setCities(res.places || []);
      if ((res.places || []).length === 0) setNote(t('No city matched that search.'));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('City search failed.'));
    } finally {
      setSearching(false);
    }
  };

  return (
    <Page
      title="Mosques & Halal"
      subtitle={center ? `${(center as any).city || (center as any).name} · ${t('within')} ${radius / 1000} km` : t('Location unavailable')}
    >
      {!place ? (
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>{t('Finding nearby places needs your coordinates.')}</p>
          <button className="btn btn-primary btn-block" onClick={() => void detectLocation()} disabled={locState === 'locating'}>
            <AppIcon name="location" size={16} /> {t('Use my location')}
          </button>
        </div>
      ) : null}

      <div className="card">
        <div className="chips">
          <button className={`chip ${kind === 'mosque' ? 'on' : ''}`} onClick={() => setKind('mosque')}>
            {t('Mosques')}
          </button>
          <button className={`chip ${kind === 'halal' ? 'on' : ''}`} onClick={() => setKind('halal')}>
            {t('Halal food & shops')}
          </button>
        </div>

        <div className="chips" style={{ marginTop: 10 }}>
          {RADII.map((value) => (
            <button
              key={value}
              className={`chip ${radius === value ? 'on' : ''}`}
              onClick={() => setRadius(value)}
              aria-pressed={radius === value}
            >
              {value / 1000} km
            </button>
          ))}
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="city-search">{t('Search another city')}</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="city-search"
              className="input"
              value={cityQuery}
              placeholder={t('e.g. Mogadishu, Hargeisa, Nairobi')}
              onChange={(event) => setCityQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchCity();
              }}
            />
            <button className="btn btn-soft btn-sm" onClick={() => void searchCity()} disabled={searching || cityQuery.trim().length < 2}>
              {searching ? t('Searching…') : t('Search')}
            </button>
          </div>
        </div>

        {cities.length > 0 ? (
          <div className="stack" style={{ marginTop: 8, gap: 6 }}>
            {cities.slice(0, 6).map((city, index) => (
              <button
                key={`${city.name}-${index}`}
                className="btn btn-soft btn-sm btn-block"
                style={{ justifyContent: 'space-between' }}
                onClick={() => {
                  setCityTarget(city);
                  setCities([]);
                  setCityQuery('');
                }}
              >
                <span>{city.name}</span>
                <span className="tiny muted">{[city.region, city.country].filter(Boolean).join(', ')}</span>
              </button>
            ))}
          </div>
        ) : null}

        {cityTarget ? (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setCityTarget(null)}
          >
            <AppIcon name="close" size={14} /> {t('Back to my location')}
          </button>
        ) : null}
      </div>

      {loading ? <Loading label={kind === 'mosque' ? t('Searching OpenStreetMap…') : t('Searching halal places…')} /> : null}
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {note && !error ? <p className="tiny muted">{note}</p> : null}

      {items && items.length === 0 && !loading && !error ? (
        <div className="empty">
          <AppIcon name="mosque" size={28} />
          <p className="small">
            {kind === 'mosque'
              ? t('No mosque is mapped in OpenStreetMap within this radius. Try a wider distance or search another city.')
              : t('No halal places are mapped within this radius. Try a wider distance or another city.')}
          </p>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {(items || []).map((p) => {
          const km = kmOf(p);
          return (
            <article key={p.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 className="section-title" style={{ margin: 0 }}>{p.name}</h3>
                {km !== null ? <span className="badge-soft tiny">{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span> : null}
              </div>
              {p.address ? <p className="tiny muted" style={{ margin: '6px 0 0' }}>{p.address}</p> : null}
              {p.cuisine ? <p className="tiny muted" style={{ margin: '4px 0 0' }}>{p.cuisine}</p> : null}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <a
                  className="btn btn-soft btn-sm"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <AppIcon name="compass" size={14} /> {t('Directions')}
                </a>
                <a
                  className="btn btn-soft btn-sm"
                  href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Map')}
                </a>
                {p.phone ? (
                  <a className="btn btn-soft btn-sm" href={`tel:${p.phone}`}>
                    <AppIcon name="phone" size={14} /> {t('Call')}
                  </a>
                ) : null}
                {p.website ? (
                  <a className="btn btn-soft btn-sm" href={p.website} target="_blank" rel="noreferrer">
                    {t('Website')}
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {attribution ? <p className="tiny muted center">{t('Data')}: {attribution}</p> : null}
      {source ? <p className="tiny muted center">{t('Data')}: {source}</p> : null}
      <p className="tiny muted center">
        {t(
          'Listings come from community map data. Contact details and halal certification are not verified — please confirm with the place directly.'
        )}
      </p>
    </Page>
  );
}
