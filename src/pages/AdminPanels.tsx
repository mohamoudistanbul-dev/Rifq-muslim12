import React, { useEffect, useState } from 'react';
import { get, post, put, patch, del } from '../lib/api';

/**
 * Admin panels for the Premium, Quiz and Kid Academy features.
 *
 * Every action goes through the server's admin routes, which enforce the role
 * on the backend. These panels only render what the API allows; they never
 * grant Premium or verification locally.
 */

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((cents || 0) / 100);
  } catch {
    return `${((cents || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
};

function Notice({ text, tone }: { text: string; tone?: 'ok' | 'bad' }) {
  if (!text) return null;
  return (
    <div className={`notice ${tone === 'bad' ? 'notice-bad' : tone === 'ok' ? 'notice-ok' : ''}`} style={{ marginTop: 10 }}>
      <span className="small">{text}</span>
    </div>
  );
}

/* ------------------------------ premium admin ----------------------------- */

interface Plan {
  id?: string;
  code: string;
  title: string;
  priceCents: number;
  currency: string;
  period: string;
  productId: string;
  benefits: string[];
  active: boolean;
  sort: number;
}

interface Subscription {
  id: string;
  user_id: string;
  email?: string;
  name?: string;
  plan_code: string;
  status: string;
  provider: string;
  expires_at?: string | null;
  created_at: string;
}

export function PremiumAdmin() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [configured, setConfigured] = useState(false);
  const [summary, setSummary] = useState<{ active: number; expired: number; manual: number; configured: boolean } | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [status, setStatus] = useState('');
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');

  const [form, setForm] = useState({
    code: '',
    title: '',
    priceCents: 0,
    currency: 'USD',
    period: 'monthly',
    productId: '',
    benefits: '',
  });
  const [grant, setGrant] = useState({ email: '', planCode: '', days: 30 });

  const say = (text: string, ok = true) => {
    setMsg(text);
    setTone(ok ? 'ok' : 'bad');
  };

  const load = async () => {
    try {
      const [planRes, sumRes, subRes] = await Promise.all([
        get<{ plans: Plan[]; configured: boolean }>('/admin/premium/plans'),
        get<{ active: number; expired: number; manual: number; configured: boolean }>('/admin/premium/summary'),
        get<{ subscriptions: Subscription[] }>(`/admin/premium/subscriptions${status ? `?status=${status}` : ''}`),
      ]);
      setPlans(planRes.plans || []);
      setConfigured(planRes.configured);
      setSummary(sumRes);
      setSubs(subRes.subscriptions || []);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not load premium data.', false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createPlan = async () => {
    if (!form.code.trim() || !form.title.trim()) return say('Code and title are required.', false);
    try {
      await post('/admin/premium/plans', {
        code: form.code.trim().toLowerCase(),
        title: form.title.trim(),
        priceCents: Math.max(0, Math.round(Number(form.priceCents) || 0)),
        currency: form.currency.toUpperCase(),
        period: form.period,
        productId: form.productId.trim(),
        benefits: form.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
        active: true,
        sort: plans.length + 1,
      });
      say('Plan created.');
      setForm({ code: '', title: '', priceCents: 0, currency: 'USD', period: 'monthly', productId: '', benefits: '' });
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The plan could not be created.', false);
    }
  };

  const togglePlan = async (plan: Plan) => {
    try {
      await put(`/admin/premium/plans/${plan.id}`, { active: !plan.active });
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The plan could not be updated.', false);
    }
  };

  const doGrant = async () => {
    if (!grant.email.trim() || !grant.planCode) return say('Email and plan are required.', false);
    try {
      await post('/admin/premium/grant', { email: grant.email.trim(), planCode: grant.planCode, days: Number(grant.days) || 30 });
      say('Premium granted and recorded in the audit log.');
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The grant failed.', false);
    }
  };

  const revoke = async (sub: Subscription) => {
    if (!window.confirm(`Revoke premium for ${sub.email || sub.user_id}?`)) return;
    try {
      await post('/admin/premium/revoke', { subscriptionId: sub.id, reason: 'revoked by administrator' });
      say('Subscription revoked.');
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The revoke failed.', false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Premium overview</div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="stat">{summary?.active ?? 0}<div className="muted tiny">active</div></div>
          <div className="stat">{summary?.expired ?? 0}<div className="muted tiny">expired</div></div>
          <div className="stat">{summary?.manual ?? 0}<div className="muted tiny">manual grants</div></div>
          <div className="stat">{configured ? 'Yes' : 'No'}<div className="muted tiny">store billing configured</div></div>
        </div>
        {!configured ? (
          <Notice
            text="Store verification is not configured, so no purchase can be approved. Set the Google Play / App Store credentials in Settings to enable real purchases; manual grants below still work and are audited."
          />
        ) : null}
        <Notice text={msg} tone={tone} />
      </div>

      <div className="card">
        <div className="section-title">Plans</div>
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          {plans.map((plan) => (
            <div key={plan.id || plan.code} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="small" style={{ fontWeight: 600 }}>
                  {plan.title} <span className="muted tiny">({plan.code})</span>
                </div>
                <div className="muted tiny">
                  {money(plan.priceCents, plan.currency)} · {plan.period} · {plan.productId || 'no product id'}
                </div>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => void togglePlan(plan)}>
                {plan.active ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
          {plans.length === 0 ? <div className="empty">No plans yet.</div> : null}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Add a plan</div>
        <div className="grid grid-2" style={{ marginTop: 10, gap: 8 }}>
          <input className="input" placeholder="code (e.g. monthly)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" type="number" placeholder="Price in cents" value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: Number(e.target.value) })} />
          <input className="input" placeholder="Currency (USD)" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          <select className="select" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
            <option value="lifetime">lifetime</option>
          </select>
          <input className="input" placeholder="Store product ID" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} />
        </div>
        <textarea
          className="input"
          rows={3}
          style={{ marginTop: 8 }}
          placeholder="One benefit per line"
          value={form.benefits}
          onChange={(e) => setForm({ ...form, benefits: e.target.value })}
        />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => void createPlan()}>
          Create plan
        </button>
      </div>

      <div className="card">
        <div className="section-title">Grant premium manually</div>
        <div className="grid grid-2" style={{ marginTop: 10, gap: 8 }}>
          <input className="input" placeholder="user email" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} />
          <select className="select" value={grant.planCode} onChange={(e) => setGrant({ ...grant, planCode: e.target.value })}>
            <option value="">select plan</option>
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>{plan.title}</option>
            ))}
          </select>
          <input className="input" type="number" placeholder="days" value={grant.days} onChange={(e) => setGrant({ ...grant, days: Number(e.target.value) })} />
        </div>
        <button className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={() => void doGrant()}>
          Grant
        </button>
        <div className="muted tiny" style={{ marginTop: 6 }}>
          Manual grants are recorded with your admin account in the activity log.
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-title">Subscriptions</div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            <option value="">all</option>
            <option value="active">active</option>
            <option value="expired">expired</option>
            <option value="revoked">revoked</option>
            <option value="pending">pending</option>
          </select>
        </div>
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          {subs.map((sub) => (
            <div key={sub.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="small">{sub.email || sub.user_id}</div>
                <div className="muted tiny">
                  {sub.plan_code} · {sub.provider} · {sub.status}
                  {sub.expires_at ? ` · until ${new Date(sub.expires_at).toLocaleDateString()}` : ' · no expiry'}
                </div>
              </div>
              {sub.status === 'active' ? (
                <button className="btn btn-ghost btn-sm" onClick={() => void revoke(sub)}>Revoke</button>
              ) : null}
            </div>
          ))}
          {subs.length === 0 ? <div className="empty">No subscriptions recorded.</div> : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- quiz admin ------------------------------ */

interface AdminQuestion {
  id: string;
  category: string;
  level: number;
  reference: string;
  question: string[];
  options: string[][];
  answer: number;
  explanation: string[];
  active: boolean;
}

export function QuizAdmin() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [stats, setStats] = useState<{ questions: number; rounds: number; average: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');

  const [draft, setDraft] = useState({
    id: '',
    category: 'quran',
    level: 1,
    reference: '',
    question: ['', '', ''],
    options: '|\n|\n|\n|',
    explanation: ['', '', ''],
    answer: 0,
  });

  const say = (text: string, ok = true) => {
    setMsg(text);
    setTone(ok ? 'ok' : 'bad');
  };

  const load = async () => {
    try {
      const [list, s] = await Promise.all([
        get<{ questions: AdminQuestion[] }>('/admin/quiz/questions'),
        get<{ questions: number; rounds: number; average: number }>('/admin/quiz/stats'),
      ]);
      setQuestions(list.questions || []);
      setStats(s);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not load quiz questions.', false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (question: AdminQuestion) => {
    try {
      await put(`/admin/quiz/questions/${question.id}`, { active: !question.active });
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The question could not be updated.', false);
    }
  };

  const create = async () => {
    const options = draft.options
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean))
      .map((cells) => [cells[0] || '', cells[1] || cells[0] || '', cells[2] || cells[0] || '']);

    if (!draft.id.trim()) return say('A unique question ID is required.', false);
    if (options.length < 2) return say('Provide at least two options, one per line as EN | AR | SO.', false);
    if (!draft.question[0].trim()) return say('The English question text is required.', false);

    try {
      await post('/admin/quiz/questions', {
        id: draft.id.trim(),
        category: draft.category,
        level: Number(draft.level),
        reference: draft.reference.trim(),
        question: [
          draft.question[0].trim(),
          draft.question[1].trim() || draft.question[0].trim(),
          draft.question[2].trim() || draft.question[0].trim(),
        ],
        options,
        answer: Math.max(0, Math.min(options.length - 1, Number(draft.answer) || 0)),
        explanation: [
          draft.explanation[0].trim(),
          draft.explanation[1].trim() || draft.explanation[0].trim(),
          draft.explanation[2].trim() || draft.explanation[0].trim(),
        ],
        active: true,
      });
      say('Question added.');
      setDraft({ id: '', category: 'quran', level: 1, reference: '', question: ['', '', ''], options: '|\n|\n|\n|', explanation: ['', '', ''], answer: 0 });
      void load();
    } catch (err) {
      say(err instanceof Error ? err.message : 'The question could not be saved.', false);
    }
  };

  const visible = questions.filter(
    (q) => !filter || q.id.includes(filter) || q.category.includes(filter) || q.question[0]?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Quiz bank</div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="stat">{stats?.questions ?? 0}<div className="muted tiny">active questions</div></div>
          <div className="stat">{stats?.rounds ?? 0}<div className="muted tiny">rounds played</div></div>
          <div className="stat">{stats?.average ?? 0}%<div className="muted tiny">average score</div></div>
        </div>
        <Notice text={msg} tone={tone} />
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-title">Questions</div>
          <input className="input" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          {visible.slice(0, 60).map((q) => (
            <div key={q.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.question[0]}</div>
                <div className="muted tiny">{q.id} · {q.category} · L{q.level} · {q.reference || 'no reference'}</div>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => void toggle(q)}>
                {q.active ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
          {visible.length === 0 ? <div className="empty">No questions match.</div> : null}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Add a question</div>
        <div className="grid grid-2" style={{ marginTop: 10, gap: 8 }}>
          <input className="input" placeholder="unique id" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
          <input className="input" placeholder="reference (e.g. Qur'an 2:255)" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
          <select className="select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="quran">quran</option>
            <option value="hadith">hadith</option>
            <option value="prophets">prophets</option>
            <option value="history">history</option>
            <option value="worship">worship</option>
          </select>
          <select className="select" value={draft.level} onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}>
            <option value={1}>Beginner</option>
            <option value={2}>Intermediate</option>
            <option value={3}>Advanced</option>
          </select>
        </div>

        {['English', 'Arabic', 'Somali'].map((label, i) => (
          <input
            key={label}
            className="input"
            style={{ marginTop: 8 }}
            placeholder={`Question (${label})`}
            value={draft.question[i]}
            onChange={(e) => {
              const next = [...draft.question];
              next[i] = e.target.value;
              setDraft({ ...draft, question: next });
            }}
          />
        ))}

        <textarea
          className="input"
          rows={4}
          style={{ marginTop: 8 }}
          placeholder={'Options, one per line: EN | AR | SO'}
          value={draft.options}
          onChange={(e) => setDraft({ ...draft, options: e.target.value })}
        />

        <div className="field" style={{ marginTop: 8 }}>
          <label>Correct option index (0 = first line)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={draft.answer}
            onChange={(e) => setDraft({ ...draft, answer: Number(e.target.value) })}
          />
        </div>

        {['English', 'Arabic', 'Somali'].map((label, i) => (
          <input
            key={`exp-${label}`}
            className="input"
            style={{ marginTop: 8 }}
            placeholder={`Explanation (${label})`}
            value={draft.explanation[i]}
            onChange={(e) => {
              const next = [...draft.explanation];
              next[i] = e.target.value;
              setDraft({ ...draft, explanation: next });
            }}
          />
        ))}

        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => void create()}>
          Add question
        </button>
        <div className="muted tiny" style={{ marginTop: 6 }}>
          Missing Arabic or Somali text falls back to the English text rather than being left blank.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- kids admin ------------------------------ */

interface KidLesson {
  id: string;
  kind: string;
  title: string[];
  active: boolean;
  sort: number;
}

export function KidsAdmin() {
  const [lessons, setLessons] = useState<KidLesson[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const res = await get<{ lessons: KidLesson[] }>('/kids/admin/lessons');
      setLessons(res.lessons || []);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not load lessons.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (lesson: KidLesson) => {
    try {
      await patch(`/kids/admin/lessons/${lesson.id}`, { active: !lesson.active });
      setLessons((rows) => rows.map((row) => (row.id === lesson.id ? { ...row, active: !row.active } : row)));
      setMsg(`${lesson.title[0]} ${lesson.active ? 'hidden' : 'published'}.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'The lesson could not be updated.');
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Kid Academy lessons</div>
        <div className="muted tiny" style={{ marginTop: 6 }}>
          Hiding a lesson removes it from the child's list and from the certificate requirement. Progress already saved is kept.
        </div>
        <Notice text={msg} />
      </div>

      <div className="card">
        <div className="stack" style={{ gap: 6 }}>
          {lessons.map((lesson) => (
            <div key={lesson.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="small">{lesson.title[0]}</div>
                <div className="muted tiny">{lesson.kind} · {lesson.id}</div>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => void toggle(lesson)}>
                {lesson.active ? 'Hide' : 'Publish'}
              </button>
            </div>
          ))}
          {lessons.length === 0 ? <div className="empty">No lessons found.</div> : null}
        </div>
      </div>
    </div>
  );
}
