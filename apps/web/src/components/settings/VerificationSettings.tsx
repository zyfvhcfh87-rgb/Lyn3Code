import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  VerificationProfileId,
  type EnvironmentId,
  type ProjectId,
  type VerificationProjectSettings,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ClipboardCheckIcon,
  CopyIcon,
  FileCodeIcon,
  GitCompareArrowsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import { verificationEnvironment } from "../../state/verification";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { toastManager } from "../ui/toast";
import { verificationComparisonRows } from "../verification/verificationDisplay";

function RecentRunComparison({
  environmentId,
  previousRunId,
  currentRunId,
}: {
  readonly environmentId: EnvironmentId;
  readonly previousRunId: import("@t3tools/contracts").VerificationRunId;
  readonly currentRunId: import("@t3tools/contracts").VerificationRunId;
}) {
  const result = useAtomValue(
    verificationEnvironment.runComparisonAtom({
      environmentId,
      input: { previousRunId, currentRunId },
    }),
  );
  const comparison = Option.getOrNull(AsyncResult.value(result));
  if (comparison === null) {
    return <p className="text-xs text-muted-foreground">Comparing the two most recent runs...</p>;
  }
  return (
    <Card>
      <CardPanel className="grid gap-2 p-4 text-xs">
        <div className="flex items-center gap-2">
          <GitCompareArrowsIcon className="size-4" />
          <h3 className="text-sm font-semibold">Change from previous run</h3>
        </div>
        {verificationComparisonRows(comparison).map((row) => (
          <p key={row.label}>
            <span className="font-medium">{row.label}:</span> {row.value}
          </p>
        ))}
      </CardPanel>
    </Card>
  );
}

function ProjectPanel({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const updateSettings = useAtomCommand(verificationEnvironment.updateSettings, {
    reportFailure: false,
  });
  const configurationResult = useAtomValue(
    verificationEnvironment.projectConfigurationAtom({ environmentId, input: { projectId } }),
  );
  const historyResult = useAtomValue(
    verificationEnvironment.runHistoryAtom({
      environmentId,
      input: { projectId, taskId: null, cursor: null, limit: 20 },
    }),
  );
  const configuration = Option.getOrNull(AsyncResult.value(configurationResult));
  const history = Option.getOrNull(AsyncResult.value(historyResult));
  const [saving, setSaving] = useState(false);
  const [optimisticSettings, setOptimisticSettings] = useState<VerificationProjectSettings | null>(
    null,
  );

  if (configurationResult._tag === "Failure") {
    return (
      <Alert variant="error">
        <TriangleAlertIcon />
        <AlertTitle>Verification configuration could not be validated</AlertTitle>
        <AlertDescription>
          The server rejected or could not read this project's configuration. No discovered command
          was executed.
        </AlertDescription>
      </Alert>
    );
  }
  if (configuration === null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Discovering verification configuration...</p>
    );
  }
  const current = optimisticSettings ?? configuration.settings;
  const profiles = configuration.discovery.profiles;
  const requiresAcceptance =
    configuration.discovery.trust === "requires_acceptance" &&
    current?.acceptedConfigurationDigest !== configuration.discovery.revision;
  const defaultProfileValue = current?.defaultProfileId ?? profiles[0]?.persistedProfileId ?? null;
  const preIntegrationValue =
    current?.preIntegrationProfileId ?? profiles[0]?.persistedProfileId ?? null;

  const save = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    const now = new Date().toISOString();
    const accepting = requiresAcceptance;
    const profileId = (name: string) => {
      const value = String(values.get(name) ?? "");
      return value.length > 0 ? VerificationProfileId.make(value) : null;
    };
    const settings: VerificationProjectSettings = {
      projectId,
      configurationPath:
        configuration.discovery.source === "repository" ? configuration.discovery.configPath : null,
      configurationSource: configuration.discovery.source === "repository" ? "repository" : "none",
      acceptedConfigurationDigest: accepting
        ? configuration.discovery.revision
        : (current?.acceptedConfigurationDigest ?? null),
      acceptedAt: accepting ? now : (current?.acceptedAt ?? null),
      acceptedBy: accepting ? "user" : (current?.acceptedBy ?? null),
      defaultProfileId: profileId("defaultProfileId"),
      preIntegrationProfileId: profileId("preIntegrationProfileId"),
      automaticTaskVerificationEnabled: values.get("automaticTaskVerificationEnabled") === "on",
      maximumRepairAttempts: Math.max(
        0,
        Math.min(10, Number(values.get("maximumRepairAttempts")) || 0),
      ),
      automaticRepairEnabled: values.get("automaticRepairEnabled") === "on",
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { settings, actor: "user", updatedAt: now },
      });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Verification settings were not saved",
          description:
            failure instanceof Error ? failure.message : "The server rejected this configuration.",
        });
      } else {
        setOptimisticSettings(settings);
        toastManager.add({
          type: "success",
          title: accepting ? "Configuration accepted" : "Verification settings saved",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      {requiresAcceptance ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>Repository commands require review</AlertTitle>
          <AlertDescription>
            Review the exact profiles and commands below. Inferred commands are suggestions only and
            are never trusted automatically.
          </AlertDescription>
        </Alert>
      ) : null}
      {configuration.discovery.trust === "not_configured" ? (
        <Alert>
          <FileCodeIcon />
          <AlertTitle>No repository verification configuration</AlertTitle>
          <AlertDescription>
            Add verification profiles to the repository project file. Package-script suggestions
            below remain untrusted until explicitly configured.
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <Card>
          <CardPanel className="grid gap-4 p-4">
            <div>
              <h2 className="text-sm font-semibold">Requirements and repair policy</h2>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {configuration.discovery.configPath}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() =>
                  void writeTextToClipboard(
                    configuration.discovery.configPath,
                    "verification configuration path",
                  ).then(() => {
                    toastManager.add({
                      type: "success",
                      title: "Verification configuration path copied",
                    });
                  })
                }
              >
                <CopyIcon /> Copy config path
              </Button>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Default profile
              <select
                name="defaultProfileId"
                defaultValue={defaultProfileValue ?? ""}
                className="h-9 rounded-md border border-input bg-background px-2"
              >
                <option value="">None</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.persistedProfileId}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Required before integration
              <select
                name="preIntegrationProfileId"
                defaultValue={preIntegrationValue ?? ""}
                className="h-9 rounded-md border border-input bg-background px-2"
              >
                <option value="">Not required</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.persistedProfileId}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="automaticTaskVerificationEnabled"
                defaultChecked={current?.automaticTaskVerificationEnabled ?? true}
              />{" "}
              Verify when implementation completes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="automaticRepairEnabled"
                defaultChecked={current?.automaticRepairEnabled ?? false}
              />{" "}
              Allow bounded automatic repair
            </label>
            <label className="grid max-w-48 gap-1 text-sm font-medium">
              Maximum repair attempts
              <input
                className="h-9 rounded-md border border-input bg-background px-2"
                type="number"
                name="maximumRepairAttempts"
                min={0}
                max={10}
                defaultValue={current?.maximumRepairAttempts ?? 2}
              />
            </label>
            <Button
              type="submit"
              className="justify-self-start"
              disabled={
                saving ||
                (profiles.length === 0 && configuration.discovery.trust !== "not_configured")
              }
            >
              <ClipboardCheckIcon />{" "}
              {requiresAcceptance ? "Accept commands and save" : "Save verification policy"}
            </Button>
          </CardPanel>
        </Card>
      </form>

      <section className="grid gap-3" aria-labelledby="verification-profiles-heading">
        <h2 id="verification-profiles-heading" className="text-sm font-semibold">
          Discovered profiles, gates, and checks
        </h2>
        {profiles.map((profile) => (
          <Card key={profile.id}>
            <CardPanel className="grid gap-3 p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{profile.name}</h3>
                {profile.triggerModes.map((trigger) => (
                  <Badge key={trigger} variant="outline">
                    {trigger}
                  </Badge>
                ))}
              </div>
              {profile.gates.map((gate) => (
                <div key={gate.id} className="grid gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{gate.name}</span>
                    <Badge variant={gate.required ? "warning" : "outline"}>
                      {gate.required ? "required" : "optional"}
                    </Badge>
                    <span className="text-muted-foreground">{gate.failurePolicy}</span>
                  </div>
                  {gate.checks.map((check) => (
                    <div key={check.id} className="grid gap-1 text-xs">
                      <code className="overflow-x-auto rounded bg-muted px-2 py-1">
                        {check.executable} {check.arguments.join(" ")}
                      </code>
                      <span className="text-muted-foreground">
                        {check.workingDirectory} - timeout {check.timeoutSeconds}s - parser{" "}
                        {check.diagnosticParser}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </CardPanel>
          </Card>
        ))}
        {configuration.discovery.suggestions.map((suggestion) => (
          <div key={suggestion.id} className="rounded-lg border border-dashed p-3 text-xs">
            <Badge variant="warning">Untrusted suggestion</Badge>{" "}
            <code>
              {suggestion.executable} {suggestion.arguments.join(" ")}
            </code>
            <p className="mt-1 text-muted-foreground">{suggestion.reason}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-2" aria-labelledby="verification-history-heading">
        <h2 id="verification-history-heading" className="text-sm font-semibold">
          Recent verification history
        </h2>
        {(history?.runs ?? []).map((run) => (
          <div
            key={run.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border p-3 text-xs"
          >
            <div>
              <p className="font-medium">
                {run.profileName} - {run.status}
              </p>
              <p className="mt-1 truncate font-mono text-muted-foreground">
                {run.sourceFingerprint}
              </p>
            </div>
            <div className="text-right text-muted-foreground">
              <p>{new Date(run.createdAt).toLocaleString()}</p>
              <p>{run.durationMilliseconds === null ? "-" : `${run.durationMilliseconds} ms`}</p>
            </div>
          </div>
        ))}
        {history?.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verification runs yet.</p>
        ) : null}
      </section>
      {history && history.runs.length >= 2 ? (
        <RecentRunComparison
          environmentId={environmentId}
          previousRunId={history.runs[1]!.id}
          currentRunId={history.runs[0]!.id}
        />
      ) : null}
    </div>
  );
}

export function VerificationSettingsPanel() {
  const projects = useProjects();
  const [selected, setSelected] = useState("");
  const selectedProject =
    projects.find((project) => `${project.environmentId}:${project.id}` === selected) ??
    projects[0] ??
    null;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto grid max-w-4xl gap-5">
        <div>
          <h1 className="text-xl font-semibold">Verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review repository-owned commands and control evidence required for integration.
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Project
          <select
            className="h-9 rounded-md border border-input bg-background px-2"
            value={selectedProject ? `${selectedProject.environmentId}:${selectedProject.id}` : ""}
            onChange={(event) => setSelected(event.currentTarget.value)}
          >
            {projects.map((project) => (
              <option
                key={`${project.environmentId}:${project.id}`}
                value={`${project.environmentId}:${project.id}`}
              >
                {project.title} - {project.environmentId}
              </option>
            ))}
          </select>
        </label>
        {selectedProject ? (
          <ProjectPanel
            key={`${selectedProject.environmentId}:${selectedProject.id}`}
            environmentId={selectedProject.environmentId}
            projectId={selectedProject.id}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Add a project to configure verification.</p>
        )}
      </div>
    </div>
  );
}
