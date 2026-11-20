/**
 * Download manager for offline Quran audio.
 *
 * Downloads stream through the same-origin endpoint, so the file size is real,
 * progress is measured in bytes and an interrupted transfer can resume with a
 * Range request from the bytes already stored on the device.
 */
import { useEffect, useState } from 'react';
import {
  deletePartial,
  getPartial,
  savePartial,
  deleteTrack,
  listTracks,
  saveTrack,
  storageUsage,
  trackKey,
  type StoredTrack,
} from './audioStore';
import { downloadUrl, fetchTrackInfo } from './quranAudio';

export type DownloadStatus = 'idle' | 'queued' | 'verifying' | 'downloading' | 'done' | 'error' | 'cancelled';

export interface DownloadEntry {
  key: string;
  reciter: string;
  surah: number;
  status: DownloadStatus;
  received: number;
  total: number;
  error: string;
  resumed: boolean;
}

type Listener = () => void;

const CONCURRENCY = 2;

function emptyEntry(reciter: string, surah: number): DownloadEntry {
  return {
    key: trackKey(reciter, surah),
    reciter,
    surah,
    status: 'idle',
    received: 0,
    total: 0,
    error: '',
    resumed: false,
  };
}

class DownloadManager {
  private entries = new Map<string, DownloadEntry>();
  private listeners = new Set<Listener>();
  private queue: Array<{ reciter: string; surah: number }> = [];
  private active = 0;
  private controllers = new Map<string, AbortController>();
  private stored: StoredTrack[] = [];
  private usage = { count: 0, bytes: 0 };
  private ready = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  get entriesMap(): DownloadEntry[] {
    return [...this.entries.values()];
  }

  get storedTracks(): StoredTrack[] {
    return this.stored;
  }

  get usageSummary(): { count: number; bytes: number } {
    return this.usage;
  }

  isStored(reciter: string, surah: number): boolean {
    return this.stored.some((track) => track.reciter === reciter && track.surah === surah);
  }

  entry(reciter: string, surah: number): DownloadEntry {
    return this.entries.get(trackKey(reciter, surah)) || emptyEntry(reciter, surah);
  }

  async refresh(): Promise<void> {
    try {
      this.stored = await listTracks();
      this.usage = await storageUsage();
    } catch {
      this.stored = [];
      this.usage = { count: 0, bytes: 0 };
    }
    this.ready = true;
    this.emit();
  }

  private set(key: string, patch: Partial<DownloadEntry>) {
    const current = this.entries.get(key);
    if (!current) return;
    this.entries.set(key, { ...current, ...patch });
    this.emit();
  }

  start(reciter: string, surah: number): void {
    const key = trackKey(reciter, surah);
    const existing = this.entries.get(key);
    if (existing && (existing.status === 'downloading' || existing.status === 'queued' || existing.status === 'verifying')) return;
    if (this.isStored(reciter, surah)) return;
    this.entries.set(key, { ...emptyEntry(reciter, surah), status: 'queued' });
    this.queue.push({ reciter, surah });
    this.emit();
    void this.pump();
  }

  startAll(reciter: string, surahs: number[]): void {
    for (const surah of surahs) this.start(reciter, surah);
  }

  cancel(reciter: string, surah: number): void {
    const key = trackKey(reciter, surah);
    this.queue = this.queue.filter((item) => trackKey(item.reciter, item.surah) !== key);
    const controller = this.controllers.get(key);
    if (controller) controller.abort();
    const current = this.entries.get(key);
    if (current && current.status !== 'done') {
      this.set(key, { status: 'cancelled', error: 'Download stopped. Tap download to resume.' });
    }
  }

  async remove(reciter: string, surah: number): Promise<void> {
    const key = trackKey(reciter, surah);
    await deleteTrack(key);
    await deletePartial(key).catch(() => undefined);
    this.entries.delete(key);
    await this.refresh();
  }

  private async pump(): Promise<void> {
    if (!this.ready) await this.refresh();
    while (this.active < CONCURRENCY && this.queue.length) {
      const next = this.queue.shift();
      if (!next) break;
      this.active += 1;
      void this.run(next.reciter, next.surah).finally(() => {
        this.active -= 1;
        void this.pump();
      });
    }
  }

  private async run(reciter: string, surah: number): Promise<void> {
    const key = trackKey(reciter, surah);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.set(key, { status: 'verifying', received: 0, total: 0, error: '', resumed: false });

    try {
      /* Verify the source with a real request before storing anything. */
      const info = await fetchTrackInfo(reciter, surah);
      if (!info.available) {
        this.set(key, { status: 'error', error: info.reason || 'This surah is not available from the source right now.' });
        return;
      }

      let offset = 0;
      let chunks: BlobPart[] = [];
      try {
        const partial = await getPartial(key);
        if (partial && partial.blob.size > 0) {
          chunks = [partial.blob];
          offset = partial.blob.size;
        }
      } catch {
        offset = 0;
      }

      this.set(key, { status: 'downloading', received: offset, total: info.bytes || 0, resumed: offset > 0 });

      const headers: Record<string, string> = {};
      if (offset > 0) headers.Range = `bytes=${offset}-`;

      const response = await fetch(downloadUrl(reciter, surah), {
        headers,
        signal: controller.signal,
        credentials: 'include',
      });

      if (!response.ok) {
        this.set(key, { status: 'error', error: `The download failed (HTTP ${response.status}).` });
        return;
      }

      /* If the server ignored the Range header, start over from zero. */
      if (offset > 0 && response.status === 200) {
        chunks = [];
        offset = 0;
        this.set(key, { received: 0, resumed: false });
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      const total = contentLength ? contentLength + offset : info.bytes || 0;
      this.set(key, { total });

      if (!response.body) {
        this.set(key, { status: 'error', error: 'This device cannot stream downloads.' });
        return;
      }

      const reader = response.body.getReader();
      let received = offset;
      let lastEmit = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            this.set(key, { received });
          }
        }
      }

      if (total && received < total) {
        /* Incomplete transfer: keep what arrived so the next tap resumes. */
        await savePartial(key, reciter, surah, new Blob(chunks, { type: 'audio/mpeg' }));
        this.set(key, {
          status: 'error',
          received,
          error: `Connection ended early (${Math.round((received / total) * 100)}%). Tap download to resume.`,
        });
        return;
      }

      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      if (blob.size < 1024) {
        this.set(key, { status: 'error', error: 'The downloaded file was empty. Please try again.' });
        return;
      }

      await saveTrack(reciter, surah, blob);
      await deletePartial(key).catch(() => undefined);
      this.set(key, { status: 'done', received: blob.size, total: blob.size, error: '' });
      await this.refresh();
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      if (!aborted) {
        this.set(key, {
          status: 'error',
          error: (err as Error)?.message || 'The download failed. Please try again.',
        });
      }
    } finally {
      this.controllers.delete(key);
    }
  }
}

export const downloads = new DownloadManager();

/** Subscribe a component to the manager's state. */
export function useDownloads(): DownloadManager {
  const [, force] = useState(0);
  useEffect(() => {
    const unsubscribe = downloads.subscribe(() => force((value) => value + 1));
    void downloads.refresh();
    return unsubscribe;
  }, []);
  return downloads;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
