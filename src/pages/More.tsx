import React from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Shell';
import { AppIcon, type IconName } from '../components/Icons';
import { useStore } from '../lib/store';
import { startApkDownload } from '../lib/download';

interface Item {
  to: string;
  icon: IconName;
  label: string;
  desc: string;
  authOnly?: boolean;
}

interface Group {
  title: string;
  items: Item[];
}

/**
 * Every section of the app stays reachable from the More menu. Groups only
 * organise the same items; nothing that existed before has been removed.
 */
const GROUPS: Group[] = [
  {
    title: 'Worship',
    items: [
      { to: '/quran/audio', icon: 'play', label: 'Quran Audio', desc: 'Listen and download surahs' },
      { to: '/qibla', icon: 'compass', label: 'Qibla', desc: 'Direction to the Kaaba' },
      { to: '/duas', icon: 'heart', label: 'Duas', desc: 'Adhkar for every moment' },
      { to: '/hadith', icon: 'book', label: 'Hadith', desc: 'Six authentic collections' },
      { to: '/calendar', icon: 'calendar', label: 'Calendar', desc: 'Hijri dates and Ramadan' },
      { to: '/athan', icon: 'bell', label: 'Athan', desc: 'Notifications and sound' },
      { to: '/tracker', icon: 'check', label: 'Tracker', desc: 'Worship and daily goals' },
    ],
  },
  {
    title: 'Learn and explore',
    items: [
      { to: '/bookmarks', icon: 'bookmark', label: 'Bookmarks', desc: 'Your saved verses' },
      { to: '/quiz', icon: 'star', label: 'Quiz', desc: 'Test your knowledge' },
      { to: '/zakat', icon: 'chart', label: 'Zakat', desc: 'Nisab calculator' },
      { to: '/places', icon: 'mosque', label: 'Mosques & Halal', desc: 'Nearby places' },
      { to: '/kids', icon: 'kids', label: 'Kids Academy', desc: 'Learning for children' },
      { to: '/hajj', icon: 'kaaba', label: 'Hajj & Umrah', desc: 'Step-by-step guide' },
    ],
  },
  {
    title: 'Community and account',
    items: [
      { to: '/assistant', icon: 'chat', label: 'Assistant', desc: 'Ask with references' },
      { to: '/community', icon: 'globe', label: 'Community', desc: 'Moderated discussion' },
      { to: '/invite', icon: 'gift', label: 'Invite Friends', desc: 'Share RIFQ Muslim' },
      { to: '/contact', icon: 'mail', label: 'Contact', desc: 'Reach the developer' },
      { to: '/settings', icon: 'settings', label: 'Settings', desc: 'Language, theme, audio' },
      { to: '/profile', icon: 'user', label: 'Profile', desc: 'Your account', authOnly: true },
      { to: '/about', icon: 'star', label: 'About RIFQ Muslim', desc: 'Version and credits' },
      { to: '/privacy', icon: 'shield', label: 'Privacy', desc: 'How data is handled' },
    ],
  },
];

export default function More() {
  const { t, user, theme, toggleTheme, lang, setLang } = useStore();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin');

  return (
    <Page title="More" subtitle={t('Everything else in RIFQ Muslim')} back={false}>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div>
          <p className="small" style={{ margin: 0 }}>{user ? user.name : t('Guest mode')}</p>
          <p className="tiny muted" style={{ margin: 0 }}>
            {user ? user.email : t('Sign in to sync your worship records')}
          </p>
        </div>
        <div className="btn-row">
          <button
            className="btn btn-soft btn-sm"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
          >
            <AppIcon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
          <select
            className="select"
            aria-label={t('Language')}
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'ar' | 'so')}
            style={{ width: 'auto', padding: '8px 10px' }}
          >
            <option value="en">EN</option>
            <option value="ar">ع</option>
            <option value="so">SO</option>
          </select>
        </div>
      </div>

      {!user && (
        <div className="btn-row">
          <Link to="/login" className="btn btn-primary" style={{ flex: 1 }}>{t('Sign in')}</Link>
          <Link to="/register" className="btn btn-soft" style={{ flex: 1 }}>{t('Create account')}</Link>
        </div>
      )}

      {/* Primary actions: always visible, on every screen size. */}
      <div className="menu-cta">
        <Link to="/design" className="menu-cta-tile design">
          <AppIcon name="design" size={22} />
          <span className="menu-cta-label">{t('Design')}</span>
          <span className="menu-cta-desc">{t('Appearance and branding')}</span>
        </Link>
        {/* Admin is private: ordinary users never see this entry. The owner
            signs in at /admin, which renders the secure login until an
            admin session exists — the API rejects everything else. */}
        {isAdmin && (
          <Link to="/admin" className="menu-cta-tile admin">
            <AppIcon name="dashboard" size={22} />
            <span className="menu-cta-label">{t('Admin')}</span>
            <span className="menu-cta-desc">{t('Dashboard open')}</span>
          </Link>
        )}
        <Link to="/support" className="menu-cta-tile support">
          <AppIcon name="support" size={22} />
          <span className="menu-cta-label">{t('Support')}</span>
          <span className="menu-cta-desc">{t('WhatsApp and email')}</span>
        </Link>
      </div>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 10 }}
        onClick={() => startApkDownload()}
      >
        <AppIcon name="download" size={17} /> {t('DOWNLOAD RIFQ MUSLIM')}
      </button>

      {GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.authOnly || user);
        if (!items.length) return null;
        return (
          <section key={group.title} style={{ marginTop: 18 }}>
            <div className="section-title">
              <h2>{t(group.title)}</h2>
            </div>
            <div className="menu-grid">
              {items.map((item) => (
                <Link key={item.to} to={item.to} className="menu-tile">
                  <span className="tile-icon"><AppIcon name={item.icon} size={19} /></span>
                  <span className="menu-tile-label">{t(item.label)}</span>
                  <span className="menu-tile-desc">{t(item.desc)}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <p className="tiny muted center" style={{ marginTop: 18 }}>
        RIFQ Muslim v1.0.0 · {t('Made by Eng Mohamud Yusuf')}
      </p>
    </Page>
  );
}
