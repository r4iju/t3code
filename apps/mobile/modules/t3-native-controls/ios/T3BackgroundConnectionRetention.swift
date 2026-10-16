import UIKit

final class T3BackgroundConnectionRetention {
  private var enabled = false
  private var backgroundedAt: TimeInterval?
  private var exhausted = false
  private var duration: TimeInterval = 180
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var deadline: DispatchWorkItem?

  func configure(enabled: Bool, durationMs: Double) {
    self.enabled = enabled
    duration = min(180, max(0, durationMs / 1000))
    if !enabled { end() } else { retainIfNeeded() }
  }

  func enterBackground() {
    guard backgroundedAt == nil else { return }
    backgroundedAt = ProcessInfo.processInfo.systemUptime
    retainIfNeeded()
  }

  private func retainIfNeeded() {
    guard enabled, !exhausted, task == .invalid, let backgroundedAt,
      UIApplication.shared.applicationState == .background else { return }
    let remaining = backgroundedAt + duration - ProcessInfo.processInfo.systemUptime
    guard remaining > 0 else { return }
    // iOS controls the actual grant; the app's deadline is only an upper bound.
    task = UIApplication.shared.beginBackgroundTask(withName: "T3 background connections") { [weak self] in
      self?.end(expired: true)
    }
    guard task != .invalid else { return }
    let deadline = DispatchWorkItem { [weak self] in self?.end(expired: true) }
    self.deadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + remaining, execute: deadline)
  }

  func enterForeground() {
    backgroundedAt = nil
    exhausted = false
    end()
  }

  private func end(expired: Bool = false) {
    if expired { exhausted = true }
    deadline?.cancel()
    deadline = nil
    guard task != .invalid else { return }
    let current = task
    task = .invalid
    UIApplication.shared.endBackgroundTask(current)
  }
}
