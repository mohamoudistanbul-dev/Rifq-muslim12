import React, { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get, post, ApiError } from '../lib/api';

/**
 * Islamic quiz.
 *
 * Questions and options come from the server; the answer key never reaches the
 * browser. Scoring, explanations and references are produced by /submit, so a
 * result shown here is a server result.
 */

interface Question {
  id: string;
  category: string;
  level: number;
  question: string;
  options: string[];
}

interface ResultRow {
  id: string;
  correct: boolean;
  picked: number | null;
  answer: number;
  reference: string;
  question: string;
  options: string[];
  explanation: string;
}

interface SubmitResult {
  score: number;
  total: number;
  percent: number;
  results: ResultRow[];
  saved: boolean;
}

interface HistoryRow {
  id: string;
  category: string;
  level: number;
  score: number;
  total: number;
  percent: number;
  durationSec: number;
  mode: string;
  createdAt: string;
}

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All topics' },
  { id: 'quran', label: 'Quran' },
  { id: 'hadith', label: 'Hadith' },
  { id: 'prophets', label: 'Prophets' },
  { id: 'history', label: 'History' },
  { id: 'worship', label: 'Worship' },
];

const LEVELS: { id: number; label: string }[] = [
  { id: 0, label: 'All levels' },
  { id: 1, label: 'Beginner' },
  { id: 2, label: 'Intermediate' },
  { id: 3, label: 'Advanced' },
];

const QUESTION_SECONDS = 40;

export default function Quiz() {
  const { t, user, toast, lang } = useStore();

  const [category, setCategory] = useState('all');
  const [level, setLevel] = useState(0);
  const [count, setCount] = useState(8);
  const [timed, setTimed] = useState(true);

  const [round, setRound] = useState<Question[] | null>(null);
  const [mode, setMode] = useState<'practice' | 'daily'>('practice');
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<{ id: string; picked: number | null }[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [remaining, setRemaining] = useState(QUESTION_SECONDS);

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<{ rounds: number; best: number; average: number } | null>(null);

  const current = round && index < round.length ? round[index] : null;

  const loadHistory = async () => {
    if (!user) return;
    try {
      const data = await get<{ history: HistoryRow[]; stats: { rounds: number; best: number; average: number } }>('/history');
      setHistory(data.history || []);
      setStats(data.stats || null);
    } catch {
      /* history is a convenience; a failure must not break the quiz */
    }
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* Per-question countdown. Running out submits the question unanswered. */
  useEffect(() => {
    if (!timed || !current) return;
    setRemaining(QUESTION_SECONDS);
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timed, current?.id, index]);

  useEffect(() => {
    if (timed && current && remaining === 0 && picked === null) {
      advance(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const start = async (kind: 'practice' | 'daily') => {
    setBusy(true);
    setResult(null);
    try {
      const data =
        kind === 'daily'
          ? await get<{ questions: Question[] }>(`/daily?lang=${lang}`)
          : await get<{ questions: Question[] }>(
              `/bank?category=${category}&level=${level}&limit=${count}&lang=${lang}`
            );

      const questions = data.questions || [];
      if (questions.length === 0) {
        toast(t('No questions are available for this selection yet'), 'error');
        return;
      }
      setMode(kind);
      setRound(questions);
      setIndex(0);
      setPicked(null);
      setAnswers([]);
      setStartedAt(Date.now());
      setRemaining(QUESTION_SECONDS);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('The quiz could not be loaded'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const advance = (choice: number | null) => {
    if (!round) return;
    const question = round[index];
    const next = [...answers, { id: question.id, picked: choice }];
    setAnswers(next);
    setPicked(null);

    if (index + 1 >= round.length) {
      void submit(next);
    } else {
      setIndex(index + 1);
      setRemaining(QUESTION_SECONDS);
    }
  };

  const submit = async (finalAnswers: { id: string; picked: number | null }[]) => {
    setBusy(true);
    try {
      const data = await post<SubmitResult>('/submit', {
        answers: finalAnswers,
        lang,
        category,
        level,
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        mode,
      });
      setResult(data);
      setRound(null);
      if (data.saved) void loadHistory();
      toast(
        `${data.score}/${data.total} · ${data.percent}%`,
        data.percent >= 60 ? 'success' : 'error'
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('The score could not be saved'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const progress = useMemo(() => {
    if (!round) return 0;
    return Math.round((index / round.length) * 100);
  }, [round, index]);

  /* ------------------------------ result view ----------------------------- */
  if (result) {
    return (
      <Page title="Quiz" subtitle={`${result.score}/${result.total} · ${result.percent}%`}>
        <div className="stack">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="section-title">{t('Round complete')}</div>
                <div className="muted small">
                  {result.percent >= 60 ? t('Well done — keep learning') : t('Review the answers below and try again')}
                </div>
              </div>
              <div className="stat">{result.percent}%</div>
            </div>
            {!result.saved ? (
              <div className="muted tiny" style={{ marginTop: 8 }}>
                {t('Sign in to save this score to your progress history.')}
              </div>
            ) : null}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={() => void start(mode)}>
                <AppIcon name="refresh" size={16} /> {t('Play again')}
              </button>
              <button
                className="btn btn-soft btn-sm"
                onClick={() => {
                  setResult(null);
                  setAnswers([]);
                }}
              >
                {t('New selection')}
              </button>
            </div>
          </div>

          {result.results.map((row, i) => (
            <div className="card" key={row.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="section-title">
                  {i + 1}. {row.question}
                </div>
                <AppIcon name={row.correct ? 'check' : 'close'} size={18} />
              </div>
              <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                {row.options.map((option, optionIndex) => {
                  const isAnswer = optionIndex === row.answer;
                  const isPicked = optionIndex === row.picked;
                  return (
                    <div
                      key={optionIndex}
                      className="small"
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid var(--line, rgba(0,0,0,.08))',
                        fontWeight: isAnswer ? 600 : 400,
                      }}
                    >
                      {option}
                      {isAnswer ? ` · ${t('correct answer')}` : isPicked ? ` · ${t('your answer')}` : ''}
                    </div>
                  );
                })}
              </div>
              {row.explanation ? (
                <div className="muted small" style={{ marginTop: 8 }}>
                  {row.explanation}
                </div>
              ) : null}
              {row.reference ? (
                <div className="refs tiny" style={{ marginTop: 4 }}>
                  {row.reference}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Page>
    );
  }

  /* ------------------------------ live round ------------------------------ */
  if (current) {
    return (
      <Page title="Quiz" subtitle={mode === 'daily' ? t('Daily challenge') : CATEGORIES.find((c) => c.id === category)?.label}>
        <div className="stack">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="muted small">
                {t('Question')} {index + 1} / {round!.length}
              </div>
              {timed ? <span className="badge-soft">{remaining}s</span> : null}
            </div>
            <div
              style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,.08)', marginTop: 8, overflow: 'hidden' }}
              aria-hidden="true"
            >
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--emerald, #0f6b4f)' }} />
            </div>

            <div className="section-title" style={{ marginTop: 14 }}>
              {current.question}
            </div>

            <div className="stack" style={{ marginTop: 10, gap: 8 }}>
              {current.options.map((option, optionIndex) => (
                <button
                  key={optionIndex}
                  className={`btn btn-block ${picked === optionIndex ? 'btn-primary' : 'btn-soft'}`}
                  style={{ textAlign: 'start', justifyContent: 'flex-start' }}
                  onClick={() => setPicked(optionIndex)}
                >
                  {option}
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 14 }}
              disabled={picked === null || busy}
              onClick={() => advance(picked)}
            >
              {index + 1 >= round!.length ? t('Finish and score') : t('Next question')}
            </button>
            <button
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              onClick={() => advance(null)}
              disabled={busy}
            >
              {t('Skip this question')}
            </button>
          </div>
        </div>
      </Page>
    );
  }

  /* ------------------------------- selection ------------------------------ */
  return (
    <Page title="Quiz" subtitle="Quran, Hadith, prophets and worship">
      <div className="stack">
        <div className="card">
          <div className="section-title">{t('Topic')}</div>
          <div className="chips" style={{ marginTop: 8 }}>
            {CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                className={`chip ${category === entry.id ? 'chip-active' : ''}`}
                onClick={() => setCategory(entry.id)}
                aria-pressed={category === entry.id}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>

          <div className="section-title" style={{ marginTop: 14 }}>{t('Level')}</div>
          <div className="chips" style={{ marginTop: 8 }}>
            {LEVELS.map((entry) => (
              <button
                key={entry.id}
                className={`chip ${level === entry.id ? 'chip-active' : ''}`}
                onClick={() => setLevel(entry.id)}
                aria-pressed={level === entry.id}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <div>
              <div className="section-title">{t('Questions')}</div>
              <div className="muted tiny">{count} {t('per round')}</div>
            </div>
            <select
              className="select"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              aria-label={t('Questions per round')}
            >
              {[5, 8, 10, 15, 20].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>

          <label className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="small">{t('Timer per question')}</span>
            <span className="switch">
              <input type="checkbox" checked={timed} onChange={(event) => setTimed(event.target.checked)} />
              <span className="track" aria-hidden="true" />
            </span>
          </label>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void start('practice')} disabled={busy}>
              <AppIcon name="play" size={16} /> {busy ? t('Loading…') : t('Start quiz')}
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => void start('daily')} disabled={busy}>
              <AppIcon name="star" size={16} /> {t('Daily challenge')}
            </button>
          </div>
        </div>

        {user ? (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="section-title">{t('Your progress')}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => void loadHistory()}>
                <AppIcon name="refresh" size={16} />
              </button>
            </div>
            {stats ? (
              <div className="grid grid-3" style={{ marginTop: 10 }}>
                <div className="stat">{stats.rounds}<div className="muted tiny">{t('rounds')}</div></div>
                <div className="stat">{stats.best}%<div className="muted tiny">{t('best')}</div></div>
                <div className="stat">{stats.average}%<div className="muted tiny">{t('average')}</div></div>
              </div>
            ) : null}

            {history.length === 0 ? (
              <div className="empty" style={{ marginTop: 10 }}>{t('No rounds recorded yet.')}</div>
            ) : (
              <div className="stack" style={{ marginTop: 10, gap: 6 }}>
                {history.slice(0, 8).map((row) => (
                  <div className="row" key={row.id} style={{ justifyContent: 'space-between' }}>
                    <div className="small">
                      {row.mode === 'daily' ? t('Daily') : t(row.category)}
                      <span className="muted tiny"> · {new Date(row.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className="badge-soft">{row.score}/{row.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="notice">
            {t('Sign in to keep a record of your quiz scores and streaks.')}
          </div>
        )}
      </div>
    </Page>
  );
}
