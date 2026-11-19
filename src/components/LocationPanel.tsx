import React, { useEffect, useMemo, useState } from 'react';
import { normalizePlace, useStore } from '../lib/store';
import { get } from '../lib/api';
import { AppIcon } from './Icons';
import { Modal, Loading } from './Shell';

interface CountryRow {
  code: string;
  en: string;
  ar: string;
}
interface CityRow {
  country: string;
  name: string;
  lat: number;
  lon: number;
  timezone: string;
}

/**
 * Location + local time card. Shows the selected country, city, timezone,
 * local clock and dates, and offers real GPS detection or manual
 * country → city selection (with worldwide search).
 */
export default function LocationPanel() {
  const {
    t,
    place,
    locState,
    locError,
    detectLocation,
    setManualPlace,
    localTime,
    localDate,
    tzLabel,
    hijri,
    toast,
  } = useStore();

  const [open, setOpen] = useState(false);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [countryCode, setCountryCode] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<(ReturnType<typeof normalizePlace>)[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open || countries.length) return;
    let cancelled = false;
    setLoadingList(true);
    get<{ countries: CountryRow[]; cities: CityRow[] }>('/cities')
      .then((res) => {
        if (cancelled) return;
        setCountries(res.countries || []);
        setCities(res.cities || []);
      })
      .catch(() => {
        if (!cancelled) toast(t('Could not load the city list. Check your connection.'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, countries.length, t, toast]);

  useEffect(() => {
    if (open) setCountryCode((prev) => prev || place?.countryCode || '');
  }, [open, place?.countryCode]);

  const cityOptions = useMemo(() => {
    if (!countryCode) return [];
    return cities
      .filter((c) => c.country === countryCode)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cities, countryCode]);

  const countryName = countries.find((c) => c.code === place?.countryCode)?.en;

  const applyCity = (city: CityRow) => {
    const row = countries.find((c) => c.code === city.country);
    const chosen = normalizePlace({
      lat: city.lat,
      lon: city.lon,
      city: city.name,
      country: row?.en || city.country,
      countryCode: city.country,
      timezone: city.timezone,
      manual: true,
    });
    if (!chosen) return;
    setManualPlace(chosen);
    setOpen(false);
    toast(`${chosen.city} · ${chosen.timezone}`, 'success');
  };

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await get<{ results: Record<string, unknown>[] }>(
        `/geo/search?q=${encodeURIComponent(q)}`
      );
      setResults((res.results || []).map((r) => normalizePlace({ ...r, manual: true })));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <section className="card loc-card">
        <div className="loc-pattern" aria-hidden />
        <div className="loc-head">
          <div>
            <p className="tiny muted loc-label">{t('Your location')}</p>
            <h2 className="loc-city">
              {place ? (
                <>
                  {place.flag && <span className="loc-flag">{place.flag}</span>}
                  {place.city}
                </>
              ) : (
                t('Location unavailable')
              )}
            </h2>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              {place
                ? [place.region, place.country || countryName].filter(Boolean).join(', ')
                : t('Allow location access or choose your city')}
            </p>
          </div>
          {place && (
            <span className="loc-badge">{place.manual ? t('Selected manually') : t('GPS detected')}</span>
          )}
        </div>

        {place ? (
          <>
            <div className="loc-facts">
              <div className="loc-fact">
                <span>{t('Country')}</span>
                <strong>{place.country || countryName || '—'}</strong>
              </div>
              <div className="loc-fact">
                <span>{t('City')}</span>
                <strong>{place.city}</strong>
              </div>
              <div className="loc-fact">
                <span>{t('Local time')}</span>
                <strong className="loc-clock">{localTime}</strong>
              </div>
              <div className="loc-fact">
                <span>{t('Date')}</span>
                <strong>{localDate}</strong>
              </div>
              <div className="loc-fact">
                <span>{t('Timezone')}</span>
                <strong>{place.timezone}</strong>
                <em className="tiny muted" style={{ fontStyle: 'normal' }}>{tzLabel}</em>
              </div>
              <div className="loc-fact">
                <span>{t('Hijri date')}</span>
                <strong>{hijri ? `${hijri.day} ${hijri.monthName} ${hijri.year} AH` : '—'}</strong>
              </div>
            </div>
            <p className="tiny muted loc-coords">
              {t('Coordinates')}: {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
            </p>
          </>
        ) : (
          <p className="small" style={{ margin: '10px 0 0' }}>
            {t('Prayer times need a real location. Allow GPS access or pick your city below.')}
          </p>
        )}

        {locError && <p className="tiny loc-error">{t(locError)}</p>}

        <div className="loc-actions">
          <button
            className="btn btn-primary"
            onClick={() => void detectLocation()}
            disabled={locState === 'locating'}
          >
            <AppIcon name="location" size={16} />{' '}
            {locState === 'locating' ? t('Locating…') : t('Use My Current Location')}
          </button>
          <button className="btn btn-soft" onClick={() => setOpen(true)}>
            <AppIcon name="search" size={16} /> {t('Choose country and city')}
          </button>
        </div>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Choose country and city')}>
        <div className="field">
          <label>{t('Country')}</label>
          <select
            className="select"
            value={countryCode}
            onChange={(e) => {
              setCountryCode(e.target.value);
              setQuery('');
              setResults([]);
            }}
          >
            <option value="">{t('Select a country')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.en}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('City')}</label>
          {loadingList ? (
            <Loading />
          ) : (
            <select
              className="select"
              value=""
              onChange={(e) => {
                const city = cityOptions.find((c) => c.name === e.target.value);
                if (city) applyCity(city);
              }}
            >
              <option value="">
                {countryCode ? t('Select a city') : t('Select a country first')}
              </option>
              {cityOptions.map((c) => (
                <option key={`${c.name}-${c.lat}-${c.lon}`} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {countryCode && !loadingList && cityOptions.length === 0 && (
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              {t('No listed city for this country. Search below for any town or village.')}
            </p>
          )}
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('Search any city')}</label>
          <input
            className="input"
            placeholder={t('Search city, e.g. Mogadishu')}
            value={query}
            onChange={(e) => void search(e.target.value)}
          />
        </div>

        <div className="loc-list">
          {searching && <Loading />}
          {!searching && query.trim().length > 1 && results.length === 0 && (
            <p className="small muted">{t('No matching place found. Try a different spelling.')}</p>
          )}
          {results.map(
            (r, i) =>
              r && (
                <button
                  key={`${r.city}-${r.lat}-${i}`}
                  className="loc-item"
                  onClick={() => {
                    setManualPlace(r);
                    setOpen(false);
                    toast(`${r.city} · ${r.timezone}`, 'success');
                  }}
                >
                  <span>
                    {r.flag} {r.city}
                  </span>
                  <span className="tiny muted">
                    {[r.region, r.country].filter(Boolean).join(', ')} · {r.timezone}
                  </span>
                </button>
              )
          )}
        </div>
      </Modal>
    </>
  );
}
