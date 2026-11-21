import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { get } from '../lib/api';

/**
 * Hadith browser for the six canonical collections.
 *
 * Every field shown here comes from the hadith-api dataset (see
 * server/hadith.js). Nothing is generated in the client: when the dataset has
 * no Somali edition, the item says so instead of showing invented text.
 */

const GOLD = '#d4af37';
const EMERALD = '#0f5132';
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

const S: Record<string, React.CSSProperties> = {
  h1: { fontSize: 22, margin: '0 0 4px', color: EMERALD, fontWeight: 700 },
  sub: { margin: '0 0 14px', fontSize: 13, opacity: 0.75 },
  tabs: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  tab: {
    padding: '8px 14px',
    borderRadius: 999,
    border: `1px solid ${GOLD}77`,
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabActive: { background: EMERALD, color: '#fff', borderColor: EMERALD },
  card: {
    background: 'var(--card, #fff)',
    border: `1px solid ${GOLD}55`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  badge: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: 999,
    background: 'rgba(212,175,55,0.16)',
    color: '#8a6d1f',
    fontSize: 11,
    fontWeight: 700,
  },
  arabic: {
    direction: 'rtl',
    textAlign: 'right',
    fontSize: 24,
    lineHeight: 2,
    fontFamily: "'Amiri', 'Scheherazade New', 'Traditional Arabic', serif",
    margin: '10px 0',
  },
  english: { fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' },
  somali: { fontSize: 13, lineHeight: 1.6, margin: '6px 0 0', opacity: 0.85, fontStyle: 'italic' },
  section: { fontSize: 12, opacity: 0.7, marginTop: 8 },
  gradeRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  grade: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(15,81,50,0.10)',
    color: EMERALD,
    fontWeight: 600,
  },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  input: {
    flex: 1,
    minWidth: 180,
    padding: '11px 13px',
    borderRadius: 12,
    border: `1px solid ${GOLD}88`,
    background: 'transparent',
    color: 'inherit',
    fontSize: 14,
  },
  select: {
    padding: '11px 13px',
    borderRadius: 12,
    border: `1px solid ${GOLD}88`,
    background: 'transparent',
    color: 'inherit',
    fontSize: 14,
  },
  button: {
    padding: '11px 16px',
    borderRadius: 12,
    border: 'none',
    background: EMERALD,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  ghost: {
    padding: '10px 14px',
    borderRadius: 12,
    border: `1px solid ${GOLD}`,
    background: 'transparent',
    color: EMERALD,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  small: { fontSize: 12, opacity: 0.75, margin: '8px 0 0' },
  error: { color: '#b3261e', fontSize: 13 },
};

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
    <div style={S.card}>
      <div style={S.row}>
        <span style={S.badge}>{collection}</span>
        <span style={{ ...S.badge, background: 'rgba(15,81,50,0.10)', color: EMERALD }}>No. {item.number}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...S.ghost, padding: '6px 12px', fontSize: 12 }}
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove hadith ${item.number} from saved` : `Save hadith ${item.number}`}
        >
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>
      <p style={S.arabic} dir="rtl" lang="ar">
        {item.arabic}
      </p>
      {item.english ? (
        <p style={S.english}>{item.english}</p>
      ) : (
        <p style={{ ...S.small, color: '#8a6d1f' }}>English translation is not available in the dataset for this hadith.</p>
      )}
      {item.somali ? <p style={S.somali}>{item.somali}</p> : null}
      {item.section ? <div style={S.section}>Book {item.book} · {item.section}</div> : null}
      {item.grades.length ? (
        <div style={S.gradeRow}>
          {item.grades.map((g, i) => (
            <span key={`${g.scholar}-${i}`} style={S.grade}>
              {g.grade}
              {g.scholar ? ` — ${g.scholar}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
  const [saved, setSaved] = useState<SavedHadith[]>(() => readSaved());

  useEffect(() => {
    get<{ collections: Collection[] }>('/hadith/collections')
      .then((r) => setCollections([...r.collections].sort((a, b) => a.order - b.order)))
      .catch(() => setCollections([]));
    get<DailyResponse>('/hadith/daily')
      .then(setDaily)
      .catch(() => setDaily(null));
  }, []);

  const loadCollection = useCallback(
    async (key: string, pageNo: number, sectionNo: number | '') => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(pageNo), pageSize: '20' });
        if (sectionNo !== '') params.set('section', String(sectionNo));
        const r = await get<CollectionResponse>(`/hadith/${key}?${params.toString()}`);
        setData(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'This collection could not be loaded.');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

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
      <p style={S.sub}>
        Six canonical collections, Arabic text with published translations, references and gradings.
      </p>

      <div style={S.tabs}>
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
            style={{ ...S.tab, ...(tab === id ? S.tabActive : {}) }}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p style={S.error} role="alert">{error}</p> : null}

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
            <p style={S.small}>Source: {daily.source}</p>
          </>
        ) : (
          <p style={S.small}>{loading ? 'Loading the hadith of the day…' : 'The hadith of the day is unavailable right now.'}</p>
        )
      ) : null}

      {tab === 'read' ? (
        <>
          <div style={{ ...S.row, marginBottom: 12 }}>
            <select
              style={S.select}
              value={activeKey}
              onChange={(e) => {
                setActiveKey(e.target.value);
                setPage(1);
                setSection('');
              }}
              aria-label="Collection"
            >
              {collections.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              style={S.select}
              value={section}
              onChange={(e) => {
                setSection(e.target.value === '' ? '' : Number(e.target.value));
                setPage(1);
              }}
              aria-label="Book"
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
            <p style={{ ...S.small, marginBottom: 10 }}>
              {activeCollection.arabicName} · {data ? `${data.total} hadith` : 'loading…'}
              {data && !data.somaliAvailable ? ' · Somali edition not published for this collection' : ''}
            </p>
          ) : null}

          {loading && !data ? <p style={S.small}>Loading…</p> : null}

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
            <div style={{ ...S.row, justifyContent: 'center', margin: '14px 0' }}>
              <button
                type="button"
                style={S.ghost}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1}
              >
                Previous
              </button>
              <span style={S.small}>
                Page {data.page} of {data.pages}
              </span>
              <button
                type="button"
                style={S.ghost}
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={data.page >= data.pages}
              >
                Next
              </button>
            </div>
          ) : null}

          {data ? <p style={S.small}>Source: {data.source}</p> : null}
        </>
      ) : null}

      {tab === 'search' ? (
        <>
          <div style={{ ...S.row, marginBottom: 12 }}>
            <input
              style={S.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
              placeholder="Search Arabic or English text, or a hadith number"
              aria-label="Search hadith"
            />
            <button type="button" style={S.button} onClick={() => void runSearch()} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
          {results ? (
            <>
              <p style={S.small}>
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
              {results.count === 0 ? <p style={S.small}>No hadith matched that search.</p> : null}
            </>
          ) : (
            <p style={S.small}>Search runs across all six collections on the server.</p>
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
          <p style={S.small}>No saved hadith yet. Use the ☆ Save button on any hadith.</p>
        )
      ) : null}
    </Page>
  );
}
