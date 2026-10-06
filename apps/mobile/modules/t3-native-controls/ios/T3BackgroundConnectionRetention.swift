import UIKit

final class T3BackgroundConnectionRetention {
  private var enabled = false
  private var backgrounded = false
  private var duration: TimeInterval = 180
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var deadline: DispatchWorkItem?

  func configure(enabled: Bool, durationMs: Double) {
    self.enabled = enabled
    duration = min(180, max(0, durationMs / 1000))
    if !enabled { end() }
  }

  func enterBackground() {
    guard !backgrounded else { return }
    backgrounded = true
    guard enabled, UIApplication.shared.applicationState == .background else { return }
    // iOS controls the actual grant; the app's deadline is only an upper bound.
    task = UIApplication.shared.beginBackgroundTask(withName: "T3 background connections") { [weak self] in
      self?.end()
    }
    guard task != .invalid else { return }
    let deadline = DispatchWorkItem { [weak self] in self?.end() }
    self.deadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: deadline)
  }

  func enterForeground() {
    backgrounded = false
    end()
  }

  private func end() {
    deadline?.cancel()
    deadline = nil
    guard task != .invalid else { return }
    let current = task
    task = .invalid
    UIApplication.shared.endBackgroundTask(current)
  }
}
