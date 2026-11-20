/**
 * On-device storage for downloaded Quran audio.
 *
 * Files are kept as real Blobs in IndexedDB, so a downloaded surah plays with
 * no network at all and survives page reloads and app restarts. Nothing is
 * uploaded back to the server.
 */

export interface StoredTrack {
  key: string;
  reciter: string;
  surah: number;
  size: number;
  mime: string;
  savedAt: string;
}

interface TrackRecord extends StoredTrack {
  blob: Blob;
}

const DB_NAME = 'rifq-quran-audio';
const STORE = 'tracks';
const PARTIALS = 'partials';
const VERSION = 2;

export const trackKey = (reciter: string, surah: number) => `${reciter}:${surah}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Offline storage is not available on this device.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(PARTIALS)) {
        database.createObjectStore(PARTIALS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage could not be opened.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  name: string = STORE
): Promise<T> {
  const database = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(name, mode);
    const request = run(transaction.objectStore(name));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage request failed.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

function strip(record: TrackRecord): StoredTrack {
  return {
    key: record.key,
    reciter: record.reciter,
    surah: record.surah,
    size: record.size,
    mime: record.mime,
    savedAt: record.savedAt,
  };
}

export async function saveTrack(reciter: string, surah: number, blob: Blob): Promise<StoredTrack> {
  const record: TrackRecord = {
    key: trackKey(reciter, surah),
    reciter,
    surah,
    size: blob.size,
    mime: blob.type || 'audio/mpeg',
    savedAt: new Date().toISOString(),
    blob,
  };
  await withStore('readwrite', (store) => store.put(record));
  return strip(record);
}

export async function listTracks(): Promise<StoredTrack[]> {
  const records = await withStore<TrackRecord[]>('readonly', (store) => store.getAll());
  return (records || []).map(strip).sort((a, b) => a.surah - b.surah || a.reciter.localeCompare(b.reciter));
}

export async function getTrackBlob(key: string): Promise<Blob | null> {
  const record = await withStore<TrackRecord | undefined>('readonly', (store) => store.get(key));
  return record?.blob || null;
}

export async function deleteTrack(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key));
}

export async function clearTracks(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}

/**
 * Partial downloads are kept separately so an interrupted transfer can be
 * resumed from the byte offset already on disk instead of starting over.
 */
export async function savePartial(reciter: string, surah: number, blob: Blob): Promise<void> {
  await withStore(
    'readwrite',
    (store) =>
      store.put({
        key: trackKey(reciter, surah),
        reciter,
        surah,
        size: blob.size,
        blob,
      }),
    PARTIALS
  );
}

export async function getPartial(key: string): Promise<{ key: string; size: number; blob: Blob } | null> {
  const record = await withStore<{ key: string; size: number; blob: Blob } | undefined>(
    'readonly',
    (store) => store.get(key),
    PARTIALS
  );
  return record || null;
}

export async function deletePartial(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key), PARTIALS);
}

export async function storageUsage(): Promise<{ count: number; bytes: number }> {
  const tracks = await listTracks();
  return { count: tracks.length, bytes: tracks.reduce((sum, track) => sum + track.size, 0) };
}
