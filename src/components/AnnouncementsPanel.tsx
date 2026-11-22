import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

type Announcement = {
  id: string;
  title: string;
  body: string;
  link: string;
  audience: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  recipients: number;
  delivered: number;
  failed: number;
  pushSent: number;
  pushFailed: number;
  category: string;
  lang: string;
  translations: { so: { title: string; body: string }; ar: { title: string; body: string } };
  skipped: number;
  note: string | null;
};

type Category = { id: string; emoji: string; route: string; label: Record<string, string> };
type Lang = { id: string; label: string; native: string; dir: string };
type Person = { id: string; email: string; name: string };

type Overview = {
  web: { devices: number; users: number };
  fcm: { configured: boolean; reason: string | null; projectId: string | null; tokens: { total: number; users: number } };
  delivery: Record<string, number>;
  announcements: Record<string, number>;
  optOuts: Record<string, number>;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const EMPTY = {
  title: '',
  body: '',
  when: '',
  category: 'announcements',
  lang: 'en',
  soTitle: '',
  soBody: '',
  arTitle: '',
  arBody: '',
  audience: 'all' as 'all' | 'selected',
  userIds: [] as string[],
};

/**
 * Notification centre for administrators: write once, choose the category and
 * language, target everybody or a chosen group, send now or schedule it.
 *
 * Recipients' own switches are enforced by the server, so a message sent to
 * "everyone" only reaches accounts that left that category on. The numbers shown
 * per row are what the server reported, including who was skipped.
 */
export default function AnnouncementsPanel() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    const [list, catalog, stats] = await Promise.all([
      api<{ announcements: Announcement[] }>('/admin/announcements').catch(() => null),
      api<{ categories: Category[]; languages: Lang[] }>('/notifications/catalog').catch(() => null),
      api<Overview>('/admin/push/overview').catch(() => null),
    ]);
    if (list) setItems(list.announcements || []);
    if (catalog) {
      setCategories(catalog.categories || []);
      setLanguages(catalog.languages || []);
    }
    if (stats) setOverview(stats);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (form.audience !== 'selected') return;
    const handle = window.setTimeout(() => {
      api<{ users: Person[] }>(`/admin/users?q=${encodeURIComponent(query)}`)
        .then((res) => setPeople(res.users || []))
        .catch(() => setPeople([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [form.audience, query]);

  async function act(fn: () => Promise<string>, okText?: string) {
    setBusy(true);
    setNote(null);
    try {
      const message = await fn();
      setNote({ ok: true, text: okText || message });
      await load();
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (form.title.trim().length < 3 || form.body.trim().length < 3) {
      setNote({ ok: false, text: 'Title and message are required.' });
      return;
    }
    if (form.audience === 'selected' && form.userIds.length === 0) {
      setNote({ ok: false, text: 'Choose at least one recipient.' });
      return;
    }
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      category: form.category,
      lang: form.lang,
      audience: form.audience,
      userIds: form.audience === 'selected' ? form.userIds : [],
      scheduledAt: form.when ? new Date(form.when).toISOString() : new Date().toISOString(),
      translations: {
        so: { title: form.soTitle.trim(), body: form.soBody.trim() },
        ar: { title: form.arTitle.trim(), body: form.arBody.trim() },
      },
    };
    void act(async () => {
      if (editing) {
        await api(`/admin/announcements/${editing}`, { method: 'PUT', body: payload });
        setEditing(null);
        setForm({ ...EMPTY });
        return 'Announcement updated.';
      }
      await api('/admin/announcements', { method: 'POST', body: payload });
      setForm({ ...EMPTY });
      return 'Announcement saved. It goes out at the chosen time.';
    });
  }

  function toggleRecipient(id: string) {
    setForm((current) => ({
      ...current,
      userIds: current.userIds.includes(id)
        ? current.userIds.filter((entry) => entry !== id)
        : [...current.userIds, id],
    }));
  }

  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="admin-subtitle">Delivery status</h3>
      <div className="admin-item" data-testid="push-overview">
        <div className="admin-item-main">
          <strong>What the server can reach right now</strong>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {overview
              ? `${overview.web.devices} browser device(s) across ${overview.web.users} account(s) · ${
                  overview.fcm.configured
                    ? `${overview.fcm.tokens.total} native token(s) on Firebase project ${overview.fcm.projectId}`
                    : 'native push not configured'
                }`
              : 'Reading delivery status…'}
          </p>
          {overview && !overview.fcm.configured ? (
            <p className="small" style={{ margin: '4px 0 0', color: 'var(--gold)' }}>
              Closed-app delivery on Android/iOS needs a Firebase service account on the server: {overview.fcm.reason}
            </p>
          ) : null}
          {overview ? (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Inbox deliveries recorded: {Object.entries(overview.delivery).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'}
              {Object.keys(overview.optOuts).length
                ? ` · opted out: ${Object.entries(overview.optOuts).map(([k, v]) => `${k} ${v}`).join(', ')}`
                : ''}
            </p>
          ) : null}
        </div>
      </div>

      <h3 className="admin-subtitle">Compose</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Only accounts that left this category switched on will receive it. Write the main text, then optional Somali and
        Arabic wording — each recipient gets the language they chose.
      </p>

      <div className="admin-form" style={{ display: 'grid', gap: 8 }}>
        <div className="grid grid-2">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="announce-category">Category</label>
            <select
              id="announce-category"
              className="select"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.emoji} {entry.label.en || entry.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="announce-lang">Main language</label>
            <select
              id="announce-lang"
              className="select"
              value={form.lang}
              onChange={(e) => setForm({ ...form, lang: e.target.value })}
            >
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.native}
                </option>
              ))}
            </select>
          </div>
        </div>

        <input
          className="input"
          placeholder="Title"
          value={form.title}
          maxLength={120}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <textarea
          className="input"
          placeholder="Message"
          rows={3}
          value={form.body}
          maxLength={1000}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />

        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>
            Somali and Arabic wording (optional)
          </summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <input
              className="input"
              placeholder="Cinwaan (Soomaali)"
              value={form.soTitle}
              maxLength={120}
              onChange={(e) => setForm({ ...form, soTitle: e.target.value })}
            />
            <textarea
              className="input"
              placeholder="Fariin (Soomaali)"
              rows={2}
              value={form.soBody}
              maxLength={1000}
              onChange={(e) => setForm({ ...form, soBody: e.target.value })}
            />
            <input
              className="input"
              placeholder="العنوان (العربية)"
              dir="rtl"
              value={form.arTitle}
              maxLength={120}
              onChange={(e) => setForm({ ...form, arTitle: e.target.value })}
            />
            <textarea
              className="input"
              placeholder="الرسالة (العربية)"
              dir="rtl"
              rows={2}
              value={form.arBody}
              maxLength={1000}
              onChange={(e) => setForm({ ...form, arBody: e.target.value })}
            />
          </div>
        </details>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="announce-audience">Recipients</label>
          <select
            id="announce-audience"
            className="select"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value as 'all' | 'selected' })}
          >
            <option value="all">All users</option>
            <option value="selected">Selected users</option>
          </select>
        </div>

        {form.audience === 'selected' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <input
              className="input"
              placeholder="Search by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4 }}>
              {people.length === 0 ? (
                <p className="tiny muted" style={{ margin: 0 }}>
                  No matching accounts.
                </p>
              ) : (
                people.map((person) => (
                  <label key={person.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={form.userIds.includes(person.id)}
                      onChange={() => toggleRecipient(person.id)}
                    />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {person.name || person.email}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              {form.userIds.length} selected
            </p>
          </div>
        ) : null}

        <label className="small muted" htmlFor="announce-when">
          Send at (leave empty to send on the next check)
        </label>
        <input
          id="announce-when"
          className="input"
          type="datetime-local"
          value={form.when}
          onChange={(e) => setForm({ ...form, when: e.target.value })}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={save}>
            {editing ? 'Save changes' : 'Save notification'}
          </button>
          {editing ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setForm({ ...EMPTY });
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      {note ? (
        <p className="small" style={{ marginTop: 8, color: note.ok ? 'var(--gold)' : '#e0655b' }} role="status">
          {note.text}
        </p>
      ) : null}

      <h3 className="admin-subtitle">History</h3>
      {items.length === 0 ? (
        <p className="small muted">No notifications yet.</p>
      ) : (
        <div>
          {items.map((item) => (
            <div className="admin-item" key={item.id}>
              <div className="admin-item-main">
                <strong>{item.title}</strong>
                <p className="small" style={{ margin: '2px 0 0' }}>
                  {item.body}
                </p>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {item.category} · {item.lang.toUpperCase()} · {item.audience === 'selected' ? 'selected users' : 'all users'} ·{' '}
                  {item.status.toUpperCase()} · scheduled {when(item.scheduledAt)}
                  {item.sentAt ? ` · sent ${when(item.sentAt)}` : ''}
                </p>
                {item.status === 'sent' ? (
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    {item.delivered}/{item.recipients} inbox · {item.pushSent} device notification(s) accepted
                    {item.pushFailed > 0 ? ` · ${item.pushFailed} failed` : ''}
                    {item.skipped > 0 ? ` · ${item.skipped} opted out` : ''}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="small" style={{ margin: '2px 0 0', color: 'var(--gold)' }}>
                    {item.note}
                  </p>
                ) : null}
              </div>
              <div className="admin-item-actions">
                {item.status === 'scheduled' ? (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const res = await api<{ push?: { sent: number; deferred?: number } }>(
                            `/admin/announcements/${item.id}/send`,
                            { method: 'POST', body: {} }
                          );
                          const sent = res.push?.sent ?? 0;
                          const deferred = res.push?.deferred ?? 0;
                          return deferred > 0
                            ? `Inbox delivered. ${deferred} native token(s) still need Firebase credentials.`
                            : `Sent. ${sent} device notification(s) accepted.`;
                        })
                      }
                    >
                      Send now
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(item.id);
                        setForm({
                          title: item.title,
                          body: item.body,
                          when: toLocalInput(item.scheduledAt),
                          category: item.category,
                          lang: item.lang,
                          soTitle: item.translations?.so?.title || '',
                          soBody: item.translations?.so?.body || '',
                          arTitle: item.translations?.ar?.title || '',
                          arBody: item.translations?.ar?.body || '',
                          audience: item.audience === 'selected' ? 'selected' : 'all',
                          userIds: [],
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await api(`/admin/announcements/${item.id}/cancel`, { method: 'POST', body: {} });
                          return 'Notification cancelled.';
                        })
                      }
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
