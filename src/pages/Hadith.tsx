import { useCallback, useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { get, ApiError } from '../lib/api';
import PremiumGate from '../components/PremiumGate';

/**
 * Hadith browser for the six canonical collections.
 *
 * Every field shown here comes from the hadith-api dataset (see
 * server/hadith.js). Nothing is generated in the client: when the dataset has
 * no Somali edition, the item says so instead of showing invented text.
 *
 * Layout note: this screen is styled entirely from the RIFQ design tokens
 * (src/screens.css). It previously used an inline `var(--card, #fff)` fallback
 * with inherited text colour, which rendered white cards with invisible text
 * in the dark theme.
 */

const BOOKMARK_KEY = 'rifq.hadith.bookmarks.v1';

interface Collection {
  key: string;
  name: string;
  arabicName: string;
  order: number;
}

interface Grade {
  grade: string;
  scholar: string;
}

interface HadithItem {
  number: number;
  arabic: string;
  english: string;
  somali: string;
  book: number | null;
  section: string;
  grades: Grade[];
}

interface CollectionResponse {
  collection: string;
  collectionKey: string;
  arabicName: string;
  total: number;
  page: number;
  pages: number;
  somaliAvailable: boolean;
  englishAvailable: boolean;
  sections: { number: number; name: string }[];
  items: HadithItem[];
  source: string;
}

interface DailyResponse extends HadithItem {
  collection: string;
  collectionKey: string;
  arabicName: string;
  source: string;
}

interface SearchHit extends HadithItem {
  collection: string;
  collectionKey: string;
}

interface SearchResponse {
  matches: SearchHit[];
  count: number;
  truncated: boolean;
  failures: string[];
  source: string;
}

interface SavedHadith {
  collectionKey: string;
  collection: string;
  number: number;
  arabic: string;
  english: string;
  section: string;
  savedAt: number;
}

function readSaved(): SavedHadith[] {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SavedHadith[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(list: SavedHadith[]) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

function Item({
  item,
  collection,
  collectionKey,
  saved,
  onToggleSave,
}: {
  item: HadithItem;
  collection: string;
  collectionKey: string;
  saved: boolean;
  onToggleSave: () => void;
}) {
  return (
    <article className="card hadith-card">
      <div className="hadith-head">
        <span className="badge-gold">{collection}</span>
        <span className="badge-soft">No. {item.number}</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove hadith ${item.number} from saved` : `Save hadith ${item.number}`}
        >
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>

      <p className="hadith-arabic" dir="rtl" lang="ar">
        {item.arabic}
      </p>

      {item.english ? (
        <p className="hadith-text" lang="en">
          {item.english}
        </p>
      ) : (
        <p className="hadith-missing">English translation is not available in the dataset for this hadith.</p>
      )}

      {item.somali ? (
        <p className="hadith-somali" lang="so">
          {item.somali}
        </p>
      ) : null}

      {item.section ? (
        <p className="hadith-ref tiny muted">
          Book {item.book} · {item.section}
        </p>
      ) : null}

      {item.grades.length ? (
        <div className="hadith-grades">
          {item.grades.map((g, i) => (
            <span key={`${g.scholar}-${i}`} className="hadith-grade">
              {g.grade}
              {g.scholar ? ` — ${g.scholar}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function Hadith() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeKey, setActiveKey] = useState('bukhari');
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [page, setPage] = useState(1);
  const [section, setSection] = useState<number | ''>('');
  const [tab, setTab] = useState<'daily' | 'read' | 'search' | 'saved'>('daily');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gate, setGate] = useState(false);
  const [saved, setSaved] = useState<SavedHadith[]>(() => readSaved());

  useEffect(() => {
    get<{ collections: Collection[] }>('/hadith/collections')
      .then((r) => setCollections([...r.collections].sort((a, b) => a.order - b.order)))
      .catch(() => setCollections([]));
    get<DailyResponse>('/hadith/daily')
      .then(setDaily)
      .catch(() => setDaily(null));
  }, []);

  const loadCollection = useCallback(async (key: string, pageNo: number, sectionNo: number | '') => {
    setLoading(true);
    setError('');
    setGate(false);
    try {
      const params = new URLSearchParams({ page: String(pageNo), pageSize: '20' });
      if (sectionNo !== '') params.set('section', String(sectionNo));
      const r = await get<CollectionResponse>(`/hadith/${key}?${params.toString()}`);
      setData(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setGate(true);
        setError('');
        setData(null);
      } else {
        setError(err instanceof Error ? err.message : 'This collection could not be loaded.');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'read') return;
    void loadCollection(activeKey, page, section);
  }, [tab, activeKey, page, section, loadCollection]);

  const isSaved = (collectionKey: string, number: number) =>
    saved.some((s) => s.collectionKey === collectionKey && s.number === number);

  const toggleSave = (collectionKey: string, collection: string, item: HadithItem) => {
    setSaved((current) => {
      const exists = current.some((s) => s.collectionKey === collectionKey && s.number === item.number);
      const next = exists
        ? current.filter((s) => !(s.collectionKey === collectionKey && s.number === item.number))
        : [
            {
              collectionKey,
              collection,
              number: item.number,
              arabic: item.arabic,
              english: item.english,
              section: item.section,
              savedAt: Date.now(),
            },
            ...current,
          ].slice(0, 200);
      writeSaved(next);
      return next;
    });
  };

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setError('Type at least two characters to search.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await get<SearchResponse>(`/hadith/search/query?q=${encodeURIComponent(q)}`);
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const activeCollection = useMemo(
    () => collections.find((c) => c.key === activeKey) || null,
    [collections, activeKey]
  );

  return (
    <Page title="Hadith">
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Six canonical collections — Arabic text with published translations, references and gradings.
      </p>

      <div className="chips" style={{ marginBottom: 14 }}>
        {(
          [
            ['daily', 'Daily'],
            ['read', 'Collections'],
            ['search', 'Search'],
            ['saved', `Saved${saved.length ? ` (${saved.length})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
          >
            {label}
          </button>
        ))}
      </div>

      {gate ? (
        <PremiumGate
          title="This Hadith collection is part of Premium"
          itemTitle={activeKey.replace(/-/g, ' ')}
        />
      ) : null}

      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'daily' ? (
        daily ? (
          <>
            <Item
              item={daily}
              collection={daily.collection}
              collectionKey={daily.collectionKey}
              saved={isSaved(daily.collectionKey, daily.number)}
              onToggleSave={() => toggleSave(daily.collectionKey, daily.collection, daily)}
            />
            <p className="tiny muted">Source: {daily.source}</p>
          </>
        ) : (
          <p className="empty">
            {loading ? 'Loading the hadith of the day…' : 'The hadith of the day is unavailable right now.'}
          </p>
        )
      ) : null}

      {tab === 'read' ? (
        <>
          <div className="row" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <select
              className="select"
              value={activeKey}
              onChange={(e) => {
                setActiveKey(e.target.value);
                setPage(1);
                setSection('');
              }}
              aria-label="Collection"
              style={{ flex: 1, minWidth: 170 }}
            >
              {collections.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={section}
              onChange={(e) => {
                setSection(e.target.value === '' ? '' : Number(e.target.value));
                setPage(1);
              }}
              aria-label="Book"
              style={{ flex: 1, minWidth: 170 }}
            >
              <option value="">All books</option>
              {(data?.sections || []).map((s) => (
                <option key={s.number} value={s.number}>
                  {s.number}. {s.name}
                </option>
              ))}
            </select>
          </div>

          {activeCollection ? (
            <p className="tiny muted" style={{ marginBottom: 10 }}>
              <span className="arabic" lang="ar">
                {activeCollection.arabicName}
              </span>{' '}
              · {data ? `${data.total} hadith` : 'loading…'}
              {data && !data.somaliAvailable ? ' · Somali edition not published for this collection' : ''}
            </p>
          ) : null}

          {loading && !data ? <p className="empty">Loading…</p> : null}

          {(data?.items || []).map((item) => (
            <Item
              key={item.number}
              item={item}
              collection={data?.collection || activeKey}
              collectionKey={data?.collectionKey || activeKey}
              saved={isSaved(data?.collectionKey || activeKey, item.number)}
              onToggleSave={() => toggleSave(data?.collectionKey || activeKey, data?.collection || activeKey, item)}
            />
          ))}

          {data && data.pages > 1 ? (
            <div className="row" style={{ justifyContent: 'center', margin: '14px 0', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1}
              >
                Previous
              </button>
              <span className="small muted">
                Page {data.page} of {data.pages}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={data.page >= data.pages}
              >
                Next
              </button>
            </div>
          ) : null}

          {data ? <p className="tiny muted">Source: {data.source}</p> : null}
        </>
      ) : null}

      {tab === 'search' ? (
        <>
          <div className="row" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
              placeholder="Search Arabic or English text, or a hadith number"
              aria-label="Search hadith"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void runSearch()} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {results ? (
            <>
              <p className="tiny muted">
                {results.count} match{results.count === 1 ? '' : 'es'}
                {results.truncated ? ' (first 60 shown)' : ''}
                {results.failures.length ? ` · ${results.failures.length} collection(s) unavailable` : ''}
              </p>
              {results.matches.map((m) => (
                <Item
                  key={`${m.collectionKey}-${m.number}`}
                  item={m}
                  collection={m.collection}
                  collectionKey={m.collectionKey}
                  saved={isSaved(m.collectionKey, m.number)}
                  onToggleSave={() => toggleSave(m.collectionKey, m.collection, m)}
                />
              ))}
              {results.count === 0 ? <p className="empty">No hadith matched that search.</p> : null}
            </>
          ) : (
            <p className="empty">Search runs across all six collections on the server.</p>
          )}
        </>
      ) : null}

      {tab === 'saved' ? (
        saved.length ? (
          saved.map((s) => (
            <Item
              key={`${s.collectionKey}-${s.number}`}
              item={{
                number: s.number,
                arabic: s.arabic,
                english: s.english,
                somali: '',
                book: null,
                section: s.section,
                grades: [],
              }}
              collection={s.collection}
              collectionKey={s.collectionKey}
              saved
              onToggleSave={() =>
                toggleSave(s.collectionKey, s.collection, {
                  number: s.number,
                  arabic: s.arabic,
                  english: s.english,
                  somali: '',
                  book: null,
                  section: s.section,
                  grades: [],
                })
              }
            />
          ))
        ) : (
          <p className="empty">No saved hadith yet. Use the ☆ Save button on any hadith.</p>
        )
      ) : null}
    </Page>
  );
}
