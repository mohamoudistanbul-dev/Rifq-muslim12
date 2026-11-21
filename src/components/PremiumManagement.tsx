import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post, put } from '../lib/api';

/**
 * Owner/Admin Premium Management.
 *
 * Everything here operates on the real registry that is seeded from the app's
 * own catalogues (surahs, reciters, hadith collections, Kid Academy lessons,
 * quiz categories), so the owner is changing the actual content — not a demo
 * list. Every save goes to the database through the admin API, which enforces
 * the admin role on the server and records who made the change.
 */

interface Item {
  key: string;
  category: string;
  title: string;
  description: string;
  tier: 'free' | 'premium';
  enabled: boolean;
  published: boolean;
  source: string;
  updatedAt: string;
  updatedBy: string;
  locked: boolean;
}

interface Counts {
  total: number;
  free: number;
  premium: number;
  disabled: number;
  draft: number;
}

interface HistoryRow {
  id: string;
  userId?: string;
  email: string;
  name: string;
  provider: string;
  planCode: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

interface Overview {
  premiumUsers: number;
  active: number;
  expired: number;
  revoked: number;
  counts: Counts;
  revenue: { currency: string; cents: number; purchases: number }[];
  revenueNote: string;
  history: HistoryRow[];
}

interface Preview {
  item: Item;
  free: { allowed: boolean; locked: boolean; reason: string; upgradeScreen: boolean };
  premium: { allowed: boolean; locked: boolean; reason: string };
  note: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  quran: 'Quran reading',
  audio: 'Quran audio',
  hadith: 'Hadith',
  duas: 'Duas & Adhkar',
  kids: 'Kid Academy',
  quiz: 'Quiz',
  general: 'Other',
};

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export default function PremiumManagement() {
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, free: 0, premium: 0, disabled: 0, draft: 0 });
  const [categories, setCategories] = useState<string[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [tier, setTier] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [preview, setPreview] = useState<Preview | null>(null);

  const say = (text: string, ok = true) => {
    setMsg(text);
    setTone(ok ? 'ok' : 'bad');
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category !== 'all') params.set('category', category);
      if (tier !== 'all') params.set('tier', tier);
      if (status !== 'all') params.set('status', status);

      const [listRes, overviewRes] = await Promise.all([
        get<{ items: Item[]; counts: Counts; categories: string[] }>(
          `/admin/premium-content/items?${params.toString()}`
        ),
        get<Overview>('/admin/premium-content/overview'),
      ]);
      setItems(listRes.items || []);
      setCounts(listRes.counts);
      setCategories(listRes.categories || []);
      setOverview(overviewRes);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not load the content registry.', false);
    } finally {
      setLoading(false);
    }
  }, [q, category, tier, status]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, tier, status]);

  const save = async (item: Item, patch: Partial<Item>) => {
    setBusy(item.key);
    try {
      const res = await put<{ item: Item; changes: string[] }>(`/admin/premium-content/items/${encodeURIComponent(item.key)}`, patch);
      setItems((prev) => prev.map((row) => (row.key === item.key ? { ...row, ...res.item } : row)));
      say(
        res.changes.length
          ? `${item.title}: ${res.changes.join(', ')}`
          : `${item.title}: saved`
      );
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The change could not be saved.', false);
    } finally {
      setBusy('');
    }
  };

  const bulk = async (patch: { tier?: 'free' | 'premium'; enabled?: boolean; published?: boolean }) => {
    if (selected.length === 0) return say('Select at least one item first.', false);
    setBusy('bulk');
    try {
      const res = await post<{ changed: number }>('/admin/premium-content/items/bulk', { keys: selected, ...patch });
      say(`${res.changed} item(s) updated.`);
      setSelected([]);
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The bulk change could not be saved.', false);
    } finally {
      setBusy('');
    }
  };

  const openPreview = async (item: Item) => {
    try {
      setPreview(await get<Preview>(`/admin/premium-content/items/${encodeURIComponent(item.key)}/preview`));
    } catch (err) {
      say(err instanceof Error ? err.message : 'Preview is unavailable.', false);
    }
  };

  const allVisibleSelected = useMemo(
    () => items.length > 0 && items.every((item) => selected.includes(item.key)),
    [items, selected]
  );

  const toggleAll = () =>
    setSelected(allVisibleSelected ? [] : items.map((item) => item.key));

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="section-title">Premium management</div>
            <div className="muted small">
              Decide which existing content is free and which needs Premium. Changes take effect immediately and are
              recorded with your account.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="muted tiny">Premium users</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{overview?.premiumUsers ?? 0}</div>
            <div className="muted tiny">
              {overview?.active ?? 0} active · {overview?.expired ?? 0} expired
            </div>
          </div>
          <div className="stat">
            <div className="muted tiny">Content items</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.total}</div>
            <div className="muted tiny">
              {counts.free} free · {counts.premium} premium · {counts.disabled} disabled
            </div>
          </div>
        </div>

        {overview ? (
          <div className="muted tiny" style={{ marginTop: 10 }}>
            {overview.revenue.length
              ? `Verified store revenue: ${overview.revenue.map((r) => money(r.cents, r.currency)).join(', ')}`
              : 'No verified store purchase yet.'}{' '}
            {overview.revenueNote}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="pm-search">Search</label>
            <input
              id="pm-search"
              className="input"
              value={q}
              placeholder="Surah, reciter, lesson, quiz…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load();
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="pm-category">Category</label>
            <select id="pm-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((id) => (
                <option key={id} value={id}>
                  {CATEGORY_LABEL[id] || id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pm-tier">Access</label>
            <select id="pm-tier" className="select" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="all">Free and premium</option>
              <option value="free">Free only</option>
              <option value="premium">Premium only</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pm-status">Status</label>
            <select id="pm-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Any status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="published">Published</option>
              <option value="draft">Draft (staff only)</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn btn-soft btn-sm" onClick={toggleAll} disabled={items.length === 0}>
            {allVisibleSelected ? 'Clear selection' : `Select all (${items.length})`}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void bulk({ tier: 'premium' })} disabled={busy === 'bulk'}>
            Make premium
          </button>
          <button className="btn btn-soft btn-sm" onClick={() => void bulk({ tier: 'free' })} disabled={busy === 'bulk'}>
            Make free
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void bulk({ enabled: false })} disabled={busy === 'bulk'}>
            Disable
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void bulk({ enabled: true, published: true })} disabled={busy === 'bulk'}>
            Enable &amp; publish
          </button>
          <span className="muted tiny">{selected.length} selected</span>
        </div>

        {msg ? (
          <div className={tone === 'ok' ? 'admin-note' : 'admin-note admin-note-bad'} style={{ marginTop: 10 }}>
            {msg}
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="section-title">Preview · {preview.item.title}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Free user: {preview.free.allowed ? 'can open' : preview.free.locked ? 'sees the Premium upgrade screen' : 'cannot see it'}
            {' · '}Premium user: {preview.premium.allowed ? 'can open' : 'cannot open'}
          </div>
          <div className="muted tiny" style={{ marginTop: 6 }}>
            {preview.note}
          </div>
        </div>
      ) : null}

      <div className="card">
        {loading ? (
          <div className="muted small">Loading content…</div>
        ) : items.length === 0 ? (
          <div className="empty">No items match these filters.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {items.map((item) => {
              const isEditing = editing === item.key;
              return (
                <div key={item.key} className="admin-item" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selected.includes(item.key)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, item.key] : prev.filter((key) => key !== item.key)
                      )
                    }
                    style={{ marginTop: 4 }}
                  />
                  <div className="admin-item-main" style={{ flex: 1 }}>
                    {isEditing ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <input
                          className="input"
                          value={draft.title}
                          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                          aria-label="Title"
                        />
                        <input
                          className="input"
                          value={draft.description}
                          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                          aria-label="Description"
                        />
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600 }}>{item.title}</div>
                        <div className="muted tiny">
                          {CATEGORY_LABEL[item.category] || item.category} · {item.key}
                          {item.description ? ` · ${item.description}` : ''}
                        </div>
                        <div className="muted tiny">
                          {item.tier === 'premium' ? 'Premium' : 'Free'}
                          {item.enabled ? '' : ' · disabled'}
                          {item.published ? '' : ' · draft'}
                          {item.updatedBy ? ` · last changed by ${item.updatedBy}` : ''}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="admin-item-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {isEditing ? (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy === item.key}
                          onClick={async () => {
                            await save(item, { title: draft.title, description: draft.description });
                            setEditing(null);
                          }}
                        >
                          Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={item.tier === 'free' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                          disabled={busy === item.key}
                          onClick={() => void save(item, { tier: 'free' })}
                        >
                          Free
                        </button>
                        <button
                          className={item.tier === 'premium' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                          disabled={busy === item.key}
                          onClick={() => void save(item, { tier: 'premium' })}
                        >
                          Premium
                        </button>
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={busy === item.key}
                          onClick={() => void save(item, { enabled: !item.enabled })}
                        >
                          {item.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={busy === item.key}
                          onClick={() => void save(item, { published: !item.published })}
                        >
                          {item.published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEditing(item.key);
                            setDraft({ title: item.title, description: item.description });
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void openPreview(item)}>
                          Preview
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Subscription history</div>
        {overview && overview.history.length > 0 ? (
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {overview.history.map((row) => (
              <div key={row.id} className="admin-audit-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{row.email || row.name || row.userId}</div>
                  <div className="muted tiny">
                    {row.provider} · {row.planCode} · {row.status}
                    {row.expiresAt ? ` · ends ${new Date(row.expiresAt).toLocaleDateString()}` : ' · lifetime'}
                  </div>
                </div>
                <div className="muted tiny">{new Date(row.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 8 }}>
            No subscription has been recorded yet. Purchases appear here once Google Play or the App Store confirms one.
          </div>
        )}
        <div className="muted tiny" style={{ marginTop: 8 }}>
          Expired subscriptions stop granting access automatically; users fall back to Free content on their next request.
        </div>
      </div>
    </div>
  );
}
