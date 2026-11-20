import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '../components/Icons';
import { getTrackBlob, trackKey } from './audioStore';
import { fetchReciters, fetchSurahs, streamUrl, type AudioReciter, type AudioSurah } from './quranAudio';

/**
 * One shared <audio> element for the whole app, so recitation keeps playing
 * while the user moves between screens. Media Session publishes metadata and
 * handlers, which is what Android uses for lock-screen and notification
 * controls. The last surah and position are remembered on the device.
 */

export type RepeatMode = 'off' | 'one' | 'all';
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

interface LastPlayed {
  reciterId: string;
  surah: number;
  position: number;
  updatedAt: string;
}

export interface PlayerState {
  reciterId: string;
  reciterName: string;
  surah: number;
  surahName: string;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  speed: number;
  repeat: RepeatMode;
  offline: boolean;
  error: string;
}

interface PlayerApi {
  state: PlayerState;
  surahs: AudioSurah[];
  reciters: AudioReciter[];
  catalogLoading: boolean;
  catalogError: string;
  lastPlayed: LastPlayed | null;
  play: (reciterId: string, surah: number) => Promise<void>;
  resumeLast: () => Promise<void>;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  cycleRepeat: () => void;
  close: () => void;
}

const LAST_KEY = 'rifq.quranAudio.last';
const SPEED_KEY = 'rifq.quranAudio.speed';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function readLast(): LastPlayed | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastPlayed;
    if (!parsed || typeof parsed.surah !== 'number' || typeof parsed.reciterId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function initialSpeed(): number {
  try {
    const stored = Number(localStorage.getItem(SPEED_KEY));
    if (SPEEDS.includes(stored)) return stored;
  } catch {
    /* storage may be blocked */
  }
  return 1;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef('');
  const lastSaveRef = useRef(0);
  const [surahs, setSurahs] = useState<AudioSurah[]>([]);
  const [reciters, setReciters] = useState<AudioReciter[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [lastPlayed, setLastPlayed] = useState<LastPlayed | null>(() => readLast());
  const [state, setState] = useState<PlayerState>({
    reciterId: '',
    reciterName: '',
    surah: 0,
    surahName: '',
    playing: false,
    loading: false,
    position: 0,
    duration: 0,
    speed: initialSpeed(),
    repeat: 'off',
    offline: false,
    error: '',
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const surahsRef = useRef<AudioSurah[]>([]);
  surahsRef.current = surahs;
  const recitersRef = useRef<AudioReciter[]>([]);
  recitersRef.current = reciters;
  const lastPlayedRef = useRef<LastPlayed | null>(lastPlayed);
  lastPlayedRef.current = lastPlayed;

  /* ------------------------------- catalogue ------------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [surahRes, reciterRes] = await Promise.all([fetchSurahs(), fetchReciters()]);
        if (!alive) return;
        setSurahs(surahRes.surahs);
        setReciters(reciterRes.reciters);
        if (!reciterRes.reciters.some((r) => r.available)) {
          setCatalogError('The recitation source is unreachable right now, so audio cannot be played. Please try again later.');
        }
      } catch (err) {
        if (alive) setCatalogError((err as Error).message || 'The surah catalogue could not be loaded.');
      } finally {
        if (alive) setCatalogLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(() => {
    const current = stateRef.current;
    if (!current.surah) return;
    const payload: LastPlayed = {
      reciterId: current.reciterId,
      surah: current.surah,
      position: Math.max(0, Math.round(current.position)),
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(payload));
    } catch {
      /* storage may be blocked */
    }
    setLastPlayed(payload);
  }, []);

  const publishMetadata = useCallback((surahName: string, reciterName: string) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: surahName || 'Quran recitation',
          artist: reciterName || 'RIFQ Muslim',
          album: 'RIFQ Muslim — Quran Audio',
        });
      }
    } catch {
      /* older WebView without MediaMetadata */
    }
  }, []);

  const play = useCallback(
    async (reciterId: string, surah: number) => {
      const el = audioRef.current;
      if (!el) return;
      const reciter = recitersRef.current.find((r) => r.id === reciterId);
      const meta = surahsRef.current.find((s) => s.number === surah);
      const surahName = meta?.name || `Surah ${surah}`;
      const reciterName = reciter?.name || reciterId;

      setState((prev) => ({ ...prev, reciterId, reciterName, surah, surahName, loading: true, error: '' }));

      let source = streamUrl(reciterId, surah);
      let offline = false;
      try {
        const blob = await getTrackBlob(trackKey(reciterId, surah));
        if (blob) {
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = URL.createObjectURL(blob);
          source = objectUrlRef.current;
          offline = true;
        }
      } catch {
        /* streaming is the fallback */
      }

      if (el.src !== source) el.src = source;
      el.playbackRate = stateRef.current.speed;
      publishMetadata(surahName, reciterName);

      try {
        await el.play();
        setState((prev) => ({ ...prev, offline, loading: false }));
      } catch {
        setState((prev) => ({
          ...prev,
          playing: false,
          loading: false,
          error: 'Playback could not start. Tap play again, or check your connection.',
        }));
      }
    },
    [publishMetadata]
  );

  const resumeLast = useCallback(async () => {
    const last = readLast();
    if (!last) return;
    await play(last.reciterId, last.surah);
    const el = audioRef.current;
    if (el && last.position > 1) {
      const apply = () => {
        try {
          el.currentTime = Math.max(0, Math.min(last.position, (el.duration || last.position) - 1));
        } catch {
          /* seeking not possible yet */
        }
        el.removeEventListener('loadedmetadata', apply);
      };
      if (el.readyState >= 1) apply();
      else el.addEventListener('loadedmetadata', apply);
    }
  }, [play]);

  const handleEnded = useCallback(() => {
    const current = stateRef.current;
    const el = audioRef.current;
    if (current.repeat === 'one' && el) {
      try {
        el.currentTime = 0;
        void el.play();
      } catch {
        /* ignore */
      }
      return;
    }
    const total = surahsRef.current.length || 114;
    if (current.surah >= total && current.repeat !== 'all') {
      setState((prev) => ({ ...prev, playing: false, position: 0 }));
      persist();
      return;
    }
    const target = current.surah >= total ? 1 : current.surah + 1;
    void play(current.reciterId, target);
  }, [persist, play]);

  const step = useCallback(
    (delta: number) => {
      const current = stateRef.current;
      if (!current.surah) return;
      const total = surahsRef.current.length || 114;
      let target = current.surah + delta;
      if (target < 1) target = total;
      if (target > total) target = 1;
      void play(current.reciterId, target);
    },
    [play]
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const endedRef = useRef<() => void>(() => {});
  endedRef.current = handleEnded;
  const nextRef = useRef<() => void>(() => {});
  nextRef.current = next;
  const prevRef = useRef<() => void>(() => {});
  prevRef.current = prev;

  /* ----------------------------- audio element ----------------------------- */
  useEffect(() => {
    const el = new Audio();
    el.preload = 'metadata';
    audioRef.current = el;

    const onTime = () => {
      setState((prev) => ({ ...prev, position: el.currentTime || 0 }));
      const now = Date.now();
      if (now - lastSaveRef.current > 5000) {
        lastSaveRef.current = now;
        persist();
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && el.duration > 0 && Number.isFinite(el.duration)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            position: Math.min(el.currentTime, el.duration),
            playbackRate: el.playbackRate || 1,
          });
        } catch {
          /* position state unsupported */
        }
      }
    };
    const onMeta = () =>
      setState((prev) => ({ ...prev, duration: Number.isFinite(el.duration) ? el.duration : 0, loading: false }));
    const onPlay = () => {
      setState((prev) => ({ ...prev, playing: true, loading: false }));
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'playing';
        } catch {
          /* ignore */
        }
      }
    };
    const onPause = () => {
      setState((prev) => ({ ...prev, playing: false }));
      persist();
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch {
          /* ignore */
        }
      }
    };
    const onWaiting = () => setState((prev) => ({ ...prev, loading: true }));
    const onCanPlay = () => setState((prev) => ({ ...prev, loading: false }));
    const onEnded = () => endedRef.current();
    const onError = () =>
      setState((prev) => ({
        ...prev,
        playing: false,
        loading: false,
        error: 'This surah could not be played. Check your connection and try again.',
      }));

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);

    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [persist]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds;
    const target = Math.max(0, Math.min(seconds, limit));
    try {
      el.currentTime = target;
      setState((prev) => ({ ...prev, position: target }));
    } catch {
      /* seeking unavailable before metadata */
    }
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!stateRef.current.surah) {
      if (lastPlayedRef.current) void resumeLast();
      return;
    }
    if (el.paused) {
      void el.play().catch(() => setState((prev) => ({ ...prev, error: 'Playback could not start.' })));
    } else {
      el.pause();
    }
  }, [resumeLast]);

  const setSpeed = useCallback((speed: number) => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      /* storage may be blocked */
    }
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const cycleRepeat = useCallback(() => {
    setState((prev) => ({ ...prev, repeat: prev.repeat === 'off' ? 'all' : prev.repeat === 'all' ? 'one' : 'off' }));
  }, []);

  const close = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    persist();
    setState((prev) => ({
      ...prev,
      surah: 0,
      surahName: '',
      playing: false,
      loading: false,
      position: 0,
      duration: 0,
      error: '',
    }));
  }, [persist]);

  /* ----------------------------- media session ----------------------------- */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: ((details: MediaSessionActionDetails) => void) | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* unsupported action on this platform */
      }
    };

    set('play', () => {
      void audioRef.current?.play();
    });
    set('pause', () => audioRef.current?.pause());
    set('previoustrack', () => prevRef.current());
    set('nexttrack', () => nextRef.current());
    set('seekbackward', (details) => seek(Math.max(0, (audioRef.current?.currentTime || 0) - (details.seekOffset || 10))));
    set('seekforward', (details) => seek((audioRef.current?.currentTime || 0) + (details.seekOffset || 10)));
    set('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime);
    });
    set('stop', () => audioRef.current?.pause());

    return () => {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekbackward',
        'seekforward',
        'seekto',
        'stop',
      ];
      for (const action of actions) set(action, null);
    };
  }, [seek]);

  /* Persist the position when the app is closed or hidden. */
  useEffect(() => {
    const onHide = () => persist();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [persist]);

  const value = useMemo<PlayerApi>(
    () => ({
      state,
      surahs,
      reciters,
      catalogLoading,
      catalogError,
      lastPlayed,
      play,
      resumeLast,
      toggle,
      next,
      prev,
      seek,
      setSpeed,
      cycleRepeat,
      close,
    }),
    [state, surahs, reciters, catalogLoading, catalogError, lastPlayed, play, resumeLast, toggle, next, prev, seek, setSpeed, cycleRepeat, close]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used inside PlayerProvider');
  return context;
}

/** Compact player that stays available on every screen while audio is loaded. */
export function PlayerBar() {
  const { state, toggle, next, prev, seek, setSpeed, cycleRepeat, close } = usePlayer();
  if (!state.surah) return null;
  const max = state.duration > 0 ? state.duration : 0;

  return (
    <div className="player-bar" role="region" aria-label="Quran audio player">
      <div className="player-bar-top">
        <div className="player-bar-meta">
          <strong className="player-bar-title">{state.surahName}</strong>
          <span className="tiny muted">
            {state.reciterName}
            {state.offline ? ' · Offline' : ''}
          </span>
        </div>
        <div className="player-bar-actions">
          <button className="icon-btn" onClick={prev} aria-label="Previous surah">
            <AppIcon name="back" size={16} />
          </button>
          <button className="icon-btn player-bar-play" onClick={toggle} aria-label={state.playing ? 'Pause' : 'Play'}>
            <AppIcon name={state.playing ? 'pause' : 'play'} size={18} />
          </button>
          <button className="icon-btn player-bar-next" onClick={next} aria-label="Next surah">
            <AppIcon name="chevron" size={16} />
          </button>
          <select
            className="select player-bar-speed"
            value={state.speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Playback speed"
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
          <button
            className={`btn btn-ghost btn-sm player-bar-repeat${state.repeat !== 'off' ? ' is-active' : ''}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${state.repeat}`}
          >
            {state.repeat === 'one' ? 'Repeat 1' : state.repeat === 'all' ? 'Repeat all' : 'Repeat'}
          </button>
          <button className="icon-btn" onClick={close} aria-label="Close player">
            <AppIcon name="close" size={16} />
          </button>
        </div>
      </div>
      <input
        className="player-bar-seek"
        type="range"
        min={0}
        max={max || 0}
        step={1}
        value={Math.min(state.position, max || 0)}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label="Seek"
      />
      <div className="player-bar-times tiny muted">
        <span>{formatTime(state.position)}</span>
        <span>{state.loading ? 'Loading…' : formatTime(state.duration)}</span>
      </div>
      {state.error && <p className="tiny player-bar-error">{state.error}</p>}
    </div>
  );
}
