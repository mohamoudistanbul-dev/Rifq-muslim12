import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Loading, ErrorBox, TopBar } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get, local } from '../lib/api';
import MushafScroll from '../components/MushafScroll';

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
 * Quran reading — the Mushaf itself, nothing else.
 *
 * The printed Madinah Mushaf is a book of 604 pages, and this screen presents it
 * that way: pages are stacked vertically and the next page loads directly below
 * the previous one as the reader scrolls, so reading is continuous instead of a
 * button per page. There is deliberately no audio player, reciter picker,
 * translation or control bar here. Quran Audio is its own separate section and
 * translations have their own screen, so this page stays a clean Mushaf.
 *
 * The Arabic text is the verified Uthmani page text from GET /quran/page/:page
 * and is never generated, shortened or adjusted.
 */
export function QuranReader() {
  const { number } = useParams();
  const surahNumber = Math.min(114, Math.max(1, Number(number) || 1));
  const { t, prefs } = useStore();
  const [startPage, setStartPage] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  // The Quran index can deep-link a page (Continue reading, a search result, a
  // surah jump), so an explicit ?page= wins over the surah's first page.
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const requestedPage = Math.min(604, Math.max(0, Number(query.get('page') || 0)));

  const load = () => {
    setNotice('');
    get<SurahData>(`/quran/surah/${surahNumber}`)
      .then((res) => {
        local.set(`surah.${surahNumber}`, res);
        setStartPage(res.ayahs[0]?.page || 1);
      })
      .catch(() => {
        const cached =
          local.get<SurahData | null>(`surah.${surahNumber}`, null) ||
          local.get<SurahData | null>(`surah.${surahNumber}.en.sahih`, null);
        if (cached?.ayahs?.length) {
          setStartPage(cached.ayahs[0]?.page || 1);
          return;
        }
        const saved = local.get<{ page?: number } | null>('mushaf.pos', null);
        setStartPage(requestedPage || saved?.page || 1);
        setNotice(t('Opening your saved Mushaf position — the surah index could not be reached.'));
      });
  };

  useEffect(load, [surahNumber]);

  const page = requestedPage > 0 ? requestedPage : startPage;

  return (
    <>
      <TopBar back />
      <div className="wrap mushaf-wrap">
        {notice ? (
          <p className="mushaf-note" role="status">
            {notice}
          </p>
        ) : null}
        {page ? <MushafScroll startPage={page} fontSize={prefs.quranFontSize} /> : <Loading />}
      </div>
    </>
  );
}
