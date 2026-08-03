import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type VerificationArtifact,
  VerificationOverrideId,
  type VerificationCheckRunId,
  type VerificationRunId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  DownloadIcon,
  FileWarningIcon,
  OctagonXIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { verificationEnvironment } from "../../state/verification";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { VerificationLogViewer } from "./VerificationLogViewer";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import { resolveVerificationArtifactUrl } from "./verificationDisplay";

const ACTIVE_RUN_STATUSES = new Set(["queued", "preparing", "running", "cancelling"]);

function VerificationArtifactDownloadAction({
  environmentId,
  verificationRunId,
  artifact,
}: {
  readonly environmentId: EnvironmentId;
  readonly verificationRunId: VerificationRunId;
  readonly artifact: VerificationArtifact;
}) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const result = useAtomValue(
    verificationEnvironment.artifactUrlAtom({
      environmentId,
      input: { verificationRunId, artifactId: artifact.id },
    }),
  );
  const access = Option.getOrNull(AsyncResult.value(result));
  const url =
    access === null || httpBaseUrl === null
      ? null
      : resolveVerificationArtifactUrl(httpBaseUrl, access.relativeUrl);
  if (url === null) {
    return (
      <Button size="sm" variant="ghost" disabled>
        <DownloadIcon /> {result._tag === "Failure" ? "Download unavailable" : "Preparing download"}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      render={<a href={url} target="_blank" rel="noopener noreferrer" download={artifact.name} />}
    >
      <DownloadIcon /> Download
    </Button>
  );
}

function Evidence({
  environmentId,
  runId,
  canMutate,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: VerificationRunId;
  readonly canMutate: boolean;
}) {
  const [logCheckId, setLogCheckId] = useState<VerificationCheckRunId | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const cancel = useAtomCommand(verificationEnvironment.cancel, { reportFailure: false });
  const request = useAtomCommand(verificationEnvironment.request, { reportFailure: false });
  const requestRepair = useAtomCommand(verificationEnvironment.requestRepair, {
    reportFailure: false,
  });
  const requestOverride = useAtomCommand(verificationEnvironment.requestOverride, {
    reportFailure: false,
  });
  const result = useAtomValue(
    verificationEnvironment.runEvidenceAtom({
      environmentId,
      input: { verificationRunId: runId },
    }),
  );
  const evidence = Option.getOrNull(AsyncResult.value(result));
  if (evidence === null) {
    return (
      <DialogPanel>
        <p className="text-sm text-muted-foreground">Loading verification evidence...</p>
      </DialogPanel>
    );
  }

  const runAction = async (
    action: string,
    execute: () => Promise<{ readonly _tag: string }>,
    successTitle: string,
  ) => {
    setPendingAction(action);
    try {
      const commandResult = await execute();
      if (commandResult._tag === "Failure") {
        const failure = squashAtomCommandFailure(
          commandResult as unknown as Parameters<typeof squashAtomCommandFailure>[0],
        );
        toastManager.add({
          type: "error",
          title: "Verification action was rejected",
          description:
            failure instanceof Error ? failure.message : "The server rejected this action.",
        });
        return false;
      }
      toastManager.add({ type: "success", title: successTitle });
      return true;
    } finally {
      setPendingAction(null);
    }
  };
  const now = () => new Date().toISOString();
  const active = ACTIVE_RUN_STATUSES.has(evidence.run.status);
  const repairable =
    evidence.run.status === "failed" &&
    evidence.run.authorizationScope === "full_profile" &&
    evidence.run.missionId !== null &&
    evidence.run.taskId !== null;
  const overridable =
    ["failed", "cancelled", "interrupted", "invalidated"].includes(evidence.run.status) &&
    evidence.run.authorizationScope === "full_profile" &&
    evidence.run.taskId !== null;
  const diagnosticsByCheck = new Map(
    evidence.checks.map(
      (check) =>
        [check.id, evidence.diagnostics.filter((item) => item.checkRunId === check.id)] as const,
    ),
  );
  const firstFailedCheckByGate = new Map(
    evidence.checks
      .filter((check) => check.status === "failed")
      .map((check) => [check.gateId, check.id] as const),
  );

  return (
    <DialogPanel className="grid gap-5">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Result</dt>
        <dd>
          <VerificationStatusBadge status={evidence.run.status} />
        </dd>
        <dt className="text-muted-foreground">Profile</dt>
        <dd>{evidence.run.executionPlan.profileName}</dd>
        <dt className="text-muted-foreground">Trigger</dt>
        <dd>{evidence.run.trigger}</dd>
        <dt className="text-muted-foreground">Authorization</dt>
        <dd>
          {evidence.run.authorizationScope === "full_profile"
            ? "Full profile"
            : "Diagnostic subset only"}
        </dd>
        <dt className="text-muted-foreground">Branch</dt>
        <dd className="truncate">{evidence.run.branchName}</dd>
        <dt className="text-muted-foreground">Commit</dt>
        <dd className="font-mono">{evidence.run.commitHash ?? "dirty state"}</dd>
        <dt className="text-muted-foreground">Fingerprint</dt>
        <dd className="truncate font-mono">{evidence.run.sourceFingerprint}</dd>
        <dt className="text-muted-foreground">Changed files</dt>
        <dd>{evidence.run.changedFilesSnapshot.length}</dd>
      </dl>

      {evidence.run.authorizationScope === "diagnostic_subset" ? (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="font-medium">This run is diagnostic evidence only.</p>
          <p className="mt-1 text-muted-foreground">
            It reruns a previously failed gate and never authorizes task completion or integration,
            even when it passes. Rerun the full profile for an integration-capable result.
          </p>
        </section>
      ) : null}

      <section
        className="grid gap-2 rounded-lg border p-3"
        aria-labelledby="verification-actions-heading"
      >
        <h3 id="verification-actions-heading" className="text-sm font-semibold">
          Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={
                !canMutate || pendingAction !== null || evidence.run.status === "cancelling"
              }
              onClick={() =>
                void runAction(
                  "cancel",
                  () =>
                    cancel({
                      environmentId,
                      input: {
                        projectId: evidence.run.projectId,
                        missionId: evidence.run.missionId,
                        verificationRunId: evidence.run.id,
                        requestedBy: "user",
                        requestedAt: now(),
                      },
                    }),
                  "Verification cancellation requested",
                )
              }
            >
              <OctagonXIcon /> Cancel run
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!canMutate || pendingAction !== null}
              onClick={() =>
                void runAction(
                  "rerun",
                  () =>
                    request({
                      environmentId,
                      input: {
                        projectId: evidence.run.projectId,
                        missionId: evidence.run.missionId,
                        taskId: evidence.run.taskId,
                        worktreeId: evidence.run.worktreeId,
                        profileId: evidence.run.profileId,
                        requestedBy: "user",
                        trigger: "manual",
                        requestedAt: now(),
                      },
                    }),
                  "Full verification profile queued",
                )
              }
            >
              <RefreshCwIcon /> Rerun full profile
            </Button>
          )}
          {repairable ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canMutate || pendingAction !== null}
              onClick={() =>
                void runAction(
                  "repair",
                  () =>
                    requestRepair({
                      environmentId,
                      input: {
                        projectId: evidence.run.projectId,
                        missionId: evidence.run.missionId!,
                        taskId: evidence.run.taskId!,
                        verificationRunId: evidence.run.id,
                        requestedBy: "user",
                        requestedAt: now(),
                      },
                    }),
                  "Repair attempt requested",
                )
              }
            >
              <WrenchIcon /> Start bounded repair
            </Button>
          ) : null}
        </div>
        {overridable ? (
          <div className="grid gap-2 border-t pt-3">
            <label className="grid gap-1 text-xs font-medium">
              Explicit override reason
              <textarea
                className="min-h-20 rounded-md border border-input bg-background p-2 font-normal"
                placeholder="Explain why integration may proceed without a passing run"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.currentTarget.value)}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              disabled={!canMutate || pendingAction !== null || overrideReason.trim().length === 0}
              onClick={() =>
                void runAction(
                  "override",
                  () =>
                    requestOverride({
                      environmentId,
                      input: {
                        overrideId: VerificationOverrideId.make(randomUUID()),
                        projectId: evidence.run.projectId,
                        missionId: evidence.run.missionId,
                        taskId: evidence.run.taskId!,
                        verificationRunId: evidence.run.id,
                        sourceFingerprint: evidence.run.sourceFingerprint,
                        reason: overrideReason.trim(),
                        requestedBy: "user",
                        requestedAt: now(),
                      },
                    }),
                  "Verification override recorded",
                ).then((applied) => {
                  if (applied) setOverrideReason("");
                })
              }
            >
              <ShieldAlertIcon /> Apply audited override
            </Button>
            <p className="text-xs text-muted-foreground">
              An override authorizes integration for this exact source fingerprint. It does not turn
              this run green.
            </p>
          </div>
        ) : null}
      </section>

      {evidence.run.executionPlan.skippedChecks.length > 0 ? (
        <section className="grid gap-2" aria-labelledby="verification-skipped-heading">
          <h3 id="verification-skipped-heading" className="text-sm font-semibold">
            Skipped by immutable plan
          </h3>
          {evidence.run.executionPlan.skippedChecks.map((check) => (
            <div
              key={check.checkDefinitionId}
              className="rounded-md border border-dashed p-2 text-xs"
            >
              <span className="font-medium">{check.name}</span> - {check.reason}
              {check.required ? (
                <Badge variant="warning" className="ml-2">
                  required
                </Badge>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid gap-2" aria-labelledby="verification-checks-heading">
        <h3 id="verification-checks-heading" className="text-sm font-semibold">
          Checks and evidence
        </h3>
        {evidence.checks.map((check) => {
          const diagnostics = diagnosticsByCheck.get(check.id) ?? [];
          return (
            <article key={check.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="min-w-0 flex-1 truncate text-sm font-medium">
                  {check.nameSnapshot}
                </h4>
                <VerificationStatusBadge status={check.status} />
              </div>
              <code className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                {check.commandSnapshot} {check.argumentsSnapshot.join(" ")}
              </code>
              <p className="text-xs text-muted-foreground">{check.selectionReason}</p>
              <dl className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                <dt className="text-muted-foreground">Directory</dt>
                <dd className="truncate">{check.workingDirectorySnapshot}</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>
                  {check.durationMilliseconds === null ? "-" : `${check.durationMilliseconds} ms`}
                </dd>
                <dt className="text-muted-foreground">Exit code</dt>
                <dd>{check.exitCode ?? "-"}</dd>
                <dt className="text-muted-foreground">Timeout</dt>
                <dd>{check.timedOut ? "Timed out" : "No"}</dd>
                <dt className="text-muted-foreground">Classification</dt>
                <dd>{check.failureCategory ?? "-"}</dd>
              </dl>
              {diagnostics.length > 0 ? (
                <div className="grid gap-1 rounded-md bg-destructive/5 p-2 text-xs">
                  {diagnostics.map((diagnostic) => (
                    <p key={diagnostic.id} className="flex gap-2">
                      <FileWarningIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {diagnostic.filePath
                          ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}` : ""}: `
                          : ""}
                        {diagnostic.message}
                      </span>
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {firstFailedCheckByGate.get(check.gateId) === check.id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canMutate || active || pendingAction !== null}
                    onClick={() =>
                      void runAction(
                        `rerun-gate:${check.gateId}`,
                        () =>
                          request({
                            environmentId,
                            input: {
                              projectId: evidence.run.projectId,
                              missionId: evidence.run.missionId,
                              taskId: evidence.run.taskId,
                              worktreeId: evidence.run.worktreeId,
                              profileId: evidence.run.profileId,
                              requestedBy: "user",
                              trigger: "retry_failed_gate",
                              scope: {
                                kind: "failed_gate",
                                sourceVerificationRunId: evidence.run.id,
                                gateId: check.gateId,
                              },
                              requestedAt: now(),
                            },
                          }),
                        "Failed gate queued as a diagnostic rerun",
                      )
                    }
                  >
                    <RefreshCwIcon /> Rerun failed gate
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLogCheckId(logCheckId === check.id ? null : check.id)}
                >
                  <ScrollTextIcon /> {logCheckId === check.id ? "Hide log" : "Open log"}
                </Button>
              </div>
              {logCheckId === check.id ? (
                <VerificationLogViewer
                  environmentId={environmentId}
                  verificationRunId={runId}
                  checkRunId={check.id}
                />
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="grid gap-2" aria-labelledby="verification-artifacts-heading">
        <h3 id="verification-artifacts-heading" className="text-sm font-semibold">
          Artifacts
        </h3>
        {evidence.artifacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No artifacts were configured or collected.
          </p>
        ) : (
          evidence.artifacts.map(({ artifact, available, unavailableReason }) => (
            <div
              key={artifact.id}
              className="flex items-center gap-2 rounded-md border p-2 text-xs"
            >
              <Badge variant={available ? "success" : "warning"}>{artifact.type}</Badge>
              <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
              <span className="text-muted-foreground">
                {available ? (artifact.checksum?.slice(0, 12) ?? "available") : unavailableReason}
              </span>
              {available ? (
                <VerificationArtifactDownloadAction
                  environmentId={environmentId}
                  verificationRunId={runId}
                  artifact={artifact}
                />
              ) : null}
            </div>
          ))
        )}
      </section>

      {evidence.repairAttempts.length > 0 || evidence.overrides.length > 0 ? (
        <section className="grid gap-1 text-xs">
          <h3 className="text-sm font-semibold">Audit history</h3>
          {evidence.repairAttempts.map((attempt) => (
            <p key={attempt.id}>
              Repair attempt {attempt.attemptNumber}: {attempt.status}
            </p>
          ))}
          {evidence.overrides.map((override) => (
            <p key={override.id}>
              Override by {override.requestedBy}: {override.reason}
            </p>
          ))}
        </section>
      ) : null}
    </DialogPanel>
  );
}

export function VerificationRunDialog({
  environmentId,
  runId,
  canMutate,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: VerificationRunId | null;
  readonly canMutate: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={runId !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="w-[min(96vw,60rem)] max-w-none">
        <DialogHeader>
          <DialogTitle>Verification evidence</DialogTitle>
          <DialogDescription>
            What ran, against which source state, and what actually happened.
          </DialogDescription>
        </DialogHeader>
        {runId ? (
          <Evidence environmentId={environmentId} runId={runId} canMutate={canMutate} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
