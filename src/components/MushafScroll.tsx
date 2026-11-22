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

/** The element that really scrolls the reader: the page, or an inner pane. */
function scrollContainerFor(el: HTMLElement): HTMLElement {
  const page = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
      return node;
    }
    node = node.parentElement;
  }
  return page;
}

function isPageScroller(el: HTMLElement): boolean {
  return el === document.scrollingElement || el === document.documentElement || el === document.body;
}

/** How far the element's top sits below the visible top of its scroll pane. */
function topWithinContainer(el: HTMLElement, container: HTMLElement): number {
  const base = isPageScroller(container) ? 0 : container.getBoundingClientRect().top;
  return el.getBoundingClientRect().top - base;
}

/** Put a page at the top of the reading pane, honouring a saved offset. */
function scrollPageIntoPlace(el: HTMLElement, offset: number): void {
  const container = scrollContainerFor(el);
  const delta = topWithinContainer(el, container) - offset - 8;
  container.scrollTop = Math.max(0, container.scrollTop + delta);
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

  /* --------------------------------------------------- remember the place */
  // Where the reader is. Seeded with the page they asked for, so a record
  // exists as soon as the Mushaf opens — before any page paints and without
  // depending on scroll events or DOM attributes.
  const positionRef = useRef<Position>({
    page: opening,
    offset: saved && saved.page === opening ? Math.max(0, saved.offset || 0) : 0,
  });

  const writePosition = useCallback(
    (record: Position) => {
      positionRef.current = record;
      local.set(POSITION_KEY, record);
      // Surah and ayah come from the loaded page itself, not the DOM, so the
      // Quran index's "Continue reading" card fills in immediately.
      const first = entries[record.page]?.data?.ayahs?.[0] as
        | (MushafAyah & { surahName?: string })
        | undefined;
      const surah = Number(first?.surah || 0);
      if (surah) {
        local.set('lastRead', {
          surah,
          ayah: Number(first?.number || 1),
          page: record.page,
          name: first?.surahName || '',
        });
      }
    },
    [entries]
  );

  const remember = useCallback(() => {
    const anchorLine = window.innerHeight * 0.3;
    let chosen: HTMLElement | null = null;
    let best = Number.POSITIVE_INFINITY;
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-mushaf-page][data-mushaf-surah]')
    );
    for (const block of blocks) {
      if (!block.dataset.mushafSurah) continue;
      const rect = block.getBoundingClientRect();
      // Only a page the reader can actually see may replace the saved place;
      // a page still loading must not drag the record somewhere else.
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const distance = Math.abs(rect.top - anchorLine);
      if (distance < best) {
        best = distance;
        chosen = block;
      }
    }
    if (chosen) {
      const page = Number(chosen.dataset.mushafPage);
      if (Number.isFinite(page) && page > 0) {
        const container = scrollContainerFor(chosen);
        writePosition({ page, offset: Math.max(0, -topWithinContainer(chosen, container)) });
        return;
      }
    }
    // Nothing readable on screen: keep the last known place instead of losing it.
    writePosition(positionRef.current);
  }, [writePosition]);

  /* ------------------------------------------------------ open where asked */
  useEffect(() => {
    if (anchored.current) return;
    if (entries[opening]?.status !== 'ready') return;
    anchored.current = true;
    const offset = saved && saved.page === opening ? Math.max(0, saved.offset || 0) : 0;
    // Record the opening page before touching the DOM: a reader who never
    // scrolls still gets a "Continue reading" entry on the Quran index, and
    // the record cannot be lost to a page that has not painted yet.
    writePosition({ page: opening, offset });
    const el = document.querySelector<HTMLElement>(`[data-mushaf-page="${opening}"]`);
    if (!el) return;
    scrollPageIntoPlace(el, offset);
    // Type and chrome can settle a frame later, so align once more.
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-mushaf-page="${opening}"]`);
      if (target) scrollPageIntoPlace(target, offset);
      writePosition(positionRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [entries, opening, saved, writePosition]);

  useEffect(() => {
    // Write synchronously. A deferred write is lost when the reader leaves the
    // screen right after scrolling, which is exactly how people read.
    let lastWrite = 0;
    const onScroll = () => {
      const now = Date.now();
      if (lastWrite && now - lastWrite < 150) return;
      lastWrite = now;
      remember();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // Scroll events do not bubble, so listen in the capture phase on the
    // document: that hears the page and every inner scrolling pane.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // Leaving the app or switching tabs must not lose the place.
    const flush = () => remember();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
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
