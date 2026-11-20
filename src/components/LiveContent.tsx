import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { useStore } from '../lib/store';

export interface SiteConfig {
  appName: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  announcement: string;
  /** The owner's own PayPal donation link; '' until they configure it. */
  paypalDonateUrl: string;
  paypalCurrency: string;
}

export interface PublicContent {
  id: string;
  type: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  image: string;
  category: string;
  featured: boolean;
  views: number;
  publishedAt: string;
}

/** Site-wide configuration published by the Super Admin dashboard. */
export function useSiteConfig() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  useEffect(() => {
    let alive = true;
    get<SiteConfig>('/config')
      .then((c) => alive && setConfig(c))
      .catch(() => {
        /* the app keeps working with built-in defaults */
      });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

/**
 * Admin-published content on the public Home screen: the announcement banner and
 * the newest featured articles. Nothing renders when the admin has published
 * nothing, so the original Home design stays intact.
 */
export default function LiveContent() {
  const { t } = useStore();
  const config = useSiteConfig();
  const [items, setItems] = useState<PublicContent[]>([]);

  useEffect(() => {
    let alive = true;
    get<{ content: PublicContent[] }>('/content?limit=6')
      .then((r) => alive && setItems(r.content.filter((c) => c.type !== 'banner')))
      .catch(() => {
        /* offline: the rest of Home still works */
      });
    return () => {
      alive = false;
    };
  }, []);

  const announcement = config?.announcement?.trim();

  if (!announcement && !items.length) return null;

  return (
    <>
      {announcement && (
        <div className="card gold-edge" style={{ marginTop: 14 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>📣</span>
            <div>
              <strong style={{ display: 'block', fontSize: 13.5 }}>{t('Announcement')}</strong>
              <p className="small" style={{ margin: '4px 0 0', lineHeight: 1.55 }}>{announcement}</p>
            </div>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <div className="section-title">
            <h2>{t('From RIFQ Muslim')}</h2>
            <Link className="link" to="/articles">{t('View all')}</Link>
          </div>
          <div className="grid-2">
            {items.slice(0, 4).map((item) => (
              <Link key={item.id} to={`/articles/${item.slug}`} className="card" style={{ textDecoration: 'none' }}>
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.title}
                    style={{ width: '100%', height: 108, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }}
                    loading="lazy"
                  />
                )}
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <span className="badge-gold">{item.category || t('Article')}</span>
                </div>
                <strong style={{ display: 'block', fontSize: 14.5, lineHeight: 1.35 }}>{item.title}</strong>
                {item.excerpt && (
                  <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
                    {item.excerpt}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
