import React, { useEffect, useState } from 'react';
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
  note: string | null;
};

/** Local datetime string for <input type="datetime-local">. */
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

const EMPTY = { title: '', body: '', when: '' };

/**
 * Scheduled announcements: written once, sent by the server when due (or now).
 * Every row shows what the server actually delivered.
 */
export default function AnnouncementsPanel() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const res = await api<{ announcements: Announcement[] }>('/admin/announcements');
      setItems(res.announcements || []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      scheduledAt: form.when ? new Date(form.when).toISOString() : new Date().toISOString(),
      audience: 'all',
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
      return 'Announcement scheduled.';
    });
  }

  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="admin-subtitle">Scheduled announcements</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Written now, delivered automatically at the chosen time (or immediately with Send now). Delivery numbers are
        what the server reported, not estimates.
      </p>

      <div className="admin-form" style={{ display: 'grid', gap: 8 }}>
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
            {editing ? 'Save changes' : 'Schedule announcement'}
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
        <p className="small" style={{ marginTop: 8, color: note.ok ? 'var(--gold)' : '#e0655b' }}>
          {note.text}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="small muted" style={{ marginTop: 10 }}>
          No announcements scheduled yet.
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          {items.map((item) => (
            <div className="admin-item" key={item.id}>
              <div className="admin-item-main">
                <strong>{item.title}</strong>
                <p className="small" style={{ margin: '2px 0 0' }}>
                  {item.body}
                </p>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {item.status.toUpperCase()} · scheduled {when(item.scheduledAt)}
                  {item.sentAt ? ` · sent ${when(item.sentAt)}` : ''}
                  {item.status === 'sent'
                    ? ` · ${item.delivered}/${item.recipients} inbox · ${item.pushSent} push`
                    : ''}
                  {item.status === 'sent' && item.pushFailed > 0 ? ` · ${item.pushFailed} push failed` : ''}
                </p>
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
                          const res = await api<{ push?: { sent: number } }>(
                            `/admin/announcements/${item.id}/send`,
                            { method: 'POST', body: {} }
                          );
                          return `Sent. ${res.push?.sent ?? 0} device notification(s) accepted.`;
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
                        setForm({ title: item.title, body: item.body, when: toLocalInput(item.scheduledAt) });
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
                          return 'Announcement cancelled.';
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
