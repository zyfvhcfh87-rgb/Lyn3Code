import { describe, expect, it } from "@effect/vitest";
import type { ModelCapabilities } from "@t3tools/contracts";

import { listSupportedReasoningLevels, mapReasoningLevel } from "./ReasoningMapping.ts";

const capabilities: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "xhigh", label: "Extra high" },
        { id: "ultra", label: "Ultra" },
      ],
    },
  ],
};

describe("ReasoningMapping", () => {
  it("maps only exact normalized provider values", () => {
    expect(listSupportedReasoningLevels(capabilities)).toEqual(["low", "extra_high"]);
    expect(mapReasoningLevel({ level: "extra_high", capabilities })).toEqual({
      normalizedLevel: "extra_high",
      supported: true,
      providerSelections: [{ id: "effort", value: "xhigh" }],
      reason: null,
    });
  });

  it("does not guess that provider-specific superlatives mean extra high", () => {
    const ultraOnly: ModelCapabilities = {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [{ id: "ultra", label: "Ultra" }],
        },
      ],
    };
    expect(mapReasoningLevel({ level: "extra_high", capabilities: ultraOnly }).supported).toBe(
      false,
    );
  });

  it("represents provider default as null without fabricating an option", () => {
    expect(mapReasoningLevel({ level: null, capabilities: null })).toEqual({
      normalizedLevel: null,
      supported: true,
      providerSelections: [],
      reason: null,
    });
  });
});
