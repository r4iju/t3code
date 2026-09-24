import { CommandId, type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import {
  autoResumeMessageId,
  autoResumeText,
  countTrailingAutoResumes,
  resolveResumeAction,
  shouldAutoScheduleResume,
  withoutFastMode,
} from "./UsageLimitResumePolicy.ts";

/**
 * Sends the configured resume message to threads stopped by a provider usage
 * limit once the limit resets. Schedules live on the thread (`usageLimit`), so
 * a restart picks them up on the first sweep.
 */
export class UsageLimitResumeReactor extends Context.Service<
  UsageLimitResumeReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/UsageLimitResumeReactor") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  // One interrupt per stop: a parked turn that ignores it is left to the user.
  const interruptedStops = new Set<string>();
  // Filled from one full scan at start, then kept current from events, so the
  // minute tick reads only threads with a pending resume.
  const scheduledThreadIds = new Set<ThreadId>();

  const commandId = (tag: string, threadId: ThreadId) =>
    Effect.map(crypto.randomUUIDv4, (uuid) =>
      CommandId.make(`server:auto-resume:${tag}:${threadId}:${uuid}`),
    );

  const autoSchedule = Effect.fn("UsageLimitResumeReactor.autoSchedule")(function* (
    threadId: ThreadId,
  ) {
    const settings = yield* settingsService.getSettings;
    if (!settings.autoResumeAfterUsageLimit) return;
    const detail = yield* snapshots.getThreadDetailSnapshot(threadId, { turnLimit: 3 });
    if (Option.isNone(detail)) return;
    const thread = detail.value.thread;
    if (
      !thread.usageLimit ||
      !shouldAutoScheduleResume({
        enabled: true,
        usageLimit: thread.usageLimit,
        trailingAutoResumes: countTrailingAutoResumes(thread.messages),
      })
    ) {
      return;
    }
    yield* engine.dispatch({
      type: "thread.auto-resume.set",
      commandId: yield* commandId("schedule", threadId),
      threadId,
      scheduled: true,
    });
  });

  const resume = Effect.fn("UsageLimitResumeReactor.resume")(function* (threadId: ThreadId) {
    const shell = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(shell) || !shell.value.usageLimit?.resumeScheduled) {
      scheduledThreadIds.delete(threadId);
      return;
    }
    const thread = shell.value;
    const now = DateTime.formatIso(yield* DateTime.now);
    const action = resolveResumeAction(thread, now);
    if (action === null || action === "wait" || !thread.usageLimit) return;
    const stopKey = `${threadId}:${thread.usageLimit.reachedAt}`;
    if (action === "interrupt") {
      if (interruptedStops.has(stopKey)) return;
      interruptedStops.add(stopKey);
      yield* engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* commandId("interrupt", threadId),
        threadId,
        ...(thread.session?.activeTurnId ? { turnId: thread.session.activeTurnId } : {}),
        createdAt: now,
      });
      return;
    }
    interruptedStops.delete(stopKey);
    const settings = yield* settingsService.getSettings;
    const modelSelection = settings.autoResumeDisablesFastMode
      ? withoutFastMode(thread.modelSelection)
      : thread.modelSelection;
    if (modelSelection !== thread.modelSelection) {
      // Saved on the thread so fast mode stays off after the resumed turn.
      yield* engine.dispatch({
        type: "thread.meta.update",
        commandId: yield* commandId("fast-mode-off", threadId),
        threadId,
        modelSelection,
      });
    }
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: yield* commandId("send", threadId),
      threadId,
      message: {
        messageId: autoResumeMessageId(yield* crypto.randomUUIDv4),
        role: "user",
        text: autoResumeText(settings.autoResumeMessage),
        attachments: [],
      },
      modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: now,
    });
  });

  const scan = Effect.fn("UsageLimitResumeReactor.scan")(function* () {
    const snapshot = yield* snapshots.getShellSnapshot();
    for (const thread of snapshot.threads) {
      if (thread.usageLimit?.resumeScheduled) scheduledThreadIds.add(thread.id);
    }
  });

  const sweep = Effect.fn("UsageLimitResumeReactor.sweep")(function* () {
    yield* Effect.forEach([...scheduledThreadIds], resume, { discard: true });
  });

  type Job =
    | { readonly kind: "sweep" }
    | { readonly kind: "resume"; readonly threadId: ThreadId }
    | { readonly kind: "auto-schedule"; readonly threadId: ThreadId };

  const worker = yield* makeDrainableWorker((job: Job) =>
    (job.kind === "sweep"
      ? sweep()
      : job.kind === "resume"
        ? resume(job.threadId)
        : autoSchedule(job.threadId)
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("usage limit resume skipped", {
              job,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );

  const processEvent = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.usage-limit-set":
        // Re-reports of a stop keep its reachedAt, so only a new stop is
        // auto-scheduled and a Cancel on the current one sticks.
        return event.payload.usageLimit !== null &&
          event.payload.usageLimit.reachedAt === event.occurredAt &&
          !event.payload.usageLimit.resumeScheduled
          ? worker.enqueue({ kind: "auto-schedule", threadId: event.payload.threadId })
          : Effect.void;
      case "thread.auto-resume-set":
        if (!event.payload.scheduled) {
          scheduledThreadIds.delete(event.payload.threadId);
          return Effect.void;
        }
        scheduledThreadIds.add(event.payload.threadId);
        return worker.enqueue({ kind: "resume", threadId: event.payload.threadId });
      case "thread.session-set":
        if (!scheduledThreadIds.has(event.payload.threadId)) return Effect.void;
        // The interrupted parked turn has settled; the resume can go out now.
        return event.payload.session.status !== "running" &&
          event.payload.session.status !== "starting"
          ? worker.enqueue({ kind: "resume", threadId: event.payload.threadId })
          : Effect.void;
    }
    return Effect.void;
  };

  const start: UsageLimitResumeReactor["Service"]["start"] = Effect.fn(
    "UsageLimitResumeReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* scan().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("usage limit resume scan failed", { cause: Cause.pretty(cause) }),
      ),
    );
    yield* forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue({ kind: "sweep" });
        yield* worker.drain;
      }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid),
    );
    yield* forkParked(Stream.runForEach(events, processEvent));
  });

  return { start, drain: worker.drain } satisfies UsageLimitResumeReactor["Service"];
});

export const layer = Layer.effect(UsageLimitResumeReactor, make);
