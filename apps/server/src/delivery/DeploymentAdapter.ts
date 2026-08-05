import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { DeploymentExecution, DeploymentStrategy } from "@t3tools/contracts";

export interface DeploymentAdapterCapabilities {
  readonly strategies: ReadonlyArray<DeploymentStrategy>;
  readonly inspect: boolean;
  readonly cancel: boolean;
  readonly rollback: boolean;
  readonly idempotentStart: boolean;
  readonly idempotentRollback: boolean;
}

export interface DeploymentStartInput {
  readonly deploymentId: string;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly sourceFingerprint: string;
  readonly sourceCommitSha: string;
  readonly strategy: DeploymentStrategy;
  readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly managedHome: string;
  readonly managedTemp: string;
  readonly onLog?: (entry: DeploymentLogEntry) => Effect.Effect<void>;
}

export interface DeploymentLogEntry {
  readonly sequence: number;
  readonly observedAt: string;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface DeploymentExecutionResult {
  readonly deploymentId: string;
  readonly executionId: string;
  readonly providerKind: string;
  readonly status: "succeeded" | "failed" | "cancelled" | "timed_out";
  readonly providerDeploymentId: string | null;
  readonly sourceFingerprint: string;
  readonly sourceCommitSha: DeploymentExecution["sourceCommit"];
  readonly exitCode: number | null;
  readonly logText: string;
  readonly logTruncated: boolean;
}

export interface DeploymentInspectInput {
  readonly deploymentId: string;
  readonly providerDeploymentId: string;
}

export interface DeploymentInspection {
  readonly status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  readonly providerDeploymentId: string;
}

export interface DeploymentCancelInput {
  readonly deploymentId: string;
  readonly executionId: string;
  readonly providerDeploymentId: string | null;
}

export interface DeploymentRollbackInput {
  readonly deploymentId: string;
  readonly providerDeploymentId: string;
  readonly rollbackIdempotencyKey: string;
}

export class DeploymentAdapterError extends Schema.TaggedErrorClass<DeploymentAdapterError>()(
  "DeploymentAdapterError",
  {
    reason: Schema.Literals([
      "invalid_adapter",
      "unsupported_strategy",
      "unsupported_capability",
      "invalid_configuration",
      "execution_failed",
    ]),
    providerKind: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Deployment adapter ${this.providerKind} failed (${this.reason}): ${this.detail}`;
  }
}

export interface DeploymentAdapter {
  readonly providerKind: string;
  readonly capabilities: DeploymentAdapterCapabilities;
  readonly start: (
    input: DeploymentStartInput,
  ) => Effect.Effect<DeploymentExecutionResult, DeploymentAdapterError>;
  readonly inspect?: (
    input: DeploymentInspectInput,
  ) => Effect.Effect<DeploymentInspection, DeploymentAdapterError>;
  readonly cancel?: (
    input: DeploymentCancelInput,
  ) => Effect.Effect<boolean, DeploymentAdapterError>;
  readonly rollback?: (
    input: DeploymentRollbackInput,
  ) => Effect.Effect<DeploymentExecutionResult, DeploymentAdapterError>;
}

const assertCapabilitiesMatchImplementation = (adapter: DeploymentAdapter): void => {
  if (adapter.providerKind.trim().length === 0) {
    throw new DeploymentAdapterError({
      reason: "invalid_adapter",
      providerKind: adapter.providerKind,
      detail: "Provider kind must not be empty.",
    });
  }
  if (adapter.capabilities.strategies.length === 0) {
    throw new DeploymentAdapterError({
      reason: "invalid_adapter",
      providerKind: adapter.providerKind,
      detail: "An adapter must truthfully advertise at least one strategy.",
    });
  }
  for (const capability of ["inspect", "cancel", "rollback"] as const) {
    const implemented = adapter[capability] !== undefined;
    if (adapter.capabilities[capability] !== implemented) {
      throw new DeploymentAdapterError({
        reason: "invalid_adapter",
        providerKind: adapter.providerKind,
        detail: `${capability} capability does not match its implementation.`,
      });
    }
  }
  if (adapter.capabilities.idempotentRollback && !adapter.capabilities.rollback) {
    throw new DeploymentAdapterError({
      reason: "invalid_adapter",
      providerKind: adapter.providerKind,
      detail: "Idempotent rollback cannot be advertised without rollback support.",
    });
  }
};

export interface DeploymentAdapterRegistry {
  readonly get: (providerKind: string) => DeploymentAdapter | undefined;
  readonly list: () => ReadonlyArray<DeploymentAdapter>;
  readonly requireStrategy: (
    providerKind: string,
    strategy: DeploymentStrategy,
  ) => DeploymentAdapter;
}

export const makeDeploymentAdapterRegistry = (
  adapters: ReadonlyArray<DeploymentAdapter> = [],
): DeploymentAdapterRegistry => {
  const registry = new Map<string, DeploymentAdapter>();
  for (const adapter of adapters) {
    assertCapabilitiesMatchImplementation(adapter);
    if (registry.has(adapter.providerKind)) {
      throw new DeploymentAdapterError({
        reason: "invalid_adapter",
        providerKind: adapter.providerKind,
        detail: "Provider kind is already registered.",
      });
    }
    registry.set(adapter.providerKind, adapter);
  }
  return Object.freeze({
    get: (providerKind: string) => registry.get(providerKind),
    list: () => Object.freeze([...registry.values()]),
    requireStrategy: (providerKind: string, strategy: DeploymentStrategy) => {
      const adapter = registry.get(providerKind);
      if (adapter === undefined) {
        throw new DeploymentAdapterError({
          reason: "unsupported_capability",
          providerKind,
          detail: "No deployment adapter is registered for this provider.",
        });
      }
      if (!adapter.capabilities.strategies.includes(strategy)) {
        throw new DeploymentAdapterError({
          reason: "unsupported_strategy",
          providerKind,
          detail: `Strategy ${strategy} is not supported.`,
        });
      }
      return adapter;
    },
  });
};
