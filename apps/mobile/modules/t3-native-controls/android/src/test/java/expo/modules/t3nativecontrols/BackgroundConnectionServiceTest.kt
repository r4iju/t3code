package expo.modules.t3nativecontrols

import android.app.Application
import android.os.Looper
import java.time.Duration
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 26, 33, 34, 36], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class BackgroundConnectionServiceTest {
  private val context: Application get() = RuntimeEnvironment.getApplication()

  @After
  fun reset() {
    BackgroundConnectionService.stop(context)
  }

  @Test
  fun retainsConnectionForTwoMinutesAndStopsAfterThree() {
    BackgroundConnectionService.start(context, 180_000)
    val controller = Robolectric.buildService(BackgroundConnectionService::class.java).create()
    controller.startCommand(0, 1)
    val service = controller.get()
    assertTrue(shadowOf(service).isLastForegroundNotificationAttached)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(2))
    assertFalse(shadowOf(service).isStoppedBySelf)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(1))
    assertTrue(shadowOf(service).isStoppedBySelf)
    controller.destroy()
  }

  @Test
  fun duplicateStartsDoNotExtendTheBackgroundDeadline() {
    BackgroundConnectionService.start(context, 180_000)
    val controller = Robolectric.buildService(BackgroundConnectionService::class.java).create()
    controller.startCommand(0, 1)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(2))
    controller.startCommand(0, 2)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(1))
    assertTrue(shadowOf(controller.get()).isStoppedBySelf)
    controller.destroy()
  }

  @Test
  fun aQueuedStartCannotRetainTheConnectionAfterReturningToTheApp() {
    BackgroundConnectionService.start(context, 180_000)
    BackgroundConnectionService.stop(context)
    val controller = Robolectric.buildService(BackgroundConnectionService::class.java).create()
    controller.startCommand(0, 1)
    assertTrue(shadowOf(controller.get()).isStoppedBySelf)
    controller.destroy()
  }
}
