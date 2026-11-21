package com.rifqmuslim.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Performs the action the user tapped on a rich prayer notification.
 *
 * "Already Prayed" records the confirmation locally (the WebView layer syncs it
 * to the account on the next launch), "Remind in 15 min" schedules a real
 * follow-up alarm through the same AlarmManager path the prayer alarms use, and
 * "Open App" opens the prayer screen directly.
 *
 * Every branch does something observable: no button is decorative.
 */
class PrayerActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val prayer = intent.getStringExtra(PrayerNotifications.EXTRA_PRAYER).orEmpty()
        val label = PrayerNotifications.label(prayer)

        when (intent.action) {
            PrayerNotifications.ACTION_PRAYED -> {
                PrayerNotifications.recordPrayed(app, prayer)
                PrayerNotifications.dismiss(app, prayer)
                PrayerNotifications.notifyNow(
                    app,
                    "Prayer confirmed",
                    "$label marked as prayed. JazakAllahu khayran.",
                    "rifq-ack-$prayer"
                )
            }

            PrayerNotifications.ACTION_SNOOZE -> {
                val at = System.currentTimeMillis() + 15 * 60_000L
                PrayerNotifications.schedule(
                    app,
                    "snooze-$prayer-$at",
                    at,
                    "$label reminder",
                    "You asked to be reminded about $label."
                )
                PrayerNotifications.dismiss(app, prayer)
                PrayerNotifications.notifyNow(
                    app,
                    "Reminder set",
                    "We will remind you about $label in 15 minutes.",
                    "rifq-snooze-ack-$prayer"
                )
            }

            PrayerNotifications.ACTION_OPEN -> {
                val open = Intent(app, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra(PrayerNotifications.EXTRA_ROUTE, "/athan?prayer=$prayer")
                }
                app.startActivity(open)
            }
        }
    }
}
