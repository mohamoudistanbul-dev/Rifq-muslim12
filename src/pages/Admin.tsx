import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Loading } from '../components/Shell';
import { useStore } from '../lib/store';
import { get, patch, post, put, del } from '../lib/api';
import '../admin.css';

type Tab =
  | 'overview'
  | 'content'
  | 'media'
  | 'users'
  | 'messages'
  | 'community'
  | 'notifications'
  | 'settings'
  | 'activity'
  | 'security';

interface AuditRow {
  id: string;
  actor_email?: string;
  action: string;
  detail: string;
  created_at: string;
}

interface ContentItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  image: string;
  category: string;
  status: string;
  featured: boolean;
  views: number;
  updatedAt: string;
  publishedAt: string | null;
}

interface MediaItem {
  id: string;
  url: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  alt: string;
  createdAt: string;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  verified?: boolean;
  emailVerified?: boolean;
  banned: boolean;
  createdAt: string;
  lastLogin?: string | null;
}

interface Message {
  id: string;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

interface Report {
  id: string;
  post_id?: string;
  post_body?: string;
  post_author?: string;
  reason: string;
  status: string;
  created_at: string;
}

interface Post {
  id: string;
  author: string;
  body: string;
  status: string;
  likes: number;
  created_at: string;
}

interface Notice {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

interface Overview {
  users: number;
  verifiedUsers: number;
  admins: number;
  posts: number;
  openReports: number;
  newMessages: number;
  bookmarks: number;
  trackerEntries: number;
  quizAttempts: number;
  notifications: number;
  content: number;
  publishedContent: number;
  drafts: number;
  media: number;
  mediaBytes: number;
  emailConfigured: boolean;
  assistantMode: string;
  recent: AuditRow[];
  topContent: { id: string; title: string; type: string; status: string; views: number }[];
}

interface Security {
  email: string;
  role: string;
  name: string;
  createdAt: string;
  lastLogin: string | null;
  admins: { id: string; email: string; name: string; role: string; last_login: string | null; created_at: string }[];
  emailConfigured: boolean;
  passwordScheme: string;
  sessionNote: string;
}

interface Draft {
  id?: string;
  type: string;
  title: string;
  category: string;
  excerpt: string;
  body: string;
  image: string;
  status: string;
  featured: boolean;
}

const EMPTY_DRAFT: Draft = {
  type: 'article',
  title: '',
  category: '',
  excerpt: '',
  body: '',
  image: '',
  status: 'draft',
  featured: false,
};

const TABS: { id: Tab; label: string; superOnly?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'media', label: 'Media library' },
  { id: 'users', label: 'Users', superOnly: true },
  { id: 'messages', label: 'Contact messages' },
  { id: 'community', label: 'Community' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings', label: 'Website settings', superOnly: true },
  { id: 'activity', label: 'Activity log' },
  { id: 'security', label: 'Security' },
];

const SETTING_FIELDS: { key: string; label: string; kind?: 'text' | 'email' | 'url' | 'textarea' | 'bool' }[] = [
  { key: 'app_name', label: 'Application name' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'contact_email', label: 'Official contact email', kind: 'email' },
  { key: 'contact_phone', label: 'Contact phone' },
  { key: 'whatsapp', label: 'WhatsApp number' },
  { key: 'download_url', label: 'APK download URL (Cloudflare R2)', kind: 'url' },
  { key: 'announcement_text', label: 'Announcement banner', kind: 'textarea' },
  { key: 'announcement_active', label: 'Show announcement on Home', kind: 'bool' },
  { key: 'community_enabled', label: 'Community enabled', kind: 'bool' },
];

const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '-';

const bytes = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const fromItem = (item: ContentItem): Draft => ({
  id: item.id,
  type: item.type,
  title: item.title,
  category: item.category,
  excerpt: item.excerpt,
  body: item.body,
  image: item.image,
  status: item.status,
  featured: item.featured,
});

/* ---------------------------------- login ---------------------------------- */

function AdminLogin({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { email: email.trim(), password });
      await onDone();
    } catch (err) {
      setError((err as Error).message || t('Sign in failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Super Admin" subtitle={t('Administrator sign in')}>
      <form className="card gold-edge" onSubmit={submit}>
        <div className="field">
          <label htmlFor="admin-email">{t('Administrator email')}</label>
          <input
            id="admin-email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="admin-password">{t('Password')}</label>
          <input
            id="admin-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="small" role="alert" style={{ color: '#f0a29b', margin: '0 0 10px' }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('Signing in...') : t('Sign in as Super Admin')}
        </button>
        <p className="admin-note" style={{ marginTop: 10 }}>
          {t('Only administrator accounts can open this dashboard.')}
        </p>
      </form>
    </Page>
  );
}

/* --------------------------------- dashboard -------------------------------- */

export default function Admin() {
  const { t, user, authReady, toast, refreshUser } = useStore();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'superadmin');
  const isSuper = user?.role === 'superadmin';

  const [tab, setTab] = useState<Tab>('overview');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [security, setSecurity] = useState<Security | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [noticeForm, setNoticeForm] = useState({ title: '', body: '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    setLoading(true);
    setError('');
    const fail = (m: string) => () => {
      if (alive) setError(m);
    };
    const jobs: Promise<void>[] = [];

    if (tab === 'overview') {
      jobs.push(
        get<Overview>('/admin/overview')
          .then((r) => {
            if (alive) setOverview(r);
          })
          .catch(fail(t('The overview could not be loaded.')))
      );
    }
    if (tab === 'content') {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      jobs.push(
        get<{ content: ContentItem[] }>(`/admin/content?${params.toString()}`)
          .then((r) => {
            if (alive) setContent(r.content);
          })
          .catch(fail(t('Content could not be loaded.')))
      );
    }
    if (tab === 'media') {
      jobs.push(
        get<{ media: MediaItem[] }>('/admin/media')
          .then((r) => {
            if (alive) setMedia(r.media);
          })
          .catch(fail(t('The media library could not be loaded.')))
      );
    }
    if (tab === 'users') {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      jobs.push(
        get<{ users: AdminUser[] }>(`/admin/users?${params.toString()}`)
          .then((r) => {
            if (alive) setUsers(r.users);
          })
          .catch(fail(t('Users could not be loaded.')))
      );
    }
    if (tab === 'messages') {
      jobs.push(
        get<{ messages: Message[] }>('/admin/messages')
          .then((r) => {
            if (alive) setMessages(r.messages);
          })
          .catch(fail(t('Messages could not be loaded.')))
      );
    }
    if (tab === 'community') {
      jobs.push(
        get<{ reports: Report[] }>('/admin/reports')
          .then((r) => {
            if (alive) setReports(r.reports);
          })
          .catch(fail(t('Reports could not be loaded.')))
      );
      jobs.push(
        get<{ posts: Post[] }>('/admin/posts')
          .then((r) => {
            if (alive) setPosts(r.posts);
          })
          .catch(fail(t('Posts could not be loaded.')))
      );
    }
    if (tab === 'notifications') {
      jobs.push(
        get<{ notifications: Notice[] }>('/admin/notifications')
          .then((r) => {
            if (alive) setNotices(r.notifications);
          })
          .catch(fail(t('Notifications could not be loaded.')))
      );
    }
    if (tab === 'settings') {
      jobs.push(
        get<{ settings: Record<string, string> }>('/admin/settings')
          .then((r) => {
            if (alive) setSettings(r.settings);
          })
          .catch(fail(t('Settings could not be loaded.')))
      );
    }
    if (tab === 'activity') {
      jobs.push(
        get<{ audit: AuditRow[] }>('/admin/audit?limit=200')
          .then((r) => {
            if (alive) setLogs(r.audit);
          })
          .catch(fail(t('The activity log could not be loaded.')))
      );
    }
    if (tab === 'security') {
      jobs.push(
        get<Security>('/admin/security')
          .then((r) => {
            if (alive) setSecurity(r);
          })
          .catch(fail(t('Security settings could not be loaded.')))
      );
    }

    Promise.all(jobs).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin, q, typeFilter, statusFilter, reload]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
      setReload((r) => r + 1);
      return true;
    } catch (err) {
      toast((err as Error).message || t('Something went wrong.'), 'error');
      return false;
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const d = draft;
    const ok = await run(
      () => (d.id ? patch(`/admin/content/${d.id}`, d) : post('/admin/content', d)),
      d.id ? t('Content updated.') : t('Content created.')
    );
    if (ok) setDraft(null);
  };

  const togglePublish = (item: ContentItem) =>
    run(
      () => post(`/admin/content/${item.id}/publish`, { published: item.status !== 'published' }),
      item.status === 'published' ? t('Content unpublished.') : t('Content published live.')
    );

  const removeContent = (item: ContentItem) => {
    if (!window.confirm(t('Delete this content permanently?'))) return;
    void run(() => del(`/admin/content/${item.id}`), t('Content deleted.'));
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    for (const file of list) {
      if (file.size > 6 * 1024 * 1024) {
        toast(t('Files must be smaller than 6 MB.'), 'error');
        continue;
      }
      let data = '';
      try {
        data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(t('That file could not be read.')));
          reader.readAsDataURL(file);
        });
      } catch (err) {
        toast((err as Error).message, 'error');
        continue;
      }
      await run(() => post('/admin/media', { mime: file.type, name: file.name, data }), t('File uploaded.'));
    }
  };

  const copyUrl = async (item: MediaItem) => {
    const full = `${window.location.origin}${item.url}`;
    try {
      await navigator.clipboard.writeText(full);
      toast(t('Media URL copied.'), 'success');
    } catch {
      toast(full, 'info');
    }
  };

  const saveSettings = () => run(() => put('/admin/settings', settings), t('Settings saved and live.'));

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      toast(t('The new passwords do not match.'), 'error');
      return;
    }
    const ok = await run(() => post('/admin/password', { current: pw.current, next: pw.next }), t('Password changed.'));
    if (ok) setPw({ current: '', next: '', confirm: '' });
  };

  if (!authReady) {
    return (
      <Page title="Super Admin">
        <Loading />
      </Page>
    );
  }
  if (!isAdmin) return <AdminLogin onDone={refreshUser} />;

  const kpis: [string, number][] = overview
    ? [
        ['Users', overview.users],
        ['Published', overview.publishedContent],
        ['Drafts', overview.drafts],
        ['Media files', overview.media],
        ['Notifications', overview.notifications],
        ['New messages', overview.newMessages],
        ['Open reports', overview.openReports],
        ['Community posts', overview.posts],
        ['Bookmarks', overview.bookmarks],
        ['Quiz attempts', overview.quizAttempts],
      ]
    : [];

  const renderOverview = () => {
    if (!overview) return null;
    return (
      <>
        <div className="admin-kpis">
          {kpis.map(([label, value]) => (
            <div className="admin-kpi" key={label}>
              <span className="stat">{value}</span>
              <span className="admin-kpi-label">{t(label)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 className="admin-card-title">{t('Platform health')}</h3>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Media storage')}: {bytes(overview.mediaBytes)} | {t('Email delivery')}:{' '}
            {overview.emailConfigured ? t('connected') : t('not configured')} | {t('Assistant')}:{' '}
            {overview.assistantMode}
          </p>
        </div>
        <div className="card">
          <h3 className="admin-card-title">{t('Most viewed content')}</h3>
          {overview.topContent.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {t('No content yet. Create your first article in the Content section.')}
            </p>
          ) : (
            overview.topContent.map((c) => (
              <div className="admin-log" key={c.id}>
                <span className="admin-log-action">{c.title}</span>
                <span className="small muted">
                  {c.type} | {c.status} | {c.views} {t('views')}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="card">
          <h3 className="admin-card-title">{t('Recent activity')}</h3>
          {overview.recent.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {t('No activity recorded yet.')}
            </p>
          ) : (
            overview.recent.map((r) => (
              <div className="admin-log" key={r.id}>
                <span className="admin-log-action">{r.action}</span>
                <span className="small muted">{r.detail}</span>
                <span className="admin-log-time">{when(r.created_at)}</span>
              </div>
            ))
          )}
        </div>
      </>
    );
  };

  const renderContent = () => (
    <>
      <div className="card">
        <div className="admin-toolbar">
          <input
            className="input"
            placeholder={t('Search content')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('Search content')}
          />
          <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={t('Type')}>
            <option value="">{t('All types')}</option>
            <option value="article">{t('Article')}</option>
            <option value="page">{t('Page')}</option>
            <option value="banner">{t('Banner')}</option>
            <option value="announcement">{t('Announcement')}</option>
          </select>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('Status')}>
            <option value="">{t('All statuses')}</option>
            <option value="published">{t('Published')}</option>
            <option value="draft">{t('Draft')}</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            + {t('New content')}
          </button>
        </div>
      </div>

      {draft ? (
        <div className="card gold-edge">
          <h3 className="admin-card-title">{draft.id ? t('Edit content') : t('Create content')}</h3>
          <div className="field">
            <label htmlFor="c-title">{t('Title')}</label>
            <input
              id="c-title"
              className="input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className="admin-toolbar">
            <select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} aria-label={t('Type')}>
              <option value="article">{t('Article')}</option>
              <option value="page">{t('Page')}</option>
              <option value="banner">{t('Banner')}</option>
              <option value="announcement">{t('Announcement')}</option>
            </select>
            <select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} aria-label={t('Status')}>
              <option value="draft">{t('Draft')}</option>
              <option value="published">{t('Published')}</option>
            </select>
            <input
              className="input"
              placeholder={t('Category')}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="c-excerpt">{t('Short summary')}</label>
            <input
              id="c-excerpt"
              className="input"
              value={draft.excerpt}
              onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="c-body">{t('Full text')}</label>
            <textarea
              id="c-body"
              className="textarea"
              rows={8}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="c-image">{t('Image URL')}</label>
            <input
              id="c-image"
              className="input"
              value={draft.image}
              placeholder="/uploads/..."
              onChange={(e) => setDraft({ ...draft, image: e.target.value })}
            />
          </div>
          <label className="row between" style={{ padding: '6px 0' }}>
            <span className="small">{t('Feature on Home')}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={draft.featured}
                onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}
              />
              <span className="track" />
            </span>
          </label>
          <div className="admin-toolbar" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void saveDraft()}>
              {draft.id ? t('Save changes') : t('Create content')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {content.length === 0 ? (
        <p className="small muted">{t('No content matches this filter.')}</p>
      ) : (
        content.map((item) => (
          <div className="admin-item" key={item.id}>
            <div className="admin-item-main">
              <strong>{item.title}</strong>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                <span className={item.status === 'published' ? 'admin-badge live' : 'admin-badge draft'}>
                  {item.status === 'published' ? t('Published') : t('Draft')}
                </span>{' '}
                {item.type} | {item.views} {t('views')} | {when(item.updatedAt)}
              </p>
            </div>
            <div className="admin-item-actions">
              <button className="btn btn-soft btn-sm" onClick={() => setDraft(fromItem(item))}>
                {t('Edit')}
              </button>
              <button className="btn btn-soft btn-sm" onClick={() => void togglePublish(item)}>
                {item.status === 'published' ? t('Unpublish') : t('Publish')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => removeContent(item)}>
                {t('Delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );

  const renderMedia = () => (
    <>
      <div className="card">
        <h3 className="admin-card-title">{t('Upload media')}</h3>
        <p className="small muted">{t('Images, PDFs, audio and MP4 video up to 6 MB each.')}</p>
        <input
          className="input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf,audio/mpeg,audio/mp4,video/mp4"
          onChange={(e) => void uploadFiles(e.target.files)}
          aria-label={t('Upload media')}
        />
      </div>
      {media.length === 0 ? (
        <p className="small muted">{t('The media library is empty.')}</p>
      ) : (
        <div className="admin-media">
          {media.map((m) => (
            <div className="admin-media-card" key={m.id}>
              {m.mime.startsWith('image/') ? (
                <img src={m.url} alt={m.alt || m.originalName} loading="lazy" />
              ) : (
                <div className="admin-media-file">{m.mime}</div>
              )}
              <div className="admin-media-meta">
                <span className="admin-media-name" title={m.originalName}>
                  {m.originalName || m.filename}
                </span>
                <span className="small muted">{bytes(m.size)}</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-soft btn-sm" onClick={() => void copyUrl(m)}>
                    {t('Copy URL')}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (window.confirm(t('Delete this file?'))) void run(() => del(`/admin/media/${m.id}`), t('File deleted.'));
                    }}
                  >
                    {t('Delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderUsers = () => (
    <>
      <div className="card">
        <input
          className="input"
          placeholder={t('Search users by name or email')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('Search users')}
        />
      </div>
      {users.length === 0 ? (
        <p className="small muted">{t('No users found.')}</p>
      ) : (
        users.map((u) => (
          <div className="admin-item" key={u.id}>
            <div className="admin-item-main">
              <strong>{u.name || u.email}</strong>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                {u.email} | {t('Joined')} {when(u.createdAt)}
                {u.banned ? ` | ${t('Banned')}` : ''}
              </p>
            </div>
            <div className="admin-item-actions">
              <select
                className="select"
                value={u.role}
                aria-label={t('Role')}
                onChange={(e) => void run(() => patch(`/admin/users/${u.id}`, { role: e.target.value }), t('Role updated.'))}
              >
                <option value="user">{t('User')}</option>
                <option value="admin">{t('Admin')}</option>
                <option value="superadmin">{t('Super Admin')}</option>
              </select>
              <button
                className="btn btn-soft btn-sm"
                onClick={() => void run(() => patch(`/admin/users/${u.id}`, { banned: !u.banned }), t('User updated.'))}
              >
                {u.banned ? t('Unban') : t('Ban')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (window.confirm(t('Delete this user and their data?'))) void run(() => del(`/admin/users/${u.id}`), t('User deleted.'));
                }}
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );

  const renderMessages = () => (
    <>
      {messages.length === 0 ? (
        <p className="small muted">{t('No contact messages yet.')}</p>
      ) : (
        messages.map((m) => (
          <div className="card" key={m.id}>
            <div className="row between">
              <strong>{m.subject || t('Contact message')}</strong>
              <span className={m.status === 'new' ? 'admin-badge live' : 'admin-badge draft'}>{m.status}</span>
            </div>
            <p className="small muted" style={{ margin: '4px 0' }}>
              {m.name} | {m.email}
              {m.phone ? ` | ${m.phone}` : ''} | {when(m.created_at)}
            </p>
            <p className="small" style={{ margin: '0 0 8px' }}>
              {m.body}
            </p>
            <div className="admin-toolbar">
              <a className="btn btn-soft btn-sm" href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject || 'RIFQ Muslim')}`}>
                {t('Reply by email')}
              </a>
              <button
                className="btn btn-soft btn-sm"
                onClick={() => void run(() => patch(`/admin/messages/${m.id}`, { status: 'replied' }), t('Marked as replied.'))}
              >
                {t('Mark replied')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (window.confirm(t('Delete this message?'))) void run(() => del(`/admin/messages/${m.id}`), t('Message deleted.'));
                }}
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );

  const renderCommunity = () => (
    <>
      <div className="card">
        <h3 className="admin-card-title">{t('Reports')}</h3>
        {reports.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            {t('No reports. The community is clean.')}
          </p>
        ) : (
          reports.map((r) => (
            <div className="admin-item" key={r.id}>
              <div className="admin-item-main">
                <strong>{r.reason}</strong>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {r.post_author || t('unknown')} | {when(r.created_at)} | {r.status}
                </p>
                {r.post_body ? <p className="small" style={{ margin: '4px 0 0' }}>{r.post_body}</p> : null}
              </div>
              <div className="admin-item-actions">
                <button
                  className="btn btn-soft btn-sm"
                  onClick={() =>
                    void run(
                      () => patch(`/admin/reports/${r.id}`, { status: 'resolved', hidePost: true, postId: r.post_id }),
                      t('Report resolved and post hidden.')
                    )
                  }
                >
                  {t('Resolve + hide')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void run(() => patch(`/admin/reports/${r.id}`, { status: 'dismissed' }), t('Report dismissed.'))}
                >
                  {t('Dismiss')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="card">
        <h3 className="admin-card-title">{t('Latest posts')}</h3>
        {posts.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            {t('No community posts yet.')}
          </p>
        ) : (
          posts.slice(0, 20).map((p) => (
            <div className="admin-item" key={p.id}>
              <div className="admin-item-main">
                <strong>{p.author}</strong>
                <p className="small" style={{ margin: '2px 0 0' }}>
                  {p.body.slice(0, 160)}
                </p>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {when(p.created_at)} | {p.status}
                </p>
              </div>
              <div className="admin-item-actions">
                <button
                  className="btn btn-soft btn-sm"
                  onClick={() =>
                    void run(
                      () => patch(`/admin/posts/${p.id}`, { status: p.status === 'hidden' ? 'published' : 'hidden' }),
                      t('Post updated.')
                    )
                  }
                >
                  {p.status === 'hidden' ? t('Show') : t('Hide')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (window.confirm(t('Delete this post?'))) void run(() => del(`/admin/posts/${p.id}`), t('Post deleted.'));
                  }}
                >
                  {t('Delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  const renderNotifications = () => (
    <>
      <div className="card gold-edge">
        <h3 className="admin-card-title">{t('Send a notification')}</h3>
        <div className="field">
          <label htmlFor="n-title">{t('Title')}</label>
          <input
            id="n-title"
            className="input"
            value={noticeForm.title}
            onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="n-body">{t('Message')}</label>
          <textarea
            id="n-body"
            className="textarea"
            rows={4}
            value={noticeForm.body}
            onChange={(e) => setNoticeForm({ ...noticeForm, body: e.target.value })}
          />
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            const ok = await run(() => post('/admin/notifications', noticeForm), t('Notification sent.'));
            if (ok) setNoticeForm({ title: '', body: '' });
          }}
        >
          {t('Send to all users')}
        </button>
      </div>
      {notices.length === 0 ? (
        <p className="small muted">{t('No notifications sent yet.')}</p>
      ) : (
        notices.map((n) => (
          <div className="admin-item" key={n.id}>
            <div className="admin-item-main">
              <strong>{n.title}</strong>
              <p className="small" style={{ margin: '2px 0 0' }}>
                {n.body}
              </p>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                {when(n.created_at)}
              </p>
            </div>
            <div className="admin-item-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (window.confirm(t('Delete this notification?'))) void run(() => del(`/admin/notifications/${n.id}`), t('Notification deleted.'));
                }}
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );

  const renderSettings = () => (
    <div className="card">
      <h3 className="admin-card-title">{t('Website settings')}</h3>
      {SETTING_FIELDS.map((f) => {
        if (f.kind === 'bool') {
          return (
            <label key={f.key} className="row between" style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <span className="small">{t(f.label)}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings[f.key] === 'true'}
                  onChange={(e) => setSettings({ ...settings, [f.key]: e.target.checked ? 'true' : 'false' })}
                />
                <span className="track" />
              </span>
            </label>
          );
        }
        return (
          <div className="field" key={f.key}>
            <label htmlFor={`s-${f.key}`}>{t(f.label)}</label>
            {f.kind === 'textarea' ? (
              <textarea
                id={`s-${f.key}`}
                className="textarea"
                rows={3}
                value={settings[f.key] || ''}
                onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
              />
            ) : (
              <input
                id={`s-${f.key}`}
                className="input"
                type={f.kind === 'email' ? 'email' : 'text'}
                value={settings[f.key] || ''}
                onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
              />
            )}
          </div>
        );
      })}
      <button className="btn btn-primary btn-sm" onClick={() => void saveSettings()}>
        {t('Save settings')}
      </button>
      <p className="admin-note" style={{ marginTop: 8 }}>
        {t('Saved settings update the live application immediately.')}
      </p>
    </div>
  );

  const renderActivity = () => (
    <div className="card">
      <h3 className="admin-card-title">{t('Activity log')}</h3>
      {logs.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {t('No activity recorded yet.')}
        </p>
      ) : (
        logs.map((r) => (
          <div className="admin-log" key={r.id}>
            <span className="admin-log-action">{r.action}</span>
            <span className="small muted">{r.detail}</span>
            <span className="admin-log-time">
              {r.actor_email || t('system')} | {when(r.created_at)}
            </span>
          </div>
        ))
      )}
    </div>
  );

  const renderSecurity = () => (
    <>
      <div className="card">
        <h3 className="admin-card-title">{t('Your account')}</h3>
        <p className="small" style={{ margin: 0 }}>
          {security?.name || user?.name} | {security?.email || user?.email} | {security?.role || user?.role}
        </p>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('Last sign in')}: {when(security?.lastLogin)}
        </p>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('Password storage')}: {security?.passwordScheme || 'scrypt'}
        </p>
      </div>

      <form className="card gold-edge" onSubmit={changePassword}>
        <h3 className="admin-card-title">{t('Change password')}</h3>
        <div className="field">
          <label htmlFor="pw-current">{t('Current password')}</label>
          <input
            id="pw-current"
            className="input"
            type="password"
            autoComplete="current-password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pw-next">{t('New password')}</label>
          <input
            id="pw-next"
            className="input"
            type="password"
            autoComplete="new-password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">{t('Confirm new password')}</label>
          <input
            id="pw-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            required
          />
        </div>
        <button className="btn btn-primary btn-sm" type="submit">
          {t('Update password')}
        </button>
      </form>

      <div className="card">
        <h3 className="admin-card-title">{t('Administrators')}</h3>
        {(security?.admins || []).map((a) => (
          <div className="admin-log" key={a.id}>
            <span className="admin-log-action">{a.email}</span>
            <span className="small muted">{a.role}</span>
            <span className="admin-log-time">{when(a.last_login)}</span>
          </div>
        ))}
        <p className="admin-note" style={{ marginTop: 8 }}>
          {security?.sessionNote}
        </p>
      </div>

      <div className="card">
        <h3 className="admin-card-title">{t('Sessions and backup')}</h3>
        <div className="admin-toolbar">
          <button
            className="btn btn-soft btn-sm"
            onClick={() => void run(() => post('/admin/sessions/revoke', {}), t('Other sessions signed out.'))}
          >
            {t('Sign out other devices')}
          </button>
          <a className="btn btn-soft btn-sm" href="/api/admin/backup">
            {t('Download data backup')}
          </a>
        </div>
        <p className="admin-note" style={{ marginTop: 8 }}>
          {t('Passwords and signing secrets are never included in a backup.')}
        </p>
      </div>
    </>
  );

  return (
    <Page title="Super Admin" subtitle={t('Complete control over RIFQ Muslim')}>
      <div className="admin-hero card gold-edge">
        <div>
          <p className="admin-eyebrow">{isSuper ? t('SUPER ADMIN') : t('ADMINISTRATOR')}</p>
          <h2 style={{ margin: '2px 0 4px' }}>{user?.name || user?.email}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {user?.email}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-soft btn-sm" to="/">
            {t('View live app')}
          </Link>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await post('/auth/logout', {});
              await refreshUser();
            }}
          >
            {t('Sign out')}
          </button>
        </div>
      </div>

      <div className="admin-layout">
        <nav className="admin-nav" aria-label={t('Admin sections')}>
          {TABS.filter((x) => !x.superOnly || isSuper).map((x) => (
            <button
              key={x.id}
              type="button"
              className={tab === x.id ? 'admin-tab active' : 'admin-tab'}
              aria-current={tab === x.id ? 'page' : undefined}
              onClick={() => {
                setTab(x.id);
                setQ('');
                setError('');
              }}
            >
              {t(x.label)}
            </button>
          ))}
        </nav>

        <div className="admin-body">
          {error ? (
            <div className="card" style={{ borderColor: 'rgba(224,101,91,.5)' }}>
              <p className="small" style={{ margin: 0 }}>
                {error}
              </p>
            </div>
          ) : null}
          {loading ? <Loading /> : null}
          {!loading && tab === 'overview' ? renderOverview() : null}
          {!loading && tab === 'content' ? renderContent() : null}
          {!loading && tab === 'media' ? renderMedia() : null}
          {!loading && tab === 'users' ? renderUsers() : null}
          {!loading && tab === 'messages' ? renderMessages() : null}
          {!loading && tab === 'community' ? renderCommunity() : null}
          {!loading && tab === 'notifications' ? renderNotifications() : null}
          {!loading && tab === 'settings' ? renderSettings() : null}
          {!loading && tab === 'activity' ? renderActivity() : null}
          {!loading && tab === 'security' ? renderSecurity() : null}
        </div>
      </div>
    </Page>
  );
}
