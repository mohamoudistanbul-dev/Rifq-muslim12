import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { useSiteConfig } from '../components/LiveContent';
import { DEFAULT_CONTACT, mailHref, telHref, waHref } from '../lib/contact';
import { DONATION_PRESETS, amountMode, buildDonateUrl, sanitizeAmount } from '../lib/donate';

/**
 * Support — the single place for help and for giving.
 *
 * The donation card uses the owner's own PayPal link from /api/config (environment
 * variable or the Super Admin setting). Nothing is invented: while no valid link
 * exists the button stays disabled and says so, and the app never claims a
 * donation succeeded — the payment happens on PayPal's own secure page.
 */
export default function Support() {
  const { t, toast } = useStore();
  const config = useSiteConfig();
  const [copied, setCopied] = useState(false);
  const [preset, setPreset] = useState<number | null>(10);
  const [custom, setCustom] = useState(false);
  const [other, setOther] = useState('');

  const email = DEFAULT_CONTACT.email;
  const phone = DEFAULT_CONTACT.phone;
  const whatsapp = DEFAULT_CONTACT.whatsapp;

  const donateBase = config?.paypalDonateUrl || '';
  const currency = config?.paypalCurrency || 'USD';
  const mode = amountMode(donateBase);
  // Only links that can carry an amount (paypal.me/<handle> or a {amount}
  // placeholder) apply the chosen amount; otherwise PayPal asks for it itself.
  const amountApplies = mode !== 'none';
  const chosen = custom ? sanitizeAmount(other) : preset;
  const donateHref = buildDonateUrl(donateBase, amountApplies ? chosen : null);
  const canDonate = Boolean(donateHref);

  const label = (value: number) => (currency === 'USD' ? `$${value}` : `${value} ${currency}`);

  const copyDetails = async () => {
    const text = `RIFQ Muslim support\nEmail: ${email}\nWhatsApp: ${whatsapp}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast(t('Support details copied'), 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast(t('Copy is not available in this browser. Please select the details manually.'), 'error');
    }
  };

  return (
    <Page title="Support" subtitle={t('We are here to help you')}>
      <div
        className="card"
        style={{
          borderColor: 'var(--gold)',
          background: 'linear-gradient(160deg, rgba(212, 175, 55, 0.12), transparent 62%)',
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="tile-icon"><AppIcon name="heart" size={20} /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 16 }}>{t('Support Us')}</strong>
            <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
              {t('Support RIFQ Muslim and help us continue serving the Muslim community.')}
            </p>
          </div>
        </div>

        {canDonate ? (
          <>
            {amountApplies && (
              <div style={{ marginTop: 14 }}>
                <p className="tiny muted" style={{ margin: '0 0 8px' }}>
                  {t('Choose an amount')} ({currency})
                </p>
                <div className="chips">
                  {DONATION_PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`chip${!custom && preset === value ? ' active' : ''}`}
                      onClick={() => {
                        setCustom(false);
                        setPreset(value);
                      }}
                    >
                      {label(value)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`chip${custom ? ' active' : ''}`}
                    onClick={() => setCustom(true)}
                  >
                    {t('Other')}
                  </button>
                </div>
                {custom && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label htmlFor="donation-amount">{t('Amount')}</label>
                    <input
                      id="donation-amount"
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      max="100000"
                      step="0.01"
                      placeholder={currency === 'USD' ? '25.00' : '25'}
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                    />
                    {sanitizeAmount(other) === null && other.trim() !== '' && (
                      <p className="tiny muted" style={{ margin: '6px 0 0', color: 'var(--danger)' }}>
                        {t('Enter a valid amount greater than zero.')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <a
              className="btn btn-primary btn-block"
              style={{ marginTop: 14 }}
              href={donateHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <AppIcon name="heart" size={17} /> {t('Donate with PayPal')}
            </a>

            <p className="tiny muted" style={{ margin: '10px 0 0', lineHeight: 1.55 }}>
              <AppIcon name="lock" size={12} />{' '}
              {t('You complete the donation on PayPal’s secure page. RIFQ Muslim never sees your PayPal password or card details, and cannot confirm a payment from inside the app.')}
            </p>
            {!amountApplies && (
              <p className="tiny muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
                {t('This PayPal link does not accept a preset amount — choose or enter the amount on PayPal’s page.')}
              </p>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-soft btn-block"
              style={{ marginTop: 14, opacity: 0.75, cursor: 'not-allowed' }}
              disabled
              aria-disabled="true"
            >
              <AppIcon name="heart" size={17} /> {t('Donate with PayPal')}
            </button>
            <p className="tiny muted" style={{ margin: '10px 0 0', lineHeight: 1.55 }}>
              {t('PayPal donations are not available yet — the official donation link has not been added. Please use the support options below, or check back soon.')}
            </p>
          </>
        )}
      </div>

      <div className="card hero">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="tile-icon"><AppIcon name="support" size={20} /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 16 }}>{t('RIFQ Muslim Support')}</strong>
            <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
              {t('Questions, bug reports or help with your account — reach the team directly.')}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>{t('WhatsApp support')}</h2>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>{whatsapp}</p>
        <a
          className="btn btn-primary"
          href={waHref(whatsapp, 'Assalamu alaikum, I need help with the RIFQ Muslim app.')}
          target="_blank"
          rel="noopener noreferrer"
        >
          <AppIcon name="whatsapp" size={17} /> {t('Chat on WhatsApp')}
        </a>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>{t('Email support')}</h2>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>{email}</p>
        <a className="btn btn-soft" href={mailHref(email, 'RIFQ Muslim support request')}>
          <AppIcon name="mail" size={17} /> {t('Email us')}
        </a>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>{t('Contact support')}</h2>
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          {t('Send a message through the in-app contact form and it is stored for the team.')}
        </p>
        <div className="btn-row">
          <Link to="/contact" className="btn btn-primary" style={{ flex: 1 }}>
            <AppIcon name="send" size={16} /> {t('Open contact form')}
          </Link>
          <a className="btn btn-soft" href={telHref(phone)}>
            <AppIcon name="phone" size={16} /> {t('Call')}
          </a>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14 }}>{t('Support details')}</strong>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>{email}</p>
            <p className="tiny muted" style={{ margin: 0 }}>{phone}</p>
          </div>
          <button className="btn btn-soft btn-sm" onClick={copyDetails}>
            <AppIcon name={copied ? 'check' : 'copy'} size={15} />
            {copied ? t('Copied') : t('Copy')}
          </button>
        </div>
      </div>

      <p className="tiny muted center" style={{ marginTop: 16 }}>
        {t('Support replies are handled by Eng Mohamud Yusuf and the RIFQ Muslim team.')}
      </p>
    </Page>
  );
}
