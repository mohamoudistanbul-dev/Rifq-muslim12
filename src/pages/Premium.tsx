import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { get, post, ApiError } from '../lib/api';

/**
 * Premium subscriptions.
 *
 * The page never grants Premium. It shows the catalogue and the entitlement the
 * server reports, and it asks the server to verify a purchase. When the stores
 * are not configured the server answers 503 and this screen says so plainly
 * instead of pretending a payment happened.
 */

interface Plan {
  code: string;
  title: string;
  priceCents: number;
  currency: string;
  period: 'month' | 'year' | 'lifetime' | string;
  productId: string;
  benefits: unknown;
}

interface Status {
  premium: boolean;
  planCode: string | null;
  provider: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  lifetime: boolean;
  status: string;
  configured?: { google?: boolean; apple?: boolean };
  subscriptions?: {
    id: string;
    provider: string;
    planCode: string;
    status: string;
    expiresAt: string | null;
    autoRenew: boolean;
  }[];
}

/** Benefits may arrive as a plain string or a per-language tuple. */
function benefitText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['en', 'ar', 'so']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return '';
}

function money(cents: number, currency: string) {
  if (!Number.isFinite(cents) || cents <= 0) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function periodLabel(period: string) {
  if (period === 'year') return 'per year';
  if (period === 'lifetime') return 'one time';
  return 'per month';
}

export default function Premium() {
  const { t, user, toast } = useStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const [catalogue, current] = await Promise.all([
        get<{ plans: Plan[] }>('/plans'),
        get<Status>('/status').catch(() => null),
      ]);
      setPlans(catalogue.plans || []);
      setStatus(current);
    } catch {
      toast(t('Premium details could not be loaded'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configured = Boolean(status?.configured?.google || status?.configured?.apple);

  const restore = async () => {
    if (!user) return toast(t('Sign in to restore a purchase'), 'error');
    setBusy('restore');
    setNote(null);
    try {
      const result = await post<Status & { note?: string }>('/restore');
      setStatus((prev) => ({ ...(prev || ({} as Status)), ...result }));
      setNote(result.note || null);
      toast(
        result.premium ? t('Premium restored on your account') : t('No active purchase was found'),
        result.premium ? 'success' : 'error'
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('Restore failed');
      toast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const buy = async (plan: Plan) => {
    if (!user) return toast(t('Sign in before subscribing'), 'error');

    // A real purchase must come from the platform billing SDK. The bridge is
    // only present in a packaged Android/iOS build, so a browser cannot fake it.
    const bridge = (window as unknown as {
      RifqBilling?: {
        purchase: (productId: string) => Promise<{ purchaseToken?: string; receipt?: string; provider?: string }>;
      };
    }).RifqBilling;

    if (!bridge) {
      setNote(
        t(
          'Purchases run through Google Play Billing or the App Store, which only exist in the installed app. Open RIFQ Muslim on your phone to subscribe.'
        )
      );
      return;
    }

    setBusy(plan.code);
    setNote(null);
    try {
      const purchase = await bridge.purchase(plan.productId);
      const provider = purchase.provider || (/iphone|ipad|ios/i.test(navigator.userAgent) ? 'apple' : 'google');
      const result = await post<Status & { granted?: boolean }>('/verify', {
        provider,
        productId: plan.productId,
        purchaseToken: purchase.purchaseToken || purchase.receipt,
      });
      setStatus((prev) => ({ ...(prev || ({} as Status)), ...result }));
      toast(result.granted ? t('Premium is now active') : t('The store did not confirm this purchase'), result.granted ? 'success' : 'error');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('The purchase could not be verified');
      setNote(message);
      toast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Premium" subtitle="Support the app and unlock more learning">
      <div className="stack">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="section-title">{t('Your plan')}</div>
              <div className="muted small">
                {status?.premium
                  ? `${status.planCode || 'premium'}${status.lifetime ? ' · lifetime' : status.expiresAt ? ` · renews ${new Date(status.expiresAt).toLocaleDateString()}` : ''}`
                  : t('Free account')}
              </div>
            </div>
            <span className={status?.premium ? 'badge-gold' : 'badge-soft'}>
              {status?.premium ? t('Premium') : t('Free')}
            </span>
          </div>

          {status?.premium && status.expiresAt ? (
            <div className="muted tiny" style={{ marginTop: 8 }}>
              {t('Access ends')} {new Date(status.expiresAt).toLocaleString()}
              {status.autoRenew ? ` · ${t('renews automatically')}` : ` · ${t('will not renew')}`}
            </div>
          ) : null}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-soft btn-sm" onClick={restore} disabled={busy === 'restore'}>
              <AppIcon name="refresh" size={16} /> {busy === 'restore' ? t('Checking…') : t('Restore purchase')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
              <AppIcon name="refresh" size={16} /> {t('Refresh')}
            </button>
          </div>
        </div>

        {!configured ? (
          <div className="notice">
            <strong>{t('Store payments are not connected yet.')}</strong>{' '}
            {t(
              'Subscriptions must be verified by Google Play or the App Store. Until those credentials are added, no purchase can be completed and no Premium access is granted.'
            )}
            <div className="muted tiny" style={{ marginTop: 6 }}>
              {t('Required server settings')}: <code>GOOGLE_PLAY_SA_JSON</code>, <code>GOOGLE_PLAY_PACKAGE</code>,{' '}
              <code>APPLE_SHARED_SECRET</code>
            </div>
          </div>
        ) : null}

        {note ? (
          <div className="notice" role="status">
            {note}
          </div>
        ) : null}

        {loading ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : plans.length === 0 ? (
          <div className="empty">{t('No subscription plans are published yet.')}</div>
        ) : (
          <div className="grid grid-2">
            {plans.map((plan) => {
              const benefits = (Array.isArray(plan.benefits) ? plan.benefits : [])
                .map(benefitText)
                .filter(Boolean);
              const active = status?.premium && status.planCode === plan.code;
              return (
                <div className="card" key={plan.code}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="section-title">{plan.title}</div>
                    {active ? <span className="badge-gold">{t('Active')}</span> : null}
                  </div>
                  <div className="stat" style={{ marginTop: 6 }}>{money(plan.priceCents, plan.currency)}</div>
                  <div className="muted tiny">{periodLabel(plan.period)}</div>

                  {benefits.length ? (
                    <ul className="small" style={{ margin: '10px 0 0', paddingInlineStart: 18 }}>
                      {benefits.map((benefit, index) => (
                        <li key={index}>{benefit}</li>
                      ))}
                    </ul>
                  ) : null}

                  <button
                    className="btn btn-primary btn-block"
                    style={{ marginTop: 12 }}
                    disabled={active || busy === plan.code}
                    onClick={() => void buy(plan)}
                  >
                    {active ? t('Current plan') : busy === plan.code ? t('Contacting store…') : t('Subscribe')}
                  </button>
                  {!plan.productId ? (
                    <div className="muted tiny" style={{ marginTop: 6 }}>
                      {t('No store product ID set for this plan yet.')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="card">
          <div className="section-title">{t('What stays free')}</div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {t(
              'Quran reading, prayer times, Qibla, Tasbih, Duas and the five daily prayers always remain free. Premium adds extra learning content and removes ads.'
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Link className="btn btn-soft btn-sm" to="/kids">
              <AppIcon name="kids" size={16} /> {t('Kid Academy')}
            </Link>
            <Link className="btn btn-soft btn-sm" to="/quiz">
              <AppIcon name="star" size={16} /> {t('Quiz')}
            </Link>
          </div>
        </div>
      </div>
    </Page>
  );
}
