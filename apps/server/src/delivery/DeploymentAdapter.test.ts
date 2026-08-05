import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeDeploymentAdapterRegistry, type DeploymentAdapter } from "./DeploymentAdapter.ts";

const adapter = (overrides: Partial<DeploymentAdapter> = {}): DeploymentAdapter => ({
  providerKind: "test_provider",
  capabilities: {
    strategies: ["standard"],
    inspect: false,
    cancel: false,
    rollback: false,
    idempotentStart: false,
    idempotentRollback: false,
  },
  start: () => Effect.die("not executed"),
  ...overrides,
});

describe("DeploymentAdapter registry", () => {
  it("starts empty and never invents deployment providers", () => {
    expect(makeDeploymentAdapterRegistry().list()).toEqual([]);
  });

  it("rejects capability claims that have no implementation", () => {
    expect(() =>
      makeDeploymentAdapterRegistry([
        adapter({ capabilities: { ...adapter().capabilities, rollback: true } }),
      ]),
    ).toThrow(/rollback capability/);
  });

  it("enforces the registered strategy allowlist", () => {
    const registry = makeDeploymentAdapterRegistry([adapter()]);
    expect(registry.requireStrategy("test_provider", "standard").providerKind).toBe(
      "test_provider",
    );
    expect(() => registry.requireStrategy("test_provider", "canary")).toThrow(/not supported/);
  });
});
