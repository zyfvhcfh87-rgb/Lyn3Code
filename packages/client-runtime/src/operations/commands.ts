import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  type EnvironmentRpcFailure,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcUnavailableError,
  request,
} from "../rpc/client.ts";

type CommandType = ClientOrchestrationCommand["type"];
type CommandOf<T extends CommandType> = Extract<ClientOrchestrationCommand, { readonly type: T }>;
type CommandInput<T extends CommandType> = Omit<
  CommandOf<T>,
  "type" | "commandId" | "createdAt"
> & {
  readonly commandId?: CommandId;
} & ("createdAt" extends keyof CommandOf<T>
    ? {
        readonly createdAt?: CommandOf<T>["createdAt"];
      }
    : {});

export type CreateProjectInput = CommandInput<"project.create">;
export type UpdateProjectInput = CommandInput<"project.meta.update">;
export type DeleteProjectInput = CommandInput<"project.delete">;
export type CreateThreadInput = CommandInput<"thread.create">;
export type DeleteThreadInput = CommandInput<"thread.delete">;
export type ArchiveThreadInput = CommandInput<"thread.archive">;
export type UnarchiveThreadInput = CommandInput<"thread.unarchive">;
export type SettleThreadInput = CommandInput<"thread.settle">;
export type UnsettleThreadInput = CommandInput<"thread.unsettle">;
export type SnoozeThreadInput = CommandInput<"thread.snooze">;
export type UnsnoozeThreadInput = CommandInput<"thread.unsnooze">;
export type UpdateThreadMetadataInput = CommandInput<"thread.meta.update">;
export type SetThreadRuntimeModeInput = CommandInput<"thread.runtime-mode.set">;
export type SetThreadInteractionModeInput = CommandInput<"thread.interaction-mode.set">;
export type StartThreadTurnInput = CommandInput<"thread.turn.start">;
export type InterruptThreadTurnInput = CommandInput<"thread.turn.interrupt">;
export type RespondToThreadApprovalInput = CommandInput<"thread.approval.respond">;
export type RespondToThreadUserInputInput = CommandInput<"thread.user-input.respond">;
export type RevertThreadCheckpointInput = CommandInput<"thread.checkpoint.revert">;
export type StopThreadSessionInput = CommandInput<"thread.session.stop">;
export type CreateMissionInput = CommandInput<"mission.create">;
export type UpdateMissionInput = CommandInput<"mission.update">;
export type CreateMissionTaskInput = CommandInput<"mission.task.create">;
export type UpdateMissionTaskInput = CommandInput<"mission.task.update">;
export type StartMissionInput = CommandInput<"mission.start">;
export type RetryMissionInput = CommandInput<"mission.retry">;
export type CancelMissionInput = CommandInput<"mission.cancel">;
export type ConfigureMissionTeamInput = CommandInput<"mission.team.configure">;
export type UpsertMissionAgentInput = CommandInput<"mission.agent.upsert">;
export type RemoveMissionAgentInput = CommandInput<"mission.agent.remove">;
export type UpdateMissionAgentPermissionsInput = CommandInput<"mission.agent.permissions.update">;
export type AddMissionTaskDependencyInput = CommandInput<"mission.task.dependency.add">;
export type RemoveMissionTaskDependencyInput = CommandInput<"mission.task.dependency.remove">;
export type RetryMissionTaskInput = CommandInput<"mission.task.retry">;
export type CancelMissionTaskInput = CommandInput<"mission.task.cancel">;
export type StartMissionSchedulerInput = CommandInput<"mission.scheduler.start">;
export type PauseMissionSchedulerInput = CommandInput<"mission.scheduler.pause">;
export type ResumeMissionSchedulerInput = CommandInput<"mission.scheduler.resume">;
export type RequestMissionIntegrationInput = CommandInput<"mission.integration.request">;
export type ApproveMissionIntegrationInput = CommandInput<"mission.integration.approve">;
export type AbortMissionIntegrationInput = CommandInput<"mission.integration.abort">;
export type RemoveMissionWorktreeInput = CommandInput<"mission.worktree.remove">;
export type RequestVerificationInput = CommandInput<"verification.request">;
export type CancelVerificationInput = CommandInput<"verification.cancel">;
export type RequestVerificationRepairInput = CommandInput<"verification.repair.request">;
export type RequestVerificationOverrideInput = CommandInput<"verification.override.request">;
export type UpdateVerificationSettingsInput = CommandInput<"verification.settings.update">;

type DispatchTag = typeof ORCHESTRATION_WS_METHODS.dispatchCommand;
type CommandEffect = Effect.Effect<
  EnvironmentRpcSuccess<DispatchTag>,
  EnvironmentRpcFailure<DispatchTag> | EnvironmentRpcUnavailableError,
  Crypto.Crypto | EnvironmentSupervisor
>;

function commandId(input: { readonly commandId?: CommandId }) {
  return Effect.gen(function* () {
    if (input.commandId !== undefined) {
      return input.commandId;
    }
    const crypto = yield* Crypto.Crypto;
    return yield* crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));
  });
}

function timestampedCommandMetadata(input: {
  readonly commandId?: CommandId;
  readonly createdAt?: string;
}) {
  return Effect.all({
    commandId: commandId(input),
    createdAt:
      input.createdAt === undefined
        ? DateTime.now.pipe(Effect.map(DateTime.formatIso))
        : Effect.succeed(input.createdAt),
  });
}

function dispatch(command: ClientOrchestrationCommand) {
  return request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
}

export const requestVerification: (input: RequestVerificationInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.requestVerification",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "verification.request",
    commandId: yield* commandId(input),
  });
});

export const cancelVerification: (input: CancelVerificationInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.cancelVerification",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "verification.cancel",
    commandId: yield* commandId(input),
  });
});

export const requestVerificationRepair: (input: RequestVerificationRepairInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.requestVerificationRepair")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "verification.repair.request",
      commandId: yield* commandId(input),
    });
  });

export const requestVerificationOverride: (
  input: RequestVerificationOverrideInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.requestVerificationOverride")(
  function* (input) {
    return yield* dispatch({
      ...input,
      type: "verification.override.request",
      commandId: yield* commandId(input),
    });
  },
);

export const updateVerificationSettings: (input: UpdateVerificationSettingsInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.updateVerificationSettings")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "verification.settings.update",
      commandId: yield* commandId(input),
    });
  });

export const createProject: (input: CreateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createProject",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "project.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateProject: (input: UpdateProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.meta.update",
    commandId: yield* commandId(input),
  });
});

export const deleteProject: (input: DeleteProjectInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteProject",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "project.delete",
    commandId: yield* commandId(input),
  });
});

export const createThread: (input: CreateThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createThread",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const deleteThread: (input: DeleteThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.delete",
    commandId: yield* commandId(input),
  });
});

export const archiveThread: (input: ArchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.archiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.archive",
    commandId: yield* commandId(input),
  });
});

export const unarchiveThread: (input: UnarchiveThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unarchiveThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unarchive",
    commandId: yield* commandId(input),
  });
});

export const settleThread: (input: SettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.settleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.settle",
    commandId: yield* commandId(input),
  });
});

export const unsettleThread: (input: UnsettleThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsettleThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsettle",
    commandId: yield* commandId(input),
  });
});

export const snoozeThread: (input: SnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.snoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.snooze",
    commandId: yield* commandId(input),
  });
});

export const unsnoozeThread: (input: UnsnoozeThreadInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unsnoozeThread",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.unsnooze",
    commandId: yield* commandId(input),
  });
});

export const updateThreadMetadata: (input: UpdateThreadMetadataInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateThreadMetadata",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "thread.meta.update",
    commandId: yield* commandId(input),
  });
});

export const setThreadRuntimeMode: (input: SetThreadRuntimeModeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.setThreadRuntimeMode",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.runtime-mode.set",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const setThreadInteractionMode: (input: SetThreadInteractionModeInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.setThreadInteractionMode")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.interaction-mode.set",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const startThreadTurn: (input: StartThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.startThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.start",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const interruptThreadTurn: (input: InterruptThreadTurnInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.interruptThreadTurn",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.turn.interrupt",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const respondToThreadApproval: (input: RespondToThreadApprovalInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadApproval")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.approval.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const respondToThreadUserInput: (input: RespondToThreadUserInputInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.respondToThreadUserInput")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.user-input.respond",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const revertThreadCheckpoint: (input: RevertThreadCheckpointInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.revertThreadCheckpoint")(function* (input) {
    const metadata = yield* timestampedCommandMetadata(input);
    return yield* dispatch({
      ...input,
      type: "thread.checkpoint.revert",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

export const stopThreadSession: (input: StopThreadSessionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.stopThreadSession",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "thread.session.stop",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const createMission: (input: CreateMissionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createMission",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "mission.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateMission: (input: UpdateMissionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateMission",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.update",
    commandId: yield* commandId(input),
  });
});

export const createMissionTask: (input: CreateMissionTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createMissionTask",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "mission.task.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateMissionTask: (input: UpdateMissionTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateMissionTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.task.update",
    commandId: yield* commandId(input),
  });
});

export const startMission: (input: StartMissionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.startMission",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "mission.start",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const retryMission: (input: RetryMissionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.retryMission",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "mission.retry",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const cancelMission: (input: CancelMissionInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.cancelMission",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);
  return yield* dispatch({
    ...input,
    type: "mission.cancel",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const configureMissionTeam: (input: ConfigureMissionTeamInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.configureMissionTeam",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.team.configure",
    commandId: yield* commandId(input),
  });
});

export const upsertMissionAgent: (input: UpsertMissionAgentInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.upsertMissionAgent",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.agent.upsert",
    commandId: yield* commandId(input),
  });
});

export const removeMissionAgent: (input: RemoveMissionAgentInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.removeMissionAgent",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.agent.remove",
    commandId: yield* commandId(input),
  });
});

export const updateMissionAgentPermissions: (
  input: UpdateMissionAgentPermissionsInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.updateMissionAgentPermissions")(
  function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.agent.permissions.update",
      commandId: yield* commandId(input),
    });
  },
);

export const addMissionTaskDependency: (input: AddMissionTaskDependencyInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.addMissionTaskDependency")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.task.dependency.add",
      commandId: yield* commandId(input),
    });
  });

export const removeMissionTaskDependency: (
  input: RemoveMissionTaskDependencyInput,
) => CommandEffect = Effect.fn("EnvironmentCommands.removeMissionTaskDependency")(
  function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.task.dependency.remove",
      commandId: yield* commandId(input),
    });
  },
);

export const retryMissionTask: (input: RetryMissionTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.retryMissionTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.task.retry",
    commandId: yield* commandId(input),
  });
});

export const cancelMissionTask: (input: CancelMissionTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.cancelMissionTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "mission.task.cancel",
    commandId: yield* commandId(input),
  });
});

export const startMissionScheduler: (input: StartMissionSchedulerInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.startMissionScheduler")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.scheduler.start",
      commandId: yield* commandId(input),
    });
  });

export const pauseMissionScheduler: (input: PauseMissionSchedulerInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.pauseMissionScheduler")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.scheduler.pause",
      commandId: yield* commandId(input),
    });
  });

export const resumeMissionScheduler: (input: ResumeMissionSchedulerInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.resumeMissionScheduler")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.scheduler.resume",
      commandId: yield* commandId(input),
    });
  });

export const requestMissionIntegration: (input: RequestMissionIntegrationInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.requestMissionIntegration")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.integration.request",
      commandId: yield* commandId(input),
    });
  });

export const approveMissionIntegration: (input: ApproveMissionIntegrationInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.approveMissionIntegration")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.integration.approve",
      commandId: yield* commandId(input),
    });
  });

export const abortMissionIntegration: (input: AbortMissionIntegrationInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.abortMissionIntegration")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.integration.abort",
      commandId: yield* commandId(input),
    });
  });

export const removeMissionWorktree: (input: RemoveMissionWorktreeInput) => CommandEffect =
  Effect.fn("EnvironmentCommands.removeMissionWorktree")(function* (input) {
    return yield* dispatch({
      ...input,
      type: "mission.worktree.remove",
      commandId: yield* commandId(input),
    });
  });
