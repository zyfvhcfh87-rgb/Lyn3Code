import { useAtomValue } from "@effect/atom-react";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AnalyticsFilter,
  AnalyticsWorkspaceSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";

import type { AnalyticsWorkspaceActions } from "../components/analytics/analyticsActions";
import {
  EMPTY_ANALYTICS_FILTER,
  isAnalyticsFilterRefreshPending,
  type AnalyticsFilterOptions,
} from "../components/analytics/analyticsFilterLogic";
import { AnalyticsSettingsPage } from "../components/analytics/AnalyticsSettingsPage";
import { toastManager } from "../components/ui/toast";
import { analyticsEnvironment } from "../state/analytics";
import { useActiveEnvironmentId, useProjects } from "../state/entities";
import { useMissionBoardState } from "../state/missions";
import { useEnvironmentQuery } from "../state/query";
import { routingEnvironment } from "../state/routing";
import { useAtomCommand } from "../state/use-atom-command";

function analyticsCommandFailureMessage(
  failure: Parameters<typeof squashAtomCommandFailure>[0],
): string {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The analytics command failed.";
}

function ConnectedAnalyticsSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const [filter, setFilter] = useState<AnalyticsFilter>(EMPTY_ANALYTICS_FILTER);
  const analyticsInput = useMemo(() => ({ filter }), [filter]);
  const projects = useProjects();
  const missionBoardState = useMissionBoardState({ environmentId });
  const workspaceQuery = useEnvironmentQuery(
    analyticsEnvironment.workspaceAtom({ environmentId, input: analyticsInput }),
  );
  const subscriptionResult = useAtomValue(
    analyticsEnvironment.workspaceSubscriptionAtom({
      environmentId,
      input: analyticsInput,
    }),
  );
  const routingRegistryResult = useAtomValue(
    routingEnvironment.registryAtom({ environmentId, input: {} }),
  );
  const streamedSnapshot: AnalyticsWorkspaceSnapshot | null = Option.getOrNull(
    AsyncResult.value(subscriptionResult),
  );
  const snapshot = streamedSnapshot ?? workspaceQuery.data;
  const routingRegistry = Option.getOrNull(AsyncResult.value(routingRegistryResult));
  const pricingProfiles = useMemo(
    () =>
      routingRegistry
        ? {
            providers: routingRegistry.providers.map((provider) => ({
              id: provider.id,
              label: provider.displayName,
            })),
            models: routingRegistry.models.map((model) => ({
              id: model.id,
              providerProfileId: model.providerProfileId,
              label: model.displayName,
            })),
          }
        : undefined,
    [routingRegistry],
  );
  const missionBoard = Option.getOrNull(missionBoardState.snapshot);
  const filterOptions = useMemo<AnalyticsFilterOptions>(() => {
    const comparisonOptions = (scopeType: "provider" | "model" | "agent_role") =>
      (snapshot?.comparisons ?? [])
        .filter((comparison) => comparison.scopeType === scopeType)
        .map((comparison) => ({ id: comparison.scopeId, label: comparison.label }));
    const providers = pricingProfiles?.providers ?? comparisonOptions("provider");
    const models =
      pricingProfiles?.models ??
      comparisonOptions("model").map((model) => ({
        ...model,
        providerProfileId: "*",
      }));

    return {
      projects: projects
        .filter((project) => project.environmentId === environmentId)
        .map((project) => ({ id: project.id, label: project.title })),
      missions: (missionBoard?.missions ?? []).map(({ mission }) => ({
        id: mission.id,
        projectId: mission.projectId,
        label: mission.title,
      })),
      roles: comparisonOptions("agent_role"),
      providers,
      models,
    };
  }, [environmentId, missionBoard, pricingProfiles, projects, snapshot]);
  const updateSettings = useAtomCommand(analyticsEnvironment.updateSettings, {
    reportFailure: false,
  });
  const saveBudget = useAtomCommand(analyticsEnvironment.saveBudget, { reportFailure: false });
  const savePricingSnapshot = useAtomCommand(analyticsEnvironment.savePricingSnapshot, {
    reportFailure: false,
  });
  const saveSubscriptionAttributionRule = useAtomCommand(
    analyticsEnvironment.saveSubscriptionAttributionRule,
    { reportFailure: false },
  );
  const saveExchangeRateSnapshot = useAtomCommand(analyticsEnvironment.saveExchangeRateSnapshot, {
    reportFailure: false,
  });
  const acknowledgeBudgetEvent = useAtomCommand(analyticsEnvironment.acknowledgeBudgetEvent, {
    reportFailure: false,
  });
  const createBudgetOverride = useAtomCommand(analyticsEnvironment.createBudgetOverride, {
    reportFailure: false,
  });
  const acknowledgeAlert = useAtomCommand(analyticsEnvironment.acknowledgeAlert, {
    reportFailure: false,
  });
  const saveAnnotation = useAtomCommand(analyticsEnvironment.saveAnnotation, {
    reportFailure: false,
  });
  const recordHumanDisposition = useAtomCommand(analyticsEnvironment.recordHumanDisposition, {
    reportFailure: false,
  });
  const createExport = useAtomCommand(analyticsEnvironment.createExport, { reportFailure: false });
  const startRetention = useAtomCommand(analyticsEnvironment.startRetention, {
    reportFailure: false,
  });
  const rebuildAggregates = useAtomCommand(analyticsEnvironment.rebuildAggregates, {
    reportFailure: false,
  });
  const reportCommand = useCallback(
    <A, E>(result: AtomCommandResult<A, E>, successTitle: string, failureTitle: string) => {
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: analyticsCommandFailureMessage(result),
        });
        return false;
      }
      toastManager.add({ type: "success", title: successTitle });
      workspaceQuery.refresh();
      return true;
    },
    [workspaceQuery.refresh],
  );
  const actions = useMemo<AnalyticsWorkspaceActions>(
    () => ({
      updateSettings: async (commandInput) =>
        reportCommand(
          await updateSettings({ environmentId, input: commandInput }),
          "Analytics settings saved",
          "Couldn’t save analytics settings",
        ),
      savePricingSnapshot: async (commandInput) =>
        reportCommand(
          await savePricingSnapshot({ environmentId, input: commandInput }),
          "Pricing snapshot saved",
          "Couldn’t save pricing snapshot",
        ),
      saveSubscriptionAttributionRule: async (commandInput) =>
        reportCommand(
          await saveSubscriptionAttributionRule({ environmentId, input: commandInput }),
          "Subscription accounting rule saved",
          "Couldn’t save subscription accounting rule",
        ),
      saveExchangeRateSnapshot: async (commandInput) =>
        reportCommand(
          await saveExchangeRateSnapshot({ environmentId, input: commandInput }),
          "Exchange-rate snapshot saved",
          "Couldn’t save exchange-rate snapshot",
        ),
      saveBudget: async (commandInput) =>
        reportCommand(
          await saveBudget({ environmentId, input: commandInput }),
          "Budget policy saved",
          "Couldn’t save budget policy",
        ),
      acknowledgeBudgetEvent: async (commandInput) =>
        reportCommand(
          await acknowledgeBudgetEvent({ environmentId, input: commandInput }),
          "Budget event acknowledged",
          "Couldn’t acknowledge budget event",
        ),
      createBudgetOverride: async (commandInput) =>
        reportCommand(
          await createBudgetOverride({ environmentId, input: commandInput }),
          "Temporary budget override created",
          "Couldn’t create budget override",
        ),
      acknowledgeAlert: async (commandInput) =>
        reportCommand(
          await acknowledgeAlert({ environmentId, input: commandInput }),
          "Analytics alert acknowledged",
          "Couldn’t acknowledge analytics alert",
        ),
      saveAnnotation: async (commandInput) =>
        reportCommand(
          await saveAnnotation({ environmentId, input: commandInput }),
          "Analytics annotation saved",
          "Couldn’t save analytics annotation",
        ),
      recordHumanDisposition: async (commandInput) =>
        reportCommand(
          await recordHumanDisposition({ environmentId, input: commandInput }),
          "Human disposition recorded",
          "Couldn’t record human disposition",
        ),
      createExport: async (commandInput) =>
        reportCommand(
          await createExport({ environmentId, input: commandInput }),
          `${commandInput.format.toUpperCase()} export completed`,
          "Couldn’t create analytics export",
        ),
      startRetention: async (commandInput) =>
        reportCommand(
          await startRetention({ environmentId, input: commandInput }),
          "Analytics retention completed",
          "Couldn’t start analytics retention",
        ),
      rebuildAggregates: async (commandInput) =>
        reportCommand(
          await rebuildAggregates({ environmentId, input: commandInput }),
          "Analytics aggregate rebuild completed",
          "Couldn’t rebuild analytics aggregates",
        ),
    }),
    [
      acknowledgeAlert,
      acknowledgeBudgetEvent,
      createBudgetOverride,
      createExport,
      environmentId,
      rebuildAggregates,
      recordHumanDisposition,
      reportCommand,
      saveAnnotation,
      saveBudget,
      saveExchangeRateSnapshot,
      savePricingSnapshot,
      saveSubscriptionAttributionRule,
      startRetention,
      updateSettings,
    ],
  );

  if (snapshot !== null) {
    return (
      <AnalyticsSettingsPage
        state="ready"
        snapshot={snapshot}
        filter={filter}
        filterOptions={filterOptions}
        onFilterChange={setFilter}
        isFilterRefreshing={isAnalyticsFilterRefreshPending(
          workspaceQuery.isPending,
          subscriptionResult.waiting,
        )}
        actions={actions}
        pricingProfiles={pricingProfiles}
      />
    );
  }

  if (workspaceQuery.error !== null) {
    return <AnalyticsSettingsPage state="unavailable" reason={workspaceQuery.error} />;
  }

  if (subscriptionResult._tag === "Failure") {
    return (
      <AnalyticsSettingsPage
        state="unavailable"
        reason="The live analytics workspace subscription failed."
      />
    );
  }

  if (workspaceQuery.isPending || subscriptionResult.waiting) {
    return <AnalyticsSettingsPage state="loading" />;
  }

  return (
    <AnalyticsSettingsPage
      state="unavailable"
      reason="This environment did not return an analytics workspace snapshot."
    />
  );
}

function AnalyticsSettingsRoute() {
  const environmentId = useActiveEnvironmentId();
  return environmentId === null ? (
    <AnalyticsSettingsPage
      state="unavailable"
      reason="Connect or select an environment to view its analytics."
    />
  ) : (
    <ConnectedAnalyticsSettings key={environmentId} environmentId={environmentId} />
  );
}

export const Route = createFileRoute("/settings/analytics")({
  component: AnalyticsSettingsRoute,
});
