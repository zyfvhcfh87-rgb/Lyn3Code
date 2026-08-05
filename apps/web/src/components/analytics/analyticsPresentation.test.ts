import type { AnalyticsDataQuality, AnalyticsNonNegativeDecimal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  analyticsDataQualityState,
  formatAnalyticsDecimal,
  formatAnalyticsMoney,
} from "./analyticsPresentation";

const COMPLETE_QUALITY: AnalyticsDataQuality = {
  runCount: 4,
  providerReportedUsageCount: 4,
  estimatedUsageCount: 0,
  unknownUsageCount: 0,
  pricedUsageCount: 4,
  unpricedUsageCount: 0,
  stalePricingCount: 0,
  incompleteOutcomeCount: 0,
  pendingHumanDispositionCount: 0,
  sourceDetailDeletedCount: 0,
};

describe("analytics presentation", () => {
  it("formats exact decimal strings without binary-float coercion", () => {
    const value = "123456789012345678.123456789012345678" as AnalyticsNonNegativeDecimal;

    expect(formatAnalyticsDecimal(value)).toBe("123,456,789,012,345,678.123456789012345678");
    expect(formatAnalyticsMoney(value, "USD")).toBe(
      "123,456,789,012,345,678.123456789012345678 USD",
    );
  });

  it("makes disabled, insufficient, unknown, partial, and complete states distinct", () => {
    expect(analyticsDataQualityState(false, COMPLETE_QUALITY)).toBe("disabled");
    expect(analyticsDataQualityState(true, { ...COMPLETE_QUALITY, runCount: 0 })).toBe(
      "insufficient_sample",
    );
    expect(
      analyticsDataQualityState(true, {
        ...COMPLETE_QUALITY,
        providerReportedUsageCount: 0,
        unknownUsageCount: 4,
      }),
    ).toBe("unknown");
    expect(analyticsDataQualityState(true, { ...COMPLETE_QUALITY, estimatedUsageCount: 1 })).toBe(
      "partial",
    );
    expect(analyticsDataQualityState(true, COMPLETE_QUALITY)).toBe("complete");
  });
});
