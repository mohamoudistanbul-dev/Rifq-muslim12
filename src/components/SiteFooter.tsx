import React from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { DEFAULT_CONTACT, mailHref, telHref, waHref } from '../lib/contact';
import { useSiteConfig } from './LiveContent';

/** Footer carrying the official contact details on every screen. */
export default function SiteFooter() {
  const { t } = useStore();
  const config = useSiteConfig();
  const email = config?.contactEmail || DEFAULT_CONTACT.email;
  const phone = config?.contactPhone || DEFAULT_CONTACT.phone;
  const whatsapp = config?.whatsapp || DEFAULT_CONTACT.whatsapp;

  return (
    <div
      className="wrap"
      style={{ marginTop: 26, paddingTop: 18, paddingBottom: 96, borderTop: '1px solid rgba(212,175,55,.22)' }}
    >
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <a className="btn btn-soft btn-sm" href={mailHref(email)}>
          {t('Email us')}
        </a>
        <a className="btn btn-soft btn-sm" href={telHref(phone)}>
          {t('Call us')}
        </a>
        <a className="btn btn-primary btn-sm" href={waHref(whatsapp)} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        <Link className="btn btn-ghost btn-sm" to="/contact">
          {t('Contact Us')}
        </Link>
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        {email} | {phone}
      </p>
      <p className="small muted" style={{ margin: '2px 0 0' }}>
        RIFQ Muslim | {t('Your Faith, Your Daily Companion')} | Made by Eng Mohamud Yusuf
      </p>
    </div>
  );
}
