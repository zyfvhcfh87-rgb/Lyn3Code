import type {
  AgentRunId,
  AgentHandoffId,
  ManagedWorktreeId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  OrchestrationEvent,
  OrchestrationReadModel,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadSettledPayload,
  ThreadSnoozedPayload,
  ThreadUnarchivedPayload,
  ThreadUnsettledPayload,
  ThreadUnsnoozedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
  AgentRunLifecyclePayload,
  AgentRunStartedPayload,
  AgentHandoffCreatedPayload,
  AgentHandoffReconciledPayload,
  ManagedWorktreeRecordedPayload,
  ManagedWorktreeRemovalRequestedPayload,
  ManagedWorktreeStatusUpdatedPayload,
  MissionCancelledPayload,
  MissionCancellationRequestedPayload,
  MissionCompletedPayload,
  MissionCreatedPayload,
  MissionFailedPayload,
  MissionRecoveryBlockedPayload,
  MissionStartedPayload,
  MissionAgentPermissionsUpdatedPayload,
  MissionAgentRemovedPayload,
  MissionAgentUpsertedPayload,
  MissionIntegrationLifecyclePayload,
  MissionSchedulerConcurrencyLimitedPayload,
  MissionSchedulerLifecyclePayload,
  MissionTaskBlockedPayload,
  MissionTaskCreatedPayload,
  MissionTaskLifecyclePayload,
  MissionTaskCancellationRequestedPayload,
  MissionTaskDependencyAddedPayload,
  MissionTaskDependencyRemovedPayload,
  MissionTaskReadyPayload,
  MissionTaskRetryRequestedPayload,
  MissionTaskUpdatedPayload,
  MissionTeamConfiguredPayload,
  MissionUpdatedPayload,
  VerificationRunLifecyclePayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

/**
 * Turn state to settle a still-running latest turn with when its session
 * leaves the "running" status, or null while the session is (re)starting or
 * running and the turn must stay unsettled.
 */
function settledTurnStateForSessionStatus(
  status: OrchestrationSession["status"],
): "completed" | "interrupted" | "error" | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function updateMission(
  missions: NonNullable<OrchestrationReadModel["missions"]>,
  missionId: MissionId,
  patch: Partial<NonNullable<OrchestrationReadModel["missions"]>[number]>,
) {
  return missions.map((mission) => (mission.id === missionId ? { ...mission, ...patch } : mission));
}

function updateMissionTask(
  tasks: NonNullable<OrchestrationReadModel["missionTasks"]>,
  taskId: MissionTaskId,
  patch: Partial<NonNullable<OrchestrationReadModel["missionTasks"]>[number]>,
) {
  return tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
}

function updateAgentRun(
  runs: NonNullable<OrchestrationReadModel["agentRuns"]>,
  agentRunId: AgentRunId,
  patch: Partial<NonNullable<OrchestrationReadModel["agentRuns"]>[number]>,
) {
  return runs.map((run) => (run.id === agentRunId ? { ...run, ...patch } : run));
}

function updateMissionAgent(
  agents: NonNullable<OrchestrationReadModel["missionAgents"]>,
  missionAgentId: MissionAgentId,
  patch: Partial<NonNullable<OrchestrationReadModel["missionAgents"]>[number]>,
) {
  return agents.map((agent) => (agent.id === missionAgentId ? { ...agent, ...patch } : agent));
}

function updateManagedWorktree(
  worktrees: NonNullable<OrchestrationReadModel["managedWorktrees"]>,
  worktreeId: ManagedWorktreeId,
  patch: Partial<NonNullable<OrchestrationReadModel["managedWorktrees"]>[number]>,
) {
  return worktrees.map((worktree) =>
    worktree.id === worktreeId ? { ...worktree, ...patch } : worktree,
  );
}

function updateAgentHandoff(
  handoffs: NonNullable<OrchestrationReadModel["agentHandoffs"]>,
  handoffId: AgentHandoffId,
  patch: Partial<NonNullable<OrchestrationReadModel["agentHandoffs"]>[number]>,
) {
  return handoffs.map((handoff) => (handoff.id === handoffId ? { ...handoff, ...patch } : handoff));
}

function decodeForEvent<A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(toProjectorDecodeError(`${eventType}:${field}`)),
  );
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    missions: [],
    missionTasks: [],
    agentRuns: [],
    agentRoles: [],
    missionAgents: [],
    taskDependencies: [],
    managedWorktrees: [],
    agentHandoffs: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
    missions: model.missions ?? [],
    missionTasks: model.missionTasks ?? [],
    agentRuns: model.agentRuns ?? [],
    agentRoles: model.agentRoles ?? [],
    missionAgents: model.missionAgents ?? [],
    taskDependencies: model.taskDependencies ?? [],
    managedWorktrees: model.managedWorktrees ?? [],
    agentHandoffs: model.agentHandoffs ?? [],
  } satisfies OrchestrationReadModel;

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            deletedAt: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
            titleRegeneration: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.settled":
      return decodeForEvent(ThreadSettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            settledOverride: "settled",
            settledAt: payload.settledAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unsettled":
      return decodeForEvent(ThreadUnsettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            settledOverride: payload.reason === "user" ? "active" : null,
            settledAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.snoozed":
      return decodeForEvent(ThreadSnoozedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            snoozedUntil: payload.snoozedUntil,
            snoozedAt: payload.snoozedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unsnoozed":
      return decodeForEvent(ThreadUnsnoozedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            snoozedUntil: null,
            snoozedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.titleRegeneration !== undefined
              ? { titleRegeneration: payload.titleRegeneration }
              : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );

        // Leaving the "running" session status is the turn-end signal: settle
        // a still-running latest turn so its duration reflects the whole turn.
        const settledTurnState = settledTurnStateForSessionStatus(session.status);
        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? {
                    turnId: session.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : session.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? (thread.latestTurn.startedAt ?? session.updatedAt)
                        : session.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  }
                : thread.latestTurn !== null &&
                    thread.latestTurn.state === "running" &&
                    settledTurnState !== null
                  ? {
                      ...thread.latestTurn,
                      state: settledTurnState,
                      // A running turn's completedAt can only hold a mid-turn
                      // placeholder checkpoint timestamp — the session leaving
                      // "running" is the authoritative turn end.
                      completedAt: session.updatedAt,
                    }
                  : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);

        // Mid-turn diff updates produce placeholder checkpoints; record the
        // checkpoint, but don't settle a turn its session is still running.
        const turnStillRunning =
          thread.session?.status === "running" && thread.session.activeTurnId === payload.turnId;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn: turnStillRunning
              ? thread.latestTurn
              : {
                  turnId: payload.turnId,
                  state: checkpointStatusToLatestTurnState(payload.status),
                  requestedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? thread.latestTurn.requestedAt
                      : payload.completedAt,
                  startedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? (thread.latestTurn.startedAt ?? payload.completedAt)
                      : payload.completedAt,
                  completedAt: payload.completedAt,
                  assistantMessageId: payload.assistantMessageId,
                },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "mission.created":
      return decodeForEvent(MissionCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: nextBase.missions.some((mission) => mission.id === payload.mission.id)
            ? updateMission(nextBase.missions, payload.mission.id, payload.mission)
            : [...nextBase.missions, payload.mission],
        })),
      );

    case "mission.updated":
      return decodeForEvent(MissionUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.description !== undefined ? { description: payload.description } : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "mission.started":
      return decodeForEvent(MissionStartedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const mission = nextBase.missions.find((entry) => entry.id === payload.missionId);
          return {
            ...nextBase,
            missions: updateMission(nextBase.missions, payload.missionId, {
              status: "running",
              startedAt: mission?.startedAt ?? payload.startedAt,
              completedAt: null,
              cancelledAt: null,
              updatedAt: payload.startedAt,
            }),
          };
        }),
      );

    case "mission.cancellation-requested":
      return decodeForEvent(
        MissionCancellationRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            updatedAt: payload.requestedAt,
          }),
        })),
      );

    case "mission.cancelled":
      return decodeForEvent(MissionCancelledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            status: "cancelled",
            cancelledAt: payload.cancelledAt,
            updatedAt: payload.cancelledAt,
          }),
        })),
      );

    case "mission.completed":
      return decodeForEvent(MissionCompletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            status: "completed",
            completedAt: payload.completedAt,
            updatedAt: payload.completedAt,
          }),
        })),
      );

    case "mission.failed":
      return decodeForEvent(MissionFailedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            status: "failed",
            updatedAt: payload.failedAt,
          }),
        })),
      );

    case "mission.recovery-blocked":
      return decodeForEvent(
        MissionRecoveryBlockedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            status: "blocked",
            updatedAt: payload.recoveredAt,
          }),
        })),
      );

    case "task.created":
      return decodeForEvent(MissionTaskCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: nextBase.missionTasks.some((task) => task.id === payload.task.id)
            ? updateMissionTask(nextBase.missionTasks, payload.task.id, payload.task)
            : [...nextBase.missionTasks, payload.task],
        })),
      );

    case "task.updated":
      return decodeForEvent(MissionTaskUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: updateMissionTask(nextBase.missionTasks, payload.taskId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.description !== undefined ? { description: payload.description } : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.position !== undefined ? { position: payload.position } : {}),
            ...(payload.assignedMissionAgentId !== undefined
              ? { assignedMissionAgentId: payload.assignedMissionAgentId }
              : {}),
            ...(payload.maximumAttempts !== undefined
              ? { maximumAttempts: payload.maximumAttempts }
              : {}),
            ...(payload.requiresDependencyHandoffs !== undefined
              ? { requiresDependencyHandoffs: payload.requiresDependencyHandoffs }
              : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.started":
    case "task.implementation-completed":
    case "task.completed":
    case "task.cancelled":
    case "task.failed":
      return decodeForEvent(MissionTaskLifecyclePayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: updateMissionTask(nextBase.missionTasks, payload.taskId, {
            status:
              event.type === "task.started"
                ? "running"
                : event.type === "task.implementation-completed"
                  ? "verification"
                  : event.type === "task.completed"
                    ? "completed"
                    : event.type === "task.cancelled"
                      ? "cancelled"
                      : "failed",
            ...(event.type === "task.started" ? { startedAt: payload.occurredAt } : {}),
            ...(event.type === "task.completed" ? { completedAt: payload.occurredAt } : {}),
            updatedAt: payload.occurredAt,
          }),
        })),
      );

    case "verification.invalidated":
      return decodeForEvent(
        VerificationRunLifecyclePayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const taskId = payload.run.taskId;
          const task =
            taskId === null
              ? undefined
              : nextBase.missionTasks.find((candidate) => candidate.id === taskId);
          if (task === undefined || task.integrationStatus === "integrated") return nextBase;
          const mission = nextBase.missions.find((candidate) => candidate.id === task.missionId);
          return {
            ...nextBase,
            missionTasks: updateMissionTask(nextBase.missionTasks, task.id, {
              status: "verification",
              integrationStatus: "not_requested",
              updatedAt: payload.occurredAt,
            }),
            missions:
              task.missionId === payload.run.missionId && mission?.status === "completed"
                ? updateMission(nextBase.missions, task.missionId, {
                    status: "verification",
                    updatedAt: payload.occurredAt,
                  })
                : nextBase.missions,
          };
        }),
      );

    case "mission.team-configured":
      return decodeForEvent(
        MissionTeamConfiguredPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            teamSettings: payload.settings,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "mission.agent-upserted":
      return decodeForEvent(MissionAgentUpsertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionAgents: nextBase.missionAgents.some((agent) => agent.id === payload.agent.id)
            ? updateMissionAgent(nextBase.missionAgents, payload.agent.id, payload.agent)
            : [...nextBase.missionAgents, payload.agent],
        })),
      );

    case "mission.agent-removed":
      return decodeForEvent(MissionAgentRemovedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionAgents: nextBase.missionAgents.filter(
            (agent) => agent.id !== payload.missionAgentId,
          ),
        })),
      );

    case "mission.agent-permissions-updated":
      return decodeForEvent(
        MissionAgentPermissionsUpdatedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionAgents: updateMissionAgent(nextBase.missionAgents, payload.missionAgentId, {
            permissions: payload.permissions,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "task.dependency-added":
      return decodeForEvent(
        MissionTaskDependencyAddedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          taskDependencies: nextBase.taskDependencies.some(
            (dependency) => dependency.id === payload.dependency.id,
          )
            ? nextBase.taskDependencies.map((dependency) =>
                dependency.id === payload.dependency.id ? payload.dependency : dependency,
              )
            : [...nextBase.taskDependencies, payload.dependency],
        })),
      );

    case "task.dependency-removed":
      return decodeForEvent(
        MissionTaskDependencyRemovedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          taskDependencies: nextBase.taskDependencies.filter(
            (dependency) => dependency.id !== payload.dependencyId,
          ),
        })),
      );

    case "task.ready":
      return decodeForEvent(MissionTaskReadyPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: updateMissionTask(nextBase.missionTasks, payload.taskId, {
            status: "ready",
            readyAt: payload.readyAt,
            blockedReason: null,
            completedAt: null,
            updatedAt: payload.readyAt,
          }),
        })),
      );

    case "task.blocked":
      return decodeForEvent(MissionTaskBlockedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: updateMissionTask(nextBase.missionTasks, payload.taskId, {
            status: "blocked",
            blockedReason: payload.reason,
            updatedAt: payload.blockedAt,
          }),
        })),
      );

    case "task.retry-requested":
      return decodeForEvent(
        MissionTaskRetryRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(Effect.as(nextBase));

    case "task.cancellation-requested":
      return decodeForEvent(
        MissionTaskCancellationRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(Effect.as(nextBase));

    case "managed_worktree.recorded":
      return decodeForEvent(
        ManagedWorktreeRecordedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          managedWorktrees: nextBase.managedWorktrees.some(
            (worktree) => worktree.id === payload.worktree.id,
          )
            ? updateManagedWorktree(
                nextBase.managedWorktrees,
                payload.worktree.id,
                payload.worktree,
              )
            : [...nextBase.managedWorktrees, payload.worktree],
          ...(payload.worktree.taskId !== null
            ? {
                missionTasks: updateMissionTask(nextBase.missionTasks, payload.worktree.taskId, {
                  worktreeId: payload.worktree.id,
                }),
              }
            : {}),
        })),
      );

    case "managed_worktree.status-updated":
      return decodeForEvent(
        ManagedWorktreeStatusUpdatedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          managedWorktrees: updateManagedWorktree(nextBase.managedWorktrees, payload.worktreeId, {
            status: payload.status,
            ...(payload.headCommit !== undefined ? { headCommit: payload.headCommit } : {}),
            ...(payload.changedFileCount !== undefined
              ? { changedFileCount: payload.changedFileCount }
              : {}),
            ...(payload.hasUncommittedChanges !== undefined
              ? { hasUncommittedChanges: payload.hasUncommittedChanges }
              : {}),
            ...(payload.conflictingFiles !== undefined
              ? { conflictingFiles: payload.conflictingFiles }
              : {}),
            ...(payload.errorSummary !== undefined ? { errorSummary: payload.errorSummary } : {}),
            ...(payload.removedAt !== undefined ? { removedAt: payload.removedAt } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "managed_worktree.removal-requested":
      return decodeForEvent(
        ManagedWorktreeRemovalRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(Effect.as(nextBase));

    case "agent_handoff.created":
      return decodeForEvent(AgentHandoffCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          agentHandoffs: nextBase.agentHandoffs.some((handoff) => handoff.id === payload.handoff.id)
            ? updateAgentHandoff(nextBase.agentHandoffs, payload.handoff.id, payload.handoff)
            : [...nextBase.agentHandoffs, payload.handoff],
        })),
      );

    case "agent_handoff.reconciled":
      return decodeForEvent(
        AgentHandoffReconciledPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          agentHandoffs: updateAgentHandoff(nextBase.agentHandoffs, payload.handoffId, {
            reconciliationStatus: payload.reconciliationStatus,
            changedFiles: payload.changedFiles,
            reconciledAt: payload.reconciledAt,
          }),
        })),
      );

    case "scheduler.started":
    case "scheduler.paused":
    case "scheduler.resumed":
      return decodeForEvent(
        MissionSchedulerLifecyclePayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missions: updateMission(nextBase.missions, payload.missionId, {
            schedulerStatus: payload.status,
            updatedAt: payload.occurredAt,
          }),
        })),
      );

    case "scheduler.concurrency-limited":
      return decodeForEvent(
        MissionSchedulerConcurrencyLimitedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(Effect.as(nextBase));

    case "integration.requested":
    case "integration.approved":
    case "integration.started":
    case "integration.completed":
    case "integration.conflicted":
    case "integration.aborted":
    case "integration.failed":
      return decodeForEvent(
        MissionIntegrationLifecyclePayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          missionTasks: updateMissionTask(nextBase.missionTasks, payload.taskId, {
            integrationStatus: payload.integrationStatus,
            updatedAt: payload.occurredAt,
          }),
        })),
      );

    case "agent_run.started":
      return decodeForEvent(AgentRunStartedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          agentRuns: nextBase.agentRuns.some((run) => run.id === payload.run.id)
            ? updateAgentRun(nextBase.agentRuns, payload.run.id, payload.run)
            : [...nextBase.agentRuns, payload.run],
          ...(payload.run.missionAgentId !== null
            ? {
                missionAgents: updateMissionAgent(
                  nextBase.missionAgents,
                  payload.run.missionAgentId,
                  { status: "running", updatedAt: payload.run.updatedAt },
                ),
              }
            : {}),
          ...(payload.run.taskId !== null
            ? {
                missionTasks: updateMissionTask(nextBase.missionTasks, payload.run.taskId, {
                  attemptCount: payload.run.attemptNumber,
                  assignedMissionAgentId: payload.run.missionAgentId,
                  worktreeId: payload.run.worktreeId,
                }),
              }
            : {}),
        })),
      );

    case "agent_run.running":
    case "agent_run.cancellation-requested":
    case "agent_run.completed":
    case "agent_run.cancelled":
    case "agent_run.failed":
    case "agent_run.interrupted":
      return decodeForEvent(AgentRunLifecyclePayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const run = nextBase.agentRuns.find((candidate) => candidate.id === payload.agentRunId);
          const status =
            event.type === "agent_run.running"
              ? "running"
              : event.type === "agent_run.cancellation-requested"
                ? "cancelling"
                : event.type === "agent_run.completed"
                  ? "completed"
                  : event.type === "agent_run.cancelled"
                    ? "cancelled"
                    : event.type === "agent_run.failed"
                      ? "failed"
                      : "interrupted";
          const isTerminal =
            status === "completed" ||
            status === "cancelled" ||
            status === "failed" ||
            status === "interrupted";
          const hasOtherActiveRun =
            run?.missionAgentId !== null &&
            run?.missionAgentId !== undefined &&
            nextBase.agentRuns.some(
              (candidate) =>
                candidate.id !== payload.agentRunId &&
                candidate.missionAgentId === run.missionAgentId &&
                (candidate.status === "starting" ||
                  candidate.status === "running" ||
                  candidate.status === "cancelling"),
            );
          return {
            ...nextBase,
            agentRuns: updateAgentRun(nextBase.agentRuns, payload.agentRunId, {
              status,
              updatedAt: payload.occurredAt,
              ...(payload.providerSessionId !== undefined
                ? { providerSessionId: payload.providerSessionId }
                : {}),
              ...(isTerminal ? { completedAt: payload.occurredAt } : {}),
              ...(payload.errorSummary !== undefined ? { errorSummary: payload.errorSummary } : {}),
            }),
            ...(run?.missionAgentId !== null && run?.missionAgentId !== undefined
              ? {
                  missionAgents: updateMissionAgent(nextBase.missionAgents, run.missionAgentId, {
                    status: isTerminal && !hasOtherActiveRun ? "idle" : "running",
                    updatedAt: payload.occurredAt,
                  }),
                }
              : {}),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
