/**
 * RIFQ Muslim — mobile touch behaviour guard.
 *
 * A real Android app never offers the browser's long-press menu or the
 * "Copy / Select all / Web search / Google lookup" selection toolbar over its
 * own reading content. This module suppresses both for everything except two
 * deliberate cases:
 *
 *   1. form fields (input, textarea, contenteditable) — copy, paste, autofill;
 *   2. reading text inside a container the app explicitly marked with
 *      `.selection-enabled` (the Quran reader's "Select text" mode).
 *
 * Everything else — Quran verses, translations, hadith, duas, headings, cards —
 * cannot be selected, so a tap or long press cannot raise the system toolbar or
 * send the text to Google.
 *
 * It also keeps the whole screen at one fixed scale. The viewport meta and
 * `touch-action: manipulation` already disable pinch and double-tap zoom in
 * Chrome and Android WebView, but in-app browsers (WhatsApp, Facebook,
 * Telegram) and an accessibility "force enable zoom" setting can ignore the
 * meta. Cancelling a two-finger touch move holds the scale there as well.
 *
 * Nothing here claims to remove Chrome's own browser interface (address bar,
 * tab strip, overflow menu). It only stops the in-page context menu and the
 * selection action mode that a long press would otherwise raise.
 */

/** Surfaces that behave like native controls, not like web links. */
const INTERACTIVE = [
  'a[href]',
  'button',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  'summary',
  'select',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'label.switch',
  'img',
  '.icon-btn',
  '.nav-item',
  '.bottom-nav',
  '.topbar',
  '.chip',
  '.tab',
  '.surah-item',
  '.btn',
  '.qa-reciter-chip',
  '.tasbih-tap',
  '.card',
].join(',');

/** Reading text that may be selected, but only inside `.selection-enabled`. */
const READING_TEXT = [
  '[data-selectable]',
  '.arabic',
  '.arabic-lg',
  '.quran-text',
  '.ayah-text',
  '.translation',
  '[dir="rtl"]',
].join(',');

/** The app's deliberate opt-in scope for selection (Quran reader mode). */
const SELECTION_SCOPE = '.selection-enabled';

/** Form fields always keep the native selection menu. */
const EDITABLE =
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, [contenteditable="true"]';

/** Labels inside a real link/button are navigation, not reading content. */
const NAV_OWNER = 'a[href], button, [role="button"], .nav-item, .icon-btn, .chip';

/**
 * Cards are only treated as controls when they actually are one: a link, a
 * role="button", or a card the app styled as clickable (cursor: pointer).
 */
function isInteractive(target: Element): boolean {
  const el = target.closest(INTERACTIVE);
  if (!el) return false;
  if (el.matches('.card') && !el.matches('a, button, [role="button"]')) {
    return window.getComputedStyle(el).cursor === 'pointer';
  }
  return true;
}

/**
 * The single selection rule for the whole app: a form field, or reading text
 * the user deliberately unlocked. Nothing else is selectable.
 */
function isSelectionAllowed(target: Element): boolean {
  if (target.closest(EDITABLE)) return true;
  const text = target.closest(READING_TEXT);
  if (!text) return false;
  if (text.closest(NAV_OWNER)) return false;
  return Boolean(text.closest(SELECTION_SCOPE));
}

/* ------------------------- native Android bridge ------------------------- */

type NativeBridge = { setTextSelectionAllowed?: (allowed: boolean) => void };

/** Tells the Android shell whether the system selection toolbar may appear. */
function notifyNative(allowed: boolean): void {
  try {
    const bridge = (window as unknown as { RifqNative?: NativeBridge }).RifqNative;
    bridge?.setTextSelectionAllowed?.(allowed);
  } catch {
    /* plain web build: no native shell to inform */
  }
}

let readingSelection = false;
let editableFocused = false;

function syncNative(): void {
  notifyNative(readingSelection || editableFocused);
}

/**
 * Called by the Quran reader when its "Select text" mode changes. The native
 * shell blocks Android's selection action mode unless this (or a focused form
 * field) allows it, so the toolbar cannot appear even if a browser ignores the
 * CSS user-select rules.
 */
export function setReadingSelection(enabled: boolean): void {
  readingSelection = enabled;
  syncNative();
}

/* ----------------------------- event handlers ---------------------------- */

function onContextMenu(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (isSelectionAllowed(target)) return;
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Stops a long press or a drag from starting a text selection in the first
 * place. Chrome for Android builds the Copy / Select all / Web search toolbar
 * from the selection, so with no selection there is no toolbar.
 */
function onSelectStart(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (isSelectionAllowed(target)) return;
  if (event.cancelable) event.preventDefault();
}

/** Stops "Download image" / drag-the-link-to-the-tab-strip behaviour. */
function onDragStart(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (isSelectionAllowed(target)) return;
  if (target.closest('a[href], img, .icon-btn, .nav-item, .brand-logo')) {
    event.preventDefault();
  }
}

/** Keep the native flag in step with focus moving in and out of form fields. */
function onFocusIn(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest(EDITABLE)) return;
  editableFocused = true;
  syncNative();
}

function onFocusOut(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest(EDITABLE)) return;
  editableFocused = false;
  syncNative();
}

/**
 * Two-finger gestures never magnify the app. A single finger is left completely
 * alone, so scrolling, swiping, sliders and taps keep working; cancelling only
 * a multi-touch move is what stops pinch-to-zoom everywhere the viewport meta
 * is ignored.
 */
function onTouchMove(event: TouchEvent): void {
  if (event.touches.length < 2) return;
  if (event.cancelable) event.preventDefault();
}

/** Safari-style gesture events zoom the page as well (future iOS shell). */
function onGesture(event: Event): void {
  if (event.cancelable) event.preventDefault();
}

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];

let installed = false;

/**
 * Installs the guard once per page. Safe to call from a React effect: repeat
 * calls are no-ops, which keeps StrictMode double-mounting from stacking
 * duplicate listeners.
 */
export function installTouchGuard(doc: Document = document): void {
  if (installed) return;
  installed = true;
  doc.addEventListener('contextmenu', onContextMenu, { capture: true });
  doc.addEventListener('selectstart', onSelectStart, { capture: true });
  doc.addEventListener('dragstart', onDragStart, { capture: true });
  doc.addEventListener('focusin', onFocusIn, { capture: true });
  doc.addEventListener('focusout', onFocusOut, { capture: true });
  // passive: false is required: a passive listener cannot cancel the gesture.
  doc.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  for (const gesture of GESTURE_EVENTS) {
    doc.addEventListener(gesture, onGesture, { passive: false });
  }
  syncNative();
}

/** Exposed for tests. */
export const __touchGuardInternals = {
  isInteractive,
  isSelectionAllowed,
  // Older name kept so existing checks keep importing a valid symbol.
  isSelectableReading: isSelectionAllowed,
  onSelectStart,
  onTouchMove,
};
