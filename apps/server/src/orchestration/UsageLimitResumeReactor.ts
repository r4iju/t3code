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
    if (Option.isNone(shell)) return;
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
      modelSelection: settings.autoResumeDisablesFastMode
        ? withoutFastMode(thread.modelSelection)
        : thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: now,
    });
  });

  const sweep = Effect.fn("UsageLimitResumeReactor.sweep")(function* () {
    const snapshot = yield* snapshots.getShellSnapshot();
    yield* Effect.forEach(
      snapshot.threads.filter((thread) => thread.usageLimit?.resumeScheduled === true),
      (thread) => resume(thread.id),
      { discard: true },
    );
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
        return event.payload.usageLimit !== null && !event.payload.usageLimit.resumeScheduled
          ? worker.enqueue({ kind: "auto-schedule", threadId: event.payload.threadId })
          : Effect.void;
      case "thread.auto-resume-set":
        return event.payload.scheduled
          ? worker.enqueue({ kind: "resume", threadId: event.payload.threadId })
          : Effect.void;
      case "thread.session-set":
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
