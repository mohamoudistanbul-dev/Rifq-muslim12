import React, { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { usePlayer, SPEEDS, formatTime } from '../lib/quranPlayer';
import { useDownloads, formatBytes } from '../lib/downloads';
import { trackKey } from '../lib/audioStore';
import type { AudioSurah } from '../lib/quranAudio';
import '../audio.css';

/**
 * Quran audio — listening and offline downloads only.
 * There is deliberately no Quran text, translation or tafsir on this page.
 */

type Tab = 'surahs' | 'downloads' | 'bookmarks';

interface Bookmark {
  reciter: string;
  surah: number;
  surahName: string;
  reciterName: string;
  at: string;
}

const BM_KEY = 'rifq.quranAudio.bookmarks';
const RECITER_KEY = 'rifq.quranAudio.reciter';

function readBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
  } catch {
    return [];
  }
}

export default function QuranAudio() {
  const { state, surahs, reciters, catalogLoading, catalogError, lastPlayed, play, resumeLast, toggle, next, prev, seek, setSpeed, cycleRepeat } =
    usePlayer();
  const manager = useDownloads();

  const [reciterId, setReciterId] = useState('');
  const [tab, setTab] = useState<Tab>('surahs');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => readBookmarks());
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  /* Pick the remembered reciter, otherwise the first one that answered. */
  useEffect(() => {
    if (reciterId || !reciters.length) return;
    let stored = '';
    try {
      stored = localStorage.getItem(RECITER_KEY) || '';
    } catch {
      stored = '';
    }
    const preferred = reciters.find((r) => r.id === stored && r.available) || reciters.find((r) => r.available) || reciters[0];
    if (preferred) setReciterId(preferred.id);
  }, [reciters, reciterId]);

  const selectReciter = (id: string) => {
    setReciterId(id);
    try {
      localStorage.setItem(RECITER_KEY, id);
    } catch {
      /* storage may be blocked */
    }
  };

  const selected = reciters.find((r) => r.id === reciterId);
  const availableCount = reciters.filter((r) => r.available).length;

  const visibleSurahs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return surahs;
    return surahs.filter(
      (surah) =>
        surah.name.toLowerCase().includes(needle) ||
        surah.arabic.includes(query.trim()) ||
        String(surah.number) === needle
    );
  }, [surahs, query]);

  const bookmarkKeys = useMemo(() => new Set(bookmarks.map((b) => trackKey(b.reciter, b.surah))), [bookmarks]);

  const toggleBookmark = (surah: AudioSurah) => {
    const key = trackKey(reciterId, surah.number);
    setBookmarks((prev) => {
      const exists = prev.some((b) => trackKey(b.reciter, b.surah) === key);
      const updated = exists
        ? prev.filter((b) => trackKey(b.reciter, b.surah) !== key)
        : [
            {
              reciter: reciterId,
              surah: surah.number,
              surahName: surah.name,
              reciterName: selected?.name || '',
              at: new Date().toISOString(),
            },
            ...prev,
          ];
      try {
        localStorage.setItem(BM_KEY, JSON.stringify(updated));
      } catch {
        /* storage may be blocked */
      }
      return updated;
    });
  };

  const downloadOne = (surah: number) => {
    if (!reciterId) return;
    manager.start(reciterId, surah);
  };

  const downloadAll = () => {
    if (!reciterId) return;
    const missing = surahs.filter((s) => !manager.isStored(reciterId, s.number)).map((s) => s.number);
    if (!missing.length) {
      setNotice('Every surah from this reciter is already downloaded on this device.');
      return;
    }
    manager.startAll(reciterId, missing);
    setNotice(`Downloading ${missing.length} surahs from ${selected?.name || 'this reciter'}. They will be kept on this device.`);
  };

  const removeDownload = async (reciter: string, surah: number) => {
    await manager.remove(reciter, surah);
    setNotice(`Deleted the downloaded audio for surah ${surah}. Storage was freed.`);
  };

  const reciterName = (id: string) => reciters.find((r) => r.id === id)?.name || id;
  const surahName = (number: number) => surahs.find((s) => s.number === number)?.name || `Surah ${number}`;

  return (
    <Page title="Quran Audio" subtitle="Listen to complete surahs and keep them offline — audio only.">
      {catalogError && (
        <div className="card qa-warn">
          <strong>Audio unavailable</strong>
          <p className="small muted">{catalogError}</p>
        </div>
      )}

      {/* ------------------------------ reciter ------------------------------ */}
      <div className="card qa-reciter">
        <div className="qa-reciter-row">
          <label className="qa-label" htmlFor="reciter-select">
            Reciter
          </label>
          <select
            id="reciter-select"
            className="select"
            value={reciterId}
            onChange={(event) => selectReciter(event.target.value)}
            disabled={!reciters.length}
          >
            {reciters.length === 0 && <option value="">Loading reciters…</option>}
            {reciters.map((reciter) => (
              <option key={reciter.id} value={reciter.id} disabled={!reciter.available}>
                {reciter.name}
                {reciter.available ? '' : ' (unavailable)'}
              </option>
            ))}
          </select>
        </div>
        <p className="tiny muted qa-source">
          {catalogLoading
            ? 'Checking the recitation source…'
            : `${availableCount} of ${reciters.length} reciters verified · audio from mp3quran.net`}
        </p>
        {selected && !selected.available && (
          <p className="tiny qa-warn-text">This reciter is not responding right now. Choose another reciter.</p>
        )}
      </div>

      {/* ----------------------------- now playing ---------------------------- */}
      {state.surah > 0 ? (
        <div className="card qa-now">
          <div className="qa-now-head">
            <div>
              <p className="tiny qa-eyebrow">Now playing{state.offline ? ' · offline' : ''}</p>
              <strong className="qa-now-title">{state.surahName}</strong>
              <p className="tiny muted">{state.reciterName}</p>
            </div>
            <span className="qa-repeat-chip">
              {state.repeat === 'one' ? 'Repeat 1' : state.repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            </span>
          </div>

          <input
            className="qa-seek"
            type="range"
            min={0}
            max={state.duration || 0}
            step={1}
            value={Math.min(state.position, state.duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Seek within the surah"
          />
          <div className="qa-times tiny muted">
            <span>{formatTime(state.position)}</span>
            <span>{state.loading ? 'Loading…' : formatTime(state.duration)}</span>
          </div>

          <div className="qa-controls">
            <button className="icon-btn" onClick={prev} aria-label="Previous surah">
              <AppIcon name="back" size={18} />
            </button>
            <button className="qa-play" onClick={toggle} aria-label={state.playing ? 'Pause' : 'Play'}>
              <AppIcon name={state.playing ? 'pause' : 'play'} size={26} />
            </button>
            <button className="icon-btn" onClick={next} aria-label="Next surah">
              <AppIcon name="chevron" size={18} />
            </button>
          </div>

          <div className="qa-extras">
            <label className="qa-speed">
              Speed
              <select className="select" value={state.speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-ghost btn-sm" onClick={cycleRepeat}>
              {state.repeat === 'off' ? 'Repeat off' : state.repeat === 'all' ? 'Repeat all' : 'Repeat one'}
            </button>
          </div>
          {state.error && <p className="tiny qa-warn-text">{state.error}</p>}
        </div>
      ) : (
        lastPlayed && (
          <div className="card qa-resume">
            <div>
              <p className="tiny qa-eyebrow">Continue listening</p>
              <strong>{surahName(lastPlayed.surah)}</strong>
              <p className="tiny muted">
                {reciterName(lastPlayed.reciterId)} · stopped at {formatTime(lastPlayed.position)}
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void resumeLast()}>
              Resume
            </button>
          </div>
        )
      )}

      {/* -------------------------------- tabs ------------------------------- */}
      <div className="qa-tabs" role="tablist">
        {(
          [
            ['surahs', `Surahs (${surahs.length})`],
            ['downloads', `Downloads (${manager.storedTracks.length})`],
            ['bookmarks', `Bookmarks (${bookmarks.length})`],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`qa-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && <p className="tiny qa-notice">{notice}</p>}

      {/* ------------------------------- surahs ------------------------------ */}
      {tab === 'surahs' && (
        <>
          <div className="qa-toolbar">
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search surah by name or number"
              aria-label="Search surahs"
            />
            <button className="btn btn-primary btn-sm" onClick={downloadAll} disabled={!reciterId}>
              <AppIcon name="download" size={16} /> Download all
            </button>
          </div>

          {catalogLoading && <p className="small muted">Loading the 114 surahs…</p>}

          <div className="qa-list">
            {visibleSurahs.map((surah) => {
              const key = trackKey(reciterId, surah.number);
              const entry = manager.entry(reciterId, surah.number);
              const stored = manager.isStored(reciterId, surah.number);
              const active = state.surah === surah.number && state.reciterId === reciterId;
              const percent = entry.total > 0 ? Math.min(100, Math.round((entry.received / entry.total) * 100)) : 0;
              const busy = entry.status === 'downloading' || entry.status === 'verifying' || entry.status === 'queued';
              const bookmarked = bookmarkKeys.has(key);

              return (
                <div key={surah.number} className={`qa-row${active ? ' is-active' : ''}`}>
                  <span className="qa-num">{surah.number}</span>
                  <div className="qa-row-main">
                    <strong className="qa-row-title">
                      {surah.name}
                      {stored && <span className="qa-stored"> · Downloaded</span>}
                    </strong>
                    <span className="qa-row-sub tiny muted">
                      <span dir="rtl" lang="ar">
                        {surah.arabic}
                      </span>{' '}
                      · {surah.ayahs} ayahs
                    </span>
                    {entry.status === 'downloading' && (
                      <div className="qa-progress" aria-label={`Downloading ${percent}%`}>
                        <div className="qa-progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    {entry.status === 'error' && <span className="tiny qa-warn-text">{entry.error}</span>}
                  </div>
                  <div className="qa-row-actions">
                    <button
                      className="icon-btn"
                      onClick={() => toggleBookmark(surah)}
                      aria-label={bookmarked ? `Remove bookmark for ${surah.name}` : `Bookmark ${surah.name}`}
                      title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
                    >
                      <AppIcon name="bookmark" size={16} className={bookmarked ? 'qa-star-on' : undefined} />
                    </button>
                    <button
                      className="icon-btn qa-dl"
                      onClick={() => (stored ? void removeDownload(reciterId, surah.number) : downloadOne(surah.number))}
                      aria-label={stored ? `Delete downloaded audio for ${surah.name}` : `Download ${surah.name}`}
                      title={stored ? 'Delete download' : 'Download for offline listening'}
                    >
                      <AppIcon name={stored ? 'trash' : 'download'} size={16} />
                    </button>
                    <button
                      className="qa-row-play"
                      onClick={() => void play(reciterId, surah.number)}
                      disabled={!reciterId || !selected?.available}
                      aria-label={`Play ${surah.name}`}
                    >
                      <AppIcon name={active && state.playing ? 'pause' : 'play'} size={16} />
                    </button>
                  </div>
                  {busy && <span className="qa-badge-status">{entry.status === 'queued' ? 'Queued' : `${percent}%`}</span>}
                </div>
              );
            })}
          </div>
          {!catalogLoading && visibleSurahs.length === 0 && <p className="small muted">No surah matches that search.</p>}
        </>
      )}

      {/* ------------------------------ downloads ---------------------------- */}
      {tab === 'downloads' && (
        <div className="card">
          <div className="qa-lib-head">
            <div>
              <strong>{manager.usageSummary.count} surahs on this device</strong>
              <p className="tiny muted">{formatBytes(manager.usageSummary.bytes)} used · plays without internet</p>
            </div>
          </div>
          {manager.storedTracks.length === 0 ? (
            <p className="small muted">
              Nothing downloaded yet. Open the Surahs tab and tap the download icon, or use “Download all”.
            </p>
          ) : (
            <div className="qa-list">
              {manager.storedTracks.map((track) => (
                <div key={track.key} className="qa-row">
                  <span className="qa-num">{track.surah}</span>
                  <div className="qa-row-main">
                    <strong className="qa-row-title">{surahName(track.surah)}</strong>
                    <span className="tiny muted">
                      {reciterName(track.reciter)} · {formatBytes(track.size)} · saved{' '}
                      {new Date(track.savedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="qa-row-actions">
                    <button className="icon-btn" onClick={() => void removeDownload(track.reciter, track.surah)} aria-label="Delete download">
                      <AppIcon name="trash" size={16} />
                    </button>
                    <button className="qa-row-play" onClick={() => void play(track.reciter, track.surah)} aria-label="Play offline">
                      <AppIcon name="play" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------ bookmarks ---------------------------- */}
      {tab === 'bookmarks' && (
        <div className="card">
          {bookmarks.length === 0 ? (
            <p className="small muted">No bookmarks yet. Tap the bookmark icon next to any surah.</p>
          ) : (
            <div className="qa-list">
              {bookmarks.map((bookmark) => (
                <div key={trackKey(bookmark.reciter, bookmark.surah)} className="qa-row">
                  <span className="qa-num">{bookmark.surah}</span>
                  <div className="qa-row-main">
                    <strong className="qa-row-title">{surahName(bookmark.surah)}</strong>
                    <span className="tiny muted">{reciterName(bookmark.reciter)}</span>
                  </div>
                  <div className="qa-row-actions">
                    <button
                      className="icon-btn"
                      onClick={() =>
                        setBookmarks((prev) => {
                          const updated = prev.filter(
                            (b) => trackKey(b.reciter, b.surah) !== trackKey(bookmark.reciter, bookmark.surah)
                          );
                          try {
                            localStorage.setItem(BM_KEY, JSON.stringify(updated));
                          } catch {
                            /* storage may be blocked */
                          }
                          return updated;
                        })
                      }
                      aria-label="Remove bookmark"
                    >
                      <AppIcon name="trash" size={16} />
                    </button>
                    <button className="qa-row-play" onClick={() => void play(bookmark.reciter, bookmark.surah)} aria-label="Play bookmark">
                      <AppIcon name="play" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="tiny muted qa-foot">
        Recitations are streamed from mp3quran.net and stored on this device only when you download them. Playback continues while
        you use other apps, and the Android lock screen shows the surah and reciter with play, pause and next controls.
      </p>
    </Page>
  );
}
