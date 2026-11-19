import React, { useEffect, useState } from 'react';
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

interface AuditRow { id: string; actor_email?: string; action: string; detail: string; created_at: string }
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
interface Post { id: string; author: string; body: string; status: string; likes: number; created_at: string }
interface Notice { id: string; title: string; body: string; created_at: string }
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
  { key: 'download_url', label: 'Download / invitation URL', kind: 'url' },
  { key: 'announcement_text', label: 'Announcement banner', kind: 'textarea' },
  { key: 'announcement_active', label: 'Show announcement on Home', kind: 'bool' },
  { key: 'community_enabled', label: 'Community enabled', kind: 'bool' },
];

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const bytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ------------------------------- login gate -------------------------------- */

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
        {error && (
          <p className="small" role="alert" style={{ color: '#f0a29b', margin: '0 0 10px' }}>
            {error}
          </p>
       姉{}
          )姉{error}
       姉{.error}
         姛(answer)</p>
姉2024 }}
         姉Hp>
         姉Elim_{error姉门</p>
姉妙 admin>
     姹 why p{error姉رم page.
           姫墨 colorbar={{姫的动作IT. Great姤 inward message. Body姉庞 icon (#define姫把2026.姦擦完/error姹么22+xT姫一大片?(!姉宏泰_trunc姀(object,000 pret姉Bo) => ('' as string))}
          </p>
        )}
      </form>
    </Page>
  );
}

export default function Admin() {
  return null;
}
