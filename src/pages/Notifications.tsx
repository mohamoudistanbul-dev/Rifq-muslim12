/**
 * Notification inbox.
 *
 * Every row here is a real record written by the server: admin messages, the
 * answer to a verification request and account notices. Opening a row marks it
 * read on the server, so the unread badge and a second device agree.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, ErrorBox, Loading } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { get, post } from '../lib/api';
import { useStore } from '../lib/store';
import type { InboxItem, InboxResponse } from '../lib/inbox';

const KIND_LABEL: Record<string, string> = {
  admin: 'From the RIFQ Muslim team',
  verification: 'Verification',
  system: 'RIFQ Muslim',
  account: 'Your account',
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Notifications() {
  const { t, user } = useStore();
  const navigate = useNavigate();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await get<InboxResponse>('/notifications?limit=100');
      setItems(res.notifications || []);
      setUnread(Number(res.unread) || 0);
    } catch (e) {
      setError((e as Error).message || t('Notifications could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, load]);

  const markAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await post('/notifications/read', { all: true });
      setItems((list) => list.map((item) => ({ ...item, read: true })));
      setUnread(0);
    } catch (e) {
      setError((e as Error).message || t('Could not mark notifications as read.'));
    } finally {
      setBusy(false);
    }
  };

  const open = async (item: InboxItem) => {
    if (!item.read) {
      try {
        const res = await post<{ unread: number }>('/notifications/read', { ids: [item.id] });
        setItems((list) => list.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
        setUnread(Number(res.unread) || 0);
      } catch {
        /* the row stays unread; the link still works */
      }
    }
    if (item.link && item.link.startsWith('/')) navigate(item.link);
  };

  if (!user) {
    return (
      <Page title={t('Notifications')} subtitle={t('Sign in to see messages sent to your account.')}>
        <div className="card gold-edge stack">
          <p className="small" style={{ margin: 0 }}>
            {t('Your notification inbox is tied to your account, so you need to sign in first.')}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-primary btn-sm" to="/login">
              {t('Sign in')}
            </Link>
            <Link className="btn btn-soft btn-sm" to="/register">
              {t('Create account')}
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title={t('Notifications')}
      subtitle={unread > 0 ? `${unread} ${t('unread')}` : t('All messages are read')}
      actions={
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Link className="btn btn-soft btn-sm" to="/athan">
            <AppIcon name="bell" size={16} /> {t('Athan & reminders')}
          </Link>
          {unread > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={markAll} disabled={busy}>
              {t('Mark all read')}
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <div className="card stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('No messages yet. Announcements from the RIFQ Muslim team and updates about your account will appear here.')}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Prayer, Quran and adhkar reminders are scheduled on this device — see Athan & reminders.')}
          </p>
        </div>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <button
              key={item.id}
              className="card"
              onClick={() => void open(item)}
              style={{
                textAlign: 'left',
                width: '100%',
                cursor: item.link ? 'pointer' : 'default',
                borderColor: item.read ? 'var(--line)' : 'var(--gold)',
                background: item.read ? undefined : 'rgba(212,175,55,.07)',
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    {!item.read && (
                      <span
                        aria-hidden="true"
                        style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--gold)', flex: '0 0 auto' }}
                      />
                    )}
                    <strong>{item.title}</strong>
                  </div>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    {KIND_LABEL[item.kind] || t('RIFQ Muslim')} · {when(item.createdAt)}
                  </p>
                </div>
                {!item.read && (
                  <span className="small" style={{ color: 'var(--gold)', flex: '0 0 auto' }}>
                    {t('New')}
                  </span>
                )}
              </div>
              <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>
                {item.body}
              </p>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}
