/**
 * Pure Free/Premium access rules.
 *
 * No database and no network here, so the policy can be tested directly. The
 * invariant that matters: whether an item is locked is decided from the stored
 * item row plus the caller's real entitlement — never from anything the client
 * sends.
 */

export const TIERS = ['free', 'premium'];

/** Accept booleans, 0/1 and common strings from admin forms. */
export function boolOf(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

export function normalizeTier(value) {
  const tier = String(value ?? '').trim().toLowerCase();
  return TIERS.includes(tier) ? tier : null;
}

/** Validate and normalise an admin-supplied item. Throws on invalid input. */
export function normalizeItem(input = {}, base = {}) {
  const title = String(input.title ?? base.title ?? '').trim();
  const category = String(input.category ?? base.category ?? 'general').trim().toLowerCase();
  const tier = normalizeTier(input.tier ?? base.tier ?? 'free');
  const description = String(input.description ?? base.description ?? '').trim().slice(0, 400);

  if (!title) throw new Error('A title is required.');
  if (title.length > 120) throw new Error('Keep the title under 120 characters.');
  if (!/^[a-z0-9._-]{2,60}$/.test(category)) {
    throw new Error('Category must be 2-60 characters: lowercase letters, digits, dot, dash or underscore.');
  }
  if (!tier) throw new Error('Tier must be either free or premium.');

  return {
    title,
    category,
    tier,
    description,
    enabled: boolOf(input.enabled ?? base.enabled, true),
    published: boolOf(input.published ?? base.published, true),
  };
}

export function isStaff(role) {
  return role === 'admin' || role === 'superadmin';
}

/**
 * Decide what a caller may do with one item.
 *
 * - disabled  → hidden from everyone, including staff previews of live content
 * - draft     → visible only to staff (preview), never to ordinary users
 * - free      → open to everyone
 * - premium   → open only with a live entitlement; staff keep access so the
 *               owner can always inspect their own content
 */
export function decideAccess(item, { premium = false, role = '' } = {}) {
  if (!item) return { allowed: false, locked: false, visible: false, reason: 'missing' };
  if (!item.enabled) return { allowed: false, locked: false, visible: false, reason: 'disabled' };

  const staff = isStaff(role);

  if (!item.published && !staff) {
    return { allowed: false, locked: false, visible: false, reason: 'unpublished' };
  }
  if (item.tier !== 'premium') {
    return {
      allowed: true,
      locked: false,
      visible: true,
      reason: staff && !item.published ? 'draft_preview' : 'free',
    };
  }
  if (premium) return { allowed: true, locked: false, visible: true, reason: 'premium' };
  if (staff) return { allowed: true, locked: false, visible: true, reason: 'staff' };
  return { allowed: false, locked: true, visible: true, reason: 'premium_required' };
}

/** Counts used by the admin dashboard header. */
export function itemCounts(items = []) {
  const counts = { total: items.length, free: 0, premium: 0, disabled: 0, draft: 0 };
  for (const item of items) {
    if (item.tier === 'premium') counts.premium += 1;
    else counts.free += 1;
    if (!item.enabled) counts.disabled += 1;
    if (!item.published) counts.draft += 1;
  }
  return counts;
}
