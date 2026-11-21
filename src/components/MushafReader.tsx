import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from './Icons';
import { get, local } from '../lib/api';

/**
 * Mushaf page reader.
 *
 * A printed Madani Mushaf has 604 pages, and a single page regularly carries the
 * end of one surah and the beginning of the next. That is why this reader is
 * page-based (GET /quran/page/:page) instead of surah-based: the page is the
 * unit of reading, exactly like the printed book.
 *
 * The Arabic text is never generated or adjusted here. It arrives from the same
 * verified Uthmani edition the surah route uses, and the only thing this file
 * adds is layout: surah header bands, the ayah-end symbol and the page footer.
 */

export interface MushafAyah {
  number: number;
  surah?: number;
  surahName?: string;
  surahEnglishName?: string;
  text: string;
  juz: number;
  page: number;
  hizbQuarter: number;
  sajda?: boolean;
  translation?: string;
}

interface PageData {
  page: number;
  ayahs: MushafAyah[];
  translationEdition?: string;
  source?: string;
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Renders a number with the Arabic-Indic digits used inside the ayah symbol. */
export function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/**
 * Start page of each juz in the 604-page Madani Mushaf, which is the page
 * numbering AlQuran Cloud uses. The page header always shows the juz reported by
 * the loaded page itself, so a jump can never mislabel the reader.
 */
export const JUZ_START_PAGE = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182,
  201, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

export const MUSHAF_TOTAL_PAGES = 604;

const BISMILLAH = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';

/** A run of consecutive ayahs belonging to one surah, as printed on the page. */
interface SurahRun {
  surah: number;
  arabicName: string;
  englishName: string;
  ayahs: MushafAyah[];
  /** The Bismillah heads a surah opening, except Al-Fatihah (it is ayah 1) and At-Tawbah. */
  showBismillah: boolean;
}

function groupRuns(ayahs: MushafAyah[]): SurahRun[] {
  const runs: SurahRun[] = [];
  for (const ayah of ayahs) {
    const surah = ayah.surah || 0;
    const last = runs[runs.length - 1];
    if (last && last.surah === surah) {
      last.ayahs.push(ayah);
      continue;
    }
    runs.push({
      surah,
      arabicName: ayah.surahName || '',
      englishName: ayah.surahEnglishName || '',
      ayahs: [ayah],
      showBismillah: surah !== 1 && surah !== 9,
    });
  }
  return runs;
}

function hizbLabel(quarter: number): string {
  return String(Math.max(1, Math.ceil(quarter / 4)));
}

interface Props {
  surahNumber: number;
  surahArabicName: string;
  surahEnglishName: string;
  /** First page of the surah, from the surah route the reader already loaded. */
  startPage: number;
  /** The loaded surah ayahs: the offline source for pages already read. */
  ayahs: MushafAyah[];
  /** A page requested from the URL (Continue reading) instead of the surah start. */
  initialPage?: number;
  fontSize: number;
  selectMode: boolean;
  onFontSize: (delta: number) => void;
  onRemember: (ayahNo: number, page: number) => void;
  /** Verse numbers already saved, so each marker shows the real saved state. */
  savedAyahs?: Record<number, boolean>;
  /** Whether the page currently shown is saved. */
  savedPage?: boolean;
  onToggleAyah: (ayahNo: number) => void;
  onTogglePage: (page: number) => void;
  jumpToAyah?: number;
  toast: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

export default function MushafReader({
  surahNumber,
  surahArabicName,
  surahEnglishName,
  startPage,
  ayahs,
  initialPage,
  fontSize,
  selectMode,
  onFontSize,
  onRemember,
  savedAyahs,
  savedPage,
  onToggleAyah,
  onTogglePage,
  jumpToAyah,
  toast,
}: Props) {
  const [page, setPage] = useState(
    initialPage && initialPage > 0 ? Math.min(MUSHAF_TOTAL_PAGES, initialPage) : startPage
  );
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<'' | 'offline' | 'not-downloaded'>('');
  const [pageInput, setPageInput] = useState('');
  const [ayahInput, setAyahInput] = useState('');
  const [pendingAyah, setPendingAyah] = useState<number | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);

  // A page that belongs to this surah can be rebuilt from the surah text that is
  // already cached, so a page the reader has visited keeps working offline.
  const surahPageAyahs = useMemo(
    () =>
      ayahs
        .filter((a) => a.page === page)
        .map<MushafAyah>((a) => ({
          ...a,
          surah: surahNumber,
          surahName: surahArabicName,
          surahEnglishName,
        })),
    [ayahs, page, surahNumber, surahArabicName, surahEnglishName]
  );

  useEffect(() => {
    if (jumpToAyah) {
      const target = ayahs.find((a) => a.number === jumpToAyah);
      if (target) {
        setPage(target.page);
        setPendingAyah(jumpToAyah);
      }
    }
  }, [jumpToAyah, ayahs]);

  useEffect(() => {
    let alive = true;
    // Arabic-only page: the reading screen never requests a translation.
    const key = `mushaf.page.${page}`;
    setLoading(true);
    setNotice('');

    get<PageData>(`/quran/page/${page}`)
      .then((res) => {
        if (!alive) return;
        setData(res);
        local.set(key, res);
      })
      .catch(() => {
        if (!alive) return;
        const cached = local.get<PageData | null>(key, null);
        if (cached) {
          setData(cached);
          setNotice('offline');
          return;
        }
        if (surahPageAyahs.length) {
          setData({ page, ayahs: surahPageAyahs });
          setNotice('offline');
          return;
        }
        setData(null);
        setNotice('not-downloaded');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [page, surahPageAyahs]);

  const runs = useMemo(() => groupRuns(data?.ayahs || []), [data]);

  useEffect(() => {
    if (!data?.ayahs.length) return;
    const first = data.ayahs[0];
    onRemember(first.number, page);
  }, [data, page, onRemember]);

  // After a jump, bring the requested ayah into view once the page is painted.
  useEffect(() => {
    if (!pendingAyah || !data) return;
    const el = document.getElementById(`m-ayah-${pendingAyah}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingAyah(null);
    }
  }, [pendingAyah, data]);

  const first = data?.ayahs[0];
  const last = data?.ayahs[data?.ayahs.length - 1];
  const juz = first?.juz ?? 1;
  const hizb = first ? hizbLabel(first.hizbQuarter) : 1;
  const headerNames = runs.map((r) => r.arabicName).filter(Boolean).join(' · ');

  const go = (next: number) => {
    const target = Math.max(1, Math.min(MUSHAF_TOTAL_PAGES, next));
    setPage(target);
    sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const jumpToPage = () => {
    const n = Number(pageInput);
    if (!Number.isInteger(n) || n < 1 || n > MUSHAF_TOTAL_PAGES) {
      toast(`Enter a page from 1 to ${MUSHAF_TOTAL_PAGES}`, 'error');
      return;
    }
    setPageInput('');
    go(n);
  };

  const goToAyah = () => {
    const n = Number(ayahInput);
    const target = ayahs.find((a) => a.number === n);
    if (!target) {
      toast(`Enter an ayah from 1 to ${ayahs.length}`, 'error');
      return;
    }
    setAyahInput('');
    setPage(target.page);
    setPendingAyah(n);
    sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="mushaf" aria-label="Mushaf page">
      <div className="mushaf-toolbar">
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
        >
          <AppIcon name="back" size={15} /> Previous page
        </button>
        <span className="mushaf-pagecount">
          Page <strong>{page}</strong> of {MUSHAF_TOTAL_PAGES}
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => go(page + 1)}
          disabled={page >= MUSHAF_TOTAL_PAGES}
        >
          Next page <AppIcon name="chevron" size={15} />
        </button>
      </div>

      <article
        ref={sheetRef}
        className={`mushaf-sheet${selectMode ? ' selection-enabled' : ''}`}
        dir="rtl"
        lang="ar"
      >
        <header className="mushaf-band">
          <span className="mushaf-band-side">Juz {juz}</span>
          <span className="mushaf-band-title">{headerNames || surahArabicName}</span>
          <span className="mushaf-band-side">Hizb {hizb}</span>
        </header>

        {loading && !data ? <p className="mushaf-status">Loading page…</p> : null}

        {notice === 'not-downloaded' ? (
          <div className="mushaf-status mushaf-status-warn" dir="ltr">
            <strong>This page is not saved on this device.</strong>
            <span>
              Connect to the internet to read page {page}, or open the surah once while online so it
              is stored for offline reading.
            </span>
          </div>
        ) : null}

        {runs.map((run) => (
          <div key={`${run.surah}-${run.ayahs[0]?.number}`} className="mushaf-run">
            <div className="mushaf-surah-header">
              <span className="mushaf-surah-frame">{run.arabicName}</span>
              {run.englishName ? (
                <span className="mushaf-surah-sub" dir="ltr">
                  {run.englishName}
                </span>
              ) : null}
            </div>
            {run.showBismillah && run.ayahs[0]?.number === 1 ? (
              <p className="mushaf-bismillah">{BISMILLAH}</p>
            ) : null}
            <p
              className="mushaf-text"
              data-selectable
              style={{ fontSize, lineHeight: 2.35 }}
            >
              {run.ayahs.map((ayah) => (
                <span key={ayah.number} id={`m-ayah-${ayah.number}`} className="mushaf-ayah">
                  {ayah.text}
                  {/* The ayah-end symbol doubles as the verse bookmark control:
                      tapping ۝ saves or removes that verse. */}
                  <button
                    type="button"
                    className={`ayah-marker${savedAyahs?.[ayah.number] ? ' saved' : ''}`}
                    aria-label={`Bookmark verse ${run.surah}:${ayah.number}`}
                    aria-pressed={Boolean(savedAyahs?.[ayah.number])}
                    title={`Bookmark ${run.surah}:${ayah.number}`}
                    onClick={() => onToggleAyah(ayah.number)}
                  >
                    {' '}
                    <span aria-hidden="true">۝</span>
                    {toArabicDigits(ayah.number)}{' '}
                  </button>
                </span>
              ))}
            </p>
          </div>
        ))}

        <footer className="mushaf-foot">
          <span>{toArabicDigits(page)}</span>
        </footer>
      </article>

      {notice === 'offline' ? (
        <p className="mushaf-note" role="status">
          Saved copy — this page is being read from your device.
        </p>
      ) : null}

      <div className="mushaf-jumps">
        <label className="mushaf-jump">
          <span>Page</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="1–604"
            aria-label="Jump to page"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && jumpToPage()}
          />
          <button type="button" className="btn btn-soft btn-sm" onClick={jumpToPage}>
            Go
          </button>
        </label>

        <label className="mushaf-jump">
          <span>Juz</span>
          <select
            className="select"
            aria-label="Jump to juz"
            value=""
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= 30) go(JUZ_START_PAGE[n - 1]);
            }}
          >
            <option value="">Select…</option>
            {JUZ_START_PAGE.map((startPage, i) => (
              <option key={i} value={i + 1}>
                Juz {i + 1} · page {startPage}
              </option>
            ))}
          </select>
        </label>

        <label className="mushaf-jump">
          <span>Ayah</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder={`1–${ayahs.length}`}
            aria-label="Jump to ayah"
            value={ayahInput}
            onChange={(e) => setAyahInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && goToAyah()}
          />
          <button type="button" className="btn btn-soft btn-sm" onClick={goToAyah}>
            Go
          </button>
        </label>
      </div>

      <div className="mushaf-toolbar mushaf-toolbar-end">
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onFontSize(2)}>
          A+
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onFontSize(-2)}>
          A−
        </button>
        <button
          type="button"
          className={`btn btn-sm ${savedPage ? 'btn-primary' : 'btn-soft'}`}
          aria-pressed={Boolean(savedPage)}
          onClick={() => onTogglePage(page)}
        >
          <AppIcon name="bookmark" size={15} /> {savedPage ? 'Page saved' : 'Bookmark this page'}
        </button>
      </div>

      <p className="mushaf-note">
        Arabic only — continuous Uthmani text in printed Mushaf order. Tap a verse's ۝ marker to
        bookmark it, or use “Bookmark this page”. Translations live in the separate Translations
        screen so this page stays a Mushaf.
      </p>
    </section>
  );
}
