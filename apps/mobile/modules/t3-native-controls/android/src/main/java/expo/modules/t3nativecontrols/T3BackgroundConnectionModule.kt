package expo.modules.t3nativecontrols

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3BackgroundConnectionModule : Module() {
  private var enabled = false
  private var backgrounded = false
  private var durationMs = 180_000L

  override fun definition() = ModuleDefinition {
    Name("T3BackgroundConnection")

    AsyncFunction("setEnabled") { nextEnabled: Boolean, duration: Long ->
      enabled = nextEnabled
      durationMs = duration.coerceIn(1, 180_000)
      if (!enabled) appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      if (!backgrounded) {
        backgrounded = true
        if (enabled) appContext.reactContext?.let { BackgroundConnectionService.start(it, durationMs) }
      }
    }

    OnActivityEntersForeground {
      backgrounded = false
      appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
    }

    OnDestroy {
      enabled = false
      appContext.reactContext?.let { BackgroundConnectionService.stop(it) }
    }
  }
}
