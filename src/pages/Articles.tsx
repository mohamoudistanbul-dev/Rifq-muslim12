import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Loading, ErrorBox } from '../components/Shell';
import { get } from '../lib/api';
import { useStore } from '../lib/store';
import type { PublicContent } from '../components/LiveContent';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

export default function Articles() {
  const { t } = useStore();
  const [items, setItems] = useState<PublicContent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    get<{ content: PublicContent[] }>('/content?limit=50')
      .then((r) => alive && setItems(r.content))
      .catch((e) => alive && setError(e?.message || t('Content could not be loaded.')));
    return () => {
      alive = false;
    };
  }, [t]);

  return (
    <Page title="Articles" subtitle={t('Published by the RIFQ Muslim team')}>
      {error && <ErrorBox message={error} />}
      {!items && !error && <Loading />}
      {items && !items.length && (
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            {t('No published articles yet. New content appears here as soon as it is published.')}
          </p>
        </div>
      )}
      <div className="stack">
        {(items || []).map((item) => (
          <Link key={item.id} to={`/articles/${item.slug}`} className="card" style={{ textDecoration: 'none' }}>
            {item.image && (
              <img
                src={item.image}
                alt={item.title}
                style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }}
                loading="lazy"
              />
            )}
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <span className="badge-gold">{item.category || t('Article')}</span>
              <span className="muted small">{when(item.publishedAt)}</span>
            </div>
            <strong style={{ display: 'block', fontSize: 15.5, lineHeight: 1.35 }}>{item.title}</strong>
            {item.excerpt && (
              <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{item.excerpt}</p>
            )}
          </Link>
        ))}
      </div>
    </Page>
  );
}

export function ArticleDetail() {
  const { t } = useStore();
  const { slug = '' } = useParams();
  const [item, setItem] = useState<PublicContent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setItem(null);
    setError('');
    get<{ item: PublicContent }>(`/content/${encodeURIComponent(slug)}`)
      .then((r) => alive && setItem(r.item))
      .catch((e) => alive && setError(e?.message || t('That page is not available.')));
    return () => {
      alive = false;
    };
  }, [slug, t]);

  return (
    <Page title={item?.title || 'Article'} subtitle={item ? when(item.publishedAt) : undefined}>
      {error && <ErrorBox message={error} />}
      {!item && !error && <Loading />}
      {item && (
        <article className="card">
          {item.image && (
            <img
              src={item.image}
              alt={item.title}
              style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14, marginBottom: 14 }}
            />
          )}
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <span className="badge-gold">{item.category || t('Article')}</span>
          </div>
          {item.body.split(/\n{2,}/).filter(Boolean).map((para, i) => (
            <p key={i} style={{ lineHeight: 1.7, fontSize: 14.5, margin: '0 0 12px' }}>{para}</p>
          ))}
          <Link className="btn btn-soft btn-sm" to="/articles">{t('All articles')}</Link>
        </article>
      )}
    </Page>
  );
}
