import React from 'react';
import { Page } from '../components/Shell';
import NotificationCenter from '../components/NotificationCenter';

/**
 * Notification settings page. The controls themselves live in
 * components/NotificationCenter.tsx and are enforced by the server, so the same
 * page works for a signed-in account on any device.
 */
export default function NotificationSettings() {
  return (
    <Page title="Notifications" subtitle="Choose what reaches you, and in which language">
      <NotificationCenter />
    </Page>
  );
}
