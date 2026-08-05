import type {
  AnalyticsConfidence,
  ThreadTokenUsageSnapshot,
  UsageRecordState,
  UsageSource,
} from "@t3tools/contracts";

export interface NormalizedUsage {
  readonly usageSource: UsageSource;
  readonly usageConfidence: AnalyticsConfidence;
  readonly state: UsageRecordState;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly totalTokens: number | null;
  readonly toolCallCount: number | null;
  readonly activeContextTokens: number | null;
  readonly contextWindowTokens: number | null;
}

export interface CumulativeUsageTotals {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly totalTokens: number | null;
  readonly toolCallCount: number | null;
}

export interface UsageNormalizationCursor {
  readonly snapshot: ThreadTokenUsageSnapshot;
  readonly observationKey?: string;
}

export interface UsageNormalizationInput {
  readonly snapshot: ThreadTokenUsageSnapshot;
  readonly previous: UsageNormalizationCursor | null;
  readonly source: UsageSource;
  readonly confidence?: AnalyticsConfidence;
  readonly observationKey?: string;
}

export interface UsageNormalizationResult {
  readonly usage: NormalizedUsage;
  readonly cursor: UsageNormalizationCursor;
  readonly duplicate: boolean;
  readonly cumulativeReset: boolean;
}

export interface UsageSourcePartition {
  readonly providerReported: ReadonlyArray<NormalizedUsage>;
  readonly adapterCalculated: ReadonlyArray<NormalizedUsage>;
  readonly estimates: ReadonlyArray<NormalizedUsage>;
  readonly unknown: ReadonlyArray<NormalizedUsage>;
}

const defaultConfidence = (source: UsageSource): AnalyticsConfidence => {
  switch (source) {
    case "provider_reported":
      return "confirmed";
    case "adapter_calculated":
      return "high";
    case "tokenizer_estimated":
      return "medium";
    case "context_estimated":
      return "low";
    case "unknown":
      return "unknown";
  }
};

const delta = (previous: number | null, current: number | null): number | null => {
  if (current === null) return null;
  if (previous === null || current < previous) return current;
  return current - previous;
};

/**
 * Reconciles cumulative counters dimension-by-dimension. A missing counter stays
 * unknown; a counter reset begins a new cumulative sequence at its current value.
 */
export const reconcileCumulativeUsage = (
  previous: CumulativeUsageTotals | null,
  current: CumulativeUsageTotals,
): CumulativeUsageTotals => ({
  inputTokens: delta(previous?.inputTokens ?? null, current.inputTokens),
  outputTokens: delta(previous?.outputTokens ?? null, current.outputTokens),
  reasoningTokens: delta(previous?.reasoningTokens ?? null, current.reasoningTokens),
  cachedInputTokens: delta(previous?.cachedInputTokens ?? null, current.cachedInputTokens),
  cacheWriteTokens: delta(previous?.cacheWriteTokens ?? null, current.cacheWriteTokens),
  cacheReadTokens: delta(previous?.cacheReadTokens ?? null, current.cacheReadTokens),
  totalTokens: delta(previous?.totalTokens ?? null, current.totalTokens),
  toolCallCount: delta(previous?.toolCallCount ?? null, current.toolCallCount),
});

const snapshotFingerprint = (snapshot: ThreadTokenUsageSnapshot): string =>
  [
    snapshot.usedTokens,
    snapshot.totalProcessedTokens ?? "?",
    snapshot.inputTokens ?? "?",
    snapshot.cachedInputTokens ?? "?",
    snapshot.outputTokens ?? "?",
    snapshot.reasoningOutputTokens ?? "?",
    snapshot.lastUsedTokens ?? "?",
    snapshot.lastInputTokens ?? "?",
    snapshot.lastCachedInputTokens ?? "?",
    snapshot.lastOutputTokens ?? "?",
    snapshot.lastReasoningOutputTokens ?? "?",
    snapshot.toolUses ?? "?",
  ].join(":");

const observedTurnValue = (
  last: number | undefined,
  current: number | undefined,
  previous: number | undefined,
  hasPreviousSnapshot: boolean,
): number | null => {
  if (last !== undefined) return last;
  if (current === undefined) return null;
  if (!hasPreviousSnapshot || previous === undefined) return current;
  return current < previous ? current : current - previous;
};

/**
 * Converts the provider-neutral runtime snapshot to a billable usage observation.
 * `usedTokens` remains active context, while `totalProcessedTokens` is used only
 * to identify progress and duplicate streaming snapshots.
 */
export const normalizeUsageSnapshot = (
  input: UsageNormalizationInput,
): UsageNormalizationResult => {
  const previous = input.previous?.snapshot ?? null;
  const sameObservation =
    input.previous === null ||
    input.previous === undefined ||
    input.observationKey === undefined ||
    input.previous.observationKey === undefined ||
    input.observationKey === input.previous.observationKey;
  const duplicate =
    sameObservation &&
    previous !== null &&
    snapshotFingerprint(previous) === snapshotFingerprint(input.snapshot);
  const previousProcessed = previous?.totalProcessedTokens;
  const currentProcessed = input.snapshot.totalProcessedTokens;
  const cumulativeReset =
    previousProcessed !== undefined &&
    currentProcessed !== undefined &&
    currentProcessed < previousProcessed;
  const cumulativeProgress =
    sameObservation &&
    previousProcessed !== undefined &&
    currentProcessed !== undefined &&
    !cumulativeReset
      ? currentProcessed - previousProcessed
      : null;
  const noNewUsage = duplicate || cumulativeProgress === 0;

  const usage: NormalizedUsage = {
    usageSource: input.source,
    usageConfidence: input.confidence ?? defaultConfidence(input.source),
    state:
      input.source === "unknown"
        ? "unknown"
        : noNewUsage || cumulativeProgress !== null
          ? "reconciled"
          : input.source === "provider_reported"
            ? "final"
            : "provisional",
    inputTokens: noNewUsage
      ? 0
      : observedTurnValue(
          input.snapshot.lastInputTokens,
          input.snapshot.inputTokens,
          previous?.inputTokens,
          previous !== null,
        ),
    outputTokens: noNewUsage
      ? 0
      : observedTurnValue(
          input.snapshot.lastOutputTokens,
          input.snapshot.outputTokens,
          previous?.outputTokens,
          previous !== null,
        ),
    reasoningTokens: noNewUsage
      ? 0
      : observedTurnValue(
          input.snapshot.lastReasoningOutputTokens,
          input.snapshot.reasoningOutputTokens,
          previous?.reasoningOutputTokens,
          previous !== null,
        ),
    cachedInputTokens: noNewUsage
      ? 0
      : observedTurnValue(
          input.snapshot.lastCachedInputTokens,
          input.snapshot.cachedInputTokens,
          previous?.cachedInputTokens,
          previous !== null,
        ),
    cacheWriteTokens: null,
    cacheReadTokens: null,
    totalTokens: noNewUsage
      ? 0
      : cumulativeProgress !== null
        ? cumulativeProgress
        : observedTurnValue(
            input.snapshot.lastUsedTokens,
            input.snapshot.usedTokens,
            previous?.usedTokens,
            previous !== null,
          ),
    toolCallCount: noNewUsage
      ? 0
      : observedTurnValue(
          undefined,
          input.snapshot.toolUses,
          previous?.toolUses,
          previous !== null,
        ),
    activeContextTokens: input.snapshot.usedTokens,
    contextWindowTokens: input.snapshot.maxTokens ?? null,
  };

  return {
    usage,
    cursor: {
      snapshot: input.snapshot,
      ...(input.observationKey === undefined ? {} : { observationKey: input.observationKey }),
    },
    duplicate,
    cumulativeReset,
  };
};

/**
 * Keeps authoritative, calculated, and estimated observations in separate lanes.
 * Consumers can reconcile lanes explicitly without accidentally adding an estimate
 * to the provider's report for the same work.
 */
export const partitionUsageBySource = (
  observations: ReadonlyArray<NormalizedUsage>,
): UsageSourcePartition => ({
  providerReported: observations.filter(({ usageSource }) => usageSource === "provider_reported"),
  adapterCalculated: observations.filter(({ usageSource }) => usageSource === "adapter_calculated"),
  estimates: observations.filter(
    ({ usageSource }) =>
      usageSource === "tokenizer_estimated" || usageSource === "context_estimated",
  ),
  unknown: observations.filter(({ usageSource }) => usageSource === "unknown"),
});
