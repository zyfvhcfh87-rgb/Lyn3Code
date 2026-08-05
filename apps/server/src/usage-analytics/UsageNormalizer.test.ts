import { describe, expect, it } from "@effect/vitest";

import {
  normalizeUsageSnapshot,
  partitionUsageBySource,
  reconcileCumulativeUsage,
} from "./UsageNormalizer.ts";

describe("UsageNormalizer", () => {
  it("reconciles cumulative streaming snapshots without double-counting", () => {
    const first = normalizeUsageSnapshot({
      snapshot: {
        usedTokens: 100,
        totalProcessedTokens: 100,
        lastUsedTokens: 100,
        lastInputTokens: 80,
        lastOutputTokens: 20,
      },
      previous: null,
      source: "provider_reported",
    });
    const second = normalizeUsageSnapshot({
      snapshot: {
        usedTokens: 150,
        totalProcessedTokens: 150,
        lastUsedTokens: 50,
        lastInputTokens: 40,
        lastOutputTokens: 10,
      },
      previous: first.cursor,
      source: "provider_reported",
    });
    const duplicate = normalizeUsageSnapshot({
      snapshot: second.cursor.snapshot,
      previous: second.cursor,
      source: "provider_reported",
    });

    expect(first.usage.totalTokens).toBe(100);
    expect(second.usage.totalTokens).toBe(50);
    expect(second.usage.inputTokens).toBe(40);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.usage.totalTokens).toBe(0);
    expect(duplicate.usage.inputTokens).toBe(0);
  });

  it("deltas cumulative dimensions when streaming snapshots omit last values", () => {
    const first = normalizeUsageSnapshot({
      snapshot: {
        usedTokens: 100,
        totalProcessedTokens: 100,
        inputTokens: 80,
        outputTokens: 20,
        cachedInputTokens: 10,
      },
      previous: null,
      source: "provider_reported",
    });
    const second = normalizeUsageSnapshot({
      snapshot: {
        usedTokens: 150,
        totalProcessedTokens: 150,
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 15,
      },
      previous: first.cursor,
      source: "provider_reported",
    });

    expect(second.usage).toMatchObject({
      totalTokens: 50,
      inputTokens: 40,
      outputTokens: 10,
      cachedInputTokens: 5,
    });
  });

  it("does not discard an equal-sized snapshot from a different provider request", () => {
    const first = normalizeUsageSnapshot({
      snapshot: { usedTokens: 100, totalProcessedTokens: 100, lastUsedTokens: 100 },
      previous: null,
      source: "provider_reported",
      observationKey: "turn-1",
    });
    const second = normalizeUsageSnapshot({
      snapshot: { usedTokens: 100, totalProcessedTokens: 100, lastUsedTokens: 100 },
      previous: first.cursor,
      source: "provider_reported",
      observationKey: "turn-2",
    });

    expect(second.duplicate).toBe(false);
    expect(second.usage.totalTokens).toBe(100);
  });

  it("preserves unknown dimensions instead of manufacturing zeroes", () => {
    const result = normalizeUsageSnapshot({
      snapshot: { usedTokens: 42 },
      previous: null,
      source: "context_estimated",
    });

    expect(result.usage.totalTokens).toBe(42);
    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBeNull();
    expect(result.usage.cacheReadTokens).toBeNull();

    expect(
      reconcileCumulativeUsage(null, {
        inputTokens: null,
        outputTokens: 10,
        reasoningTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
        cacheReadTokens: null,
        totalTokens: 10,
        toolCallCount: null,
      }).inputTokens,
    ).toBeNull();
  });

  it("keeps reported, calculated, and estimated sources in separate lanes", () => {
    const make = (source: "provider_reported" | "adapter_calculated" | "context_estimated") =>
      normalizeUsageSnapshot({
        snapshot: { usedTokens: 1 },
        previous: null,
        source,
      }).usage;
    const partition = partitionUsageBySource([
      make("provider_reported"),
      make("adapter_calculated"),
      make("context_estimated"),
    ]);

    expect(partition.providerReported).toHaveLength(1);
    expect(partition.adapterCalculated).toHaveLength(1);
    expect(partition.estimates).toHaveLength(1);
  });
});
