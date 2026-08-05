import type { AnalyticsComparisonRow } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AnalyticsComparisonTable } from "./AnalyticsComparisonsAndForecasts";

const row = (
  scopeType: AnalyticsComparisonRow["scopeType"],
  scopeId: string,
  label: string,
  overrides: Partial<AnalyticsComparisonRow> = {},
): AnalyticsComparisonRow =>
  ({
    scopeType,
    scopeId,
    label,
    taskCount: 6,
    runCount: 8,
    completionRate: 0.75,
    firstPassVerificationRate: 0.5,
    repairRate: 0.25,
    fallbackRate: 0.125,
    averageFirstOutputLatencyMilliseconds: 1_200,
    tokensPerVerifiedTask: "1500",
    humanAcceptanceRate: 0.5,
    missingDataRatio: 0,
    estimatedCostRatio: 0,
    insufficientSample: false,
    ...overrides,
  }) as AnalyticsComparisonRow;

describe("AnalyticsComparisonTable", () => {
  it("shows sample and missing-data evidence for every supported comparison scope", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsComparisonTable
        minimumSampleSize={5}
        rows={[
          row("provider", "provider:codex", "Codex"),
          row("model", "model:gpt", "GPT"),
          row("reasoning", "high", "High"),
          row("agent_role", "role:implementer", "Implementer", {
            taskCount: 2,
            missingDataRatio: 0.5,
            estimatedCostRatio: 0.25,
            insufficientSample: true,
          }),
        ]}
      />,
    );

    expect(markup).toContain("Provider, model, reasoning, and role comparisons");
    expect(markup).toContain("Codex");
    expect(markup).toContain("GPT");
    expect(markup).toContain("High");
    expect(markup).toContain("Implementer");
    expect(markup).toContain("Sample (tasks)");
    expect(markup).toContain("Meets 5-task minimum");
    expect(markup).toContain("Below 5-task minimum");
    expect(markup).toContain("Some comparisons need more evidence");
    expect(markup).toContain("Some comparison evidence is incomplete");
    expect(markup).toContain("50%");
    expect(markup).toContain("25%");
  });
});
