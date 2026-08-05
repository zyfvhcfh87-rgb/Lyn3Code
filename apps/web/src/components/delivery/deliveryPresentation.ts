export type DeliveryTone = "neutral" | "info" | "success" | "warning" | "critical";

const SUCCESS_WORDS = [
  "approved",
  "complete",
  "completed",
  "connected",
  "passed",
  "ready",
  "succeeded",
];
const WARNING_WORDS = [
  "expired",
  "interrupted",
  "partial",
  "pending",
  "required",
  "running",
  "stale",
  "unknown",
];
const CRITICAL_WORDS = ["blocked", "disconnected", "failed", "rejected", "unavailable"];

export function humanizeDeliveryKey(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function deliveryTone(value: unknown): DeliveryTone {
  const normalized = String(value ?? "").toLowerCase();
  if (CRITICAL_WORDS.some((word) => normalized.includes(word))) {
    return "critical";
  }
  if (WARNING_WORDS.some((word) => normalized.includes(word))) {
    return "warning";
  }
  if (SUCCESS_WORDS.some((word) => normalized.includes(word))) {
    return "success";
  }
  return "neutral";
}

export function formatDeliveryTime(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "Time not recorded";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function shortIdentifier(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not recorded";
  }
  const text = String(value);
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

export function latestBy<T>(
  values: readonly T[],
  timestamp: (value: T) => string | null | undefined,
): T | undefined {
  return values.reduce<T | undefined>((latest, value) => {
    if (!latest) {
      return value;
    }
    return Date.parse(timestamp(value) ?? "") >= Date.parse(timestamp(latest) ?? "")
      ? value
      : latest;
  }, undefined);
}

export function metadataHas(
  metadata: Readonly<Record<string, unknown>>,
  keyPattern: RegExp,
  valuePattern: RegExp,
): boolean {
  return Object.entries(metadata).some(
    ([key, value]) => keyPattern.test(key) && valuePattern.test(String(value)),
  );
}
