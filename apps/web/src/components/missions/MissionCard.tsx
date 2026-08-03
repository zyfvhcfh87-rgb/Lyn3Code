import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, BotIcon, ListChecksIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Card, CardPanel } from "../ui/card";
import { MissionStatusBadge } from "./MissionStatusBadge";
import type { MissionPresentationStatus } from "./MissionBoard.logic";

export interface MissionCardProps {
  readonly environmentId: string;
  readonly missionId: string;
  readonly title: string;
  readonly projectTitle: string;
  readonly status: MissionPresentationStatus;
  readonly completedTaskCount: number;
  readonly taskCount: number;
  readonly activeRunStatus: string | null;
  readonly updatedAt: string;
  readonly alertSummary: string | null;
}

export function MissionCard(props: MissionCardProps) {
  const taskProgress = `${props.completedTaskCount}/${props.taskCount}`;

  return (
    <Card
      render={
        <Link
          to="/missions/$environmentId/$missionId"
          params={{ environmentId: props.environmentId, missionId: props.missionId }}
          aria-label={`Open mission ${props.title}`}
        />
      }
      className="rounded-xl transition-colors hover:border-foreground/16 hover:bg-accent/24 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardPanel className="grid gap-3 p-3.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{props.title}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{props.projectTitle}</p>
          </div>
          <MissionStatusBadge status={props.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span aria-label={`${props.completedTaskCount} of ${props.taskCount} tasks completed`}>
            <ListChecksIcon aria-hidden className="mr-1 inline size-3.5" />
            {taskProgress}
          </span>
          {props.activeRunStatus ? (
            <Badge variant="outline">
              <BotIcon aria-hidden />
              {props.activeRunStatus}
            </Badge>
          ) : null}
          <time dateTime={props.updatedAt}>{formatRelativeTimeLabel(props.updatedAt)}</time>
        </div>

        {props.alertSummary ? (
          <p className="flex min-w-0 items-start gap-1.5 text-xs text-warning-foreground">
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-2">{props.alertSummary}</span>
          </p>
        ) : null}
      </CardPanel>
    </Card>
  );
}
