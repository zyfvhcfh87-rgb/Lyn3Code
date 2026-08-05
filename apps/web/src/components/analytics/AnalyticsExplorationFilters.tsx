import type { AnalyticsFilter, HumanDisposition, RoutingReasoningLevel } from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { AnalyticsCard, AnalyticsNotice } from "./AnalyticsPrimitives";
import {
  activeAnalyticsFilterCount,
  analyticsDateBoundary,
  analyticsDateInputValue,
  EMPTY_ANALYTICS_FILTER,
  type AnalyticsFilterOption,
  type AnalyticsFilterOptions,
  withAnalyticsProject,
  withAnalyticsProvider,
} from "./analyticsFilterLogic";
import { humanizeAnalyticsKey } from "./analyticsPresentation";

const SELECT_CLASSNAME =
  "h-8.5 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24 disabled:opacity-64 sm:h-7.5";

const REASONING_LEVELS: ReadonlyArray<RoutingReasoningLevel> = [
  "low",
  "medium",
  "high",
  "extra_high",
];

const HUMAN_DISPOSITIONS: ReadonlyArray<HumanDisposition> = [
  "accepted",
  "accepted_with_edits",
  "rejected",
  "abandoned",
  "not_reviewed",
  "unknown",
];

function FilterField({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function optionsWithSelected(
  options: ReadonlyArray<AnalyticsFilterOption>,
  selectedId: string | null,
): ReadonlyArray<AnalyticsFilterOption> {
  if (selectedId === null || options.some(({ id }) => id === selectedId)) return options;
  return [{ id: selectedId, label: selectedId }, ...options];
}

export function AnalyticsExplorationFilters({
  filter,
  options,
  onChange,
  isRefreshing = false,
}: {
  readonly filter: AnalyticsFilter;
  readonly options: AnalyticsFilterOptions;
  readonly onChange: (filter: AnalyticsFilter) => void;
  readonly isRefreshing?: boolean;
}) {
  const activeCount = activeAnalyticsFilterCount(filter);
  const missions = options.missions.filter(
    ({ projectId }) => filter.projectId === null || projectId === filter.projectId,
  );
  const models = options.models.filter(
    ({ providerProfileId }) =>
      filter.providerProfileId === null ||
      providerProfileId === "*" ||
      providerProfileId === filter.providerProfileId,
  );

  return (
    <AnalyticsCard
      title="Explore analytics"
      action={
        <div className="flex items-center gap-2">
          <Badge variant={activeCount > 0 ? "info" : "outline"}>
            {activeCount === 0 ? "All data" : `${activeCount} active`}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={activeCount === 0}
            onClick={() => onChange(EMPTY_ANALYTICS_FILTER)}
          >
            Reset filters
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isRefreshing ? (
          <AnalyticsNotice title="Refreshing selected scope" tone="neutral" role="status">
            The last complete snapshot stays labelled while Lyn Code requests the new scope.
          </AnalyticsNotice>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FilterField label="From date" hint="UTC start of day.">
            <Input
              nativeInput
              type="date"
              value={analyticsDateInputValue(filter.dateRange.from)}
              onChange={(event) =>
                onChange({
                  ...filter,
                  dateRange: {
                    ...filter.dateRange,
                    from: analyticsDateBoundary(event.currentTarget.value, "start"),
                  },
                })
              }
            />
          </FilterField>
          <FilterField label="To date" hint="UTC end of day.">
            <Input
              nativeInput
              type="date"
              value={analyticsDateInputValue(filter.dateRange.to)}
              onChange={(event) =>
                onChange({
                  ...filter,
                  dateRange: {
                    ...filter.dateRange,
                    to: analyticsDateBoundary(event.currentTarget.value, "end"),
                  },
                })
              }
            />
          </FilterField>
          <FilterField label="Project">
            <select
              className={SELECT_CLASSNAME}
              value={filter.projectId ?? ""}
              onChange={(event) =>
                onChange(withAnalyticsProject(filter, event.currentTarget.value, options.missions))
              }
            >
              <option value="">All projects</option>
              {optionsWithSelected(options.projects, filter.projectId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Mission">
            <select
              className={SELECT_CLASSNAME}
              value={filter.missionId ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  missionId: event.currentTarget.value === "" ? null : event.currentTarget.value,
                } as AnalyticsFilter)
              }
            >
              <option value="">All missions</option>
              {optionsWithSelected(missions, filter.missionId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Agent role">
            <select
              className={SELECT_CLASSNAME}
              value={filter.agentRoleId ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  agentRoleId: event.currentTarget.value === "" ? null : event.currentTarget.value,
                } as AnalyticsFilter)
              }
            >
              <option value="">All roles</option>
              {optionsWithSelected(options.roles, filter.agentRoleId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Provider">
            <select
              className={SELECT_CLASSNAME}
              value={filter.providerProfileId ?? ""}
              onChange={(event) =>
                onChange(withAnalyticsProvider(filter, event.currentTarget.value, options.models))
              }
            >
              <option value="">All providers</option>
              {optionsWithSelected(options.providers, filter.providerProfileId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Model">
            <select
              className={SELECT_CLASSNAME}
              value={filter.modelProfileId ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  modelProfileId:
                    event.currentTarget.value === "" ? null : event.currentTarget.value,
                } as AnalyticsFilter)
              }
            >
              <option value="">All models</option>
              {optionsWithSelected(models, filter.modelProfileId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Reasoning level" hint="Provider-default is included only by All.">
            <select
              className={SELECT_CLASSNAME}
              value={filter.reasoningLevel ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  reasoningLevel:
                    event.currentTarget.value === ""
                      ? null
                      : (event.currentTarget.value as RoutingReasoningLevel),
                })
              }
            >
              <option value="">All reasoning levels</option>
              {REASONING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {humanizeAnalyticsKey(level)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Human outcome" hint="Silence remains not reviewed or unknown.">
            <select
              className={SELECT_CLASSNAME}
              value={filter.humanDisposition ?? ""}
              onChange={(event) =>
                onChange({
                  ...filter,
                  humanDisposition:
                    event.currentTarget.value === ""
                      ? null
                      : (event.currentTarget.value as HumanDisposition),
                })
              }
            >
              <option value="">All human outcomes</option>
              {HUMAN_DISPOSITIONS.map((disposition) => (
                <option key={disposition} value={disposition}>
                  {humanizeAnalyticsKey(disposition)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Billing basis">
            <select
              className={SELECT_CLASSNAME}
              value={
                filter.subscriptionBacked === null
                  ? ""
                  : filter.subscriptionBacked
                    ? "subscription"
                    : "non_subscription"
              }
              onChange={(event) =>
                onChange({
                  ...filter,
                  subscriptionBacked:
                    event.currentTarget.value === ""
                      ? null
                      : event.currentTarget.value === "subscription",
                })
              }
            >
              <option value="">API and subscription</option>
              <option value="non_subscription">API or other non-subscription</option>
              <option value="subscription">Subscription-backed</option>
            </select>
          </FilterField>
          <FilterField
            label="Cost confidence"
            hint="The current analytics query contract does not expose this filter yet."
          >
            <select className={SELECT_CLASSNAME} value="unavailable" disabled>
              <option value="unavailable">Not filterable in v1</option>
            </select>
          </FilterField>
        </div>
      </div>
    </AnalyticsCard>
  );
}
