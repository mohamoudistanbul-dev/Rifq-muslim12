import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { get, put } from '../lib/api';
import { useStore } from '../lib/store';

/**
 * Design — appearance and branding control for the RIFQ Muslim Super Admin.
 *
 * Every value here is persisted through the real admin settings API
 * (`GET/PUT /api/admin/settings`) and published to the live app by
 * `GET /api/config`, so a saved change is visible to every visitor.
 * Server-side guards still decide who may write: only a Super Admin can save.
 */

type Settings = Record<string, string>;

const BRAND_FIELDS: { key: string; label: string; hint: string; placeholder?: string }[] = [
  { key: 'app_name', label: 'Application name', hint: 'Shown in the header, notifications and About.' },
  { key: 'tagline', label: 'Tagline', hint: 'The line under the RIFQ Muslim name.' },
];

const CONTENT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'download_url', label: 'Official download / invite URL', hint: 'Must start with http:// or https://. Used by Invite Friends.' },
];

const CONTACT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'contact_email', label: 'Support email', hint: 'Used by Contact and Support.' },
  { key: 'contact_phone', label: 'Support phone', hint: 'Used by the call button.' },
  { key: 'whatsapp', label: 'WhatsApp number', hint: 'Used by the direct WhatsApp chat button.' },
];

export default function Design() {
  const { t, user, theme, toggleTheme, lang, setLang, toast } = useStore();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin');
  const isSuper = user?.role === 'superadmin';

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    setLoading(true);
    get<{ settings: Settings }>('/admin/settings')
      .then((res) => {
        if (!alive) return;
        setSettings(res.settings || {});
        setError('');
      })
      .catch((err) => {
        if (alive) setError(err?.message || t('Could not load the design settings.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: string, value: string) =>
    setSettings((prev) => ({ ...(prev || {}), [key]: value }));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await put<{ settings: Settings }>('/admin/settings', settings);
      setSettings(res.settings || settings);
      setError('');
      toast(t('Design settings published to the live app.'), 'success');
    } catch (err: any) {
      setError(err?.message || t('Could not save the design settings.'));
      toast(t('Could not save the design settings.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <Page title="Design" subtitle={t('Appearance and branding')}>
        <div className="card gold-edge">
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className="tile-icon"><AppIcon name="lock" size={18} /></span>
            <div>
              <strong style={{ display: 'block' }}>{t('Administrator access required')}</strong>
              <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
                {t('Design controls the live application branding. Sign in with the Super Admin account to continue.')}
              </p>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Link to="/admin" className="btn btn-primary" style={{ flex: 1 }}>
              <AppIcon name="shield" size={16} /> {t('Go to admin sign-in')}
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  if (!isAdmin) {
    return (
      <Page title="Design" subtitle={t('Appearance and branding')}>
        <div className="card">
          <strong style={{ display: 'block' }}>{t('This area is for administrators')}</strong>
          <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
            {t('Your account does not have design permissions. The dashboard owner can grant access.')}
          </p>
          <Link to="/more" className="btn btn-soft" style={{ marginTop: 12 }}>{t('Back to menu')}</Link>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Design" subtitle={t('Appearance and branding')}>
      <div className="card hero">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="badge-gold">{t('Live preview')}</span>
            <h2 style={{ margin: '8px 0 2px', fontFamily: 'var(--font-display)', fontSize: 22 }}>
              {settings?.app_name || 'RIFQ Muslim'}
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              {settings?.tagline || t('Your Faith, Your Daily Companion')}
            </p>
          </div>
          <span className="tile-icon"><AppIcon name="design" size={20} /></span>
        </div>
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          {t('Made by Eng Mohamud Yusuf')}
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>{t('Theme and language')}</h2>
        </div>
        <div className="btn-row">
          <button
            className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => theme !== 'light' && toggleTheme()}
          >
            <AppIcon name="sun" size={16} /> {t('Light')}
          </button>
          <button
            className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => theme !== 'dark' && toggleTheme()}
          >
            <AppIcon name="moon" size={16} /> {t('Dark')}
          </button>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="design-lang">{t('Default language')}</label>
          <select
            id="design-lang"
            className="select"
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'ar' | 'so')}
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="so">Somali</option>
          </select>
        </div>
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          {t('The emerald and gold identity is preserved in both themes.')}
        </p>
      </div>

      {loading && <div className="card"><p className="small muted" style={{ margin: 0 }}>{t('Loading design settings…')}</p></div>}

      {error && (
        <div className="card" role="alert">
          <p className="small" style={{ margin: 0, color: '#f0a29b' }}>{error}</p>
        </div>
      )}

      {settings && (
        <>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              <h2>{t('Branding')}</h2>
            </div>
            {BRAND_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`design-${f.key}`}>{t(f.label)}</label>
                <input
                  id={`design-${f.key}`}
                  className="input"
                  value={settings[f.key] ?? ''}
                  onChange={(e) => update(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
                <p className="tiny muted" style={{ margin: '4px 0 0' }}>{t(f.hint)}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              <h2>{t('Announcement banner')}</h2>
            </div>
            <div className="field">
              <label htmlFor="design-announcement">{t('Announcement text')}</label>
              <textarea
                id="design-announcement"
                className="input"
                rows={3}
                value={settings.announcement_text ?? ''}
                onChange={(e) => update('announcement_text', e.target.value)}
                placeholder={t('Shown on the Home screen when published.')}
              />
            </div>
            <label className="row" style={{ gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={settings.announcement_active === 'true'}
                onChange={(e) => update('announcement_active', e.target.checked ? 'true' : 'false')}
              />
              <span className="small">{t('Publish the announcement on the live app')}</span>
            </label>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              <h2>{t('Contact and sharing')}</h2>
            </div>
            {[...CONTACT_FIELDS, ...CONTENT_FIELDS].map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`design-${f.key}`}>{t(f.label)}</label>
                <input
                  id={`design-${f.key}`}
                  className="input"
                  value={settings[f.key] ?? ''}
                  onChange={(e) => update(f.key, e.target.value)}
                />
                <p className="tiny muted" style={{ margin: '4px 0 0' }}>{t(f.hint)}</p>
              </div>
            ))}
            <label className="row" style={{ gap: 10, alignItems: 'center', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={settings.community_enabled !== 'false'}
                onChange={(e) => update('community_enabled', e.target.checked ? 'true' : 'false')}
              />
              <span className="small">{t('Community section enabled')}</span>
            </label>
          </div>

          <div className="btn-row">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving || !isSuper}>
              <AppIcon name="check" size={16} />
              {saving ? t('Publishing…') : t('Publish design changes')}
            </button>
            <Link to="/admin" className="btn btn-soft">{t('Full dashboard')}</Link>
          </div>

          {!isSuper && (
            <p className="tiny muted center">
              {t('Only the Super Admin can publish design changes.')}
            </p>
          )}
        </>
      )}
    </Page>
  );
}
