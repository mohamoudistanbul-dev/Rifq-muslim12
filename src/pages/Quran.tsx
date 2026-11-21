import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Loading, ErrorBox, TopBar } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { setReadingSelection } from '../lib/touchGuard';
import { get, post, local } from '../lib/api';
import MushafReader from '../components/MushafReader';

interface SurahMeta {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface Ayah {
  number: number;
  text: string;
  juz: number;
  page: number;
  hizbQuarter: number;
  sajda: boolean;
  translation: string;
}

export interface SurahData {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  revelationType: string;
  ayahCount: number;
  translationEdition: string;
  ayahs: Ayah[];
  source: string;
}

export const RECITERS = [
  { id: 'ar.alafasy', label: 'Mishary al-Afasy' },
  { id: 'ar.abdulbasitmurattal', label: 'Abdul Basit (Murattal)' },
  { id: 'ar.husary', label: 'Mahmoud al-Husary' },
  { id: 'ar.minshawi', label: 'Muhammad al-Minshawi' },
  { id: 'ar.shaatree', label: 'Abu Bakr al-Shatri' },
];

export default function QuranList() {
  const { t, toast } = useStore();
  const [surahs, setSurahs] = useState<SurahMeta[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [verseQuery, setVerseQuery] = useState('');
  const [matches, setMatches] = useState<{ surah: number; surahName: string; ayah: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const lastRead = local.get<{ surah: number; ayah: number; page?: number; name: string } | null>(
    'lastRead',
    null
  );

  const load = () => {
    setError('');
    get<{ surahs: SurahMeta[] }>('/quran/surahs')
      .then((res) => {
        setSurahs(res.surahs);
        local.set('surahIndex', res.surahs);
      })
      .catch(() => {
        const cached = local.get<SurahMeta[] | null>('surahIndex', null);
        if (cached) {
          setSurahs(cached);
          setError(t('Showing the saved Quran index — you are offline.'));
        } else {
          setError(t('The Quran index could not be loaded. Check your connection and retry.'));
        }
      });
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!surahs) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter(
      (s) =>
        s.englishName.toLowerCase().includes(q) ||
        s.englishNameTranslation.toLowerCase().includes(q) ||
        s.name.includes(filter.trim()) ||
        String(s.number) === q
    );
  }, [surahs, filter]);

  const searchVerses = async () => {
    const q = verseQuery.trim();
    if (q.length < 3) return toast(t('Type at least 3 characters'), 'error');
    setSearching(true);
    try {
      const res = await get<{ matches: typeof matches }>(`/quran/search?q=${encodeURIComponent(q)}`);
      setMatches(res.matches);
      if (!res.matches.length) toast(t('No verse matched that search'), 'info');
    } catch {
      toast(t('Verse search is unavailable right now'), 'error');
    } finally {
      setSearching(false);
    }
  };

  return (
    <Page title="Quran" subtitle={t('114 surahs · Uthmani Mushaf · audio')} back={false}>
      {lastRead && (
        <Link
          to={`/quran/${lastRead.surah}?page=${lastRead.page || 1}`}
          className="card row"
          style={{ justifyContent: 'space-between', textDecoration: 'none' }}
        >
          <span className="row" style={{ gap: 10 }}>
            <AppIcon name="book" size={18} />
            <span>
              <span className="small" style={{ display: 'block' }}>{t('Continue reading')}</span>
              <span className="tiny muted">
                {lastRead.name} · {t('Page')} {lastRead.page || 1} · {t('Ayah')} {lastRead.ayah}
              </span>
            </span>
          </span>
          <AppIcon name="chevron" size={16} />
        </Link>
      )}

      <div className="card">
        <input className="input" placeholder={t('Search surah by name or number')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            className="input"
            placeholder={t('Search inside the Quran')}
            value={verseQuery}
            onChange={(e) => setVerseQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchVerses()}
          />
          <button className="btn btn-primary" onClick={() => void searchVerses()}>
            <AppIcon name="search" size={16} />
          </button>
        </div>
        {searching && <Loading />}
        {matches.length > 0 && (
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            <p className="tiny muted" style={{ margin: 0 }}>{t('Verse results')}</p>
            {matches.slice(0, 20).map((m, i) => (
              <Link key={`${m.surah}-${m.ayah}-${i}`} to={`/quran/${m.surah}?ayah=${m.ayah}`} className="card" style={{ textDecoration: 'none', padding: 12 }}>
                <p className="small" style={{ margin: 0 }}>{m.text}</p>
                <p className="tiny muted" style={{ margin: '6px 0 0' }}>{m.surahName} · {m.surah}:{m.ayah}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!surahs && !error && <Loading />}

      <div className="stack" style={{ gap: 6 }}>
        {filtered.map((s) => (
          <Link key={s.number} to={`/quran/${s.number}`} className="surah-item">
            <span className="surah-num">{s.number}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block' }}>{s.englishName}</span>
              <span className="tiny muted">
                {s.englishNameTranslation} · {s.numberOfAyahs} {t('ayahs')} · {s.revelationType}
              </span>
            </span>
            <span className="arabic" style={{ fontSize: 20 }}>{s.name.replace('سُورَةُ ', '')}</span>
          </Link>
        ))}
      </div>
      <p className="tiny muted center">
        {t('Quran text is provided by AlQuran Cloud. RIFQ never alters the scripture.')}
      </p>
    </Page>
  );
}

/**
 * Quran reading.
 *
 * Arabic only: this screen is a Mushaf. It renders the verified Uthmani text in
 * printed page order and never mixes in a translation, transliteration or tafsir
 * — those stay on the separate Translations screen (link in the header card).
 * Audio is the existing per-surah recitation player.
 */
export function QuranReader() {
  const { number } = useParams();
  const surahNumber = Math.min(114, Math.max(1, Number(number) || 1));
  const { t, prefs, setPrefs, user, toast } = useStore();
  const [data, setData] = useState<SurahData | null>(null);
  const [error, setError] = useState('');
  const [reciter, setReciter] = useState(() => local.get('reciter', 'ar.alafasy'));
  const [playing, setPlaying] = useState(false);
  const [savedAyahs, setSavedAyahs] = useState<Record<number, boolean>>({});
  const [savedPages, setSavedPages] = useState<Record<number, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const jumpTo = Number(query.get('ayah') || 0);
  const initialPage = Number(query.get('page') || 0);

  const load = () => {
    setError('');
    // No translation parameter: the reading screen is Arabic only.
    get<SurahData>(`/quran/surah/${surahNumber}`)
      .then((res) => {
        setData(res);
        local.set(`surah.${surahNumber}`, res);
        local.set('lastRead', {
          surah: res.number,
          ayah: 1,
          page: res.ayahs[0]?.page || 1,
          name: res.englishName,
        });
      })
      .catch(() => {
        const cached =
          local.get<SurahData | null>(`surah.${surahNumber}`, null) ||
          local.get<SurahData | null>(`surah.${surahNumber}.en.sahih`, null);
        if (cached) {
          setData(cached);
          setError(t('Offline copy — saved on this device.'));
        } else {
          setError(t('This surah could not be loaded. Check your connection and retry.'));
        }
      });
  };

  useEffect(load, [surahNumber]);

  useEffect(() => {
    local.set('reciter', reciter);
  }, [reciter]);

  // Saved verses and saved pages come from the server, so the markers show the
  // real stored state instead of an optimistic guess.
  useEffect(() => {
    if (!user) {
      setSavedAyahs({});
      setSavedPages({});
      return;
    }
    let alive = true;
    get<{ bookmarks: { kind: string; ref: string }[] }>('/bookmarks')
      .then((res) => {
        if (!alive) return;
        const ayahs: Record<number, boolean> = {};
        const pages: Record<number, boolean> = {};
        for (const bookmark of res.bookmarks || []) {
          if (bookmark.kind !== 'quran') continue;
          const verse = /^quran:(\d+):(\d+)$/.exec(bookmark.ref);
          if (verse && Number(verse[1]) === surahNumber) ayahs[Number(verse[2])] = true;
          const pageRef = /^quran:page:(\d+)$/.exec(bookmark.ref);
          if (pageRef) pages[Number(pageRef[1])] = true;
        }
        setSavedAyahs(ayahs);
        setSavedPages(pages);
      })
      .catch(() => {
        /* signed-in bookmarks are a convenience; reading still works without them */
      });
    return () => {
      alive = false;
    };
  }, [user, surahNumber]);

  const rememberAyah = (ayahNo: number, page?: number) => {
    if (!data) return;
    local.set('lastRead', {
      surah: data.number,
      ayah: ayahNo,
      page: page || data.ayahs[0]?.page || 1,
      name: data.englishName,
    });
  };

  const toggleAyah = async (ayahNo: number) => {
    if (!user) return toast(t('Sign in to save bookmarks'), 'error');
    try {
      const res = await post<{ removed?: boolean }>('/bookmarks', {
        kind: 'quran',
        ref: `quran:${surahNumber}:${ayahNo}`,
        surah: surahNumber,
        ayah: ayahNo,
        label: `${data?.englishName} ${surahNumber}:${ayahNo}`,
      });
      setSavedAyahs((current) => ({ ...current, [ayahNo]: !res.removed }));
      toast(res.removed ? t('Bookmark removed') : t('Bookmark saved'), 'success');
    } catch {
      toast(t('The bookmark could not be saved'), 'error');
    }
  };

  const togglePage = async (page: number) => {
    if (!user) return toast(t('Sign in to save bookmarks'), 'error');
    try {
      const res = await post<{ removed?: boolean }>('/bookmarks', {
        kind: 'quran',
        ref: `quran:page:${page}`,
        surah: surahNumber,
        label: `Page ${page}`,
      });
      setSavedPages((current) => ({ ...current, [page]: !res.removed }));
      toast(res.removed ? t('Bookmark removed') : t('Page bookmarked'), 'success');
    } catch {
      toast(t('The bookmark could not be saved'), 'error');
    }
  };

  const toggleAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play()
        .then(() => setPlaying(true))
        .catch(() => toast(t('Audio playback was blocked by the browser'), 'error'));
    }
  };

  // Leaving the reader must never leave the native selection toolbar unlocked.
  useEffect(() => () => setReadingSelection(false), []);

  const audioUrl = `https://cdn.islamic.network/quran/audio-surah/128/${reciter}/${surahNumber}.mp3`;

  const juzRange = data && data.ayahs.length
    ? data.ayahs[0].juz === data.ayahs[data.ayahs.length - 1].juz
      ? `Juz ${data.ayahs[0].juz}`
      : `Juz ${data.ayahs[0].juz}–${data.ayahs[data.ayahs.length - 1].juz}`
    : '';

  return (
    <>
      <TopBar back />
      <div className="wrap">
        <div className="page-head">
          <div>
            <h1 className="page-title">{data?.englishName || `${t('Surah')} ${surahNumber}`}</h1>
            <p className="page-sub">
              {data ? `${data.englishNameTranslation} · ${data.ayahCount} ${t('ayahs')} · ${data.revelationType}` : t('Loading')}
            </p>
          </div>
        </div>

        {error && <ErrorBox message={error} onRetry={load} />}
        {!data && !error && <Loading />}

        {data && (
          <>
            <div className="card">
              <p className="arabic-lg center" dir="rtl" lang="ar" style={{ margin: 0 }}>{data.name}</p>
              <p className="tiny muted center" style={{ margin: '6px 0 0' }}>
                {data.ayahCount} {t('ayahs')} · {juzRange}
              </p>
              <div className="divider" />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={toggleAudio}>
                  <AppIcon name={playing ? 'pause' : 'play'} size={15} /> {playing ? t('Pause') : t('Play surah')}
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  onClick={() => setPrefs({ quranFontSize: Math.min(44, prefs.quranFontSize + 2) })}
                >
                  A+
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  onClick={() => setPrefs({ quranFontSize: Math.max(18, prefs.quranFontSize - 2) })}
                >
                  A−
                </button>
                <button
                  className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-soft'}`}
                  aria-pressed={selectMode}
                  onClick={() => {
                    const next = !selectMode;
                    setSelectMode(next);
                    setReadingSelection(next);
                    toast(
                      next ? t('Text selection on — long-press to copy') : t('Text selection off'),
                      'success'
                    );
                  }}
                >
                  {t('Select text')}
                </button>
                <Link className="btn btn-soft btn-sm" to={`/quran/${surahNumber}/translation`}>
                  <AppIcon name="book" size={15} /> {t('Translations')}
                </Link>
              </div>
              <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} preload="none" />
              <div className="field" style={{ marginTop: 12 }}>
                <label>{t('Reciter')}</label>
                <select className="select" value={reciter} onChange={(e) => setReciter(e.target.value)}>
                  {RECITERS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
              <p className="tiny muted" style={{ marginBottom: 0 }}>{data.source}</p>
            </div>

            <MushafReader
              surahNumber={surahNumber}
              surahArabicName={data.name}
              surahEnglishName={data.englishName}
              startPage={data.ayahs[0]?.page || 1}
              initialPage={initialPage || undefined}
              ayahs={data.ayahs}
              fontSize={prefs.quranFontSize}
              selectMode={selectMode}
              onFontSize={(delta) =>
                setPrefs({
                  quranFontSize: Math.max(18, Math.min(46, prefs.quranFontSize + delta)),
                })
              }
              onRemember={(ayahNo, page) => rememberAyah(ayahNo, page)}
              savedAyahs={savedAyahs}
              savedPage={Boolean(savedPages[initialPage || data.ayahs[0]?.page || 1])}
              onToggleAyah={(ayahNo) => void toggleAyah(ayahNo)}
              onTogglePage={(page) => void togglePage(page)}
              jumpToAyah={jumpTo || undefined}
              toast={toast}
            />

            <div className="btn-row" style={{ marginTop: 14 }}>
              {surahNumber > 1 && (
                <Link className="btn btn-soft" to={`/quran/${surahNumber - 1}`}>
                  <AppIcon name="back" size={15} /> {t('Previous')}
                </Link>
              )}
              {surahNumber < 114 && (
                <Link className="btn btn-primary" to={`/quran/${surahNumber + 1}`}>
                  {t('Next')} <AppIcon name="chevron" size={15} />
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
