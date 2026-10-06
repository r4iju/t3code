package expo.modules.t3nativecontrols

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log

class BackgroundConnectionService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var started = false
  private val expire = Runnable { finish() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // An activity can resume before its queued service start is delivered.
    val remainingMs = deadlineAtMs - SystemClock.elapsedRealtime()
    if (!requested || remainingMs <= 0) {
      finish()
      return START_NOT_STICKY
    }
    if (started) return START_NOT_STICKY
    started = true

    val manager = getSystemService(NotificationManager::class.java)
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Background connections", NotificationManager.IMPORTANCE_LOW)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notification = builder
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("T3 Code is keeping connections active")
      .setContentText("Background connection window ends within 3 minutes.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      notification.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification.build())
    }

    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:background-connection")
      .apply { acquire(remainingMs) }
    handler.postDelayed(expire, remainingMs)
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int) {
    finish()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    finish()
  }

  private fun finish() {
    requested = false
    release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun release() {
    handler.removeCallbacks(expire)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  override fun onDestroy() {
    release()
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "t3-background-connections"
    private const val NOTIFICATION_ID = 7344
    @Volatile private var requested = false
    @Volatile private var deadlineAtMs = 0L

    fun start(context: Context, durationMs: Long) {
      if (requested) return
      requested = true
      deadlineAtMs = SystemClock.elapsedRealtime() + durationMs.coerceIn(1, 180_000)
      try {
        val intent = Intent(context, BackgroundConnectionService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: IllegalStateException) {
        requested = false
        Log.w("T3BackgroundConnection", "Android declined background connection retention.", error)
      } catch (error: SecurityException) {
        requested = false
        Log.w("T3BackgroundConnection", "Android declined background connection retention.", error)
      }
    }

    fun stop(context: Context) {
      requested = false
      context.stopService(Intent(context, BackgroundConnectionService::class.java))
    }
  }
}
