/**
 * RIFQ Muslim — mobile touch behaviour guard.
 *
 * A real Android app never offers the browser's long-press menu on its own
 * navigation, buttons, tabs, icons or cards. This module suppresses that menu
 * (and the drag-to-download behaviour that follows it) for interactive
 * surfaces only, so reading content — Quran verses, translations, hadith and
 * duas — keeps normal text selection and copy.
 *
 * Nothing here claims to remove Chrome's own browser interface (address bar,
 * tab strip, overflow menu). It only stops the in-page context menu that a
 * long press would otherwise raise over the app's own controls.
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
  '.zoom-btn',
  '.card',
].join(',');

/** Text the user is allowed to select and copy. */
const SELECTABLE = [
  '[data-selectable]',
  '.arabic',
  '.arabic-lg',
  '.quran-text',
  '.ayah-text',
  '.translation',
  '[dir="rtl"]',
].join(',');

/** Form fields keep the native selection menu (copy, paste, autofill). */
const EDITABLE = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, [contenteditable="true"]';

/** Labels inside a real link/button are navigation, not reading content. */
const NAV_OWNER = 'a[href], button, [role="button"], .nav-item, .icon-btn, .chip';

function isSelectableReading(target: Element): boolean {
  const text = target.closest(SELECTABLE);
  if (!text) return false;
  return !text.closest(NAV_OWNER);
}

/**
 * Cards are only treated as controls when they actually are one: a link, a
 * role="button", or a card the app styled as clickable (cursor: pointer).
 * A plain content card therefore keeps its selectable text.
 */
function isInteractive(target: Element): boolean {
  const el = target.closest(INTERACTIVE);
  if (!el) return false;
  if (el.matches('.card') && !el.matches('a, button, [role="button"]')) {
    return window.getComputedStyle(el).cursor === 'pointer';
  }
  return true;
}

function onContextMenu(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(EDITABLE)) return;
  if (isSelectableReading(target)) return;
  if (!isInteractive(target)) return;
  event.preventDefault();
  event.stopPropagation();
}

/** Stops "Download image" / drag-the-link-to-the-tab-strip behaviour. */
function onDragStart(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (isSelectableReading(target)) return;
  if (target.closest('a[href], img, .icon-btn, .nav-item, .brand-logo')) {
    event.preventDefault();
  }
}

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
  doc.addEventListener('dragstart', onDragStart, { capture: true });
}

/** Exposed for tests. */
export const __touchGuardInternals = { isInteractive, isSelectableReading };
