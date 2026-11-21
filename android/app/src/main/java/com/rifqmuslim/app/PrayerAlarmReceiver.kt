package com.rifqmuslim.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fires the alarm scheduled by [PrayerNotifications].
 *
 * A prayer alarm renders the expanded notification; anything else (a snooze
 * follow-up or a reminder created from the web layer) falls back to the simple
 * branded notification.
 */
class PrayerAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        val id = intent.getStringExtra(PrayerNotifications.EXTRA_ID).orEmpty()
        val title = intent.getStringExtra(PrayerNotifications.EXTRA_TITLE).orEmpty()
        val body = intent.getStringExtra(PrayerNotifications.EXTRA_BODY).orEmpty()
        val prayer = intent.getStringExtra(PrayerNotifications.EXTRA_PRAYER).orEmpty()
        val timeLabel = intent.getStringExtra(PrayerNotifications.EXTRA_TIME).orEmpty()
        val remaining = intent.getIntExtra(PrayerNotifications.EXTRA_REMAINING, -1)

        if (prayer.isNotBlank() && remaining >= 0) {
            PrayerNotifications.notifyPrayer(appContext, prayer, title, body, timeLabel, remaining)
        } else {
            PrayerNotifications.notifyNow(appContext, title, body, id)
        }
        PrayerNotifications.forget(appContext, id)
    }
}
