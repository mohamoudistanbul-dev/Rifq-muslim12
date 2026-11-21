import React, { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon, type IconName } from '../components/Icons';
import { useStore } from '../lib/store';
import { get, post, ApiError } from '../lib/api';

/**
 * Kid Academy.
 *
 * Lesson content comes from the server catalogue; stars, badges and
 * certificates are recorded server-side. A certificate is only issued when the
 * server confirms every active lesson is finished.
 */

type Lang3 = [string, string, string];

interface Lesson {
  id: string;
  kind: 'letter' | 'surah' | 'pillar' | 'manner' | 'story';
  kindLabel: string;
  sort: number;
  title: Lang3;
  body: any;
  progress: { done: boolean; stars: number };
}

interface Stats {
  lessons: number;
  completed: number;
  stars: number;
  percent: number;
}

interface Badge {
  id: string;
  label: string;
  earned: boolean;
  detail?: string;
}

interface Certificate {
  id: string;
  childName: string;
  stars: number;
  lessons: number;
  issuedAt: string;
}

const KIND_ICON: Record<string, IconName> = {
  letter: 'book',
  surah: 'quran',
  pillar: 'star',
  manner: 'check',
  story: 'sparkle',
};

export default function Kids() {
  const { t, lang, user, toast } = useStore();
  const index = lang === 'ar' ? 1 : lang === 'so' ? 2 : 0;

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [kinds, setKinds] = useState<{ id: string; label: string }[]>([]);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<Lesson | null>(null);
  const [tab, setTab] = useState<'learn' | 'parent'>('learn');
  const [loading, setLoading] = useState(true);

  const [childName, setChildName] = useState('');
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [answer, setAnswer] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);

  const load = async () => {
    try {
      const data = await get<{ lessons: Lesson[]; kinds: { id: string; label: string }[]; stats: Stats; badges: Badge[] }>(
        '/kids/lessons'
      );
      setLessons(data.lessons || []);
      setKinds(data.kinds || []);
      setStats(data.stats || null);
      setBadges(data.badges || []);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('Lessons could not be loaded'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadParent = async () => {
    if (!user) return;
    try {
      const data = await get<{ badges: Badge[]; certificates: Certificate[]; stars: number; percent: number; completed: number; total: number }>(
        '/kids/progress'
      );
      setBadges(data.badges || []);
      setCertificates(data.certificates || []);
      setStats({ lessons: data.total, completed: data.completed, stars: data.stars, percent: data.percent });
    } catch {
      /* parent summary is optional */
    }
  };

  useEffect(() => {
    void load();
    void loadParent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, lang]);

  const visible = useMemo(
    () => (filter === 'all' ? lessons : lessons.filter((lesson) => lesson.kind === filter)),
    [lessons, filter]
  );

  const complete = async (lesson: Lesson) => {
    if (!user) {
      toast(t('Sign in to save stars and certificates'), 'error');
      return;
    }
    const stars = lesson.kind === 'surah' || lesson.kind === 'story' ? 2 : 1;
    try {
      const data = await post<{ totalStars: number; badges: Badge[] }>('/kids/complete', { lessonId: lesson.id, stars });
      setLessons((rows) =>
        rows.map((row) => (row.id === lesson.id ? { ...row, progress: { done: true, stars: Math.max(row.progress.stars, stars) } } : row))
      );
      setBadges(data.badges || []);
      toast(`+${stars} ★`, 'success');
      void loadParent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('This lesson could not be saved'), 'error');
    }
  };

  /** Device speech synthesis: used for letter and surah pronunciation. */
  const speak = (text: string, language = 'ar-SA') => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) {
        toast(t('Audio pronunciation is not available on this device'), 'error');
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = 0.8;
      synth.speak(utterance);
    } catch {
      toast(t('Audio pronunciation is not available on this device'), 'error');
    }
  };

  const issueCertificate = async () => {
    if (!user) {
      toast(t('Sign in to receive a certificate'), 'error');
      return;
    }
    try {
      const data = await post<{ certificate: Certificate }>('/kids/certificate', { childName });
      setCertificates((rows) => [data.certificate, ...rows]);
      toast(t('Certificate issued'), 'success');
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('not_complete')) {
        toast(t('Finish every lesson to unlock the certificate'), 'error');
      } else {
        toast(err instanceof ApiError ? err.message : t('The certificate could not be issued'), 'error');
      }
    }
  };

  const saveName = async () => {
    if (!childName.trim()) return;
    try {
      await post('/kids/name', { name: childName.trim() });
      toast(t('Name saved'), 'success');
    } catch {
      toast(t('The name could not be saved'), 'error');
    }
  };

  const reset = async () => {
    if (!user) return;
    if (!window.confirm(t('Reset all Kid Academy progress for this account?'))) return;
    try {
      await post('/kids/reset', {});
      setLessons((rows) => rows.map((row) => ({ ...row, progress: { done: false, stars: 0 } })));
      setStats((value) => (value ? { ...value, completed: 0, stars: 0, percent: 0 } : value));
      toast(t('Progress reset'), 'success');
      void loadParent();
    } catch {
      toast(t('Progress could not be reset'), 'error');
    }
  };

  /* ------------------------------ lesson view ----------------------------- */
  if (open) {
    const body = open.body || {};
    const quiz = body.quiz || body.question;
    const textLines: string[] = Array.isArray(body.text) ? body.text : [];

    const answeredCorrect = answered && quiz && answer === quiz.answer;

    return (
      <Page
        title={open.title[index]}
        subtitle={t(open.kindLabel)}
        back={false}
        actions={
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setOpen(null);
              setAnswer(null);
              setAnswered(false);
            }}
          >
            {t('Back to lessons')}
          </button>
        }
      >
        <div className="stack">
          <div className="card kid-card">
            {open.kind === 'letter' ? (
              <div className="kid-glyph">
                <div style={{ fontSize: 96, lineHeight: 1.1 }}>{body.glyph}</div>
                <div className="muted small">{body.name} · “{body.sound}”</div>
                <button className="btn btn-soft btn-sm" style={{ marginTop: 10 }} onClick={() => speak(body.glyph)}>
                  <AppIcon name="play" size={16} /> {t('Hear the letter')}
                </button>
              </div>
            ) : null}

            {open.kind === 'surah' ? (
              <div className="stack">
                <div className="muted small">
                  {t('Surah')} {body.number} · {body.ayahs} {t('verses')}
                </div>
                <div className="arabic" dir="rtl" style={{ fontSize: 26, lineHeight: 2 }}>
                  {body.arabic}
                </div>
                <button className="btn btn-soft btn-sm" onClick={() => speak(body.arabic || '')}>
                  <AppIcon name="play" size={16} /> {t('Listen')}
                </button>
                {Array.isArray(body.meaning) ? (
                  <div className="small muted" style={{ marginTop: 4 }}>{body.meaning[index]}</div>
                ) : null}
              </div>
            ) : null}

            {open.kind === 'pillar' || open.kind === 'manner' || open.kind === 'story' ? (
              <div className="stack">
                <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <AppIcon name={KIND_ICON[open.kind] || 'star'} size={22} />
                  <div className="section-title">{open.title[index]}</div>
                </div>
                {textLines.length ? <div className="small">{textLines[index]}</div> : null}
                {body.source ? <div className="refs tiny">{body.source}</div> : null}
                {open.kind === 'story' ? (
                  <button className="btn btn-soft btn-sm" onClick={() => speak(textLines[0] || '', 'en-US')}>
                    <AppIcon name="play" size={16} /> {t('Read aloud')}
                  </button>
                ) : null}
              </div>
            ) : null}

            {Array.isArray(body.hint) ? <div className="muted small">{body.hint[index]}</div> : null}
          </div>

          {quiz && Array.isArray(quiz.q) ? (
            <div className="card">
              <div className="section-title">{quiz.q[index]}</div>
              <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                {(quiz.options || []).map((option: Lang3, optionIndex: number) => {
                  const isAnswer = optionIndex === quiz.answer;
                  const chosen = answer === optionIndex;
                  return (
                    <button
                      key={optionIndex}
                      className={`btn btn-block ${chosen ? (isAnswer ? 'btn-primary' : 'btn-danger') : 'btn-soft'}`}
                      style={{ textAlign: 'start', justifyContent: 'flex-start' }}
                      onClick={() => {
                        if (answered) return;
                        setAnswer(optionIndex);
                        setAnswered(true);
                        if (isAnswer) void complete(open);
                      }}
                    >
                      {option[index]}
                      {answered && isAnswer ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
              {answered ? (
                <div className="muted small" style={{ marginTop: 8 }}>
                  {answeredCorrect ? t('Correct — well done!') : t('Not quite. Try the lesson again.')}
                </div>
              ) : null}
            </div>
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => void complete(open)}>
              <AppIcon name="check" size={16} /> {open.progress.done ? t('Mark as reviewed') : t('I learned this')}
            </button>
          )}
        </div>
      </Page>
    );
  }

  /* ------------------------------- main view ------------------------------ */
  return (
    <Page title="Kid Academy" subtitle="Letters, surahs, stories and manners">
      <div className="stack">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="section-title">{t('My progress')}</div>
              <div className="muted tiny">
                {stats ? `${stats.completed}/${stats.lessons} ${t('lessons')} · ${stats.stars} ★` : t('Loading…')}
              </div>
            </div>
            <div className="stat">{stats ? `${stats.percent}%` : '—'}</div>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'rgba(0,0,0,.08)', marginTop: 10, overflow: 'hidden' }}>
            <div
              style={{ width: `${stats?.percent || 0}%`, height: '100%', background: 'linear-gradient(90deg,#0f6b4f,#c9a227)' }}
            />
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className={`btn btn-sm ${tab === 'learn' ? 'btn-primary' : 'btn-soft'}`} onClick={() => setTab('learn')}>
              <AppIcon name="book" size={16} /> {t('Learn')}
            </button>
            <button className={`btn btn-sm ${tab === 'parent' ? 'btn-primary' : 'btn-soft'}`} onClick={() => setTab('parent')}>
              <AppIcon name="shield" size={16} /> {t('Parent')}
            </button>
          </div>
        </div>

        {tab === 'learn' ? (
          <>
            <div className="chips">
              <button className={`chip ${filter === 'all' ? 'chip-active' : ''}`} onClick={() => setFilter('all')}>
                {t('All')}
              </button>
              {kinds.map((kind) => (
                <button
                  key={kind.id}
                  className={`chip ${filter === kind.id ? 'chip-active' : ''}`}
                  onClick={() => setFilter(kind.id)}
                >
                  {t(kind.label)}
                </button>
              ))}
            </div>

            {loading ? <div className="empty">{t('Loading lessons…')}</div> : null}

            <div className="stack" style={{ gap: 8 }}>
              {visible.map((lesson) => (
                <button key={lesson.id} className="card kid-row" onClick={() => { setOpen(lesson); setAnswer(null); setAnswered(false); }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                      <span className="kid-badge"><AppIcon name={KIND_ICON[lesson.kind] || 'star'} size={18} /></span>
                      <div>
                        <div className="small" style={{ fontWeight: 600 }}>{lesson.title[index]}</div>
                        <div className="muted tiny">{t(lesson.kindLabel)}</div>
                      </div>
                    </div>
                    <span className="tiny">{lesson.progress.done ? '★'.repeat(Math.max(1, lesson.progress.stars)) : '☆'}</span>
                  </div>
                </button>
              ))}
            </div>

            {!user ? (
              <div className="notice">{t('Sign in so stars, badges and certificates are saved to your account.')}</div>
            ) : null}
          </>
        ) : (
          <>
            <div className="card">
              <div className="section-title">{t('Child name on certificates')}</div>
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <input
                  className="input"
                  value={childName}
                  placeholder={t('e.g. Amina')}
                  onChange={(event) => setChildName(event.target.value)}
                  maxLength={60}
                />
                <button className="btn btn-primary btn-sm" onClick={() => void saveName()} disabled={!childName.trim()}>
                  {t('Save')}
                </button>
              </div>
              <div className="muted tiny" style={{ marginTop: 6 }}>
                {t('Only the child’s first name is stored, and it is used only for certificates.')}
              </div>
            </div>

            <div className="card">
              <div className="section-title">{t('Badges')}</div>
              <div className="grid grid-2" style={{ marginTop: 10, gap: 8 }}>
                {badges.map((badge) => (
                  <div
                    key={badge.id}
                    className="kid-badge-card"
                    style={{ opacity: badge.earned ? 1 : 0.45 }}
                    title={badge.detail || badge.label}
                  >
                    <AppIcon name={badge.earned ? 'star' : 'lock'} size={18} />
                    <div className="small">{t(badge.label)}</div>
                    {badge.detail ? <div className="muted tiny">{badge.detail}</div> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="section-title">{t('Certificate')}</div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {t('Unlocked after every lesson is completed.')}
              </div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => void issueCertificate()}>
                <AppIcon name="star" size={16} /> {t('Get my certificate')}
              </button>

              {certificates.map((certificate) => (
                <div className="certificate" key={certificate.id}>
                  <div className="certificate-brand">RIFQ Muslim</div>
                  <div className="certificate-title">{t('Certificate of Achievement')}</div>
                  <div className="certificate-name">{certificate.childName}</div>
                  <div className="muted small">
                    {certificate.lessons} {t('lessons')} · {certificate.stars} ★
                  </div>
                  <div className="muted tiny">{new Date(certificate.issuedAt).toLocaleDateString()}</div>
                  <button className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={() => window.print()}>
                    {t('Print or save as PDF')}
                  </button>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="section-title">{t('Parent controls')}</div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {t('Kid Academy has no ads, no chat and no external links.')}
              </div>
              <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => void reset()}>
                {t('Reset progress')}
              </button>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
