import type {
  AnalyticsConfidence,
  AnalyticsCurrency,
  AnalyticsDataQuality,
  AnalyticsNonNegativeDecimal,
} from "@t3tools/contracts";

export type AnalyticsPresentationState =
  | "complete"
  | "partial"
  | "unknown"
  | "disabled"
  | "insufficient_sample";

export const ANALYTICS_STATE_LABELS: Readonly<Record<AnalyticsPresentationState, string>> = {
  complete: "Complete",
  partial: "Partial data",
  unknown: "Unknown",
  disabled: "Disabled",
  insufficient_sample: "Insufficient sample",
};

export function analyticsDataQualityState(
  enabled: boolean,
  quality: AnalyticsDataQuality,
): AnalyticsPresentationState {
  if (!enabled) return "disabled";
  if (quality.runCount === 0) return "insufficient_sample";

  const knownUsageCount = quality.providerReportedUsageCount + quality.estimatedUsageCount;
  const observedUsageCount = knownUsageCount + quality.unknownUsageCount;
  if (knownUsageCount === 0) return "unknown";

  if (
    quality.estimatedUsageCount > 0 ||
    quality.unknownUsageCount > 0 ||
    quality.unpricedUsageCount > 0 ||
    quality.stalePricingCount > 0 ||
    quality.incompleteOutcomeCount > 0 ||
    quality.pendingHumanDispositionCount > 0 ||
    quality.sourceDetailDeletedCount > 0 ||
    observedUsageCount < quality.runCount
  ) {
    return "partial";
  }

  return "complete";
}

/** Format a wire decimal without first coercing it through a binary float. */
export function formatAnalyticsDecimal(
  value: AnalyticsNonNegativeDecimal | string,
  maximumFractionDigits = 18,
): string {
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  const trimmedFraction = fractionPart.slice(0, maximumFractionDigits).replace(/0+$/, "");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmedFraction.length > 0 ? `${groupedInteger}.${trimmedFraction}` : groupedInteger;
}

export function formatAnalyticsMoney(
  value: AnalyticsNonNegativeDecimal | string,
  currency: AnalyticsCurrency | string,
): string {
  return `${formatAnalyticsDecimal(value)} ${currency}`;
}

export function formatRatio(value: number | null): string {
  if (value === null) return "Unknown";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "Unknown";
  if (milliseconds < 1_000) return `${milliseconds.toLocaleString()} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  if (milliseconds < 3_600_000) return `${(milliseconds / 60_000).toFixed(1)} min`;
  return `${(milliseconds / 3_600_000).toFixed(1)} hr`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function humanizeAnalyticsKey(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function confidenceLabel(confidence: AnalyticsConfidence): string {
  return confidence === "unknown"
    ? "Unknown confidence"
    : `${humanizeAnalyticsKey(confidence)} confidence`;
}
