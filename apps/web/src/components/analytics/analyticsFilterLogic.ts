import type { AnalyticsFilter } from "@t3tools/contracts";

export interface AnalyticsFilterOption {
  readonly id: string;
  readonly label: string;
}

export interface AnalyticsMissionFilterOption extends AnalyticsFilterOption {
  readonly projectId: string;
}

export interface AnalyticsModelFilterOption extends AnalyticsFilterOption {
  readonly providerProfileId: string;
}

export interface AnalyticsFilterOptions {
  readonly projects: ReadonlyArray<AnalyticsFilterOption>;
  readonly missions: ReadonlyArray<AnalyticsMissionFilterOption>;
  readonly roles: ReadonlyArray<AnalyticsFilterOption>;
  readonly providers: ReadonlyArray<AnalyticsFilterOption>;
  readonly models: ReadonlyArray<AnalyticsModelFilterOption>;
}

export const EMPTY_ANALYTICS_FILTER: AnalyticsFilter = {
  dateRange: { from: null, to: null },
  projectId: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  providerProfileId: null,
  modelProfileId: null,
  agentRoleId: null,
  reasoningLevel: null,
  humanDisposition: null,
  subscriptionBacked: null,
};

export function analyticsDateInputValue(value: string | null): string {
  return value?.slice(0, 10) ?? "";
}

export function analyticsDateBoundary(value: string, boundary: "start" | "end"): string | null {
  if (value === "") return null;
  return `${value}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
}

export function isAnalyticsFilterRefreshPending(
  workspacePending: boolean,
  subscriptionWaiting: boolean,
): boolean {
  return workspacePending && subscriptionWaiting;
}

export function withAnalyticsProject(
  filter: AnalyticsFilter,
  projectId: string,
  missions: ReadonlyArray<AnalyticsMissionFilterOption>,
): AnalyticsFilter {
  const nextProjectId = projectId === "" ? null : projectId;
  const missionStillMatches = missions.some(
    (mission) => mission.id === filter.missionId && mission.projectId === nextProjectId,
  );
  return {
    ...filter,
    projectId: nextProjectId,
    missionId: missionStillMatches ? filter.missionId : null,
  } as AnalyticsFilter;
}

export function withAnalyticsProvider(
  filter: AnalyticsFilter,
  providerProfileId: string,
  models: ReadonlyArray<AnalyticsModelFilterOption>,
): AnalyticsFilter {
  const nextProviderProfileId = providerProfileId === "" ? null : providerProfileId;
  const modelStillMatches = models.some(
    (model) =>
      model.id === filter.modelProfileId &&
      (nextProviderProfileId === null ||
        model.providerProfileId === "*" ||
        model.providerProfileId === nextProviderProfileId),
  );
  return {
    ...filter,
    providerProfileId: nextProviderProfileId,
    modelProfileId: modelStillMatches ? filter.modelProfileId : null,
  } as AnalyticsFilter;
}

export function activeAnalyticsFilterCount(filter: AnalyticsFilter): number {
  return (
    Number(filter.dateRange.from !== null || filter.dateRange.to !== null) +
    Number(filter.projectId !== null) +
    Number(filter.missionId !== null) +
    Number(filter.taskId !== null) +
    Number(filter.agentRunId !== null) +
    Number(filter.providerProfileId !== null) +
    Number(filter.modelProfileId !== null) +
    Number(filter.agentRoleId !== null) +
    Number(filter.reasoningLevel !== null) +
    Number(filter.humanDisposition !== null) +
    Number(filter.subscriptionBacked !== null)
  );
}
