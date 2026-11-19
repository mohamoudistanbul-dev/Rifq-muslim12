import { db, newId, nowIso, auditLog, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';

/**
 * Super Admin bootstrap.
 *
 * The account password is NEVER written in source and never sent to the browser:
 * only a one-way scrypt hash is stored below. If ADMIN_PASSWORD is supplied
 * through Settings → Environment variables it takes priority on first boot.
 * Once the account exists its hash is left alone, so a password changed inside
 * the dashboard stays changed after restarts and redeploys.
 */
const SEEDED_PASSWORD_HASH =
  'scrypt$16384$d8e3d8a3ceb698b422a0d1e4beaad0aa$92f426ab928f91f0e2c87ded48a9b51e845c5025f6f55c04ae7e43e5a88cd1a0d57dbde0580dc73c1803ca00b2ec7ca79c27bb8765bbb98f3a88f1e5a71b5d32';

export const SUPER_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'rifqmuslim@gmail.com')
  .trim()
  .toLowerCase();

export const OFFICIAL_CONTACT = {
  contact_email: 'rifqmuslim@gmail.com',
  contact_phone: '+252612215593',
  whatsapp: '+252612215593',
};

const LEGACY_CONTACT = {
  contact_email: 'mohamoudistanbul@gmail.com',
  contact_phone: '+252-612215593',
  whatsapp: '+252612215593',
};

const DEFAULTS = {
  ...OFFICIAL_CONTACT,
  app_name: 'RIFQ Muslim',
  tagline: 'Your Faith, Your Daily Companion',
  announcement_text: '',
  announcement_active: 'false',
  community_enabled: 'true',
  download_url: '',
};

export function seedSuperAdmin() {
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(SUPER_ADMIN_EMAIL);

  if (!existing) {
    const passHash = process.env.ADMIN_PASSWORD
      ? hashPassword(String(process.env.ADMIN_PASSWORD))
      : SEEDED_PASSWORD_HASH;
    db.prepare(
      `INSERT INTO users (id,email,name,pass_hash,role,verified,lang,theme,prefs,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId(),
      SUPER_ADMIN_EMAIL,
      'Eng Mohamud Yusuf',
      passHash,
      'superadmin',
      1,
      'en',
      'dark',
      '{}',
      nowIso()
    );
    auditLog({ id: null, email: 'system' }, 'admin.seed', `Super Admin account created for ${SUPER_ADMIN_EMAIL}`);
  } else if (existing.role !== 'superadmin' || !existing.verified) {
    db.prepare("UPDATE users SET role = 'superadmin', verified = 1 WHERE id = ?").run(existing.id);
  }

  // Move the previous contact details to the official ones exactly once, so an
  // admin who later edits them is not overwritten on every restart.
  if (getSetting('contact_details_v2') !== 'done') {
    for (const [key, legacy] of Object.entries(LEGACY_CONTACT)) {
      const current = getSetting(key);
      if (current === null || current === legacy) setSetting(key, OFFICIAL_CONTACT[key]);
    }
    setSetting('contact_details_v2', 'done');
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (getSetting(key) === null) setSetting(key, value);
  }
}

export { DEFAULTS as SITE_DEFAULTS };
