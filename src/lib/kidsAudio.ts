/**
 * Kid Academy audio.
 *
 * Two genuinely different sources, both real:
 *
 *  - Short-surah lessons play the published recitation stream that the Quran
 *    Audio feature already uses (cdn.islamic.network), so a child hears the
 *    actual surah rather than a synthesised approximation.
 *  - Arabic letters and story read-aloud use the device's own speech engine,
 *    because no verified per-letter recording ships with the app. When the
 *    device has no Arabic voice this module reports that instead of pretending
 *    to play something.
 *
 * The player is a module-level singleton: navigating between lessons does not
 * destroy the <audio> element, so playback continues across screens and the
 * queue can advance to the next surah on its own.
 */

const RECITATION_BASE = 'https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy';

/** Published recitation stream for one surah (same source as Quran Audio). */
export function surahAudioUrl(surah: number): string {
  return `${RECITATION_BASE}/${surah}.mp3`;
}

export interface Track {
  src: string;
  title: string;
  surah?: number;
}

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  track: Track | null;
  error: string;
}

type Listener = (state: PlaybackState) => void;

let audio: HTMLAudioElement | null = null;
let queue: Track[] = [];
let queueIndex = -1;
let state: PlaybackState = { status: 'idle', track: null, error: '' };
const listeners = new Set<Listener>();

function emit(next: Partial<PlaybackState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = 'none';
  el.addEventListener('playing', () => emit({ status: 'playing', error: '' }));
  el.addEventListener('waiting', () => {
    if (state.status === 'playing' || state.status === 'loading') emit({ status: 'loading' });
  });
  el.addEventListener('pause', () => {
    // An error already explains the stop; do not overwrite it with "paused".
    if (state.status === 'error') return;
    if (el.currentTime > 0 && !el.ended) emit({ status: 'paused' });
  });
  el.addEventListener('ended', () => {
    if (queueIndex + 1 < queue.length) {
      void playAt(queueIndex + 1);
      return;
    }
    emit({ status: 'idle' });
  });
  el.addEventListener('error', () =>
    emit({
      status: 'error',
      error: 'The recitation could not be played. Check your connection and try again.',
    })
  );
  audio = el;
  return el;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function currentState(): PlaybackState {
  return state;
}

async function playAt(index: number): Promise<void> {
  const track = queue[index];
  if (!track) return;
  queueIndex = index;
  const el = element();
  el.src = track.src;
  el.currentTime = 0;
  emit({ status: 'loading', track, error: '' });
  try {
    await el.play();
  } catch {
    emit({
      status: 'error',
      track,
      error: 'Playback was blocked. Tap play again, or check that the device is not muted.',
    });
  }
}

/** Play one track, replacing the queue. */
export async function playTrack(track: Track): Promise<void> {
  queue = [track];
  await playAt(0);
}

/** Play a list continuously, starting at `startIndex`. */
export async function playQueue(tracks: Track[], startIndex = 0): Promise<void> {
  if (!tracks.length) return;
  queue = [...tracks];
  await playAt(Math.max(0, Math.min(startIndex, tracks.length - 1)));
}

/** Play/pause the current track (or start the first queued track). */
export async function toggle(): Promise<void> {
  const el = audio;
  if (!el || !state.track) {
    if (queue.length) await playAt(Math.max(0, queueIndex));
    return;
  }
  if (state.status === 'playing' || state.status === 'loading') {
    el.pause();
    emit({ status: 'paused' });
    return;
  }
  try {
    await el.play();
  } catch {
    emit({ status: 'error', error: 'Playback could not resume. Tap play to try again.' });
  }
}

/** Skip to the next queued surah, if any. */
export async function next(): Promise<void> {
  if (queueIndex + 1 < queue.length) await playAt(queueIndex + 1);
}

/** Hard stop: silence, rewind and clear the queue. */
export function stop(): void {
  const el = audio;
  queue = [];
  queueIndex = -1;
  if (el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  emit({ status: 'idle', track: null, error: '' });
}

/* ------------------------------ device speech ------------------------------ */

let voiceLoad: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length) return Promise.resolve(existing);
  if (voiceLoad) return voiceLoad;
  voiceLoad = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
  return voiceLoad;
}

export class SpeechUnavailable extends Error {
  reason: 'unsupported' | 'no-arabic-voice' | 'failed';
  constructor(reason: 'unsupported' | 'no-arabic-voice' | 'failed') {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Speak text with the device voice. Resolves when speech finishes.
 * Throws SpeechUnavailable so the UI can explain the real cause.
 */
export async function speak(text: string, lang = 'ar-SA'): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    throw new SpeechUnavailable('unsupported');
  }
  const synth = window.speechSynthesis;
  const voices = await loadVoices();
  const prefix = lang.split('-')[0].toLowerCase();
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (prefix === 'ar' && !voice) throw new SpeechUnavailable('no-arabic-voice');

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || lang;
  utterance.rate = 0.8;

  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new SpeechUnavailable('failed'));
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* nothing to cancel */
  }
}
