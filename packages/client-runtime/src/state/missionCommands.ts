import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  cancelMission,
  createMission,
  createMissionTask,
  retryMission,
  startMission,
  updateMission,
  updateMissionTask,
  type CancelMissionInput,
  type CreateMissionInput,
  type CreateMissionTaskInput,
  type RetryMissionInput,
  type StartMissionInput,
  type UpdateMissionInput,
  type UpdateMissionTaskInput,
} from "../operations/commands.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";

export type {
  CancelMissionInput,
  CreateMissionInput,
  CreateMissionTaskInput,
  RetryMissionInput,
  StartMissionInput,
  UpdateMissionInput,
  UpdateMissionTaskInput,
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

  return {
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:create",
      execute: (input: CreateMissionInput) => createMission(input),
      scheduler,
      concurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:update",
      execute: (input: UpdateMissionInput) => updateMission(input),
      scheduler,
      concurrency,
    }),
    createTask: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:create-task",
      execute: (input: CreateMissionTaskInput) => createMissionTask(input),
      scheduler,
      concurrency,
    }),
    updateTask: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:update-task",
      execute: (input: UpdateMissionTaskInput) => updateMissionTask(input),
      scheduler,
      concurrency,
    }),
    start: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:start",
      execute: (input: StartMissionInput) => startMission(input),
      scheduler,
      concurrency,
    }),
    retry: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:retry",
      execute: (input: RetryMissionInput) => retryMission(input),
      scheduler,
      concurrency,
    }),
    cancel: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:mission:cancel",
      execute: (input: CancelMissionInput) => cancelMission(input),
      scheduler,
      concurrency,
    }),
  };
}
