import type { AnalyticsFilter } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activeAnalyticsFilterCount,
  analyticsDateBoundary,
  analyticsDateInputValue,
  EMPTY_ANALYTICS_FILTER,
  isAnalyticsFilterRefreshPending,
  withAnalyticsProject,
  withAnalyticsProvider,
} from "./analyticsFilterLogic";

describe("analytics filter logic", () => {
  it("uses explicit UTC day boundaries without fabricating missing dates", () => {
    expect(analyticsDateBoundary("", "start")).toBeNull();
    expect(analyticsDateBoundary("2026-08-05", "start")).toBe("2026-08-05T00:00:00.000Z");
    expect(analyticsDateBoundary("2026-08-05", "end")).toBe("2026-08-05T23:59:59.999Z");
    expect(analyticsDateInputValue("2026-08-05T23:59:59.999Z")).toBe("2026-08-05");
    expect(analyticsDateInputValue(null)).toBe("");
  });

  it("does not label a completed snapshot as refreshing just because its live stream remains open", () => {
    expect(isAnalyticsFilterRefreshPending(false, true)).toBe(false);
    expect(isAnalyticsFilterRefreshPending(true, false)).toBe(false);
    expect(isAnalyticsFilterRefreshPending(true, true)).toBe(true);
  });

  it("clears a mission when its project scope no longer matches", () => {
    const filter = {
      ...EMPTY_ANALYTICS_FILTER,
      projectId: "project:one",
      missionId: "mission:one",
    } as AnalyticsFilter;
    const missions = [
      { id: "mission:one", projectId: "project:one", label: "One" },
      { id: "mission:two", projectId: "project:two", label: "Two" },
    ];

    expect(withAnalyticsProject(filter, "project:one", missions).missionId).toBe("mission:one");
    expect(withAnalyticsProject(filter, "project:two", missions).missionId).toBeNull();
    expect(withAnalyticsProject(filter, "", missions).projectId).toBeNull();
  });

  it("clears incompatible models while retaining models with unknown provider association", () => {
    const filter = {
      ...EMPTY_ANALYTICS_FILTER,
      providerProfileId: "provider:one",
      modelProfileId: "model:one",
    } as AnalyticsFilter;

    expect(
      withAnalyticsProvider(filter, "provider:two", [
        {
          id: "model:one",
          providerProfileId: "provider:one",
          label: "Model one",
        },
      ]).modelProfileId,
    ).toBeNull();
    expect(
      withAnalyticsProvider(filter, "provider:two", [
        { id: "model:one", providerProfileId: "*", label: "Model one" },
      ]).modelProfileId,
    ).toBe("model:one");
  });

  it("counts each visible scope concept once and preserves hidden task/run filters", () => {
    const filter = {
      ...EMPTY_ANALYTICS_FILTER,
      dateRange: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-05T23:59:59.999Z",
      },
      projectId: "project:one",
      taskId: "task:one",
      agentRunId: "run:one",
      subscriptionBacked: false,
    } as AnalyticsFilter;

    expect(activeAnalyticsFilterCount(filter)).toBe(5);
    expect(activeAnalyticsFilterCount(EMPTY_ANALYTICS_FILTER)).toBe(0);
  });
});
