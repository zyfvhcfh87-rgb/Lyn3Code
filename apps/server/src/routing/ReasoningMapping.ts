import type {
  ModelCapabilities,
  ProviderOptionSelection,
  RoutingReasoningLevel,
} from "@t3tools/contracts";

export const NORMALIZED_REASONING_LEVELS = ["low", "medium", "high", "extra_high"] as const;

export type NormalizedReasoningLevel = RoutingReasoningLevel;

const REASONING_OPTION_IDS = new Set(["effort", "reasoningEffort"]);

const exactNormalizedLevel = (value: string): RoutingReasoningLevel | null => {
  switch (value.trim().toLowerCase().replaceAll("-", "_")) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "extra_high":
    case "extrahigh":
    case "xhigh":
      return "extra_high";
    default:
      return null;
  }
};

export interface ReasoningLevelMapping {
  /** Null means the provider's default reasoning behavior. */
  readonly normalizedLevel: RoutingReasoningLevel | null;
  readonly supported: boolean;
  readonly providerSelections: ReadonlyArray<ProviderOptionSelection>;
  readonly reason: string | null;
}

/**
 * Map a normalized routing level to an explicitly advertised provider option.
 *
 * The mapping is intentionally exact. Values such as `max`, `ultra`, and
 * `ultrathink` are not guessed to mean `extra_high`; a provider-owned mapping
 * can add that knowledge later without changing the routing engine.
 */
export const mapReasoningLevel = (input: {
  /** Null preserves the provider default and emits no provider-specific option. */
  readonly level: RoutingReasoningLevel | null;
  readonly capabilities: ModelCapabilities | null;
}): ReasoningLevelMapping => {
  if (input.level === null) {
    return {
      normalizedLevel: null,
      supported: true,
      providerSelections: [],
      reason: null,
    };
  }

  const descriptor = input.capabilities?.optionDescriptors?.find(
    (candidate) => candidate.type === "select" && REASONING_OPTION_IDS.has(candidate.id),
  );
  if (descriptor?.type !== "select") {
    return {
      normalizedLevel: input.level,
      supported: false,
      providerSelections: [],
      reason: "The provider did not advertise a normalized reasoning control for this model.",
    };
  }

  const option = descriptor.options.find(
    (candidate) => exactNormalizedLevel(candidate.id) === input.level,
  );
  if (option === undefined) {
    return {
      normalizedLevel: input.level,
      supported: false,
      providerSelections: [],
      reason: `The provider did not advertise ${input.level} reasoning for this model.`,
    };
  }

  return {
    normalizedLevel: input.level,
    supported: true,
    providerSelections: [{ id: descriptor.id, value: option.id }],
    reason: null,
  };
};

/** Explicit levels only. An empty list means provider-default reasoning. */
export const listSupportedReasoningLevels = (
  capabilities: ModelCapabilities | null,
): ReadonlyArray<RoutingReasoningLevel> => {
  const descriptor = capabilities?.optionDescriptors?.find(
    (candidate) => candidate.type === "select" && REASONING_OPTION_IDS.has(candidate.id),
  );
  if (descriptor?.type !== "select") return [];

  const levels = new Set<RoutingReasoningLevel>();
  for (const option of descriptor.options) {
    const normalized = exactNormalizedLevel(option.id);
    if (normalized !== null) levels.add(normalized);
  }
  return NORMALIZED_REASONING_LEVELS.filter((level) => levels.has(level));
};
