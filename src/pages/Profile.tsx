import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, Loading } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import VerifiedBadge from '../components/VerifiedBadge';
import { useStore } from '../lib/store';
import { get, patch, post, del } from '../lib/api';
import { LANGS, type Lang } from '../lib/i18n';

interface VerificationRequest {
  id: string;
  fullName: string;
  reason: string;
  avatarUrl: string;
  links: string[];
  documentCount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionReason?: string;
}

interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

const MAX_DOCS = 3;
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_DOC = 4 * 1024 * 1024;

/** Data URL for the API, which validates the real bytes and type server-side. */
const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

export default function Profile() {
  const { t, user, authReady, refreshUser, logout, lang, setLang, toast } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  const [badgeReq, setBadgeReq] = useState<VerificationRequest | null>(null);
  const [badgeLoaded, setBadgeLoaded] = useState(false);
  const [fullName, setFullName] = useState('');
  const [reason, setReason] = useState('');
  const [links, setLinks] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [docs, setDocs] = useState<File[]>([]);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (authReady && !user) navigate('/login?next=/profile', { replace: true });
    if (user) {
      setName(user.name);
      setFullName((prev) => prev || user.name || '');
    }
  }, [authReady, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    get<{ request: VerificationRequest | null }>('/badge/request')
      .then((r) => {
        if (!alive) return;
        setBadgeReq(r.request);
        if (r.request?.fullName) setFullName((prev) => prev || r.request.fullName);
        if (r.request?.reason) setReason((prev) => prev || r.request.reason);
        if (r.request?.links?.length) setLinks((prev) => prev || r.request.links.join('\n'));
      })
      .catch(() => {
        /* the card stays in its default state */
      })
      .finally(() => {
        if (alive) setBadgeLoaded(true);
      });
    get<{ notifications: AppNotification[]; unread: number }>('/notifications')
      .then((r) => {
        if (!alive) return;
        setNotifications(r.notifications || []);
        setUnread(r.unread || 0);
      })
      .catch(() => {
        /* notifications are a convenience; the card is simply hidden */
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!authReady) return <Page title="Profile"><Loading /></Page>;
  if (!user) return <Page title="Profile"><p className="small">{t('Redirecting to sign in…')}</p></Page>;

  const saveProfile = async () => {
    setBusy(true);
    try {
      await patch('/auth/profile', { name, lang });
      await refreshUser();
      toast(t('Profile saved'), 'success');
    } catch (err) {
      toast((err as Error).message || t('The profile could not be saved'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      toast(t('Password updated. Other sessions were signed out.'), 'success');
    } catch (err) {
      toast((err as Error).message || t('The password could not be changed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = (file: File | null) => {
    if (!file) {
      setAvatar(null);
      setAvatarPreview('');
      return;
    }
    if (file.size > MAX_AVATAR) {
      toast(t('The profile picture must be smaller than 2 MB.'), 'error');
      return;
    }
    setAvatar(file);
    void readAsDataUrl(file)
      .then(setAvatarPreview)
      .catch(() => setAvatarPreview(''));
  };

  const pickDocs = (files: FileList | null) => {
    const picked = Array.from(files || []);
    if (picked.length > MAX_DOCS) {
      toast(t('Please attach at most 3 documents.'), 'error');
      return;
    }
    const tooBig = picked.find((f) => f.size > MAX_DOC);
    if (tooBig) {
      toast(t('Each document must be smaller than 4 MB.'), 'error');
      return;
    }
    setDocs(picked);
  };

  const requestVerification = async () => {
    if (fullName.trim().length < 3) return toast(t('Please enter your full name.'), 'error');
    if (reason.trim().length < 20) {
      return toast(t('Please explain in at least 20 characters why this account should be verified.'), 'error');
    }
    if (!avatar) return toast(t('A profile picture is required for verification.'), 'error');
    setBadgeBusy(true);
    try {
      const documents = await Promise.all(
        docs.map(async (file) => ({
          name: file.name,
          mime: file.type,
          data: await readAsDataUrl(file),
        }))
      );
      const r = await post<{ request: VerificationRequest }>('/badge/request', {
        fullName: fullName.trim(),
        reason: reason.trim(),
        links: links
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        avatar: await readAsDataUrl(avatar),
        avatarMime: avatar.type,
        documents,
      });
      setBadgeReq(r.request);
      setDocs([]);
      await refreshUser();
      toast(t('Verification request sent. An administrator will review it.'), 'success');
    } catch (err) {
      toast((err as Error).message || t('The request could not be sent'), 'error');
    } finally {
      setBadgeBusy(false);
    }
  };

  const markNotificationsRead = async () => {
    try {
      await post('/notifications/read', {});
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch (err) {
      toast((err as Error).message || t('The notifications could not be updated'), 'error');
    }
  };

  const deleteAccount = async () => {
    if (confirmDelete !== 'DELETE') return toast(t('Type DELETE to confirm'), 'error');
    setBusy(true);
    try {
      await del('/auth/account');
      await refreshUser();
      toast(t('Your account has been deleted'), 'success');
      navigate('/');
    } catch (err) {
      toast((err as Error).message || t('The account could not be deleted'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const canRequest = !user.badgeVerified && badgeReq?.status !== 'pending';
  const avatarSrc = user.avatarUrl || badgeReq?.avatarUrl || '';

  return (
    <Page title="Profile" subtitle={user.email}>
      <div className="card center">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={user.name}
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              objectFit: 'cover',
              margin: '0 auto 8px',
              border: '2px solid var(--gold)',
            }}
          />
        ) : (
          <div className="tile-icon" style={{ margin: '0 auto 8px', width: 64, height: 64, fontSize: 26 }}>
            {user.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <h3 className="section-title qa-author" style={{ marginBottom: 2, justifyContent: 'center' }}>
          {user.name}
          {user.badgeVerified && <VerifiedBadge size={16} />}
        </h3>
        {user.badgeVerified && (
          <p className="tiny" style={{ margin: '0 0 2px', color: '#1d9bf0' }}>
            {t('Verified Account')}
            {user.badgeVerifiedAt ? ` · ${new Date(user.badgeVerifiedAt).toLocaleDateString()}` : ''}
          </p>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          {user.emailVerified ? t('Email verified') : t('Email not verified yet')}
          {user.role === 'admin' ? ` · ${t('Administrator')}` : ''}
          {user.role === 'superadmin' ? ` · ${t('Owner')}` : ''}
        </p>
      </div>

      {notifications.length > 0 && (
        <div className="card">
          <h3 className="section-title">
            {t('Notifications')}
            {unread > 0 ? ` · ${unread}` : ''}
          </h3>
          {notifications.slice(0, 8).map((n) => (
            <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <strong className="small" style={{ display: 'block' }}>
                {n.title}
              </strong>
              {n.body && (
                <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                  {n.body}
                </p>
              )}
              <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                {new Date(n.created_at).toLocaleString()}
                {n.read_at ? '' : ` · ${t('New')}`}
              </p>
            </div>
          ))}
          {unread > 0 && (
            <button className="btn btn-soft btn-block" style={{ marginTop: 8 }} onClick={() => void markNotificationsRead()}>
              {t('Mark all as read')}
            </button>
          )}
        </div>
      )}

      {!user.badgeVerified && (
        <div className="card">
          <h3 className="section-title">{t('Blue verified badge')}</h3>

          {!badgeLoaded ? (
            <Loading />
          ) : badgeReq?.status === 'pending' ? (
            <>
              <p className="small">
                {t('Your verification request is waiting for review. You cannot send another one until it is decided.')}
              </p>
              <p className="tiny muted">
                {t('Submitted')} {new Date(badgeReq.createdAt).toLocaleString()}
                {badgeReq.documentCount ? ` · ${badgeReq.documentCount} ${t('documents attached')}` : ''}
              </p>
              <div className="admin-item" style={{ marginTop: 6 }}>
                <div className="admin-item-main">
                  <strong className="small">{badgeReq.fullName || user.name}</strong>
                  <p className="tiny muted" style={{ margin: '2px 0 0' }}>{badgeReq.reason}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="tiny muted">
                {badgeReq?.status === 'rejected'
                  ? t('Your last verification request was not approved. You can send a new request with more details.')
                  : t('Verified accounts are reviewed by an administrator. Sending a request never grants the badge automatically.')}
              </p>
              {badgeReq?.status === 'rejected' && badgeReq.decisionReason && (
                <p className="small" style={{ color: 'var(--danger)' }}>
                  {t('Reason')}: {badgeReq.decisionReason}
                </p>
              )}
              {badgeReq?.status === 'rejected' && badgeReq.decidedAt && (
                <p className="tiny muted">
                  {t('Reviewed')} {new Date(badgeReq.decidedAt).toLocaleString()}
                  {badgeReq.decidedBy ? ` · ${badgeReq.decidedBy}` : ''}
                </p>
              )}

              <div className="field">
                <label>{t('Full name')}</label>
                <input
                  className="input"
                  value={fullName}
                  maxLength={120}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('Your full name as it should appear')}
                />
              </div>
              <div className="field">
                <label>{t('Why should this account be verified?')}</label>
                <textarea
                  className="input"
                  rows={4}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('Describe your role, organisation or public work (at least 20 characters).')}
                />
              </div>
              <div className="field">
                <label>{t('Profile picture (required)')}</label>
                <input
                  className="input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => pickAvatar(e.target.files?.[0] || null)}
                />
                {avatarPreview && (
                  <img
                    src={avatarPreview}
                    alt={t('Profile picture preview')}
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', marginTop: 8 }}
                  />
                )}
                <p className="tiny muted">{t('PNG, JPEG or WebP up to 2 MB.')}</p>
              </div>
              <div className="field">
                <label>{t('Supporting links (optional)')}</label>
                <textarea
                  className="input"
                  rows={2}
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  placeholder="https://…"
                />
                <p className="tiny muted">{t('One link per line, up to 5.')}</p>
              </div>
              <div className="field">
                <label>{t('Supporting documents (optional)')}</label>
                <input
                  className="input"
                  type="file"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => pickDocs(e.target.files)}
                />
                <p className="tiny muted">
                  {docs.length > 0
                    ? `${docs.length} ${t('file(s) selected')}`
                    : t('PDF or image, up to 3 files of 4 MB each. Only administrators can open them.')}
                </p>
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={() => void requestVerification()}
                disabled={badgeBusy || !canRequest}
              >
                {badgeBusy ? t('Sending…') : t('Request verification')}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3 className="section-title">{t('Edit profile')}</h3>
        <div className="field">
          <label>{t('Name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('Language')}</label>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.native}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => void saveProfile()} disabled={busy}>
          {t('Save profile')}
        </button>
      </div>

      <div className="card">
        <h3 className="section-title">{t('Change password')}</h3>
        <div className="field">
          <label>{t('Current password')}</label>
          <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('New password')}</label>
          <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <button className="btn btn-soft btn-block" onClick={() => void changePassword()} disabled={busy}>
          {t('Update password')}
        </button>
      </div>

      <div className="card">
        <h3 className="section-title">{t('Shortcuts')}</h3>
        <div className="grid grid-2">
          <Link to="/tracker" className="btn btn-soft"><AppIcon name="check" size={16} /> {t('Tracker')}</Link>
          <Link to="/bookmarks" className="btn btn-soft"><AppIcon name="bookmark" size={16} /> {t('Bookmarks')}</Link>
          <Link to="/settings" className="btn btn-soft"><AppIcon name="settings" size={16} /> {t('Settings')}</Link>
          <Link to="/privacy" className="btn btn-soft"><AppIcon name="shield" size={16} /> {t('Privacy')}</Link>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">{t('Session')}</h3>
        <button className="btn btn-ghost btn-block" onClick={() => void logout()}>{t('Sign out')}</button>
      </div>

      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h3 className="section-title" style={{ color: 'var(--danger)' }}>{t('Delete account')}</h3>
        <p className="small">{t('This permanently removes your profile, bookmarks, tracker history and posts. It cannot be undone.')}</p>
        <input className="input" placeholder={t('Type DELETE to confirm')} value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
        <button className="btn btn-block" style={{ marginTop: 8, background: 'var(--danger)', color: '#fff' }} onClick={() => void deleteAccount()} disabled={busy}>
          {t('Delete my account permanently')}
        </button>
      </div>
    </Page>
  );
}
