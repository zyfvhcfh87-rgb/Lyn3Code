import { AnalyticsCurrency, IsoDateTime } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { forecastMetric, type ForecastInput } from "./Forecasting.ts";

const start = IsoDateTime.make("2026-01-01T00:00:00.000Z");
const end = IsoDateTime.make("2026-01-11T00:00:00.000Z");
const asOf = "2026-01-06T00:00:00.000Z";

const baseInput = (): ForecastInput => ({
  metricKey: "period_cost",
  unit: "USD",
  method: "current_period_run_rate",
  observationStart: start,
  observationEnd: end,
  asOf,
  observations: [
    { value: "10", observedAt: "2026-01-02T00:00:00.000Z", estimated: false },
    { value: "20", observedAt: "2026-01-03T00:00:00.000Z", estimated: false },
  ],
  minimumSampleSize: 2,
});

describe("Forecasting", () => {
  it("calculates an exact current-period run rate with transparent uncertainty", () => {
    const forecast = forecastMetric(baseInput());

    expect(forecast.value).toBe("60");
    expect(forecast.confidence).toBe("medium");
    expect(forecast.withheldReason).toBeNull();
    expect(forecast.uncertainty).toContain("2 known and 0 missing");
  });

  it("withholds forecasts below the configured minimum sample", () => {
    const forecast = forecastMetric({ ...baseInput(), minimumSampleSize: 3 });

    expect(forecast.value).toBeNull();
    expect(forecast.confidence).toBe("unknown");
    expect(forecast.withheldReason).toContain("2 known samples; minimum is 3");
  });

  it("withholds mixed-currency inputs instead of summing them", () => {
    const forecast = forecastMetric({
      ...baseInput(),
      observations: [
        {
          value: "10",
          observedAt: "2026-01-02T00:00:00.000Z",
          estimated: false,
          currency: AnalyticsCurrency.make("USD"),
        },
        {
          value: "20",
          observedAt: "2026-01-03T00:00:00.000Z",
          estimated: false,
          currency: AnalyticsCurrency.make("EUR"),
        },
      ],
    });

    expect(forecast.value).toBeNull();
    expect(forecast.withheldReason).toContain("mixed currencies");
  });

  it("requires an expected volume for trailing-average projections", () => {
    const withheld = forecastMetric({ ...baseInput(), method: "trailing_average" });
    const projected = forecastMetric({
      ...baseInput(),
      method: "trailing_average",
      expectedSampleCount: 10,
    });

    expect(withheld.value).toBeNull();
    expect(withheld.withheldReason).toContain("expected sample count");
    expect(projected.value).toBe("150");
  });

  it("sums configured scheduled mission estimates and marks estimates explicitly", () => {
    const forecast = forecastMetric({
      ...baseInput(),
      method: "scheduled_mission_estimate",
      scheduledValues: [
        { value: "2", observedAt: "2026-01-02T00:00:00.000Z", estimated: true },
        { value: "3", observedAt: "2026-01-03T00:00:00.000Z", estimated: true },
      ],
    });

    expect(forecast.value).toBe("5");
    expect(forecast.includesEstimatedCost).toBe(true);
    expect(forecast.uncertainty).toContain("includes estimated source values");
  });
});
