import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  abortMissionIntegration,
  addMissionTaskDependency,
  approveMissionIntegration,
  cancelMission,
  cancelMissionTask,
  configureMissionTeam,
  createMission,
  createMissionTask,
  pauseMissionScheduler,
  removeMissionAgent,
  removeMissionTaskDependency,
  removeMissionWorktree,
  requestMissionIntegration,
  resumeMissionScheduler,
  retryMission,
  retryMissionTask,
  startMission,
  startMissionScheduler,
  updateMission,
  updateMissionAgentPermissions,
  updateMissionTask,
  upsertMissionAgent,
  type AbortMissionIntegrationInput,
  type AddMissionTaskDependencyInput,
  type ApproveMissionIntegrationInput,
  type CancelMissionInput,
  type CancelMissionTaskInput,
  type ConfigureMissionTeamInput,
  type CreateMissionInput,
  type CreateMissionTaskInput,
  type PauseMissionSchedulerInput,
  type RemoveMissionAgentInput,
  type RemoveMissionTaskDependencyInput,
  type RemoveMissionWorktreeInput,
  type RequestMissionIntegrationInput,
  type ResumeMissionSchedulerInput,
  type RetryMissionInput,
  type RetryMissionTaskInput,
  type StartMissionInput,
  type StartMissionSchedulerInput,
  type UpdateMissionAgentPermissionsInput,
  type UpdateMissionInput,
  type UpdateMissionTaskInput,
  type UpsertMissionAgentInput,
} from "../operations/commands.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";

export type {
  AbortMissionIntegrationInput,
  AddMissionTaskDependencyInput,
  ApproveMissionIntegrationInput,
  CancelMissionInput,
  CancelMissionTaskInput,
  ConfigureMissionTeamInput,
  CreateMissionInput,
  CreateMissionTaskInput,
  PauseMissionSchedulerInput,
  RemoveMissionAgentInput,
  RemoveMissionTaskDependencyInput,
  RemoveMissionWorktreeInput,
  RequestMissionIntegrationInput,
  ResumeMissionSchedulerInput,
  RetryMissionInput,
  RetryMissionTaskInput,
  StartMissionInput,
  StartMissionSchedulerInput,
  UpdateMissionAgentPermissionsInput,
  UpdateMissionInput,
  UpdateMissionTaskInput,
  UpsertMissionAgentInput,
} from "../operations/commands.ts";

export function createMissionCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { missionId: string } }) =>
      JSON.stringify([environmentId, input.missionId]),
  };
  const command = <Input extends { readonly missionId: string }>(
    label: string,
    execute: (input: Input) => ReturnType<typeof createMission>,
  ) =>
    createEnvironmentCommand(runtime, {
      label,
      execute,
      scheduler,
      concurrency,
    });

  return {
    create: command<CreateMissionInput>("environment-data:commands:mission:create", createMission),
    update: command<UpdateMissionInput>("environment-data:commands:mission:update", updateMission),
    createTask: command<CreateMissionTaskInput>(
      "environment-data:commands:mission:create-task",
      createMissionTask,
    ),
    updateTask: command<UpdateMissionTaskInput>(
      "environment-data:commands:mission:update-task",
      updateMissionTask,
    ),
    start: command<StartMissionInput>("environment-data:commands:mission:start", startMission),
    retry: command<RetryMissionInput>("environment-data:commands:mission:retry", retryMission),
    cancel: command<CancelMissionInput>("environment-data:commands:mission:cancel", cancelMission),
    configureTeam: command<ConfigureMissionTeamInput>(
      "environment-data:commands:mission:configure-team",
      configureMissionTeam,
    ),
    upsertAgent: command<UpsertMissionAgentInput>(
      "environment-data:commands:mission:upsert-agent",
      upsertMissionAgent,
    ),
    removeAgent: command<RemoveMissionAgentInput>(
      "environment-data:commands:mission:remove-agent",
      removeMissionAgent,
    ),
    updateAgentPermissions: command<UpdateMissionAgentPermissionsInput>(
      "environment-data:commands:mission:update-agent-permissions",
      updateMissionAgentPermissions,
    ),
    addTaskDependency: command<AddMissionTaskDependencyInput>(
      "environment-data:commands:mission:add-task-dependency",
      addMissionTaskDependency,
    ),
    removeTaskDependency: command<RemoveMissionTaskDependencyInput>(
      "environment-data:commands:mission:remove-task-dependency",
      removeMissionTaskDependency,
    ),
    retryTask: command<RetryMissionTaskInput>(
      "environment-data:commands:mission:retry-task",
      retryMissionTask,
    ),
    cancelTask: command<CancelMissionTaskInput>(
      "environment-data:commands:mission:cancel-task",
      cancelMissionTask,
    ),
    startScheduler: command<StartMissionSchedulerInput>(
      "environment-data:commands:mission:start-scheduler",
      startMissionScheduler,
    ),
    pauseScheduler: command<PauseMissionSchedulerInput>(
      "environment-data:commands:mission:pause-scheduler",
      pauseMissionScheduler,
    ),
    resumeScheduler: command<ResumeMissionSchedulerInput>(
      "environment-data:commands:mission:resume-scheduler",
      resumeMissionScheduler,
    ),
    requestIntegration: command<RequestMissionIntegrationInput>(
      "environment-data:commands:mission:request-integration",
      requestMissionIntegration,
    ),
    approveIntegration: command<ApproveMissionIntegrationInput>(
      "environment-data:commands:mission:approve-integration",
      approveMissionIntegration,
    ),
    abortIntegration: command<AbortMissionIntegrationInput>(
      "environment-data:commands:mission:abort-integration",
      abortMissionIntegration,
    ),
    removeWorktree: command<RemoveMissionWorktreeInput>(
      "environment-data:commands:mission:remove-worktree",
      removeMissionWorktree,
    ),
  };
}
