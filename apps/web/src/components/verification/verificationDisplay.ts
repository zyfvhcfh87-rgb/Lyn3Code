import type {
  VerificationCheckRunStatus,
  VerificationIntegrationAuthorizationStatus,
  VerificationRunComparison,
  VerificationRunStatus,
} from "@t3tools/contracts";

export type VerificationDisplayStatus =
  | VerificationRunStatus
  | VerificationIntegrationAuthorizationStatus
  | VerificationCheckRunStatus;

const STATUS_LABELS: Readonly<Record<VerificationDisplayStatus, string>> = {
  not_required: "Not required",
  missing: "Verification missing",
  queued: "Verification queued",
  preparing: "Preparing verification",
  running: "Verification running",
  cancelling: "Cancelling verification",
  passed: "Verification passed",
  passed_with_warnings: "Passed with warnings",
  failed: "Verification failed",
  cancelled: "Verification cancelled",
  interrupted: "Verification interrupted",
  invalidated: "Verification invalidated",
  overridden: "Verification overridden",
  warned: "Passed with warning",
  skipped: "Skipped",
};

export const verificationStatusLabel = (status: VerificationDisplayStatus): string =>
  STATUS_LABELS[status];

export function verificationStatusVariant(status: VerificationDisplayStatus) {
  if (status === "passed" || status === "not_required") return "success" as const;
  if (status === "passed_with_warnings" || status === "overridden" || status === "warned") {
    return "warning" as const;
  }
  if (status === "queued" || status === "preparing" || status === "running") {
    return "info" as const;
  }
  if (status === "failed" || status === "invalidated") return "destructive" as const;
  if (status === "missing" || status === "interrupted" || status === "cancelled") {
    return "warning" as const;
  }
  return "outline" as const;
}

export const verificationComparisonRows = (comparison: VerificationRunComparison) =>
  [
    {
      label: "Now passing",
      value: comparison.previouslyFailingNowPassing.join(", ") || "None",
    },
    { label: "Newly failing", value: comparison.newlyFailing.join(", ") || "None" },
    {
      label: "No longer applicable",
      value: comparison.noLongerApplicable.join(", ") || "None",
    },
    {
      label: "Duration change",
      value:
        comparison.durationDeltaMilliseconds === null
          ? "Not comparable"
          : `${comparison.durationDeltaMilliseconds >= 0 ? "+" : ""}${comparison.durationDeltaMilliseconds} ms`,
    },
  ] as const;

export function resolveVerificationArtifactUrl(
  httpBaseUrl: string,
  relativeUrl: string,
): string | null {
  if (!relativeUrl.startsWith("/api/verification/artifacts/")) return null;
  try {
    const base = new URL(httpBaseUrl);
    const resolved = new URL(relativeUrl, base);
    return resolved.origin === base.origin && ["http:", "https:"].includes(resolved.protocol)
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}
