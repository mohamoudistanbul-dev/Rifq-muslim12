package com.rifqmuslim.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Real Android notifications for RIFQ Muslim.
 *
 * A prayer reminder is a rich, expandable notification: the emerald/gold banner
 * image, a title that states the remaining time ("Dhuhr – 30 min remaining"), the
 * prayer time as sub-text, a progress bar for the countdown window, and three
 * buttons that really do something (see [PrayerActionReceiver]).
 *
 * Everything is driven by the alarm this class schedules, so the reminder still
 * arrives when the app is closed. Channels are HIGH importance so Android shows
 * a heads-up banner when the user allows it.
 */
object PrayerNotifications {

    const val CHANNEL_ID = "rifq_athan"
    const val EXTRA_ID = "rifq_extra_id"
    const val EXTRA_TITLE = "rifq_extra_title"
    const val EXTRA_BODY = "rifq_extra_body"
    const val EXTRA_PRAYER = "rifq_extra_prayer"
    const val EXTRA_TIME = "rifq_extra_time"
    const val EXTRA_REMAINING = "rifq_extra_remaining"
    const val EXTRA_ROUTE = "rifq_extra_route"

    const val ACTION_PRAYED = "com.rifqmuslim.app.PRAYED"
    const val ACTION_SNOOZE = "com.rifqmuslim.app.SNOOZE"
    const val ACTION_OPEN = "com.rifqmuslim.app.OPEN"

    private const val PREFS = "rifq_alarms"
    private const val LOG_PREFS = "rifq_prayer_log"
    private const val NOTIFICATION_ID = 4001
    private const val WINDOW_MINUTES = 60

    /** Human label for a prayer key coming from the web layer. */
    fun label(prayer: String): String = when (prayer.lowercase(Locale.ROOT)) {
        "fajr" -> "Fajr"
        "dhuhr" -> "Dhuhr"
        "asr" -> "Asr"
        "maghrib" -> "Maghrib"
        "isha" -> "Isha"
        "sunrise" -> "Sunrise"
        else -> prayer.replaceFirstChar { it.uppercase() }
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService<NotificationManager>() ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.athan_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.athan_channel_description)
            enableVibration(true)
            setShowBadge(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    /** Simple branded notification used for confirmations and admin messages. */
    @SuppressLint("MissingPermission")
    fun notifyNow(context: Context, title: String, body: String, tag: String) {
        if (!canNotify(context)) return
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rifq)
            .setColor(ContextCompat.getColor(context, R.color.rifq_emerald))
            .setContentTitle(title.ifBlank { context.getString(R.string.app_name) })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openApp(context, ""))
            .build()
        NotificationManagerCompat.from(context)
            .notify(tag.ifBlank { "rifq-prayer" }, NOTIFICATION_ID, notification)
    }

    /**
     * The expanded prayer notification: banner image, remaining-time title,
     * prayer time, countdown progress and the three action buttons.
     */
    @SuppressLint("MissingPermission")
    fun notifyPrayer(
        context: Context,
        prayer: String,
        title: String,
        body: String,
        timeLabel: String,
        remainingMinutes: Int
    ) {
        if (!canNotify(context)) return
        ensureChannel(context)
        val name = label(prayer)
        val resolvedTitle = title.ifBlank { "$name reminder" }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rifq)
            .setColor(ContextCompat.getColor(context, R.color.rifq_emerald))
            .setContentTitle(resolvedTitle)
            .setContentText(body.ifBlank { "$name is due now." })
            .setSubText(if (timeLabel.isBlank()) name else "$name · $timeLabel")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(openApp(context, prayer))
            .addAction(0, "Already Prayed", action(context, ACTION_PRAYED, prayer, 1))
            .addAction(0, "Remind in 15 min", action(context, ACTION_SNOOZE, prayer, 2))
            .addAction(0, "Open App", openApp(context, prayer))

        // The countdown bar fills as the reminder window elapses.
        if (remainingMinutes >= 0) {
            val elapsed = (WINDOW_MINUTES - remainingMinutes).coerceIn(0, WINDOW_MINUTES)
            builder.setProgress(WINDOW_MINUTES, elapsed, false)
        }

        val banner = BitmapFactory.decodeResource(context.resources, R.drawable.notif_prayer)
        if (banner != null) {
            builder.setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(banner)
                    .setSummaryText(resolvedTitle)
            )
        } else {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }

        NotificationManagerCompat.from(context)
            .notify(tagFor(prayer), NOTIFICATION_ID, builder.build())
    }

    /** Removes the prayer notification once the user acted on it. */
    fun dismiss(context: Context, prayer: String) {
        NotificationManagerCompat.from(context).cancel(tagFor(prayer), NOTIFICATION_ID)
    }

    /**
     * Records "Already Prayed" on the device. The web layer reads this log when
     * the app next opens and syncs it to the account, so a tap made from the
     * notification with the app closed is never lost.
     */
    fun recordPrayed(context: Context, prayer: String) {
        if (prayer.isBlank()) return
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date())
        context.getSharedPreferences(LOG_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("$day|${prayer.lowercase(Locale.ROOT)}", stamp)
            .putString("pending|$day|${prayer.lowercase(Locale.ROOT)}", stamp)
            .apply()
    }

    /** Schedules an Athan reminder and records it so it can be restored later. */
    fun schedule(
        context: Context,
        id: String,
        triggerAtMillis: Long,
        title: String,
        body: String,
        prayer: String = "",
        timeLabel: String = "",
        remainingMinutes: Int = -1
    ) {
        if (id.isBlank() || triggerAtMillis <= System.currentTimeMillis()) return
        save(context, id, triggerAtMillis, title, body, prayer, timeLabel, remainingMinutes)
        setAlarm(context, id, triggerAtMillis, title, body, prayer, timeLabel, remainingMinutes)
    }

    fun cancel(context: Context, id: String) {
        if (id.isBlank()) return
        forget(context, id)
        val pending = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            Intent(context, PrayerAlarmReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pending != null) {
            context.getSystemService<AlarmManager>()?.cancel(pending)
            pending.cancel()
        }
    }

    /** Restores future reminders after a reboot, app update or timezone change. */
    fun rescheduleAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        for ((id, raw) in prefs.all) {
            val json = (raw as? String)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: continue
            val at = json.optLong("at", 0L)
            if (at <= now) {
                prefs.edit().remove(id).apply()
                continue
            }
            setAlarm(
                context,
                id,
                at,
                json.optString("title"),
                json.optString("body"),
                json.optString("prayer"),
                json.optString("time"),
                json.optInt("remaining", -1)
            )
        }
    }

    fun forget(context: Context, id: String) {
        if (id.isBlank()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
    }

    private fun tagFor(prayer: String): String {
        val day = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
        return "rifq-prayer-${prayer.lowercase(Locale.ROOT)}-$day"
    }

    private fun openApp(context: Context, prayer: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (prayer.isNotBlank()) putExtra(EXTRA_ROUTE, "/athan?prayer=$prayer")
        }
        return PendingIntent.getActivity(
            context,
            if (prayer.isBlank()) 0 else prayer.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun action(
        context: Context,
        action: String,
        prayer: String,
        requestCode: Int
    ): PendingIntent {
        val intent = Intent(context, PrayerActionReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_PRAYER, prayer)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode * 1000 + prayer.hashCode().and(0xFF),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun setAlarm(
        context: Context,
        id: String,
        triggerAtMillis: Long,
        title: String,
        body: String,
        prayer: String,
        timeLabel: String,
        remainingMinutes: Int
    ) {
        val manager = context.getSystemService<AlarmManager>() ?: return
        val intent = Intent(context, PrayerAlarmReceiver::class.java).apply {
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_BODY, body)
            putExtra(EXTRA_PRAYER, prayer)
            putExtra(EXTRA_TIME, timeLabel)
            putExtra(EXTRA_REMAINING, remainingMinutes)
        }
        val pending = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms() ->
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)

            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)

            else ->
                manager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)
        }
    }

    private fun save(
        context: Context,
        id: String,
        at: Long,
        title: String,
        body: String,
        prayer: String,
        timeLabel: String,
        remainingMinutes: Int
    ) {
        val json = JSONObject().apply {
            put("at", at)
            put("title", title)
            put("body", body)
            put("prayer", prayer)
            put("time", timeLabel)
            put("remaining", remainingMinutes)
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(id, json.toString())
            .apply()
    }
}
