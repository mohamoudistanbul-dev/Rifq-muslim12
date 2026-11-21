import { useCallback, useEffect, useState } from 'react';
import { get } from './api';

/**
 * Client view of the server's Free/Premium decisions.
 *
 * The client never decides access: it reads what the server says and renders a
 * lock or an upgrade prompt. If this module were bypassed entirely, the content
 * routes still refuse to serve premium material (402 premium_required).
 */

export interface AccessItem {
  key: string;
  category: string;
  title: string;
  description: string;
  tier: 'free' | 'premium';
  enabled: boolean;
  published: boolean;
  locked: boolean;
  allowed: boolean;
  reason: string;
}

export interface AccessPayload {
  items: AccessItem[];
  categories: string[];
  premium: boolean;
  staff: boolean;
}

export async function loadAccess(category?: string): Promise<AccessPayload> {
  const suffix = category ? `?category=${encodeURIComponent(category)}` : '';
  return get<AccessPayload>(`/access/items${suffix}`);
}

/** Ask the server about one item (used when opening a single surah or lesson). */
export async function checkAccess(key: string): Promise<{ allowed: boolean; locked: boolean; item?: AccessItem }> {
  try {
    const result = await get<{ allowed: boolean; locked: boolean; item: AccessItem }>(
      `/access/check?key=${encodeURIComponent(key)}`
    );
    return result;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 402) return { allowed: false, locked: true };
    return { allowed: false, locked: false };
  }
}

/** Shared read-only hook so several screens show the same server state. */
export function useAccess(category?: string) {
  const [data, setData] = useState<AccessPayload | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setData(await loadAccess(category));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access rules could not be loaded.');
    }
  }, [category]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byKey = useCallback(
    (key: string): AccessItem | undefined => data?.items.find((item) => item.key === key),
    [data]
  );

  return { data, error, reload, byKey, premium: Boolean(data?.premium) };
}
