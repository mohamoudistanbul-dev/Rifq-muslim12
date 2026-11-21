import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

/**
 * The upgrade screen a free user sees instead of premium content.
 *
 * It states what is locked and links to the real Premium page, where a purchase
 * is verified by Google Play or the App Store on the server. Nothing here
 * unlocks anything: pressing a button cannot grant entitlement.
 */
export default function PremiumGate({
  title,
  itemTitle,
  compact = false,
}: {
  title?: string;
  itemTitle?: string;
  compact?: boolean;
}) {
  const { t, user } = useStore();

  return (
    <div className="card premium-gate" style={{ textAlign: 'center' }}>
      <div
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          margin: '0 auto 12px',
          borderRadius: 18,
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(145deg, rgba(198,164,74,.22), rgba(11,61,46,.14))',
          border: '1px solid rgba(198,164,74,.45)',
          fontSize: 26,
        }}
      >
        🔒
      </div>
      <div className="section-title">{title || t('This is a Premium feature')}</div>
      <p className="muted small" style={{ marginTop: 6 }}>
        {itemTitle
          ? t('{item} is part of RIFQ Muslim Premium. Upgrade to open it.').replace('{item}', itemTitle)
          : t('Upgrade to RIFQ Muslim Premium to open this content.')}
      </p>
      {!compact ? (
        <p className="muted tiny" style={{ marginTop: 6 }}>
          {t('Quran reading, prayer times and the Qibla compass stay free for everyone.')}
        </p>
      ) : null}
      <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 14 }}>
        <Link className="btn btn-primary btn-sm" to="/premium">
          {t('See Premium plans')}
        </Link>
        {!user ? (
          <Link className="btn btn-ghost btn-sm" to="/login">
            {t('Sign in')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
