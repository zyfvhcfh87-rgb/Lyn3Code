import type { AgentHandoff } from "@t3tools/contracts";
import { CheckCircle2Icon, FileDiffIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Card, CardPanel } from "../ui/card";

export function MissionHandoffViewer({ handoff }: { readonly handoff: AgentHandoff }) {
  return (
    <Card className="[content-visibility:auto] [contain-intrinsic-size:auto_18rem]">
      <CardPanel className="grid gap-4 p-4">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold">Structured handoff</h4>
            <time className="text-xs text-muted-foreground" dateTime={handoff.createdAt}>
              {formatRelativeTimeLabel(handoff.createdAt)}
            </time>
          </div>
          <Badge variant={handoff.reconciliationStatus === "matched" ? "success" : "outline"}>
            Git {handoff.reconciliationStatus}
          </Badge>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-6">{handoff.summary}</p>

        {handoff.decisions.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              {handoff.decisions.length} decision{handoff.decisions.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 grid gap-2 pl-4">
              {handoff.decisions.map((decision) => (
                <li
                  key={`${decision.decision}:${decision.reason}:${decision.impact}`}
                  className="text-sm"
                >
                  <p className="font-medium">{decision.decision}</p>
                  <p className="text-muted-foreground">{decision.reason}</p>
                  {decision.impact ? (
                    <p className="text-xs text-muted-foreground">Impact: {decision.impact}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {handoff.changedFiles.length > 0 ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <FileDiffIcon className="size-4" />
              {handoff.changedFiles.length} changed file
              {handoff.changedFiles.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 grid gap-1.5 pl-4">
              {handoff.changedFiles.map((file) => (
                <li key={file.path} className="min-w-0 text-sm">
                  <code className="break-all text-xs">{file.path}</code>
                  <Badge className="ml-2" variant="outline">
                    {file.change}
                  </Badge>
                  <p className="text-muted-foreground">{file.summary}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {handoff.commandsRun.length > 0 ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <TerminalIcon className="size-4" />
              {handoff.commandsRun.length} command{handoff.commandsRun.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 grid gap-2 pl-4">
              {handoff.commandsRun.map((command) => (
                <li
                  key={`${command.command}:${command.exitCode}:${command.summary}`}
                  className="text-sm"
                >
                  <div className="flex items-start gap-2">
                    {command.exitCode === 0 ? (
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
                    ) : (
                      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                    )}
                    <div className="min-w-0">
                      <code className="break-all text-xs">{command.command}</code>
                      <p className="text-muted-foreground">
                        Exit {command.exitCode}: {command.summary}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {handoff.unresolvedProblems.length > 0 ? (
          <div className="rounded-lg border border-warning/30 bg-warning/8 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-warning-foreground">
              <TriangleAlertIcon className="size-4" /> Unresolved
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm text-warning-foreground/90">
              {handoff.unresolvedProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {handoff.recommendedNextAction ? (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <span className="font-medium">Recommended next action:</span>{" "}
            {handoff.recommendedNextAction}
          </div>
        ) : null}
      </CardPanel>
    </Card>
  );
}
