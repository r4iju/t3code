import ExpoModulesCore
import UIKit

public final class T3BackgroundConnectionModule: Module {
  private let retention = T3BackgroundConnectionRetention()

  public func definition() -> ModuleDefinition {
    Name("T3BackgroundConnection")

    AsyncFunction("setEnabled") { (enabled: Bool, durationMs: Double) in
      self.retention.configure(enabled: enabled, durationMs: durationMs)
    }.runOnQueue(.main)

    OnAppEntersBackground {
      DispatchQueue.main.async { self.retention.enterBackground() }
    }

    OnAppBecomesActive {
      DispatchQueue.main.async { self.retention.enterForeground() }
    }

    OnDestroy {
      let retention = self.retention
      DispatchQueue.main.async { retention.configure(enabled: false, durationMs: 0) }
    }
  }
}
