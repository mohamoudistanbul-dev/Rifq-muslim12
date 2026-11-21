import React from 'react';
import { SHARE_CHANNELS } from '../lib/portal';

/**
 * One-tap sharing shortcuts for the public download page.
 *
 * The native share sheet stays the main action (it lists every installed app);
 * these buttons cover the channels that people use most even when the browser
 * has no share sheet at all.
 */
export default function ShareChannels({ url, message }: { url: string; message: string }) {
  if (!url) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }} data-testid="share-channels">
      {SHARE_CHANNELS.map((channel) => (
        <a
          key={channel.id}
          href={channel.href(url, message)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 999,
            border: `1px solid ${channel.color}66`,
            background: `${channel.color}1f`,
            color: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, borderRadius: 999, background: channel.color }}
          />
          {channel.label}
        </a>
      ))}
    </div>
  );
}
