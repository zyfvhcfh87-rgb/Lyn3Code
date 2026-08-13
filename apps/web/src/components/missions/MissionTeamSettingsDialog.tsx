import type { MissionIntegrationMode, MissionTeamSettings } from "@t3tools/contracts";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { MISSION_INTEGRATION_MODE_LABELS } from "./missionLabels";

const INTEGRATION_MODES = [
  "manual",
  "sequential",
  "automatic_when_clean",
] as const satisfies ReadonlyArray<MissionIntegrationMode>;

/**
 * Mission-wide limits, separated from per-agent editing.
 *
 * These settings govern the whole team, so interleaving them with one agent's fields made a
 * mission-wide change look like part of editing that agent.
 */
export function MissionTeamSettingsDialog({
  open,
  settings,
  isSubmitting,
  onOpenChange,
  onSave,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        {/* Mounted only while open, so each opening starts from the saved settings. */}
        {open ? (
          <SettingsForm
            settings={settings}
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onSave={onSave}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

interface Props {
  readonly open: boolean;
  readonly settings: MissionTeamSettings;
  readonly isSubmitting: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (settings: MissionTeamSettings) => Promise<boolean>;
}

function SettingsForm({ settings, isSubmitting, onOpenChange, onSave }: Omit<Props, "open">) {
  const [maximumConcurrentAgents, setMaximumConcurrentAgents] = useState(
    settings.maximumConcurrentAgents,
  );
  const [maximumConcurrentWriteAgents, setMaximumConcurrentWriteAgents] = useState(
    settings.maximumConcurrentWriteAgents,
  );
  const [defaultMaximumTaskAttempts, setDefaultMaximumTaskAttempts] = useState(
    settings.defaultMaximumTaskAttempts,
  );
  const [autoStartReadyTasks, setAutoStartReadyTasks] = useState(settings.autoStartReadyTasks);
  const [integrationMode, setIntegrationMode] = useState<MissionIntegrationMode>(
    settings.integrationMode,
  );
  const [conflict, setConflict] = useState(false);
  // Settings as they stood when this dialog opened. Every field is submitted together, so saving
  // over a change made elsewhere would revert it silently; the baseline makes that detectable.
  const [baseline] = useState(settings);

  // The server rejects writers exceeding total concurrency, so say so before the request.
  const writersExceedTotal = maximumConcurrentWriteAgents > maximumConcurrentAgents;
  const canSubmit = !writersExceedTotal && !isSubmitting;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (
      baseline.maximumConcurrentAgents !== settings.maximumConcurrentAgents ||
      baseline.maximumConcurrentWriteAgents !== settings.maximumConcurrentWriteAgents ||
      baseline.defaultMaximumTaskAttempts !== settings.defaultMaximumTaskAttempts ||
      baseline.autoStartReadyTasks !== settings.autoStartReadyTasks ||
      baseline.integrationMode !== settings.integrationMode
    ) {
      setConflict(true);
      return;
    }
    setConflict(false);
    const saved = await onSave({
      maximumConcurrentAgents,
      maximumConcurrentWriteAgents,
      defaultMaximumTaskAttempts,
      autoStartReadyTasks,
      integrationMode,
    });
    if (saved) onOpenChange(false);
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <DialogHeader>
        <DialogTitle>Team settings</DialogTitle>
        <DialogDescription>Limits that apply to every agent on this mission.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Concurrent agents</span>
            <Input
              nativeInput
              type="number"
              min={1}
              value={maximumConcurrentAgents}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 1) setMaximumConcurrentAgents(value);
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Concurrent write agents</span>
            <Input
              nativeInput
              type="number"
              min={1}
              aria-invalid={writersExceedTotal}
              value={maximumConcurrentWriteAgents}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 1) {
                  setMaximumConcurrentWriteAgents(value);
                }
              }}
            />
            {writersExceedTotal ? (
              <span className="text-xs text-destructive-foreground">
                Cannot exceed concurrent agents ({maximumConcurrentAgents}).
              </span>
            ) : null}
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Attempts per task</span>
            <Input
              nativeInput
              type="number"
              min={1}
              value={defaultMaximumTaskAttempts}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 1) setDefaultMaximumTaskAttempts(value);
              }}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Integration</span>
            <Select
              value={integrationMode}
              onValueChange={(value) =>
                value && setIntegrationMode(value as MissionIntegrationMode)
              }
            >
              <SelectTrigger aria-label="Integration mode">
                <SelectValue>{MISSION_INTEGRATION_MODE_LABELS[integrationMode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {INTEGRATION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {MISSION_INTEGRATION_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={autoStartReadyTasks}
            onCheckedChange={(checked) => setAutoStartReadyTasks(Boolean(checked))}
          />
          Start ready tasks automatically
        </label>
      </DialogPanel>
      {conflict ? (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive-foreground sm:px-6">
          Team settings changed elsewhere while this dialog was open. Close and reopen to start from
          the current values.
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting ? "Saving..." : "Save settings"}
        </Button>
      </DialogFooter>
    </form>
  );
}
