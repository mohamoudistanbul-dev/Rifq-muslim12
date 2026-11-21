/**
 * Unread badge for the notification inbox.
 *
 * The count comes from the server (`/api/notifications`), never from a local
 * guess, so the badge matches the rows a user can actually open. It refreshes on
 * mount, when the tab becomes visible again and once a minute while the app is
 * open. No polling happens while signed out.
 */
import { useEffect, useState } from 'react';
import { get } from './api';
import { useStore } from './store';

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  broadcastId: string | null;
}

export interface InboxResponse {
  notifications: InboxItem[];
  unread: number;
}

export function useUnreadNotifications(): number {
  const { user } = useStore();
  const userId = user?.id || '';
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      return;
    }
    let alive = true;
    const load = () => {
      get<InboxResponse>('/notifications?limit=1')
        .then((res) => {
          if (alive) setUnread(Number(res.unread) || 0);
        })
        .catch(() => {
          /* offline or signed out: keep the last known count */
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  return unread;
}
