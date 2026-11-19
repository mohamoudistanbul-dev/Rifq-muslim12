import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Shell';
import { AppIcon } from '../components/Icons';
import { useStore } from '../lib/store';
import { DEFAULT_CONTACT, mailHref, telHref, waHref } from '../lib/contact';

/**
 * Support — the single place for help. The WhatsApp and email buttons open the
 * real apps/mail clients with the official RIFQ Muslim contact details, and the
 * copy action confirms only after the clipboard write succeeds.
 */
export default function Support() {
  const { t, toast } = useStore();
  const [copied, setCopied] = useState(false);

  const email = DEFAULT_CONTACT.email;
  const phone = DEFAULT_CONTACT.phone;
  const whatsapp = DEFAULT_CONTACT.whatsapp;

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
