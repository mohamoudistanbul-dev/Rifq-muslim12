import React from 'react';

/**
 * Blue verified tick.
 *
 * The badge is only ever rendered from a server-provided flag — the server
 * decides who is verified, and this component cannot grant anything.
 */
export default function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="verified-badge"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified Account"
      focusable="false"
    >
      <title>Verified Account</title>
      <path
        fill="#1d9bf0"
        d="M12 1.6l2.5 1.9 3.1-.2 1.2 2.9 2.6 1.7-.7 3 1.4 2.8-2.2 2.2-.4 3.1-3 .7-1.9 2.5-2.9-1.1-2.9 1.1-1.9-2.5-3-.7-.4-3.1L2.3 13.7l1.4-2.8-.7-3 2.6-1.7 1.2-2.9 3.1.2L12 1.6z"
      />
      <path
        fill="#fff"
        d="M10.6 16.1l-3.1-3.1 1.4-1.4 1.7 1.7 4.5-4.5 1.4 1.4-5.9 5.9z"
      />
    </svg>
  );
}
