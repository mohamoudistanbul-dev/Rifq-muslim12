import React, { useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { DUAS, DUA_GROUPS, dailyDua, type Dua, type DuaCategory } from '../lib/duas';
import { post, local } from '../lib/api';

const todayKey = () => new Date().toISOString().slice(0, 10);

function DuaCard({
  dua,
  favorite,
  onFavorite,
  onBookmark,
  onShare,
  highlight,
}: {
  dua: Dua;
  favorite: boolean;
  onFavorite: () => void;
  onBookmark: () => void;
  onShare: () => void;
  highlight?: boolean;
}) {
  const { t } = useStore();
  const group = DUA_GROUPS.find((g) => g.id === dua.category);
  return (
    <article className="card" style={highlight ? { borderColor: 'var(--gold)' } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>{dua.title}</h3>
          <p className="tiny muted" style={{ margin: '2px 0 0' }}>{dua.titleAr}</p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {group && <span className="badge-soft tiny">{group.label}</span>}
          <span className="badge-soft tiny">{dua.repeat}</span>
        </div>
      </div>

      <p className="arabic" dir="rtl" lang="ar" style={{ margin: '12px 0 8px', lineHeight: 2 }}>
        {dua.arabic}
      </p>
      <p className="tiny muted" style={{ margin: 0, fontStyle: 'italic' }}>{dua.transliteration}</p>

      <p className="tiny muted" style={{ margin: '10px 0 2px', letterSpacing: '.06em' }}>{t('English')}</p>
      <p className="small" style={{ margin: 0 }}>{dua.english}</p>

      <p className="tiny muted" style={{ margin: '10px 0 2px', letterSpacing: '.06em' }}>{t('Somali')}</p>
      <p className="small" style={{ margin: 0 }}>{dua.somali}</p>

      <p className="tiny muted" style={{ margin: '10px 0 0' }}>{dua.reference}</p>

      <div className="ayah-actions">
        <button
          className="icon-btn"
          aria-label={t('Favorite')}
          aria-pressed={favorite}
          style={favorite ? { color: 'var(--gold-deep)' } : undefined}
          onClick={onFavorite}
        >
          <AppIcon name={favorite ? 'bookmark' : 'bookmark'} size={17} />
        </button>
        <button className="icon-btn" aria-label={t('Bookmark')} onClick={onBookmark}>
          <AppIcon name="plus" size={17} />
        </button>
        <button className="icon-btn" aria-label={t('Share')} onClick={onShare}>
          <AppIcon name="share" size={17} />
        </button>
        {favorite && <span className="tiny" style={{ color: 'var(--gold-deep)' }}>{t('Saved')}</span>}
      </div>
    </article>
  );
}

export default function Duas() {
  const { t, user, toast } = useStore();
  const [category, setCategory] = useState<DuaCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => local.get<string[]>('duaFavorites', []));

  const daily = dailyDua(todayKey());

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DUAS.filter((d) => {
      if (category !== 'all' && d.category !== category) return false;
      if (onlyFavorites && !favorites.includes(d.id)) return false;
      if (!q) return true;
      return [d.title, d.titleAr, d.transliteration, d.english, d.somali, d.reference, d.arabic].some((f) =>
        f.toLowerCase().includes(q)
      );
    });
  }, [category, query, favorites, onlyFavorites]);

  const toggleFavorite = (dua: Dua) => {
    const on = !favorites.includes(dua.id);
    const next = on ? [...favorites, dua.id] : favorites.filter((x) => x !== dua.id);
    setFavorites(next);
    local.set('duaFavorites', next);
    toast(on ? t('Saved to favorites') : t('Removed from favorites'), 'success');
    if (on && user) void post('/bookmarks', { kind: 'dua', ref: `dua:${dua.id}`, label: dua.title }).catch(() => {});
  };

  const bookmark = async (dua: Dua) => {
    if (!user) return toast(t('Sign in to save bookmarks'), 'error');
    try {
      await post('/bookmarks', { kind: 'dua', ref: `dua:${dua.id}`, label: dua.title });
      toast(t('Bookmark saved'), 'success');
    } catch {
      toast(t('The bookmark could not be saved'), 'error');
    }
  };

  const share = (dua: Dua) => {
    const text = `${dua.arabic}\n\n${dua.english}\n${dua.somali}\n— ${dua.reference}`;
    if (navigator.share) void navigator.share({ title: dua.title, text });
    else void navigator.clipboard.writeText(text).then(() => toast(t('Copied'), 'success'));
  };

  return (
    <Page title="Duas" subtitle={t('16 categories · Arabic, English and Somali with references')}>
      <div className="card">
        <input
          className="input"
          placeholder={t('Search duas by name, meaning or reference')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className={`chip ${onlyFavorites ? 'on' : ''}`} onClick={() => setOnlyFavorites(!onlyFavorites)}>
            {t('Favorites')} ({favorites.length})
          </button>
          <button className={`chip ${category === 'all' ? 'on' : ''}`} onClick={() => setCategory('all')}>
            {t('All')} ({DUAS.length})
          </button>
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {DUA_GROUPS.map((g) => (
            <button
              key={g.id}
              className={`chip ${category === g.id ? 'on' : ''}`}
              onClick={() => setCategory(g.id)}
              title={g.hint}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <h2 className="section-title">{t('Dua of the day')}</h2>
      <DuaCard
        dua={daily}
        highlight
        favorite={favorites.includes(daily.id)}
        onFavorite={() => toggleFavorite(daily)}
        onBookmark={() => void bookmark(daily)}
        onShare={() => share(daily)}
      />

      <h2 className="section-title">
        {category === 'all' ? t('All duas') : DUA_GROUPS.find((g) => g.id === category)?.label} · {list.length}
      </h2>
      {category !== 'all' && (
        <p className="tiny muted" style={{ marginTop: -4 }}>
          {DUA_GROUPS.find((g) => g.id === category)?.hint}
        </p>
      )}

      {list.length === 0 && (
        <div className="empty">
          <p className="small">{t('No dua matches that search.')}</p>
        </div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {list.map((dua) => (
          <DuaCard
            key={dua.id}
            dua={dua}
            favorite={favorites.includes(dua.id)}
            onFavorite={() => toggleFavorite(dua)}
            onBookmark={() => void bookmark(dua)}
            onShare={() => share(dua)}
          />
        ))}
      </div>

      <p className="tiny muted center">
        {t('Every dua carries the reference it is reported in. Repeat counts are shown only where the report states one.')}
      </p>
    </Page>
  );
}
