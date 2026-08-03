import { WS_METHODS } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  cancelVerification,
  requestVerification,
  requestVerificationOverride,
  requestVerificationRepair,
  updateVerificationSettings,
} from "../operations/commands.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createVerificationStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    projectConfigurationAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:project-configuration",
      tag: WS_METHODS.verificationGetProjectConfiguration,
      staleTimeMs: 5_000,
    }),
    runHistoryAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:run-history",
      tag: WS_METHODS.verificationListRuns,
      staleTimeMs: 3_000,
    }),
    taskSummariesAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:task-summaries",
      tag: WS_METHODS.verificationGetTaskSummaries,
      staleTimeMs: 2_000,
      refreshIntervalMs: 5_000,
    }),
    runEvidenceAtom: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "verification:run-evidence",
      tag: WS_METHODS.verificationSubscribeRun,
    }),
    runComparisonAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:run-comparison",
      tag: WS_METHODS.verificationCompareRuns,
      staleTimeMs: 30_000,
    }),
    logPageAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:log-page",
      tag: WS_METHODS.verificationReadLog,
      staleTimeMs: 1_000,
    }),
    artifactUrlAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "verification:artifact-url",
      tag: WS_METHODS.verificationCreateArtifactUrl,
      staleTimeMs: 2 * 60_000,
      idleTtlMs: 10 * 60_000,
    }),
  };
}

export function createVerificationCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const command = <Input>(
    label: string,
    execute: (input: Input) => ReturnType<typeof requestVerification>,
  ) => createEnvironmentCommand(runtime, { label, execute, scheduler });

  return {
    request: command("verification:request", requestVerification),
    cancel: command("verification:cancel", cancelVerification),
    requestRepair: command("verification:repair", requestVerificationRepair),
    requestOverride: command("verification:override", requestVerificationOverride),
    updateSettings: command("verification:settings", updateVerificationSettings),
  };
}
