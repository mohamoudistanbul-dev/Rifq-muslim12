import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Loading, ErrorBox } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get, post, local } from '../lib/api';
import type { SurahData } from './Quran';

/**
 * Translations.
 *
 * Kept separate from the Mushaf reading screen on purpose: the reading screen is
 * Arabic only, and translations, sharing and study belong here. The Arabic text
 * shown beside each translation is the same verified Uthmani edition.
 */

export const TRANSLATIONS = [
  { id: 'en.sahih', label: 'English — Saheeh International' },
  { id: 'en.pickthall', label: 'English — Pickthall' },
  { id: 'so.abduh', label: 'Somali — Abduh' },
  { id: 'fr.hamidullah', label: 'French — Hamidullah' },
  { id: 'tr.diyanet', label: 'Turkish — Diyanet' },
];

export default function QuranTranslation() {
  const { number } = useParams();
  const surahNumber = Math.min(114, Math.max(1, Number(number) || 1));
  const { t, user, toast } = useStore();
  const [data, setData] = useState<SurahData | null>(null);
  const [error, setError] = useState('');
  const [translation, setTranslation] = useState(() => local.get('translation', 'en.sahih'));
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  const load = () => {
    setError('');
    get<SurahData>(`/quran/surah/${surahNumber}?translation=${translation}`)
      .then((res) => {
        setData(res);
        local.set(`surah.${surahNumber}.${translation}`, res);
      })
      .catch(() => {
        const cached = local.get<SurahData | null>(`surah.${surahNumber}.${translation}`, null);
        if (cached) {
          setData(cached);
          setError(t('Offline copy — saved on this device.'));
        } else {
          setError(t('This translation could not be loaded. Check your connection and retry.'));
        }
      });
  };

  useEffect(load, [surahNumber, translation]);

  useEffect(() => {
    local.set('translation', translation);
  }, [translation]);

  useEffect(() => {
    if (!user) {
      setSaved({});
      return;
    }
    let alive = true;
    get<{ bookmarks: { kind: string; ref: string }[] }>('/bookmarks')
      .then((res) => {
        if (!alive) return;
        const next: Record<number, boolean> = {};
        for (const bookmark of res.bookmarks || []) {
          if (bookmark.kind !== 'quran') continue;
          const verse = /^quran:(\d+):(\d+)$/.exec(bookmark.ref);
          if (verse && Number(verse[1]) === surahNumber) next[Number(verse[2])] = true;
        }
        setSaved(next);
      })
      .catch(() => {
        /* bookmarks are optional here */
      });
    return () => {
      alive = false;
    };
  }, [user, surahNumber]);

  const toggleBookmark = async (ayahNo: number) => {
    if (!user) return toast(t('Sign in to save bookmarks'), 'error');
    try {
      const res = await post<{ removed?: boolean }>('/bookmarks', {
        kind: 'quran',
        ref: `quran:${surahNumber}:${ayahNo}`,
        surah: surahNumber,
        ayah: ayahNo,
        label: `${data?.englishName} ${surahNumber}:${ayahNo}`,
      });
      setSaved((current) => ({ ...current, [ayahNo]: !res.removed }));
      toast(res.removed ? t('Bookmark removed') : t('Bookmark saved'), 'success');
    } catch {
      toast(t('The bookmark could not be saved'), 'error');
    }
  };

  return (
    <Page
      title={data ? `${data.englishName} — ${t('Translations')}` : t('Translations')}
      subtitle={t('Arabic text with translation, study and sharing')}
    >
      <div className="card">
        <div className="field">
          <label>{t('Translation')}</label>
          <select
            className="select"
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
          >
            {TRANSLATIONS.map((tr) => (
              <option key={tr.id} value={tr.id}>{tr.label}</option>
            ))}
          </select>
        </div>
        <Link className="btn btn-soft btn-sm" to={`/quran/${surahNumber}`}>
          <AppIcon name="book" size={15} /> {t('Back to Mushaf reading')}
        </Link>
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <Loading />}

      {data && (
        <div className="stack" style={{ gap: 10 }}>
          {data.ayahs.map((ayah) => (
            <article key={ayah.number} id={`ayah-${ayah.number}`} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="ayah-num">{surahNumber}:{ayah.number}</span>
                <span className="tiny muted">Juz {ayah.juz} · {t('Page')} {ayah.page}</span>
              </div>
              <p className="arabic" data-selectable dir="rtl" lang="ar" style={{ fontSize: 26, lineHeight: 2.1, margin: '10px 0' }}>
                {ayah.text}
              </p>
              <p className="small" data-selectable style={{ margin: 0 }}>{ayah.translation}</p>
              <div className="ayah-actions">
                <button
                  className="icon-btn"
                  onClick={() => void toggleBookmark(ayah.number)}
                  aria-label={t('Bookmark')}
                  aria-pressed={Boolean(saved[ayah.number])}
                >
                  <AppIcon name="bookmark" size={17} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Share')}
                  onClick={() => {
                    const text = `${ayah.text}\n\n${ayah.translation}\n— Quran ${surahNumber}:${ayah.number}`;
                    if (navigator.share) void navigator.share({ title: data.englishName, text });
                    else void navigator.clipboard.writeText(text).then(() => toast(t('Copied'), 'success'));
                  }}
                >
                  <AppIcon name="share" size={17} />
                </button>
                {saved[ayah.number] && (
                  <span className="tiny" style={{ color: 'var(--gold-deep)' }}>{t('Saved')}</span>
                )}
              </div>
            </article>
          ))}
          <p className="tiny muted center">{data.source}</p>
        </div>
      )}
    </Page>
  );
}
