import {
  ALL_AGENT_PERMISSIONS,
  DEFAULT_MISSION_TEAM_SETTINGS,
  EventId,
  canTransitionManagedWorktree,
  hasWritePermission,
  isActiveAgentRunStatus,
  isAuthorizingVerificationRun,
  normalizeAgentPermissions,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  wouldCreateTaskDependencyCycle,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  findActiveAgentRun,
  findAgentHandoffById,
  findManagedWorktreeById,
  findMissionAgentById,
  findTaskDependencyById,
  listActiveAgentRuns,
  listThreadsByProjectId,
  requireAgentRun,
  requireAgentRunAbsent,
  requireAgentRunTransition,
  requireActiveProjectWorkspaceRootAbsent,
  requireProject,
  requireProjectAbsent,
  requireMission,
  requireMissionAbsent,
  requireMissionTask,
  requireMissionTaskAbsent,
  requireMissionTaskTransition,
  requireMissionTransition,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

// Session adoption takes seconds; a user message still unadopted after this
// window is a failed/stale start, not pending work. Mirrors the client's
// QUEUED_TURN_START_GRACE_MS in client-runtime threadSettled.ts.
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/**
 * Blocked-on-you work derived from the thread's retained activities: an
 * approval or user-input request with no later resolution for the same
 * requestId. The server-side twin of the shell's hasPendingApprovals /
 * hasPendingUserInput flags, which the decider read model does not carry.
 * The clearing rules MUST match ProjectionPipeline's pending accounting —
 * resolved activities always clear, respond.failed clears only when the
 * failure detail marks the request stale/unknown — or settle would be
 * rejected on threads whose shell flags read as clear.
 */
function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

// Scans the read model's activities, which the projector caps at the most
// recent 500. That bound is safe here: an OPEN approval/user-input request
// blocks its turn, so the thread cannot accumulate hundreds of later
// activities while one is outstanding — a request that has scrolled out of
// the window is one whose turn kept running, i.e. it was resolved or went
// stale. (The projection pipeline's pendingApprovalCount reads the same
// capped stream and stays consistent with this view.)
function hasOpenBlockingRequest(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}): boolean {
  const openRequestIds = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      openRequestIds.delete(requestId);
    }
  }
  return openRequestIds.size > 0;
}

/**
 * A queued turn start — a user message no turn has picked up yet — is work
 * in flight even though session is still null (turn.start emits
 * message-sent + turn-start-requested; the session arrives later). Detection
 * mirrors the client's hasQueuedTurnStart: the newest user message is
 * strictly newer than every latestTurn timestamp (adoption stamps the new
 * turn's requestedAt with the message time, clearing this), and only within
 * the adoption grace window — historical threads whose last user message
 * postdates their turn timestamps (older-server data, mid-turn messages)
 * must not be blocked forever. A failed session start (status "error")
 * clears the block immediately.
 *
 * The age check is bounded on BOTH sides: message timestamps are
 * client-supplied, so a client clock ahead of the server yields a negative
 * age. Without the lower bound that negative age satisfies `<= grace` for
 * as long as the skew lasts, extending the block far past the intended two
 * minutes.
 */
function threadHasQueuedTurnStart(
  thread: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>;
    readonly latestTurn: {
      readonly requestedAt: string;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
    } | null;
    readonly session: { readonly status: string } | null;
  },
  occurredAt: string,
): boolean {
  const latestUserMessageAtMs = thread.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  const latestTurnAtMs =
    thread.latestTurn === null
      ? Number.NEGATIVE_INFINITY
      : Math.max(
          ...[
            thread.latestTurn.requestedAt,
            thread.latestTurn.startedAt,
            thread.latestTurn.completedAt,
          ].map((candidate) =>
            candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
          ),
        );
  const queuedAgeMs = Date.parse(occurredAt) - latestUserMessageAtMs;
  return (
    thread.session?.status !== "error" &&
    Number.isFinite(latestUserMessageAtMs) &&
    latestUserMessageAtMs > latestTurnAtMs &&
    Math.abs(queuedAgeMs) <= QUEUED_TURN_START_GRACE_MS
  );
}

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireActiveProjectWorkspaceRootAbsent({
        readModel,
        command,
        workspaceRoot: command.workspaceRoot,
        exceptProjectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.workspaceRoot !== undefined) {
        yield* requireActiveProjectWorkspaceRootAbsent({
          readModel,
          command,
          workspaceRoot: command.workspaceRoot,
          exceptProjectId: command.projectId,
        });
      }
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      const missionRun = (readModel.agentRuns ?? []).find(
        (run) => run.threadId === command.threadId,
      );
      if (missionRun !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is retained as mission run '${missionRun.id}' history. Archive it instead.`,
        });
      }
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.settle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Server-side twin of the client's canSettle session check: a stale
      // or raced client must not settle a thread whose session is coming
      // alive or working.
      if (thread.session?.status === "starting" || thread.session?.status === "running") {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has an active session and cannot be settled`,
          }),
        );
      }
      // Pending approval / user-input requests are blocked-on-you work: a
      // raced or stale client must not park them behind a settled override
      // that would surface only after the request resolves.
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be settled`,
          }),
        );
      }
      const occurredAt = yield* nowIso;
      // Settling inside the adoption window would hide just-requested work.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be settled`,
          }),
        );
      }
      // Settling an already-settled thread re-emits with the original
      // settledAt: the engine rejects zero-event commands, and bulk-settle /
      // double-click must stay silent no-ops rather than surface errors.
      const alreadySettled = thread.settledOverride === "settled" && thread.settledAt !== null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.settled",
        payload: {
          threadId: command.threadId,
          settledAt: alreadySettled ? thread.settledAt : occurredAt,
          // A re-emission is a projected no-op: keep the existing updatedAt
          // so duplicate settles neither rewind nor churn ordering. A fresh
          // settle stamps the command time.
          updatedAt: alreadySettled ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsettle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): reducing the event a
      // second time lands on the same override state. A re-emission keeps
      // the existing updatedAt so duplicates do not churn ordering.
      const alreadyPinnedActive = thread.settledOverride === "active";
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyPinnedActive ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.snooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      // A wake time in the past would create a thread that is snoozed and
      // woken at once — the row would never leave the inbox but still carry
      // snooze state. Reject instead of silently normalizing. The negated
      // comparison also catches unparseable wake times (IsoDateTime is
      // structurally just a string): NaN fails every comparison, and an
      // unparseable snoozedUntil must never persist.
      if (!(Date.parse(command.snoozedUntil) > Date.parse(occurredAt))) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} snooze wake time ${command.snoozedUntil} is not in the future`,
          }),
        );
      }
      // Blocked-on-you work must not be snoozed away: a pending approval or
      // user-input request is the agent waiting on the user, and hiding it
      // defeats the request. (A running session IS snoozable — snooze only
      // affects visibility, never the agent.)
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be snoozed`,
          }),
        );
      }
      // A queued turn start — a user message no turn has adopted yet — is
      // invisible pending work: no session, no pending flags. Snoozing in
      // that window would hide a just-requested turn exactly the way settle
      // would.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be snoozed`,
          }),
        );
      }
      // Re-snoozing an already-snoozed thread to the SAME wake time is a
      // duplicate (double-click, raced clients): re-emit with the original
      // timestamps so the projection is a no-op. A different wake time is a
      // real change and stamps fresh.
      const existingSnoozedAt =
        thread.snoozedUntil === command.snoozedUntil && thread.snoozedAt != null
          ? thread.snoozedAt
          : null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.snoozed",
        payload: {
          threadId: command.threadId,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: existingSnoozedAt ?? occurredAt,
          updatedAt: existingSnoozedAt !== null ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsnooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): waking a thread that
      // is not snoozed lands on the same null state without churning
      // updatedAt.
      const alreadyAwake = thread.snoozedUntil == null;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsnoozed",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyAwake ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const branch =
        command.branch !== undefined &&
        command.expectedBranch !== undefined &&
        thread.branch !== command.expectedBranch
          ? thread.branch
          : command.branch;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.regenerateTitle === true
            ? {
                regenerateTitle: true as const,
                previousTitle: thread.title,
                titleRegeneration: {
                  requestId: command.commandId,
                  startedAt: occurredAt,
                },
              }
            : {}),
          ...(command.title !== undefined && thread.titleRegeneration != null
            ? { titleRegeneration: null }
            : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.title.regeneration.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestIsCurrent = thread.titleRegeneration?.requestId === command.requestId;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(requestIsCurrent && command.title !== undefined ? { title: command.title } : {}),
          ...(requestIsCurrent ? { titleRegeneration: null } : {}),
          updatedAt: requestIsCurrent ? occurredAt : thread.updatedAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      // Real activity resets ANY override: it wakes an explicitly settled
      // thread, and it clears a keep-active pin back to neutral so the
      // thread can auto-settle again after this burst of work goes stale.
      // A snooze clears the same way — sending a message to a snoozed
      // thread is the user re-engaging, so the return ticket is spent.
      const lifecycleResetEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
      if (targetThread.settledOverride !== null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsettled",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      if (targetThread.snoozedUntil != null) {
        lifecycleResetEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "thread.unsnoozed",
          payload: {
            threadId: command.threadId,
            reason: "activity",
            updatedAt: command.createdAt,
          },
        });
      }
      return [...lifecycleResetEvents, userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sessionSetEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
      // Only a session coming alive is activity worth waking a settled thread
      // for — status writes like ready/stopped/error arrive after the fact and
      // must not fight a user's explicit settle. Snooze is deliberately NOT
      // cleared here: snooze never pauses the agent, so its session starting
      // or erroring is not the user re-engaging. Blocked/failed work still
      // surfaces immediately — effectiveSnoozed refuses to classify a thread
      // with a raised hand (approval / input / failure / fresh completion)
      // as snoozed, without spending the return ticket.
      const isSessionActivity =
        command.session.status === "starting" || command.session.status === "running";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !isSessionActivity) {
        return sessionSetEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [unsettledEvent, sessionSetEvent];
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      const activityAppendedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
      // An approval or user-input request is blocked-on-you work — it must
      // never stay hidden inside a settled slim row.
      const wakesSettledThread =
        command.activity.kind === "approval.requested" ||
        command.activity.kind === "user-input.requested";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !wakesSettledThread) {
        return activityAppendedEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [unsettledEvent, activityAppendedEvent];
    }

    case "mission.create": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      yield* requireMissionAbsent({ readModel, command, missionId: command.missionId });
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "mission.created",
        payload: {
          mission: {
            id: command.missionId,
            projectId: command.projectId,
            title: command.title,
            description: command.description,
            status: "backlog",
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            teamSettings: DEFAULT_MISSION_TEAM_SETTINGS,
            schedulerStatus: "idle",
          },
        },
      };
    }

    case "mission.update": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (command.status !== undefined) {
        const manualStatuses = new Set([
          "backlog",
          "planning",
          "ready",
          "verification",
          "review",
          "blocked",
        ]);
        if (!manualStatuses.has(command.status)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Mission lifecycle status '${command.status}' must be changed by a lifecycle command.`,
          });
        }
        const activeRun = findActiveAgentRun(readModel, command.missionId);
        if (activeRun !== undefined && command.status !== mission.status) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Mission '${mission.id}' cannot leave active work behind while run '${activeRun.id}' is active.`,
          });
        }
        yield* requireMissionTransition({ command, mission, status: command.status });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "mission.updated",
        payload: {
          missionId: command.missionId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.status !== undefined ? { status: command.status } : {}),
          updatedAt: command.updatedAt,
        },
      };
    }

    case "mission.task.create": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (mission.status === "completed" || mission.status === "cancelled") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' is terminal and cannot accept new tasks.`,
        });
      }
      yield* requireMissionTaskAbsent({ readModel, command, taskId: command.taskId });
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.created",
        payload: {
          task: {
            id: command.taskId,
            missionId: command.missionId,
            title: command.title,
            description: command.description,
            status: "backlog",
            position: command.position,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            startedAt: null,
            completedAt: null,
            assignedMissionAgentId: null,
            worktreeId: null,
            attemptCount: 0,
            maximumAttempts: mission.teamSettings.defaultMaximumTaskAttempts,
            readyAt: null,
            blockedReason: null,
            integrationStatus: "not_requested",
            requiresDependencyHandoffs: true,
          },
        },
      };
    }

    case "mission.task.update": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (mission.status === "completed" || mission.status === "cancelled") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' is terminal and its tasks cannot be updated.`,
        });
      }
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: command.missionId,
        taskId: command.taskId,
      });
      if (command.status !== undefined) {
        const manualStatuses = new Set(["backlog", "ready", "blocked"]);
        if (!manualStatuses.has(command.status)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task lifecycle status '${command.status}' must be changed by a lifecycle command.`,
          });
        }
        const activeRun = (readModel.agentRuns ?? []).find(
          (run) =>
            run.taskId === task.id &&
            (run.status === "starting" || run.status === "running" || run.status === "cancelling"),
        );
        if (activeRun !== undefined && command.status !== task.status) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task '${task.id}' cannot move while agent run '${activeRun.id}' is active.`,
          });
        }
        yield* requireMissionTaskTransition({ command, task, status: command.status });
      }
      if (command.assignedMissionAgentId !== undefined && command.assignedMissionAgentId !== null) {
        const agent = findMissionAgentById(readModel, command.assignedMissionAgentId);
        if (agent?.missionId !== command.missionId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Agent '${command.assignedMissionAgentId}' does not belong to mission '${command.missionId}'.`,
          });
        }
        const activeTaskRun = (readModel.agentRuns ?? []).some(
          (run) => run.taskId === task.id && isActiveAgentRunStatus(run.status),
        );
        if (activeTaskRun && command.assignedMissionAgentId !== task.assignedMissionAgentId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task '${task.id}' cannot be reassigned while it has an active run.`,
          });
        }
      }
      if (command.maximumAttempts !== undefined && command.maximumAttempts < task.attemptCount) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' already used ${task.attemptCount} attempts.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "task.updated",
        payload: {
          missionId: command.missionId,
          taskId: command.taskId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.status !== undefined ? { status: command.status } : {}),
          ...(command.position !== undefined ? { position: command.position } : {}),
          ...(command.assignedMissionAgentId !== undefined
            ? { assignedMissionAgentId: command.assignedMissionAgentId }
            : {}),
          ...(command.maximumAttempts !== undefined
            ? { maximumAttempts: command.maximumAttempts }
            : {}),
          ...(command.requiresDependencyHandoffs !== undefined
            ? { requiresDependencyHandoffs: command.requiresDependencyHandoffs }
            : {}),
          updatedAt: command.updatedAt,
        },
      };
    }

    case "mission.start":
    case "mission.retry": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      const startableStatuses =
        command.type === "mission.retry"
          ? new Set(["blocked", "failed"])
          : new Set(["backlog", "planning", "ready", "running", "verification"]);
      if (!startableStatuses.has(mission.status)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' cannot ${
            command.type === "mission.retry" ? "retry" : "start"
          } from '${mission.status}'.`,
        });
      }
      yield* requireMissionTransition({ command, mission, status: "running" });
      yield* requireAgentRunAbsent({ readModel, command, agentRunId: command.agentRunId });
      yield* requireThreadAbsent({ readModel, command, threadId: command.threadId });
      if (command.providerInstanceId !== command.modelSelection.instanceId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Agent-run provider instance must match the selected model provider instance.",
        });
      }
      const missionTasks = (readModel.missionTasks ?? [])
        .filter((entry) => entry.missionId === command.missionId)
        .toSorted(
          (left, right) => left.position - right.position || left.id.localeCompare(right.id),
        );
      const firstActionableTask = missionTasks.find(
        (entry) =>
          entry.status === "backlog" ||
          entry.status === "ready" ||
          entry.status === "blocked" ||
          entry.status === "failed",
      );
      if (
        command.taskId === undefined &&
        missionTasks.some(
          (entry) => entry.status !== "completed" && entry.status !== "cancelled",
        ) &&
        firstActionableTask === undefined
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' has unfinished tasks but none can be started.`,
        });
      }
      const selectedTaskId = command.taskId ?? firstActionableTask?.id;
      const task =
        selectedTaskId === undefined
          ? undefined
          : yield* requireMissionTask({
              readModel,
              command,
              missionId: command.missionId,
              taskId: selectedTaskId,
            });
      const runPurpose = command.purpose ?? "implementation";
      const isVerificationRepair = runPurpose === "verification_repair";
      if (isVerificationRepair !== (command.repairAttemptId !== undefined)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Verification repair runs require exactly one repair-attempt id.",
        });
      }
      if (task !== undefined) {
        if (isVerificationRepair) {
          if (task.status !== "verification") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Verification repair for task '${task.id}' requires the task to be in verification.`,
            });
          }
        } else {
          yield* requireMissionTaskTransition({ command, task, status: "running" });
        }
      } else if (isVerificationRepair) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Verification repair runs require a task.",
        });
      }

      const activeRuns = listActiveAgentRuns(readModel, mission.id);
      const missionAgentId = command.missionAgentId ?? task?.assignedMissionAgentId ?? null;
      const missionAgent =
        missionAgentId === null ? undefined : findMissionAgentById(readModel, missionAgentId);
      const isPhaseTwoRun = missionAgentId !== null || command.worktreeId !== undefined;
      if (!isPhaseTwoRun && activeRuns.length > 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Legacy mission start cannot run beside active agent run '${activeRuns[0]!.id}'.`,
        });
      }
      if (missionAgentId !== null && missionAgent?.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${missionAgentId}' does not belong to mission '${mission.id}'.`,
        });
      }
      if (missionAgent !== undefined) {
        if (missionAgent.status === "disabled" || missionAgent.status === "unavailable") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Mission agent '${missionAgent.id}' is '${missionAgent.status}'.`,
          });
        }
        if (
          activeRuns.filter((run) => run.missionAgentId === missionAgent.id).length >=
          missionAgent.maximumConcurrentRuns
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Mission agent '${missionAgent.id}' reached its concurrency limit.`,
          });
        }
      }
      if (activeRuns.length >= mission.teamSettings.maximumConcurrentAgents) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' reached its agent concurrency limit.`,
        });
      }
      if (task !== undefined) {
        if (activeRuns.some((run) => run.taskId === task.id)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task '${task.id}' already has an active agent run.`,
          });
        }
        const dependencies = (readModel.taskDependencies ?? []).filter(
          (dependency) => dependency.missionId === mission.id && dependency.taskId === task.id,
        );
        for (const dependency of dependencies) {
          const prerequisite = missionTasks.find(
            (entry) => entry.id === dependency.dependsOnTaskId,
          );
          if (prerequisite?.status !== "completed") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Task '${task.id}' is waiting for dependency '${dependency.dependsOnTaskId}'.`,
            });
          }
          if (
            task.requiresDependencyHandoffs &&
            !(readModel.agentHandoffs ?? []).some(
              (handoff) => handoff.taskId === dependency.dependsOnTaskId,
            )
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Task '${task.id}' is waiting for dependency handoff '${dependency.dependsOnTaskId}'.`,
            });
          }
        }
      }
      const permissions = normalizeAgentPermissions(
        command.permissions ?? missionAgent?.permissions ?? ALL_AGENT_PERMISSIONS,
      );
      if (
        missionAgent !== undefined &&
        permissions.some((permission) => !missionAgent.permissions.includes(permission))
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Agent run cannot exceed mission agent '${missionAgent.id}' permissions.`,
        });
      }
      if (
        isVerificationRepair &&
        permissions.some(
          (permission) =>
            permission === "manage_tasks" ||
            permission === "manage_worktrees" ||
            permission === "integrate_branches",
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Verification repair runs cannot manage tasks, worktrees, or branch integration.",
        });
      }
      const writeCapable = command.writeCapable ?? hasWritePermission(permissions);
      if (writeCapable !== hasWritePermission(permissions)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Agent-run write capability must match its permissions.",
        });
      }
      const worktreeId = command.worktreeId ?? task?.worktreeId ?? null;
      const worktree =
        worktreeId === null ? undefined : findManagedWorktreeById(readModel, worktreeId);
      if (
        worktreeId !== null &&
        (worktree?.missionId !== mission.id ||
          worktree.status === "planned" ||
          worktree.status === "creating" ||
          worktree.status === "removing" ||
          worktree.status === "removed" ||
          worktree.status === "failed" ||
          worktree.status === "orphaned")
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${worktreeId}' is not available to this mission run.`,
        });
      }
      if (
        isVerificationRepair &&
        (task === undefined ||
          worktree === undefined ||
          worktree.missionId !== mission.id ||
          worktree.taskId !== task.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Verification repair runs must reuse the task's assigned managed worktree.",
        });
      }
      if (isPhaseTwoRun && writeCapable) {
        const worktreeAvailableForWrite =
          worktree?.status === "ready" ||
          worktree?.status === "active" ||
          (isVerificationRepair &&
            (worktree?.status === "dirty" || worktree?.status === "integration_ready"));
        if (
          task === undefined ||
          worktree?.missionId !== mission.id ||
          worktree.taskId !== task.id ||
          !worktreeAvailableForWrite
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Write-capable task runs require their own ready managed worktree.",
          });
        }
        if (
          activeRuns.some((run) => run.writeCapable && run.worktreeId === worktreeId) ||
          activeRuns.filter((run) => run.writeCapable).length >=
            mission.teamSettings.maximumConcurrentWriteAgents
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Managed worktree '${worktreeId}' or the mission write pool already has an active writer.`,
          });
        }
      }
      const attemptNumber = command.attemptNumber ?? (task?.attemptCount ?? 0) + 1;
      if (!isVerificationRepair && task !== undefined && attemptNumber > task.maximumAttempts) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' exhausted its ${task.maximumAttempts} attempts.`,
        });
      }

      const run = {
        id: command.agentRunId,
        missionId: command.missionId,
        taskId: selectedTaskId ?? null,
        threadId: command.threadId,
        provider: command.providerInstanceId,
        providerInstanceId: command.providerInstanceId,
        providerSessionId: null,
        status: "starting" as const,
        createdAt: command.createdAt,
        startedAt: command.createdAt,
        updatedAt: command.createdAt,
        completedAt: null,
        errorSummary: null,
        missionAgentId,
        worktreeId,
        attemptNumber,
        permissions,
        writeCapable,
        purpose: runPurpose,
        repairAttemptId: command.repairAttemptId ?? null,
        routingDecisionId: command.routingDecisionId ?? null,
        modelSelection: command.modelSelection,
        reasoningLevel: command.reasoningLevel ?? null,
      };
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: command.missionId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "mission.started",
          payload: {
            missionId: command.missionId,
            taskId: selectedTaskId ?? null,
            agentRunId: command.agentRunId,
            startedAt: command.createdAt,
          },
        },
      ];
      if (task !== undefined) {
        if (isPhaseTwoRun) {
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: command.missionId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            })),
            type: "task.updated",
            payload: {
              missionId: command.missionId,
              taskId: task.id,
              assignedMissionAgentId: missionAgentId,
              updatedAt: command.createdAt,
            },
          });
        }
        if (!isVerificationRepair) {
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: command.missionId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            })),
            type: "task.started",
            payload: {
              missionId: command.missionId,
              taskId: task.id,
              agentRunId: command.agentRunId,
              occurredAt: command.createdAt,
            },
          });
        }
      }
      if (writeCapable && worktree !== undefined && worktree.status !== "active") {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: command.missionId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "managed_worktree.status-updated",
          payload: {
            missionId: command.missionId,
            worktreeId: worktree.id,
            status: "active",
            updatedAt: command.createdAt,
          },
        });
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "agent_run.started",
        payload: { run, modelSelection: command.modelSelection, runtimeMode: command.runtimeMode },
      });
      return events;
    }

    case "mission.team.configure": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      if (mission.status === "completed" || mission.status === "cancelled") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' is terminal and its team cannot be reconfigured.`,
        });
      }
      if (
        command.settings.maximumConcurrentWriteAgents > command.settings.maximumConcurrentAgents
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Maximum concurrent write agents cannot exceed total concurrent agents.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "mission.team-configured",
        payload: {
          missionId: mission.id,
          settings: command.settings,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "mission.agent.upsert": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      if (command.agent.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${command.agent.id}' has the wrong mission id.`,
        });
      }
      const existing = findMissionAgentById(readModel, command.agent.id);
      if (
        existing !== undefined &&
        listActiveAgentRuns(readModel, mission.id).some((run) => run.missionAgentId === existing.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${existing.id}' cannot be changed while it has an active run.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.agent.updatedAt,
          commandId: command.commandId,
        })),
        type: "mission.agent-upserted",
        payload: {
          agent: {
            ...command.agent,
            permissions: normalizeAgentPermissions(command.agent.permissions),
          },
        },
      };
    }

    case "mission.agent.remove": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const agent = findMissionAgentById(readModel, command.missionAgentId);
      if (agent?.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${command.missionAgentId}' does not exist in mission '${mission.id}'.`,
        });
      }
      if (
        listActiveAgentRuns(readModel, mission.id).some((run) => run.missionAgentId === agent.id) ||
        (readModel.missionTasks ?? []).some(
          (task) =>
            task.missionId === mission.id &&
            task.assignedMissionAgentId === agent.id &&
            task.status !== "completed" &&
            task.status !== "cancelled",
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${agent.id}' still owns active or unfinished work.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.removedAt,
          commandId: command.commandId,
        })),
        type: "mission.agent-removed",
        payload: {
          missionId: mission.id,
          missionAgentId: agent.id,
          removedAt: command.removedAt,
        },
      };
    }

    case "mission.agent.permissions.update": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const agent = findMissionAgentById(readModel, command.missionAgentId);
      if (agent?.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${command.missionAgentId}' does not exist in mission '${mission.id}'.`,
        });
      }
      if (
        listActiveAgentRuns(readModel, mission.id).some((run) => run.missionAgentId === agent.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission agent '${agent.id}' permissions cannot change during an active run.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "mission.agent-permissions-updated",
        payload: {
          missionId: mission.id,
          missionAgentId: agent.id,
          permissions: normalizeAgentPermissions(command.permissions),
          updatedAt: command.updatedAt,
        },
      };
    }

    case "mission.task.dependency.add": {
      yield* requireMission({ readModel, command, missionId: command.missionId });
      const dependency = command.dependency;
      if (
        dependency.missionId !== command.missionId ||
        dependency.taskId === dependency.dependsOnTaskId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Task dependencies must stay inside one mission and cannot point to themselves.",
        });
      }
      yield* requireMissionTask({
        readModel,
        command,
        missionId: command.missionId,
        taskId: dependency.taskId,
      });
      yield* requireMissionTask({
        readModel,
        command,
        missionId: command.missionId,
        taskId: dependency.dependsOnTaskId,
      });
      const dependencies = readModel.taskDependencies ?? [];
      if (
        dependencies.some(
          (entry) =>
            entry.id === dependency.id ||
            (entry.missionId === dependency.missionId &&
              entry.taskId === dependency.taskId &&
              entry.dependsOnTaskId === dependency.dependsOnTaskId),
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "That task dependency already exists.",
        });
      }
      if (wouldCreateTaskDependencyCycle(dependencies, dependency)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "That dependency would create a task cycle.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: dependency.createdAt,
          commandId: command.commandId,
        })),
        type: "task.dependency-added",
        payload: { dependency },
      };
    }

    case "mission.task.dependency.remove": {
      yield* requireMission({ readModel, command, missionId: command.missionId });
      const dependency = findTaskDependencyById(readModel, command.dependencyId);
      if (
        dependency?.missionId !== command.missionId ||
        dependency.taskId !== command.taskId ||
        dependency.dependsOnTaskId !== command.dependsOnTaskId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task dependency '${command.dependencyId}' does not match the requested edge.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.removedAt,
          commandId: command.commandId,
        })),
        type: "task.dependency-removed",
        payload: {
          missionId: command.missionId,
          dependencyId: dependency.id,
          taskId: dependency.taskId,
          dependsOnTaskId: dependency.dependsOnTaskId,
          removedAt: command.removedAt,
        },
      };
    }

    case "mission.task.retry": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      if (!new Set(["failed", "blocked", "cancelled"]).has(task.status)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' cannot retry from '${task.status}'.`,
        });
      }
      if (task.attemptCount >= task.maximumAttempts) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' exhausted its ${task.maximumAttempts} attempts.`,
        });
      }
      if (
        (readModel.agentRuns ?? []).some(
          (run) => run.taskId === task.id && isActiveAgentRunStatus(run.status),
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' already has an active run.`,
        });
      }
      return [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.requestedAt,
            commandId: command.commandId,
          })),
          type: "task.retry-requested",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            reason: command.reason,
            attemptNumber: task.attemptCount + 1,
            requestedAt: command.requestedAt,
          },
        },
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.requestedAt,
            commandId: command.commandId,
          })),
          type: "task.ready",
          payload: { missionId: mission.id, taskId: task.id, readyAt: command.requestedAt },
        },
      ];
    }

    case "mission.task.cancel": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      if (task.status === "completed" || task.status === "cancelled") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' is already '${task.status}'.`,
        });
      }
      const activeRun = (readModel.agentRuns ?? []).find(
        (run) => run.taskId === task.id && isActiveAgentRunStatus(run.status),
      );
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.requestedAt,
            commandId: command.commandId,
          })),
          type: "task.cancellation-requested",
          payload: { missionId: mission.id, taskId: task.id, requestedAt: command.requestedAt },
        },
      ];
      if (activeRun === undefined) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.requestedAt,
            commandId: command.commandId,
          })),
          type: "task.updated",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            status: "cancelled",
            updatedAt: command.requestedAt,
          },
        });
      } else {
        yield* requireAgentRunTransition({ command, run: activeRun, status: "cancelling" });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.requestedAt,
            commandId: command.commandId,
          })),
          type: "agent_run.cancellation-requested",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: activeRun.id,
            occurredAt: command.requestedAt,
          },
        });
      }
      return events;
    }

    case "mission.scheduler.start":
    case "mission.scheduler.pause":
    case "mission.scheduler.resume": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      if (
        mission.status === "completed" ||
        mission.status === "cancelled" ||
        mission.status === "failed"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' is terminal and its scheduler cannot change.`,
        });
      }
      const status = command.type === "mission.scheduler.pause" ? "paused" : "running";
      if (mission.schedulerStatus === status) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission scheduler is already '${status}'.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type:
          command.type === "mission.scheduler.start"
            ? "scheduler.started"
            : command.type === "mission.scheduler.pause"
              ? "scheduler.paused"
              : "scheduler.resumed",
        payload: { missionId: mission.id, status, occurredAt: command.requestedAt },
      };
    }

    case "mission.integration.request":
    case "mission.integration.approve": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      const worktree = findManagedWorktreeById(readModel, command.worktreeId);
      if (worktree?.missionId !== mission.id || worktree.taskId !== task.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Worktree '${command.worktreeId}' does not belong to task '${task.id}'.`,
        });
      }
      if (task.status !== "completed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' must complete before integration.`,
        });
      }
      if (task.integrationStatus === "integrated") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' is already integrated.`,
        });
      }
      if (command.type === "mission.integration.approve" && task.integrationStatus !== "pending") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' has no pending integration request to approve.`,
        });
      }
      const policyApproved =
        command.type === "mission.integration.request" &&
        mission.teamSettings.integrationMode !== "manual";
      const approved = command.type === "mission.integration.approve" || policyApproved;
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: approved ? "integration.approved" : "integration.requested",
        payload: {
          missionId: mission.id,
          taskId: task.id,
          worktreeId: worktree.id,
          integrationStatus: approved ? "ready" : "pending",
          occurredAt: command.requestedAt,
        },
      };
    }

    case "mission.integration.abort": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      const worktree = findManagedWorktreeById(readModel, command.worktreeId);
      if (worktree?.taskId !== task.id || task.integrationStatus === "integrated") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' has no abortable integration.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "integration.aborted",
        payload: {
          missionId: mission.id,
          taskId: task.id,
          worktreeId: worktree.id,
          integrationStatus: "failed",
          occurredAt: command.requestedAt,
          errorSummary: command.reason,
        },
      };
    }

    case "mission.worktree.remove": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const worktree = findManagedWorktreeById(readModel, command.worktreeId);
      if (worktree?.missionId !== mission.id || worktree.status === "removed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${command.worktreeId}' is not removable for mission '${mission.id}'.`,
        });
      }
      if (
        listActiveAgentRuns(readModel, mission.id).some((run) => run.worktreeId === worktree.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${worktree.id}' still has an active agent run.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "managed_worktree.removal-requested",
        payload: {
          missionId: mission.id,
          worktreeId: worktree.id,
          requestedAt: command.requestedAt,
        },
      };
    }

    case "mission.cancel": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (mission.status === "cancelled" || mission.status === "completed") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' is already '${mission.status}'.`,
        });
      }
      const activeRuns = listActiveAgentRuns(readModel, command.missionId).filter(
        (run) => run.status !== "cancelling",
      );
      for (const run of activeRuns) {
        yield* requireAgentRunTransition({ command, run, status: "cancelling" });
      }
      yield* requireMissionTransition({ command, mission, status: "cancelled" });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: command.missionId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "mission.cancellation-requested",
          payload: {
            missionId: command.missionId,
            agentRunId: activeRuns[0]?.id ?? null,
            agentRunIds: activeRuns.map((run) => run.id),
            requestedAt: command.createdAt,
          },
        },
      ];
      for (const run of activeRuns) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: command.missionId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "agent_run.cancellation-requested",
          payload: {
            missionId: command.missionId,
            taskId: run.taskId,
            agentRunId: run.id,
            occurredAt: command.createdAt,
          },
        });
      }
      const activeTaskIds = new Set(
        activeRuns.flatMap((run) => (run.taskId === null ? [] : [run.taskId])),
      );
      for (const task of (readModel.missionTasks ?? []).filter(
        (entry) =>
          entry.missionId === mission.id &&
          !activeTaskIds.has(entry.id) &&
          entry.status !== "completed" &&
          entry.status !== "cancelled",
      )) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: command.missionId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "task.updated",
          payload: {
            missionId: command.missionId,
            taskId: task.id,
            status: "cancelled",
            updatedAt: command.createdAt,
          },
        });
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "mission.cancelled",
        payload: {
          missionId: command.missionId,
          agentRunId: activeRuns[0]?.id ?? null,
          cancelledAt: command.createdAt,
        },
      });
      return events;
    }

    case "mission.worktree.record": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const worktree = command.worktree;
      if (worktree.missionId !== mission.id || worktree.projectId !== mission.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${worktree.id}' does not match mission '${mission.id}'.`,
        });
      }
      if (
        (worktree.purpose === "task" && worktree.taskId === null) ||
        (worktree.purpose === "integration" && worktree.taskId !== null)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Task worktrees require a task; integration worktrees must not have one.",
        });
      }
      if (worktree.taskId !== null) {
        yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: worktree.taskId,
        });
      }
      const collision = (readModel.managedWorktrees ?? []).find(
        (entry) =>
          entry.status !== "removed" &&
          (entry.id === worktree.id ||
            entry.worktreePath === worktree.worktreePath ||
            (entry.repositoryPath === worktree.repositoryPath &&
              entry.branchName === worktree.branchName) ||
            (worktree.taskId !== null && entry.taskId === worktree.taskId) ||
            (worktree.purpose === "integration" &&
              entry.missionId === mission.id &&
              entry.purpose === "integration")),
      );
      if (collision !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${worktree.id}' collides with '${collision.id}'.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: worktree.updatedAt,
          commandId: command.commandId,
        })),
        type: "managed_worktree.recorded",
        payload: { worktree },
      };
    }

    case "mission.worktree.status.update": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const worktree = findManagedWorktreeById(readModel, command.worktreeId);
      if (worktree?.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${command.worktreeId}' does not belong to mission '${mission.id}'.`,
        });
      }
      if (!canTransitionManagedWorktree(worktree.status, command.status)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Managed worktree '${worktree.id}' cannot transition from '${worktree.status}' to '${command.status}'.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "managed_worktree.status-updated",
        payload: {
          missionId: mission.id,
          worktreeId: worktree.id,
          status: command.status,
          ...(command.headCommit !== undefined ? { headCommit: command.headCommit } : {}),
          ...(command.changedFileCount !== undefined
            ? { changedFileCount: command.changedFileCount }
            : {}),
          ...(command.hasUncommittedChanges !== undefined
            ? { hasUncommittedChanges: command.hasUncommittedChanges }
            : {}),
          ...(command.conflictingFiles !== undefined
            ? { conflictingFiles: command.conflictingFiles }
            : {}),
          ...(command.errorSummary !== undefined ? { errorSummary: command.errorSummary } : {}),
          ...(command.removedAt !== undefined ? { removedAt: command.removedAt } : {}),
          updatedAt: command.updatedAt,
        },
      };
    }

    case "mission.handoff.create": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const handoff = command.handoff;
      if (handoff.missionId !== mission.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Handoff '${handoff.id}' has the wrong mission id.`,
        });
      }
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: handoff.taskId,
      });
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: mission.id,
        agentRunId: handoff.agentRunId,
      });
      if (
        run.taskId !== task.id ||
        run.missionAgentId !== handoff.fromMissionAgentId ||
        (readModel.agentHandoffs ?? []).some((entry) => entry.id === handoff.id)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Handoff '${handoff.id}' does not match its task/run or already exists.`,
        });
      }
      if (
        handoff.toMissionAgentId !== null &&
        findMissionAgentById(readModel, handoff.toMissionAgentId)?.missionId !== mission.id
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Handoff target '${handoff.toMissionAgentId}' is not a member of this mission.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: handoff.createdAt,
          commandId: command.commandId,
        })),
        type: "agent_handoff.created",
        payload: { handoff },
      };
    }

    case "mission.handoff.reconcile": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const handoff = findAgentHandoffById(readModel, command.handoffId);
      if (handoff?.missionId !== mission.id || handoff.reconciliationStatus !== "pending") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Handoff '${command.handoffId}' is missing or already reconciled.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.reconciledAt,
          commandId: command.commandId,
        })),
        type: "agent_handoff.reconciled",
        payload: {
          missionId: mission.id,
          handoffId: handoff.id,
          reconciliationStatus: command.reconciliationStatus,
          changedFiles: command.changedFiles,
          reconciledAt: command.reconciledAt,
        },
      };
    }

    case "mission.task.mark-ready":
    case "mission.task.mark-blocked": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      const nextStatus = command.type === "mission.task.mark-ready" ? "ready" : "blocked";
      yield* requireMissionTaskTransition({ command, task, status: nextStatus });
      const occurredAt =
        command.type === "mission.task.mark-ready" ? command.readyAt : command.blockedAt;
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: command.type === "mission.task.mark-ready" ? "task.ready" : "task.blocked",
        payload:
          command.type === "mission.task.mark-ready"
            ? { missionId: mission.id, taskId: task.id, readyAt: command.readyAt }
            : {
                missionId: mission.id,
                taskId: task.id,
                reason: command.reason,
                blockedAt: command.blockedAt,
              },
      };
    }

    case "mission.scheduler.concurrency-limit": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.observedAt,
          commandId: command.commandId,
        })),
        type: "scheduler.concurrency-limited",
        payload: {
          missionId: mission.id,
          maximumConcurrentAgents: command.maximumConcurrentAgents,
          maximumConcurrentWriteAgents: command.maximumConcurrentWriteAgents,
          observedAt: command.observedAt,
        },
      };
    }

    case "mission.integration.start":
    case "mission.integration.complete":
    case "mission.integration.conflict":
    case "mission.integration.fail": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      const worktree = findManagedWorktreeById(readModel, command.worktreeId);
      if (worktree?.missionId !== mission.id || worktree.taskId !== task.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Integration worktree '${command.worktreeId}' does not match task '${task.id}'.`,
        });
      }
      if (command.type === "mission.integration.start") {
        if (task.integrationStatus !== "ready") {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task '${task.id}' integration has not been approved.`,
          });
        }
        const dependencies = (readModel.taskDependencies ?? []).filter(
          (dependency) => dependency.missionId === mission.id && dependency.taskId === task.id,
        );
        const taskById = new Map(
          (readModel.missionTasks ?? [])
            .filter((entry) => entry.missionId === mission.id)
            .map((entry) => [entry.id, entry] as const),
        );
        if (
          dependencies.some(
            (dependency) =>
              taskById.get(dependency.dependsOnTaskId)?.integrationStatus !== "integrated",
          )
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Task '${task.id}' must integrate after all dependencies.`,
          });
        }
      } else if (task.integrationStatus !== "integrating") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' has no integration in progress.`,
        });
      }
      const integrationStatus =
        command.type === "mission.integration.start"
          ? "integrating"
          : command.type === "mission.integration.complete"
            ? "integrated"
            : command.type === "mission.integration.conflict"
              ? "conflicted"
              : "failed";
      const type =
        command.type === "mission.integration.start"
          ? "integration.started"
          : command.type === "mission.integration.complete"
            ? "integration.completed"
            : command.type === "mission.integration.conflict"
              ? "integration.conflicted"
              : "integration.failed";
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type,
          payload: {
            missionId: mission.id,
            taskId: task.id,
            worktreeId: worktree.id,
            integrationStatus,
            occurredAt: command.occurredAt,
            ...(command.type === "mission.integration.complete"
              ? { headCommit: command.headCommit }
              : {}),
            ...(command.type === "mission.integration.conflict"
              ? { conflictingFiles: command.conflictingFiles }
              : {}),
            ...(command.type === "mission.integration.fail"
              ? { errorSummary: command.errorSummary }
              : {}),
          },
        },
      ];
      if (
        command.type === "mission.integration.complete" ||
        command.type === "mission.integration.conflict"
      ) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: "managed_worktree.status-updated",
          payload: {
            missionId: mission.id,
            worktreeId: worktree.id,
            status: command.type === "mission.integration.complete" ? "integrated" : "conflicted",
            ...(command.type === "mission.integration.complete"
              ? { headCommit: command.headCommit }
              : { conflictingFiles: command.conflictingFiles }),
            updatedAt: command.occurredAt,
          },
        });
      }
      return events;
    }

    case "verification.settings.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.settings.projectId,
      });
      if (command.settings.updatedAt !== command.updatedAt) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Verification settings updatedAt must match the audited command timestamp.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.settings.projectId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "verification.settings_updated",
        payload: {
          settings: command.settings,
          actor: command.actor,
          occurredAt: command.updatedAt,
        },
      };
    }

    case "verification.request": {
      if ((command.scope === undefined) !== (command.trigger !== "retry_failed_gate")) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Failed-gate retries require an explicit failed-gate scope, and scoped requests must use the retry_failed_gate trigger.",
        });
      }
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const mission =
        command.missionId === null
          ? undefined
          : yield* requireMission({ readModel, command, missionId: command.missionId });
      if (mission !== undefined && mission.projectId !== project.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' does not belong to project '${project.id}'.`,
        });
      }
      if (command.taskId !== null) {
        if (mission === undefined) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Task verification requires a mission.",
          });
        }
        yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: command.taskId,
        });
      }
      if (command.worktreeId !== null) {
        const worktree = findManagedWorktreeById(readModel, command.worktreeId);
        if (
          worktree === undefined ||
          worktree.projectId !== project.id ||
          worktree.missionId !== command.missionId ||
          (command.taskId !== null && worktree.taskId !== command.taskId)
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Verification worktree '${command.worktreeId}' does not match its project, mission, and task.`,
          });
        }
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: mission === undefined ? "project" : "mission",
          aggregateId: mission?.id ?? project.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "verification.requested",
        payload: {
          projectId: project.id,
          missionId: command.missionId,
          taskId: command.taskId,
          worktreeId: command.worktreeId,
          profileId: command.profileId,
          requestedBy: command.requestedBy,
          trigger: command.trigger,
          scope: command.scope ?? null,
          requestedAt: command.requestedAt,
        },
      };
    }

    case "verification.cancel": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      if (command.missionId !== null) {
        yield* requireMission({ readModel, command, missionId: command.missionId });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "verification.cancel_requested",
        payload: {
          projectId: command.projectId,
          missionId: command.missionId,
          verificationRunId: command.verificationRunId,
          requestedBy: command.requestedBy,
          requestedAt: command.requestedAt,
        },
      };
    }

    case "verification.repair.request": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (mission.projectId !== command.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Mission '${mission.id}' does not belong to project '${command.projectId}'.`,
        });
      }
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      if (task.status !== "verification") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' is not awaiting verification repair.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "verification.repair_requested",
        payload: {
          projectId: command.projectId,
          missionId: mission.id,
          taskId: task.id,
          verificationRunId: command.verificationRunId,
          requestedBy: command.requestedBy,
          requestedAt: command.requestedAt,
        },
      };
    }

    case "verification.override.request": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      const mission =
        command.missionId === null
          ? undefined
          : yield* requireMission({ readModel, command, missionId: command.missionId });
      if (mission === undefined || mission.projectId !== command.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Task verification overrides require a matching mission and project.",
        });
      }
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.taskId,
      });
      if (task.status !== "verification" || task.integrationStatus === "integrated") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Task '${task.id}' cannot receive a verification override in its current state.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        })),
        type: "verification.override_requested",
        payload: {
          overrideId: command.overrideId,
          projectId: command.projectId,
          missionId: command.missionId,
          taskId: command.taskId,
          verificationRunId: command.verificationRunId,
          sourceFingerprint: command.sourceFingerprint,
          reason: command.reason,
          requestedBy: command.requestedBy,
          requestedAt: command.requestedAt,
        },
      };
    }

    case "verification.profile.record": {
      yield* requireProject({ readModel, command, projectId: command.profile.projectId });
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.profile.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type:
          command.operation === "created"
            ? "verification.profile_created"
            : "verification.profile_updated",
        payload: { profile: command.profile, occurredAt: command.occurredAt },
      };
    }

    case "verification.request.reject": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      if (command.missionId !== null) {
        const mission = yield* requireMission({
          readModel,
          command,
          missionId: command.missionId,
        });
        if (mission.projectId !== command.projectId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Verification request failure has a mismatched mission '${command.missionId}'.`,
          });
        }
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type: "verification.request_failed",
        payload: {
          projectId: command.projectId,
          missionId: command.missionId,
          taskId: command.taskId,
          failureCategory: command.failureCategory,
          summary: command.summary,
          occurredAt: command.occurredAt,
        },
      };
    }

    case "verification.run.record": {
      const run = command.run;
      yield* requireProject({ readModel, command, projectId: run.projectId });
      if (
        run.executionPlan.source.sourceFingerprint !== run.sourceFingerprint ||
        run.executionPlan.profileId !== run.profileId ||
        run.executionPlan.configurationRevision !== run.configurationRevision ||
        run.executionPlan.configurationDigest !== run.configurationDigest
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Verification run '${run.id}' does not match its immutable execution plan.`,
        });
      }
      const expectedStatus =
        command.action === "plan_created" || command.action === "queued"
          ? "queued"
          : command.action === "started"
            ? "running"
            : command.action;
      if (run.status !== expectedStatus) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Verification action '${command.action}' does not match run status '${run.status}'.`,
        });
      }
      const mission =
        run.missionId === null
          ? undefined
          : yield* requireMission({ readModel, command, missionId: run.missionId });
      if (mission !== undefined && mission.projectId !== run.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Verification run '${run.id}' has a mismatched mission.`,
        });
      }
      const task =
        run.taskId === null || mission === undefined
          ? undefined
          : yield* requireMissionTask({
              readModel,
              command,
              missionId: mission.id,
              taskId: run.taskId,
            });
      const eventType =
        command.action === "plan_created"
          ? "verification.plan_created"
          : (`verification.${command.action}` as const);
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: mission === undefined ? "project" : "mission",
            aggregateId: mission?.id ?? run.projectId,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: eventType,
          payload: { run, occurredAt: command.occurredAt },
        },
      ];
      if (
        (command.action === "passed" || command.action === "passed_with_warnings") &&
        task !== undefined &&
        mission !== undefined &&
        task.status === "verification" &&
        run.authorizationScope === "full_profile"
      ) {
        const skipsRequiredCheck = run.executionPlan.skippedChecks.some((check) => check.required);
        const hasEmptyRequiredGate = run.executionPlan.gates.some(
          (gate) => gate.required && gate.checks.length === 0,
        );
        if (!isAuthorizingVerificationRun(run) || skipsRequiredCheck || hasEmptyRequiredGate) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Verification run '${run.id}' cannot authorize task '${task.id}'.`,
          });
        }
        yield* requireMissionTaskTransition({ command, task, status: "completed" });
        const allTasksComplete = (readModel.missionTasks ?? [])
          .filter((entry) => entry.missionId === mission.id)
          .every((entry) => entry.id === task.id || entry.status === "completed");
        const nextMissionStatus = allTasksComplete ? "completed" : "running";
        yield* requireMissionTransition({ command, mission, status: nextMissionStatus });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: "task.completed",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: run.agentRunId,
            occurredAt: command.occurredAt,
          },
        });
        if (run.worktreeId !== null) {
          const worktree = findManagedWorktreeById(readModel, run.worktreeId);
          if (
            worktree?.missionId !== mission.id ||
            worktree.taskId !== task.id ||
            !canTransitionManagedWorktree(worktree.status, "integration_ready")
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Verified worktree '${run.worktreeId}' is not integration ready.`,
            });
          }
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: mission.id,
              occurredAt: command.occurredAt,
              commandId: command.commandId,
            })),
            type: "managed_worktree.status-updated",
            payload: {
              missionId: mission.id,
              worktreeId: worktree.id,
              status: "integration_ready",
              updatedAt: command.occurredAt,
            },
          });
        }
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          ...(allTasksComplete
            ? {
                type: "mission.completed" as const,
                payload: {
                  missionId: mission.id,
                  agentRunId: run.agentRunId,
                  completedAt: command.occurredAt,
                },
              }
            : {
                type: "mission.updated" as const,
                payload: {
                  missionId: mission.id,
                  status: "running" as const,
                  updatedAt: command.occurredAt,
                },
              }),
        });
      }
      if (
        command.action === "invalidated" &&
        task !== undefined &&
        mission !== undefined &&
        task.status === "completed" &&
        task.integrationStatus !== "integrated"
      ) {
        yield* requireMissionTaskTransition({ command, task, status: "verification" });
        const nextMissionStatus = mission.status === "completed" ? "verification" : mission.status;
        yield* requireMissionTransition({ command, mission, status: nextMissionStatus });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: "task.updated",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            status: "verification",
            updatedAt: command.occurredAt,
          },
        });
        if (nextMissionStatus !== mission.status) {
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: mission.id,
              occurredAt: command.occurredAt,
              commandId: command.commandId,
            })),
            type: "mission.updated",
            payload: {
              missionId: mission.id,
              status: nextMissionStatus,
              updatedAt: command.occurredAt,
            },
          });
        }
      }
      return events;
    }

    case "verification.gate.record": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type: `verification.gate_${command.action}` as const,
        payload: {
          projectId: command.projectId,
          missionId: command.missionId,
          verificationRunId: command.verificationRunId,
          gateId: command.gateId,
          name: command.name,
          summary: command.summary,
          occurredAt: command.occurredAt,
        },
      };
    }

    case "verification.check.record": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type: `verification.check_${command.action}` as const,
        payload: {
          projectId: command.projectId,
          missionId: command.missionId,
          checkRun: command.checkRun,
          occurredAt: command.occurredAt,
        },
      };
    }

    case "verification.check.output.record": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type: "verification.check_output",
        payload: {
          projectId: command.projectId,
          missionId: command.missionId,
          verificationRunId: command.verificationRunId,
          checkRunId: command.checkRunId,
          logReference: command.logReference,
          stdoutBytes: command.stdoutBytes,
          stderrBytes: command.stderrBytes,
          truncated: command.truncated,
          occurredAt: command.occurredAt,
        },
      };
    }

    case "verification.diagnostic.record":
    case "verification.artifact.record": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      return {
        ...(yield* withEventBase({
          aggregateKind: command.missionId === null ? "project" : "mission",
          aggregateId: command.missionId ?? command.projectId,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type:
          command.type === "verification.diagnostic.record"
            ? "verification.diagnostic_created"
            : "verification.artifact_created",
        payload:
          command.type === "verification.diagnostic.record"
            ? {
                projectId: command.projectId,
                missionId: command.missionId,
                verificationRunId: command.verificationRunId,
                diagnostic: command.diagnostic,
                occurredAt: command.occurredAt,
              }
            : {
                projectId: command.projectId,
                missionId: command.missionId,
                artifact: command.artifact,
                occurredAt: command.occurredAt,
              },
      };
    }

    case "verification.repair.record": {
      const mission = yield* requireMission({
        readModel,
        command,
        missionId: command.missionId,
      });
      if (mission.projectId !== command.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Repair attempt '${command.attempt.id}' has a mismatched project.`,
        });
      }
      yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: command.attempt.taskId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        type: `verification.repair_${command.action}` as const,
        payload: {
          projectId: command.projectId,
          missionId: mission.id,
          attempt: command.attempt,
          summary: command.summary,
          occurredAt: command.occurredAt,
        },
      };
    }

    case "verification.override.apply": {
      const override = command.override;
      yield* requireProject({ readModel, command, projectId: override.projectId });
      const mission =
        override.missionId === null
          ? undefined
          : yield* requireMission({ readModel, command, missionId: override.missionId });
      if (mission === undefined || mission.projectId !== override.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Verification override '${override.id}' has a mismatched mission.`,
        });
      }
      const task = yield* requireMissionTask({
        readModel,
        command,
        missionId: mission.id,
        taskId: override.taskId,
      });
      if (task.status !== "verification" || task.integrationStatus === "integrated") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Verification override '${override.id}' cannot authorize task '${task.id}'.`,
        });
      }
      yield* requireMissionTaskTransition({ command, task, status: "completed" });
      const allTasksComplete = (readModel.missionTasks ?? [])
        .filter((entry) => entry.missionId === mission.id)
        .every((entry) => entry.id === task.id || entry.status === "completed");
      const nextMissionStatus = allTasksComplete ? "completed" : "running";
      yield* requireMissionTransition({ command, mission, status: nextMissionStatus });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: "verification.override_applied",
          payload: { override, occurredAt: command.occurredAt },
        },
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.occurredAt,
            commandId: command.commandId,
          })),
          type: "task.completed",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: null,
            occurredAt: command.occurredAt,
          },
        },
      ];
      if (task.worktreeId !== null) {
        const worktree = findManagedWorktreeById(readModel, task.worktreeId);
        if (
          worktree !== undefined &&
          canTransitionManagedWorktree(worktree.status, "integration_ready")
        ) {
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: mission.id,
              occurredAt: command.occurredAt,
              commandId: command.commandId,
            })),
            type: "managed_worktree.status-updated",
            payload: {
              missionId: mission.id,
              worktreeId: worktree.id,
              status: "integration_ready",
              updatedAt: command.occurredAt,
            },
          });
        }
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.occurredAt,
          commandId: command.commandId,
        })),
        ...(allTasksComplete
          ? {
              type: "mission.completed" as const,
              payload: {
                missionId: mission.id,
                agentRunId: null,
                completedAt: command.occurredAt,
              },
            }
          : {
              type: "mission.updated" as const,
              payload: {
                missionId: mission.id,
                status: "running" as const,
                updatedAt: command.occurredAt,
              },
            }),
      });
      return events;
    }

    case "github.event.record": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.payload.projectId,
      });
      const mission =
        command.payload.missionId === null
          ? null
          : yield* requireMission({
              readModel,
              command,
              missionId: command.payload.missionId,
            });
      if (mission !== null && mission.projectId !== command.payload.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `GitHub event '${command.eventType}' has a mismatched mission and project.`,
        });
      }
      if (command.payload.taskId !== null) {
        if (mission === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `GitHub event '${command.eventType}' cannot reference a task without a mission.`,
          });
        }
        yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: command.payload.taskId,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: mission === null ? "project" : "mission",
          aggregateId: mission === null ? command.payload.projectId : mission.id,
          occurredAt: command.payload.occurredAt,
          commandId: command.commandId,
        })),
        type: command.eventType,
        payload: command.payload,
      };
    }

    case "memory.event.record": {
      const project =
        command.payload.projectId === null
          ? null
          : yield* requireProject({
              readModel,
              command,
              projectId: command.payload.projectId,
            });
      const mission =
        command.payload.missionId === null
          ? null
          : yield* requireMission({
              readModel,
              command,
              missionId: command.payload.missionId,
            });
      if (mission !== null && (project === null || mission.projectId !== project.id)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Memory event '${command.eventType}' has a mismatched mission and project.`,
        });
      }
      if (command.payload.taskId !== null) {
        if (mission === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Memory event '${command.eventType}' cannot reference a task without a mission.`,
          });
        }
        yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: command.payload.taskId,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "memory",
          aggregateId: command.payload.aggregateId,
          occurredAt: command.payload.occurredAt,
          commandId: command.commandId,
        })),
        type: command.eventType,
        payload: command.payload,
      };
    }

    case "routing.event.record": {
      const project =
        command.payload.projectId === null
          ? null
          : yield* requireProject({
              readModel,
              command,
              projectId: command.payload.projectId,
            });
      const mission =
        command.payload.missionId === null
          ? null
          : yield* requireMission({
              readModel,
              command,
              missionId: command.payload.missionId,
            });
      if (mission !== null && (project === null || mission.projectId !== project.id)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routing event '${command.eventType}' has a mismatched mission and project.`,
        });
      }
      if (command.payload.taskId !== null) {
        if (mission === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Routing event '${command.eventType}' cannot reference a task without a mission.`,
          });
        }
        yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: command.payload.taskId,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "routing",
          aggregateId: command.aggregateId,
          occurredAt: command.payload.occurredAt,
          commandId: command.commandId,
        })),
        type: command.eventType,
        payload: command.payload,
      };
    }

    case "mission.agent-run.mark-running": {
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: command.missionId,
        agentRunId: command.agentRunId,
      });
      yield* requireAgentRunTransition({ command, run, status: "running" });
      return {
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: command.missionId,
          occurredAt: command.startedAt,
          commandId: command.commandId,
        })),
        type: "agent_run.running",
        payload: {
          missionId: command.missionId,
          taskId: run.taskId,
          agentRunId: run.id,
          providerSessionId: command.providerSessionId,
          occurredAt: command.startedAt,
        },
      };
    }

    case "mission.agent-run.complete": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: command.missionId,
        agentRunId: command.agentRunId,
      });
      yield* requireAgentRunTransition({ command, run, status: "completed" });
      const task =
        run.taskId === null
          ? undefined
          : yield* requireMissionTask({
              readModel,
              command,
              missionId: command.missionId,
              taskId: run.taskId,
            });
      const isVerificationRepair = run.purpose === "verification_repair";
      const requiresVerification = !isVerificationRepair && (command.requiresVerification ?? false);
      if (task !== undefined && !isVerificationRepair) {
        yield* requireMissionTaskTransition({
          command,
          task,
          status: requiresVerification ? "verification" : "completed",
        });
      }
      const allTasksSettledForThisRun = (readModel.missionTasks ?? [])
        .filter((entry) => entry.missionId === mission.id)
        .every(
          (entry) =>
            entry.id === task?.id ||
            entry.status === "completed" ||
            (requiresVerification && entry.status === "verification"),
        );
      const otherActiveRuns = listActiveAgentRuns(readModel, mission.id).filter(
        (entry) => entry.id !== run.id,
      );
      const completesMission = task === undefined;
      const entersVerification =
        requiresVerification &&
        task !== undefined &&
        allTasksSettledForThisRun &&
        otherActiveRuns.length === 0;
      const completesTaskMission =
        !requiresVerification &&
        !isVerificationRepair &&
        task !== undefined &&
        allTasksSettledForThisRun &&
        otherActiveRuns.length === 0;
      const nextMissionStatus = completesMission
        ? "completed"
        : completesTaskMission
          ? "completed"
          : entersVerification
            ? "verification"
            : "running";
      yield* requireMissionTransition({ command, mission, status: nextMissionStatus });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.completedAt,
            commandId: command.commandId,
          })),
          type: "agent_run.completed",
          payload: {
            missionId: mission.id,
            taskId: run.taskId,
            agentRunId: run.id,
            occurredAt: command.completedAt,
          },
        },
      ];
      if (task !== undefined && requiresVerification) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.completedAt,
            commandId: command.commandId,
          })),
          type: "task.implementation-completed",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: run.id,
            occurredAt: command.completedAt,
          },
        });
      }
      if (task !== undefined && !isVerificationRepair && !requiresVerification) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.completedAt,
            commandId: command.commandId,
          })),
          type: "task.completed",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: run.id,
            occurredAt: command.completedAt,
          },
        });
        if (run.worktreeId !== null) {
          const worktree = findManagedWorktreeById(readModel, run.worktreeId);
          if (
            worktree?.missionId !== mission.id ||
            worktree.taskId !== task.id ||
            !canTransitionManagedWorktree(worktree.status, "integration_ready")
          ) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Completed worktree '${run.worktreeId}' is not integration ready.`,
            });
          }
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: mission.id,
              occurredAt: command.completedAt,
              commandId: command.commandId,
            })),
            type: "managed_worktree.status-updated",
            payload: {
              missionId: mission.id,
              worktreeId: worktree.id,
              status: "integration_ready",
              updatedAt: command.completedAt,
            },
          });
        }
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.completedAt,
          commandId: command.commandId,
        })),
        ...(completesMission || completesTaskMission
          ? {
              type: "mission.completed" as const,
              payload: {
                missionId: mission.id,
                agentRunId: run.id,
                completedAt: command.completedAt,
              },
            }
          : {
              type: "mission.updated" as const,
              payload: {
                missionId: mission.id,
                status: nextMissionStatus,
                updatedAt: command.completedAt,
              },
            }),
      });
      return events;
    }

    case "mission.agent-run.fail": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: command.missionId,
        agentRunId: command.agentRunId,
      });
      yield* requireAgentRunTransition({ command, run, status: "failed" });
      const isVerificationRepair = run.purpose === "verification_repair";
      const isLegacySingleAgentRun = run.missionAgentId === null && !isVerificationRepair;
      const preservesCancelledMission = mission.status === "cancelled";
      const otherActiveRuns = listActiveAgentRuns(readModel, mission.id).filter(
        (entry) => entry.id !== run.id,
      );
      const allTasksAwaitingVerification = (readModel.missionTasks ?? [])
        .filter((entry) => entry.missionId === mission.id)
        .every((entry) => entry.status === "completed" || entry.status === "verification");
      const repairMissionStatus =
        otherActiveRuns.length === 0 && allTasksAwaitingVerification ? "verification" : "running";
      yield* requireMissionTransition({
        command,
        mission,
        status: preservesCancelledMission
          ? "cancelled"
          : isVerificationRepair
            ? repairMissionStatus
            : isLegacySingleAgentRun
              ? "failed"
              : "running",
      });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.failedAt,
            commandId: command.commandId,
          })),
          type: "agent_run.failed",
          payload: {
            missionId: mission.id,
            taskId: run.taskId,
            agentRunId: run.id,
            occurredAt: command.failedAt,
            errorSummary: command.errorSummary,
            runtimeErrorClass: command.runtimeErrorClass ?? null,
          },
        },
      ];
      if (run.taskId !== null && !isVerificationRepair) {
        const task = yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: run.taskId,
        });
        yield* requireMissionTaskTransition({ command, task, status: "failed" });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.failedAt,
            commandId: command.commandId,
          })),
          type: "task.failed",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: run.id,
            occurredAt: command.failedAt,
            errorSummary: command.errorSummary,
          },
        });
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.failedAt,
          commandId: command.commandId,
        })),
        ...(preservesCancelledMission
          ? {
              type: "mission.updated" as const,
              payload: {
                missionId: mission.id,
                status: "cancelled" as const,
                updatedAt: command.failedAt,
              },
            }
          : isLegacySingleAgentRun
            ? {
                type: "mission.failed" as const,
                payload: {
                  missionId: mission.id,
                  agentRunId: run.id,
                  errorSummary: command.errorSummary,
                  failedAt: command.failedAt,
                },
              }
            : {
                type: "mission.updated" as const,
                payload: {
                  missionId: mission.id,
                  status: isVerificationRepair ? repairMissionStatus : ("running" as const),
                  updatedAt: command.failedAt,
                },
              }),
      });
      return events;
    }

    case "mission.agent-run.cancel": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: command.missionId,
        agentRunId: command.agentRunId,
      });
      yield* requireAgentRunTransition({ command, run, status: "cancelled" });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.cancelledAt,
            commandId: command.commandId,
          })),
          type: "agent_run.cancelled",
          payload: {
            missionId: mission.id,
            taskId: run.taskId,
            agentRunId: run.id,
            occurredAt: command.cancelledAt,
          },
        },
      ];
      if (run.taskId !== null) {
        const task = yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: run.taskId,
        });
        yield* requireMissionTaskTransition({ command, task, status: "cancelled" });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.cancelledAt,
            commandId: command.commandId,
          })),
          type: "task.cancelled",
          payload: {
            missionId: mission.id,
            taskId: task.id,
            agentRunId: run.id,
            occurredAt: command.cancelledAt,
          },
        });
      }
      if (mission.status !== "cancelled" && run.missionAgentId === null) {
        yield* requireMissionTransition({ command, mission, status: "cancelled" });
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.cancelledAt,
            commandId: command.commandId,
          })),
          type: "mission.cancelled",
          payload: { missionId: mission.id, agentRunId: run.id, cancelledAt: command.cancelledAt },
        });
      }
      return events;
    }

    case "mission.agent-run.interrupt": {
      const mission = yield* requireMission({ readModel, command, missionId: command.missionId });
      const run = yield* requireAgentRun({
        readModel,
        command,
        missionId: command.missionId,
        agentRunId: command.agentRunId,
      });
      yield* requireAgentRunTransition({ command, run, status: "interrupted" });
      const isVerificationRepair = run.purpose === "verification_repair";
      const isLegacySingleAgentRun = run.missionAgentId === null && !isVerificationRepair;
      const preservesCancelledMission = mission.status === "cancelled";
      const otherActiveRuns = listActiveAgentRuns(readModel, mission.id).filter(
        (entry) => entry.id !== run.id,
      );
      const allTasksAwaitingVerification = (readModel.missionTasks ?? [])
        .filter((entry) => entry.missionId === mission.id)
        .every((entry) => entry.status === "completed" || entry.status === "verification");
      const repairMissionStatus =
        otherActiveRuns.length === 0 && allTasksAwaitingVerification ? "verification" : "running";
      yield* requireMissionTransition({
        command,
        mission,
        status: preservesCancelledMission
          ? "cancelled"
          : isVerificationRepair
            ? repairMissionStatus
            : isLegacySingleAgentRun
              ? "blocked"
              : "running",
      });
      const events: PlannedOrchestrationEvent[] = [
        {
          ...(yield* withEventBase({
            aggregateKind: "mission",
            aggregateId: mission.id,
            occurredAt: command.interruptedAt,
            commandId: command.commandId,
          })),
          type: "agent_run.interrupted",
          payload: {
            missionId: mission.id,
            taskId: run.taskId,
            agentRunId: run.id,
            occurredAt: command.interruptedAt,
            errorSummary: command.reason,
          },
        },
      ];
      if (run.taskId !== null) {
        const task = yield* requireMissionTask({
          readModel,
          command,
          missionId: mission.id,
          taskId: run.taskId,
        });
        if (task.status === "running" && !isVerificationRepair) {
          const recoveredTaskStatus = preservesCancelledMission ? "cancelled" : "blocked";
          yield* requireMissionTaskTransition({
            command,
            task,
            status: recoveredTaskStatus,
          });
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "mission",
              aggregateId: mission.id,
              occurredAt: command.interruptedAt,
              commandId: command.commandId,
            })),
            type: "task.updated",
            payload: {
              missionId: mission.id,
              taskId: task.id,
              status: recoveredTaskStatus,
              updatedAt: command.interruptedAt,
            },
          });
        }
      }
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "mission",
          aggregateId: mission.id,
          occurredAt: command.interruptedAt,
          commandId: command.commandId,
        })),
        ...(preservesCancelledMission
          ? {
              type: "mission.updated" as const,
              payload: {
                missionId: mission.id,
                status: "cancelled" as const,
                updatedAt: command.interruptedAt,
              },
            }
          : isLegacySingleAgentRun
            ? {
                type: "mission.recovery-blocked" as const,
                payload: {
                  missionId: mission.id,
                  agentRunId: run.id,
                  reason: command.reason,
                  recoveredAt: command.interruptedAt,
                },
              }
            : {
                type: "mission.updated" as const,
                payload: {
                  missionId: mission.id,
                  status: isVerificationRepair ? repairMissionStatus : ("running" as const),
                  updatedAt: command.interruptedAt,
                },
              }),
      });
      return events;
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
