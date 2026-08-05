"use client";

import type { DeliveryWorkspaceSnapshot, DeploymentStrategy } from "@t3tools/contracts";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import type { DeploymentPlanProposalContext, ReleasePlanProposalContext } from "./deliveryActions";
import { DeliveryNotice } from "./DeliveryPrimitives";

const selectClassName =
  "mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24";

export function ReleasePlanProposalForm({
  snapshot,
  onSubmit,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  onSubmit: (context: ReleasePlanProposalContext) => void | Promise<void>;
}) {
  const configurations = snapshot.releaseConfigurations.filter((item) => item.enabled);
  const policies = snapshot.policies.filter((item) => item.enabled);
  const [configurationId, setConfigurationId] = useState(configurations[0]?.id ?? "");
  const [policyId, setPolicyId] = useState(
    policies.find((item) => item.isDefault)?.id ?? policies[0]?.id ?? "",
  );
  const [bump, setBump] = useState<"major" | "minor" | "patch">("patch");
  const [requestedVersion, setRequestedVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = configurations.find((item) => item.id === configurationId);
  const explicit = selected?.versionStrategy === "semantic_explicit";

  if (configurations.length === 0 || policies.length === 0) {
    return (
      <DeliveryNotice title="Release planning needs configuration" tone="warning">
        Add an enabled release configuration and delivery policy before proposing a plan.
      </DeliveryNotice>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        releaseConfigurationId: configurationId,
        deliveryPolicyId: policyId,
        bump: explicit ? null : bump,
        requestedVersion: explicit ? requestedVersion.trim() || null : null,
        releaseNotesSupplement: notes.trim() || null,
      });
      setRequestedVersion("");
      setNotes("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The release proposal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">Propose release plan</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label>
          <span className="font-medium">Configuration</span>
          <select
            className={selectClassName}
            value={configurationId}
            onChange={(event) => setConfigurationId(event.currentTarget.value)}
          >
            {configurations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="font-medium">Policy</span>
          <select
            className={selectClassName}
            value={policyId}
            onChange={(event) => setPolicyId(event.currentTarget.value)}
          >
            {policies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {explicit ? (
          <label>
            <span className="font-medium">Exact version</span>
            <Input
              className="mt-1"
              size="sm"
              value={requestedVersion}
              onChange={(event) => setRequestedVersion(event.currentTarget.value)}
              placeholder="1.2.3"
              required
            />
          </label>
        ) : (
          <label>
            <span className="font-medium">Version bump</span>
            <select
              className={selectClassName}
              value={bump}
              onChange={(event) => setBump(event.currentTarget.value as typeof bump)}
            >
              <option value="patch">Patch</option>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
            </select>
          </label>
        )}
        <label className="sm:col-span-2">
          <span className="font-medium">Additional notes (optional)</span>
          <Textarea
            className="mt-1"
            size="sm"
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            placeholder="Context to append after server-derived mission, PR, and verification evidence"
          />
        </label>
        <p className="text-muted-foreground sm:col-span-2">
          The server will bind the plan to the clean current commit and a passing full-profile
          verification.
        </p>
        {error ? (
          <p className="text-destructive-foreground sm:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          className="w-fit"
          size="xs"
          disabled={busy || (explicit && !requestedVersion.trim())}
          type="submit"
        >
          {busy ? "Proposingâ€¦" : "Propose release plan"}
        </Button>
      </form>
    </details>
  );
}

export function DeploymentPlanProposalForm({
  snapshot,
  onSubmit,
}: {
  snapshot: DeliveryWorkspaceSnapshot;
  onSubmit: (context: DeploymentPlanProposalContext) => void | Promise<void>;
}) {
  const environments = snapshot.deploymentEnvironments.filter((item) => item.status === "active");
  const policies = snapshot.policies.filter((item) => item.enabled);
  const completedReleases = useMemo(
    () => snapshot.releasePlans.filter((item) => item.status === "completed"),
    [snapshot.releasePlans],
  );
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [policyId, setPolicyId] = useState(
    policies.find((item) => item.isDefault)?.id ?? policies[0]?.id ?? "",
  );
  const [releasePlanId, setReleasePlanId] = useState("");
  const selectedPolicy = policies.find((item) => item.id === policyId);
  const strategies = selectedPolicy?.deploymentPolicy.allowedStrategies ?? [];
  const [strategy, setStrategy] = useState<DeploymentStrategy>(strategies[0] ?? "provider_default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (environments.length === 0 || policies.length === 0) {
    return (
      <DeliveryNotice title="Deployment planning needs configuration" tone="warning">
        Add an active deployment environment and enabled delivery policy before proposing a plan.
      </DeliveryNotice>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        releasePlanId: releasePlanId || null,
        deploymentEnvironmentId: environmentId,
        deliveryPolicyId: policyId,
        strategy,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deployment proposal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">Propose deployment plan</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <label>
          <span className="font-medium">Environment</span>
          <select
            className={selectClassName}
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.currentTarget.value)}
          >
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="font-medium">Policy</span>
          <select
            className={selectClassName}
            value={policyId}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setPolicyId(next);
              const allowed = policies.find((item) => item.id === next)?.deploymentPolicy
                .allowedStrategies;
              if (allowed?.[0]) setStrategy(allowed[0]);
            }}
          >
            {policies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="font-medium">Source</span>
          <select
            className={selectClassName}
            value={releasePlanId}
            onChange={(event) => setReleasePlanId(event.currentTarget.value)}
          >
            <option value="">Current verified commit</option>
            {completedReleases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.releaseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="font-medium">Strategy</span>
          <select
            className={selectClassName}
            value={strategy}
            onChange={(event) => setStrategy(event.currentTarget.value as DeploymentStrategy)}
          >
            {strategies.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground sm:col-span-2">
          The environment, policy, source, and public configuration are snapshotted into a
          server-computed digest.
        </p>
        {error ? (
          <p className="text-destructive-foreground sm:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          className="w-fit"
          size="xs"
          disabled={busy || strategies.length === 0}
          type="submit"
        >
          {busy ? "Proposingâ€¦" : "Propose deployment plan"}
        </Button>
      </form>
    </details>
  );
}
