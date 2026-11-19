import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizePlace, useStore } from '../lib/store';
import { get } from '../lib/api';
import { AppIcon } from './Icons';
import { Modal, Loading } from './Shell';

interface CountryRow {
  code: string;
  en: string;
  ar: string;
  flag: string;
  capital: string;
  continent: string;
  cities: number;
}

interface PlaceRow {
  city: string;
  name?: string;
  region?: string;
  country?: string;
  countryAr?: string;
  countryCode: string;
  flag?: string;
  lat: number;
  lon: number;
  timezone: string;
  population?: number;
  capital?: boolean;
}

/**
 * Location + local time card.
 *
 * Shows the selected country, city, timezone, local clock and dates, and offers
 * real GPS detection or manual selection from the worldwide place database
 * (every country and territory, 70k places) with a live geocoder for villages.
 */
export default function LocationPanel() {
  const {
    t,
    lang,
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
  const [loadingList, setLoadingList] = useState(false);
  const [step, setStep] = useState<'country' | 'city'>('country');
  const [countryCode, setCountryCode] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [cities, setCities] = useState<PlaceRow[]>([]);
  const [cityQuery, setCityQuery] = useState('');
  const [loadingCities, setLoadingCities] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countryName = (code: string) => {
    const row = countries.find((c) => c.code === code);
    if (!row) return code;
    return lang === 'ar' ? row.ar : row.en;
  };

  const localCountryName = (p: { country?: string; countryAr?: string; countryCode: string }) =>
    lang === 'ar' ? p.countryAr || countryName(p.countryCode) : p.country || countryName(p.countryCode);

  /* ------------------------------ country list ------------------------------ */
  useEffect(() => {
    if (!open || countries.length) return;
    let cancelled = false;
    setLoadingList(true);
    get<{ countries: CountryRow[] }>('/geo/countries')
      .then((res) => {
        if (!cancelled) setCountries(res.countries || []);
      })
      .catch(() => {
        if (!cancelled) toast(t('Could not load the country list. Check your connection.'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, countries.length, t, toast]);

  useEffect(() => {
    if (open) {
      setCountryCode((prev) => prev || place?.countryCode || '');
      setStep('country');
      setCityQuery('');
      setQuery('');
      setResults([]);
      setSearchNote('');
    }
  }, [open, place?.countryCode]);

  /* ------------------------------- city list -------------------------------- */
  useEffect(() => {
    if (!open || step !== 'city' || !countryCode) return;
    let cancelled = false;
    setLoadingCities(true);
    const url = cityQuery.trim().length >= 2
      ? `/geo/cities?country=${countryCode}&q=${encodeURIComponent(cityQuery.trim())}&limit=200`
      : `/geo/cities?country=${countryCode}&limit=300`;
    get<{ cities: PlaceRow[] }>(url)
      .then((res) => {
        if (!cancelled) setCities(res.cities || []);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, countryCode, cityQuery]);

  const visibleCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const list = q
      ? countries.filter(
          (c) =>
            c.en.toLowerCase().includes(q) ||
            c.ar.includes(countryQuery.trim()) ||
            c.code.toLowerCase() === q
        )
      : countries;
    return list;
  }, [countries, countryQuery]);

  const apply = (row: PlaceRow) => {
    const chosen = normalizePlace({
      ...row,
      country: row.country || countryName(row.countryCode),
      manual: true,
    });
    if (!chosen) {
      toast(t('That place could not be used. Try another one.'), 'error');
      return;
    }
    setManualPlace(chosen);
    setOpen(false);
    toast(`${chosen.city} · ${chosen.timezone}`, 'success');
  };

  /* ----------------------------- worldwide search ---------------------------- */
  const search = (value: string) => {
    setQuery(value);
    setSearchNote('');
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      get<{ results: PlaceRow[]; note?: string }>(`/geo/search?q=${encodeURIComponent(value.trim())}&limit=15`)
        .then((res) => {
          setResults(res.results || []);
          setSearchNote(res.note || '');
        })
        .catch(() => {
          setResults([]);
          setSearchNote(t('Search is unavailable right now.'));
        })
        .finally(() => setSearching(false));
    }, 280);
  };

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const placeLabel = (p: PlaceRow) =>
    [p.region, localCountryName(p)].filter(Boolean).join(', ');

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
                ? [place.region, place.country || countryName(place.countryCode)].filter(Boolean).join(', ')
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
                <strong>{place.country || countryName(place.countryCode) || '—'}</strong>
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
        {/* Worldwide search — works from any country. */}
        <div className="field">
          <label>{t('Search any city worldwide')}</label>
          <input
            className="input"
            placeholder={t('City or town, e.g. Mogadishu, Kuala Lumpur, Oslo')}
            value={query}
            onChange={(e) => search(e.target.value)}
          />
        </div>

        {searching && <Loading />}
        {!searching && searchNote && <p className="tiny muted">{searchNote}</p>}
        {!searching && query.trim().length > 1 && results.length === 0 && !searchNote && (
          <p className="small muted">{t('No matching place found. Try a different spelling.')}</p>
        )}
        {results.length > 0 && (
          <div className="loc-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <button key={`${r.city}-${r.lat}-${i}`} className="loc-item" onClick={() => apply(r)}>
                <span>
                  {r.flag} {r.city}
                  {r.capital ? ' ★' : ''}
                </span>
                <span className="tiny muted">
                  {placeLabel(r)} · {r.timezone}
                </span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line, rgba(255,255,255,.14))' }} />
          <span className="tiny muted">{t('or browse by country')}</span>
          <div style={{ flex: 1, height: 1, background: 'var(--line, rgba(255,255,255,.14))' }} />
        </div>

        {step === 'country' ? (
          <>
            <div className="field">
              <label>{t('Country')}</label>
              <input
                className="input"
                placeholder={t('Search a country, e.g. Somalia, Japan, Brazil')}
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
              />
            </div>
            {loadingList ? (
              <Loading />
            ) : (
              <>
                <p className="tiny muted" style={{ margin: '8px 0 4px' }}>
                  {visibleCountries.length} {t('countries and territories')}
                </p>
                <div className="loc-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {visibleCountries.map((c) => (
                    <button
                      key={c.code}
                      className="loc-item"
                      onClick={() => {
                        setCountryCode(c.code);
                        setStep('city');
                        setCityQuery('');
                      }}
                    >
                      <span>
                        {c.flag} {lang === 'ar' ? c.ar : c.en}
                      </span>
                      <span className="tiny muted">
                        {c.capital ? `${t('Capital')}: ${c.capital} · ` : ''}
                        {c.cities} {t('places')}
                      </span>
                    </button>
                  ))}
                  {visibleCountries.length === 0 && (
                    <p className="small muted">{t('No country matches that spelling.')}</p>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button className="btn btn-soft" onClick={() => setStep('country')}>
                <AppIcon name="back" size={16} /> {t('Countries')}
              </button>
              <strong className="small" style={{ flex: 1 }}>
                {countries.find((c) => c.code === countryCode)?.flag}{' '}
                {countryName(countryCode)}
              </strong>
            </div>
            <div className="field">
              <label>{t('Search a city in this country')}</label>
              <input
                className="input"
                placeholder={t('City or town name')}
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
              />
            </div>
            {loadingCities ? (
              <Loading />
            ) : (
              <div className="loc-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
                {cities.map((c, i) => (
                  <button key={`${c.city}-${c.lat}-${i}`} className="loc-item" onClick={() => apply(c)}>
                    <span>
                      {c.city}
                      {c.capital ? ' ★' : ''}
                    </span>
                    <span className="tiny muted">
                      {[c.region, c.timezone].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
                {cities.length === 0 && (
                  <p className="small muted">
                    {t('No place matches here. Try the worldwide search above.')}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 14 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => {
              setOpen(false);
              void detectLocation();
            }}
            disabled={locState === 'locating'}
          >
            <AppIcon name="location" size={16} />{' '}
            {locState === 'locating' ? t('Locating…') : t('Use My Current Location')}
          </button>
        </div>
      </Modal>
    </>
  );
}
