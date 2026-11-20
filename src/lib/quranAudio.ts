/** Quran audio API client (audio only — no text, translation or tafsir). */

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

export interface AudioSurah {
  number: number;
  name: string;
  arabic: string;
  ayahs: number;
  revelation: string;
}

export interface AudioReciter {
  id: string;
  name: string;
  arabic: string;
  bitrate: string;
  source: string;
  available: boolean;
  /** Server-provided artwork path for this reciter. */
  artwork?: string;
  sampleBytes?: number;
  reason?: string;
}

export interface TrackInfo {
  reciter: string;
  surah: number;
  available: boolean;
  bytes: number;
  contentType: string;
  source: string;
  reason?: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!res.ok) throw new Error((data.error as string) || `Request failed (${res.status})`);
  return data as T;
}

export const fetchSurahs = () => getJson<{ surahs: AudioSurah[] }>('/quran/audio/surahs');
export const fetchReciters = () => getJson<{ reciters: AudioReciter[]; verifiedAt: string }>('/quran/audio/reciters');
export const fetchTrackInfo = (reciter: string, surah: number) =>
  getJson<TrackInfo>(`/quran/audio/${encodeURIComponent(reciter)}/${surah}/info`);

/** Same-origin stream URL: Range requests work, so seeking and resume are real. */
export const streamUrl = (reciter: string, surah: number) =>
  `${API_BASE}/quran/audio/${encodeURIComponent(reciter)}/${surah}`;

/**
 * Branded artwork shipped with the app for each reciter.
 *
 * The audio source publishes recitation files only — it has no reciter
 * photography — so RIFQ Muslim ships its own emerald-and-gold medallion per
 * reciter instead of inventing pictures of real people. The same file is used
 * for the Now Playing screen and the Android media notification.
 */
export const reciterArtwork = (id: string) => `/reciters/${id}.png`;

/** Absolute URL, which Media Session needs for lock-screen artwork. */
export const absoluteArtwork = (id: string) => {
  const path = reciterArtwork(id);
  if (typeof window === 'undefined') return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
};

/** Adds the attachment header so the server names the file RIFQ-Muslim-<reciter>-<surah>.mp3 */
export const downloadUrl = (reciter: string, surah: number) =>
  `${API_BASE}/quran/audio/${encodeURIComponent(reciter)}/${surah}?download=1`;
