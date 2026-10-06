package expo.modules.t3nativecontrols

import android.os.SystemClock
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3BackgroundConnectionModule : Module() {
  private var enabled = false
  private var backgroundedAtMs: Long? = null
  private var durationMs = 180_000L

  override fun definition() = ModuleDefinition {
    Name("T3BackgroundConnection")

    AsyncFunction("setEnabled") { nextEnabled: Boolean, duration: Long ->
      enabled = nextEnabled
      durationMs = duration.coerceIn(1, 180_000)
      if (!enabled) appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
      else retainIfNeeded()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      if (backgroundedAtMs == null) {
        backgroundedAtMs = SystemClock.elapsedRealtime()
        retainIfNeeded()
      }
    }

    OnActivityEntersForeground {
      backgroundedAtMs = null
      appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
    }

    OnDestroy {
      enabled = false
      appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
    }
  }

  private fun retainIfNeeded() {
    val backgroundedAt = backgroundedAtMs ?: return
    val remainingMs = backgroundedAt + durationMs - SystemClock.elapsedRealtime()
    if (enabled && remainingMs > 0) {
      appContext.reactContext?.let { BackgroundConnectionService.start(it, remainingMs) }
    }
  }
}
