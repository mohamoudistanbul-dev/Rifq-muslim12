import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { get, local } from '../lib/api';
import {
  BISMILLAH,
  MUSHAF_TOTAL_PAGES,
  groupRuns,
  toArabicDigits,
  type MushafAyah,
} from './MushafReader';

/**
 * Continuous Mushaf.
 *
 * The printed Madinah Mushaf is 604 pages and a reader moves through it by
 * turning pages, not by pressing buttons. This component therefore renders the
 * pages stacked vertically: when the reader approaches the bottom of the loaded
 * pages the next one is appended directly beneath it, and reaching the top
 * prepends the previous one. Nothing here changes the scripture — the Arabic
 * text is the verified Uthmani page text from GET /quran/page/:page, laid out in
 * printed order with its surah bands, ayah-end symbols and page number.
 *
 * Deliberately absent: audio controls, reciter picker, translation, tafsir and
 * bookmark buttons. Audio lives in the separate Quran Audio section.
 */

interface PageData {
  page: number;
  ayahs: MushafAyah[];
  source?: string;
  translationEdition?: string | null;
}

interface Position {
  page: number;
  /** How far the page top sits above the viewport top when it was last seen. */
  offset?: number;
}

type Entry = { status: 'loading' | 'ready' | 'missing'; data?: PageData };

const POSITION_KEY = 'mushaf.pos';
const cacheKey = (page: number) => `mushaf.page.${page}`;

/** Pages already fetched in this session, so scrolling back is instant. */
const pageMemory = new Map<number, PageData>();

function clampPage(value: number): number {
  const n = Math.round(Number(value) || 1);
  return Math.min(MUSHAF_TOTAL_PAGES, Math.max(1, n));
}

function hizbLabel(quarter: number): string {
  return String(Math.max(1, Math.ceil(quarter / 4)));
}

async function loadPage(page: number): Promise<PageData | null> {
  const memorised = pageMemory.get(page);
  if (memorised) return memorised;

  // A page that was read once is kept on the device, so the Mushaf keeps
  // working with no connection at all.
  const cached = local.get<PageData | null>(cacheKey(page), null);
  if (cached?.ayahs?.length) {
    pageMemory.set(page, cached);
    return cached;
  }

  try {
    const fresh = await get<PageData>(`/quran/page/${page}`);
    if (!fresh?.ayahs?.length) return null;
    pageMemory.set(page, fresh);
    local.set(cacheKey(page), fresh);
    return fresh;
  } catch {
    return null;
  }
}

function PageBlock({
  page,
  entry,
  fontSize,
}: {
  page: number;
  entry: Entry | undefined;
  fontSize: number;
}) {
  if (!entry || entry.status === 'loading') {
    return (
      <article className="mushaf-sheet mushaf-sheet-loading" data-mushaf-page={page} aria-busy="true">
        <div className="mushaf-band">
          <span className="mushaf-band-side" />
          <span className="mushaf-band-title">…</span>
          <span className="mushaf-band-side" />
        </div>
        {[92, 100, 96, 88, 74].map((width, i) => (
          <span key={i} className="mushaf-skeleton-line" style={{ width: `${width}%` }} />
        ))}
      </article>
    );
  }

  if (entry.status === 'missing') {
    return (
      <article className="mushaf-sheet" data-mushaf-page={page}>
        <p className="mushaf-missing" dir="ltr">
          <strong>Page {page} is not saved on this device.</strong> Connect to the internet to load
          it. Pages you have already read stay available offline.
        </p>
      </article>
    );
  }

  const data = entry.data!;
  const runs = groupRuns(data.ayahs);
  const first = data.ayahs[0];
  const juz = first?.juz ?? 1;
  const hizb = first ? hizbLabel(first.hizbQuarter) : 1;
  const pageSurahs = runs.map((run) => run.arabicName).filter(Boolean).join(' · ');

  return (
    <article
      className="mushaf-sheet mushaf-scroll-page"
      data-mushaf-page={page}
      data-mushaf-surah={first?.surah || ''}
      data-mushaf-ayah={first?.number || ''}
      data-mushaf-surah-name={first?.surahEnglishName || ''}
      dir="rtl"
      lang="ar"
      aria-label={`Mushaf page ${page}`}
    >
      <header className="mushaf-band">
        <span className="mushaf-band-side">Juz {juz}</span>
        <span className="mushaf-band-title">{pageSurahs}</span>
        <span className="mushaf-band-side">Hizb {hizb}</span>
      </header>

      {runs.map((run) => {
        // A printed Mushaf announces a surah only where the surah begins, not on
        // every page that continues it.
        const opensSurah = run.ayahs[0]?.number === 1;
        return (
          <div key={`${run.surah}-${run.ayahs[0]?.number}`} className="mushaf-run">
            {opensSurah ? (
              <div className="mushaf-surah-header">
                <span className="mushaf-surah-frame">{run.arabicName}</span>
                {run.englishName ? (
                  <span className="mushaf-surah-sub" dir="ltr">
                    {run.englishName}
                  </span>
                ) : null}
              </div>
            ) : null}
            {opensSurah && run.showBismillah ? (
              <p className="mushaf-bismillah">{BISMILLAH}</p>
            ) : null}
            <p className="mushaf-text" style={{ fontSize, lineHeight: 2.3 }}>
              {run.ayahs.map((ayah) => (
                <span key={`${ayah.surah}-${ayah.number}`} className="mushaf-ayah">
                  {ayah.text}
                  {/* The ayah-end symbol is part of the printed page, not a control. */}
                  <span className="ayah-marker ayah-marker-static" aria-hidden="true">
                    {' '}
                    <span>۝</span>
                    {toArabicDigits(ayah.number)}{' '}
                  </span>
                </span>
              ))}
            </p>
          </div>
        );
      })}

      <footer className="mushaf-foot">
        <span>{toArabicDigits(page)}</span>
      </footer>
    </article>
  );
}

export default function MushafScroll({
  startPage,
  fontSize,
}: {
  startPage: number;
  fontSize: number;
}) {
  const opening = clampPage(startPage);
  const saved = useRef<Position | null>(local.get<Position | null>(POSITION_KEY, null)).current;

  const [range, setRange] = useState(() => ({
    from: Math.max(1, opening - 1),
    to: Math.min(MUSHAF_TOTAL_PAGES, opening + 2),
  }));
  const [entries, setEntries] = useState<Record<number, Entry>>({});

  const requested = useRef<Set<number>>(new Set());
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const anchored = useRef(false);
  const heightBeforePrepend = useRef(0);
  const prependPending = useRef(false);

  /* ---------------------------------------------------------------- loading */
  useEffect(() => {
    let alive = true;
    for (let page = range.from; page <= range.to; page += 1) {
      if (requested.current.has(page)) continue;
      requested.current.add(page);
      setEntries((current) => ({ ...current, [page]: { status: 'loading' } }));
      void loadPage(page).then((data) => {
        if (!alive) return;
        setEntries((current) => ({
          ...current,
          [page]: data ? { status: 'ready', data } : { status: 'missing' },
        }));
      });
    }
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  /* ------------------------------------------------------- next page below */
  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (!items.some((item) => item.isIntersecting)) return;
        setRange((current) =>
          current.to >= MUSHAF_TOTAL_PAGES
            ? current
            : { ...current, to: Math.min(MUSHAF_TOTAL_PAGES, current.to + 2) }
        );
      },
      { rootMargin: '1200px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  /* --------------------------------------------------- previous page above */
  useEffect(() => {
    const sentinel = topRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (!items.some((item) => item.isIntersecting)) return;
        setRange((current) => {
          if (current.from <= 1) return current;
          // Remember the document height so the prepended pages do not push the
          // reader's current page out of view.
          heightBeforePrepend.current = document.documentElement.scrollHeight;
          prependPending.current = true;
          return { ...current, from: Math.max(1, current.from - 2) };
        });
      },
      { rootMargin: '700px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!prependPending.current) return;
    prependPending.current = false;
    const grown = document.documentElement.scrollHeight - heightBeforePrepend.current;
    if (grown > 0) window.scrollBy(0, grown);
  }, [range.from]);

  /* ------------------------------------------------------ open where asked */
  useEffect(() => {
    if (anchored.current) return;
    if (entries[opening]?.status !== 'ready') return;
    anchored.current = true;
    const el = document.querySelector<HTMLElement>(`[data-mushaf-page="${opening}"]`);
    if (!el) return;
    const offset = saved && saved.page === opening ? Math.max(0, saved.offset || 0) : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }, [entries, opening, saved]);

  /* --------------------------------------------------- remember the place */
  const remember = useCallback(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-mushaf-page][data-mushaf-surah]')
    ).filter((node) => node.dataset.mushafSurah);
    if (!blocks.length) return;

    const anchorLine = window.innerHeight * 0.3;
    let chosen: HTMLElement | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const distance = Math.abs(rect.top - anchorLine);
      if (distance < best) {
        best = distance;
        chosen = block;
      }
    }
    if (!chosen) return;

    const page = Number(chosen.dataset.mushafPage);
    if (!Number.isFinite(page)) return;
    const rect = chosen.getBoundingClientRect();
    local.set(POSITION_KEY, { page, offset: Math.max(0, -rect.top) } satisfies Position);

    const surah = Number(chosen.dataset.mushafSurah || 0);
    const ayah = Number(chosen.dataset.mushafAyah || 1);
    if (surah) {
      // The Quran index's "Continue reading" card reads this record.
      local.set('lastRead', {
        surah,
        ayah: ayah || 1,
        page,
        name: chosen.dataset.mushafSurahName || '',
      });
    }
  }, []);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        remember();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    remember();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [remember]);

  const pages = useMemo(() => {
    const list: number[] = [];
    for (let page = range.from; page <= range.to; page += 1) list.push(page);
    return list;
  }, [range.from, range.to]);

  return (
    <div className="mushaf-scroll" dir="rtl" lang="ar">
      <div ref={topRef} className="mushaf-scroll-sentinel" aria-hidden="true" />
      {pages.map((page) => (
        <PageBlock key={page} page={page} entry={entries[page]} fontSize={fontSize} />
      ))}
      <div ref={bottomRef} className="mushaf-scroll-sentinel" aria-hidden="true" />
    </div>
  );
}
