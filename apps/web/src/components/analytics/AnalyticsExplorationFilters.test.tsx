import type { AnalyticsFilter } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AnalyticsExplorationFilters } from "./AnalyticsExplorationFilters";
import { EMPTY_ANALYTICS_FILTER } from "./analyticsFilterLogic";

describe("AnalyticsExplorationFilters", () => {
  it("renders every supported scope and labels the unsupported confidence query honestly", () => {
    const filter = {
      ...EMPTY_ANALYTICS_FILTER,
      dateRange: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-05T23:59:59.999Z",
      },
      projectId: "project:one",
      missionId: "mission:one",
      agentRoleId: "role:implementer",
      providerProfileId: "provider:codex",
      modelProfileId: "model:gpt",
      reasoningLevel: "high",
      humanDisposition: "accepted",
      subscriptionBacked: true,
    } as AnalyticsFilter;
    const markup = renderToStaticMarkup(
      <AnalyticsExplorationFilters
        filter={filter}
        options={{
          projects: [{ id: "project:one", label: "Lyn Code" }],
          missions: [{ id: "mission:one", projectId: "project:one", label: "Phase 7" }],
          roles: [{ id: "role:implementer", label: "Implementer" }],
          providers: [{ id: "provider:codex", label: "Codex" }],
          models: [
            {
              id: "model:gpt",
              providerProfileId: "provider:codex",
              label: "GPT",
            },
          ],
        }}
        onChange={() => undefined}
        isRefreshing
      />,
    );

    expect(markup).toContain("9 active");
    expect(markup).toContain("Refreshing selected scope");
    expect(markup).toContain("Lyn Code");
    expect(markup).toContain("Phase 7");
    expect(markup).toContain("Implementer");
    expect(markup).toContain("All reasoning levels");
    expect(markup).toContain("All human outcomes");
    expect(markup).toContain("Subscription-backed");
    expect(markup).toContain("Cost confidence");
    expect(markup).toContain("Not filterable in v1");
    expect(markup).toContain("does not expose this filter yet");
  });

  it("renders an unfiltered scope without enabling reset", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsExplorationFilters
        filter={EMPTY_ANALYTICS_FILTER}
        options={{ projects: [], missions: [], roles: [], providers: [], models: [] }}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain("All data");
    expect(markup).toContain("Reset filters");
    expect(markup).toContain("disabled");
  });
});
