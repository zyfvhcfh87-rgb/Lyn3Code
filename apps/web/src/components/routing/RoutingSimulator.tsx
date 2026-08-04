import { FlaskConicalIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { RoutingCandidateComparison } from "./RoutingCandidateComparison";
import {
  routingDecisionTypeLabel,
  type RoutingDecisionDetailView,
  type RoutingSelectOption,
  type RoutingSimulatorDraft,
} from "./routingView";

function SimulatorSelect({
  label,
  value,
  options,
  allowAutomatic = false,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<RoutingSelectOption>;
  readonly allowAutomatic?: boolean;
  readonly onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select
        value={value ?? (allowAutomatic ? "automatic" : null)}
        onValueChange={(next) => onChange(next === "automatic" ? null : next)}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={`Choose ${label.toLocaleLowerCase()}`}>
            <span className="flex items-center gap-2">
              {selected?.label ?? (allowAutomatic ? "Automatic" : undefined)}
              {selected?.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {allowAutomatic ? <SelectItem value="automatic">Automatic</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                {option.label}
                {option.unavailable ? <Badge variant="warning">Unavailable</Badge> : null}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

export function RoutingSimulator({
  initialDraft,
  projects,
  missions,
  roles,
  taskTypes,
  complexities,
  privacyModes,
  capabilities,
  providers,
  models,
  result,
  error,
  isSimulating,
  onSimulate,
}: {
  readonly initialDraft: RoutingSimulatorDraft;
  readonly projects: ReadonlyArray<RoutingSelectOption>;
  readonly missions: ReadonlyArray<RoutingSelectOption>;
  readonly roles: ReadonlyArray<RoutingSelectOption>;
  readonly taskTypes: ReadonlyArray<RoutingSelectOption>;
  readonly complexities: ReadonlyArray<RoutingSelectOption>;
  readonly privacyModes: ReadonlyArray<RoutingSelectOption>;
  readonly capabilities: ReadonlyArray<RoutingSelectOption>;
  readonly providers: ReadonlyArray<RoutingSelectOption>;
  readonly models: ReadonlyArray<RoutingSelectOption>;
  readonly result: RoutingDecisionDetailView | null;
  readonly error: string | null;
  readonly isSimulating: boolean;
  readonly onSimulate: (draft: RoutingSimulatorDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const patchDraft = (patch: Partial<RoutingSimulatorDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSimulate(draft);
  };
  const canSubmit =
    draft.projectId.length > 0 && draft.role.length > 0 && draft.taskDescription.trim().length > 0;

  return (
    <SettingsSection id="routing-simulator" title="Routing simulator">
      <SettingsRow
        title="Preview a real routing decision"
        description="Uses the production routing engine, but never creates an agent run or sends a provider request."
      >
        <form className="grid gap-4 py-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SimulatorSelect
              label="Project"
              value={draft.projectId}
              options={projects}
              onChange={(projectId) => patchDraft({ projectId: projectId ?? "", missionId: null })}
            />
            <SimulatorSelect
              label="Mission"
              value={draft.missionId}
              options={missions}
              allowAutomatic
              onChange={(missionId) => patchDraft({ missionId })}
            />
            <SimulatorSelect
              label="Agent role"
              value={draft.role}
              options={roles}
              onChange={(role) => patchDraft({ role: role ?? "" })}
            />
            <SimulatorSelect
              label="Task type"
              value={draft.taskType}
              options={taskTypes}
              onChange={(taskType) => patchDraft({ taskType: taskType ?? "" })}
            />
            <SimulatorSelect
              label="Complexity"
              value={draft.complexity}
              options={complexities}
              onChange={(complexity) => patchDraft({ complexity: complexity ?? "" })}
            />
            <SimulatorSelect
              label="Privacy"
              value={draft.privacyMode}
              options={privacyModes}
              onChange={(privacyMode) => patchDraft({ privacyMode: privacyMode ?? "" })}
            />
            <SimulatorSelect
              label="Provider pin"
              value={draft.providerPin}
              options={providers}
              allowAutomatic
              onChange={(providerPin) => patchDraft({ providerPin })}
            />
            <SimulatorSelect
              label="Model pin"
              value={draft.modelPin}
              options={models}
              allowAutomatic
              onChange={(modelPin) => patchDraft({ modelPin })}
            />
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Task description</span>
            <Textarea
              value={draft.taskDescription}
              rows={4}
              placeholder="Describe the work the routed agent would perform…"
              onChange={(event) => patchDraft({ taskDescription: event.currentTarget.value })}
            />
          </label>
          <label className="grid gap-1.5 sm:max-w-xs">
            <span className="text-sm font-medium">Expected context tokens</span>
            <Input
              nativeInput
              type="number"
              min={0}
              step={1_000}
              value={draft.expectedContextTokens ?? ""}
              placeholder="Unknown"
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                patchDraft({ expectedContextTokens: Number.isFinite(value) ? value : null });
              }}
            />
          </label>
          <fieldset className="grid gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Required capabilities
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability) => (
                <label key={capability.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.requiredCapabilities.includes(capability.value)}
                    onCheckedChange={() => {
                      const next = draft.requiredCapabilities.includes(capability.value)
                        ? draft.requiredCapabilities.filter((value) => value !== capability.value)
                        : [...draft.requiredCapabilities, capability.value];
                      patchDraft({ requiredCapabilities: next });
                    }}
                  />
                  {capability.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canSubmit || isSimulating}>
              <FlaskConicalIcon /> {isSimulating ? "Simulating" : "Simulate routing"}
            </Button>
            <span className="text-xs text-muted-foreground">Simulation only · no agent starts</span>
          </div>
        </form>

        {error ? (
          <div
            className="mb-3 rounded-lg bg-destructive/8 p-3 text-sm text-destructive-foreground"
            role="alert"
          >
            <strong>No eligible model.</strong>
            <p className="mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        ) : null}

        {result ? (
          <section
            className="mb-3 grid gap-4 rounded-xl border border-border p-4"
            aria-live="polite"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{result.modelName}</h3>
                <p className="text-xs text-muted-foreground">
                  {result.providerName} · {result.reasoningLevel ?? "Model default reasoning"}
                </p>
              </div>
              <Badge variant="info">{routingDecisionTypeLabel(result.decisionType)}</Badge>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium">Why this candidate</h4>
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {result.selectionReasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium">Candidates</h4>
              <RoutingCandidateComparison candidates={result.candidates} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium">Fallback chain</h4>
              <p className="text-xs text-muted-foreground">
                {result.fallbackPlan.length > 0
                  ? result.fallbackPlan.join(" → ")
                  : "Fallback disabled"}
              </p>
            </div>
          </section>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
