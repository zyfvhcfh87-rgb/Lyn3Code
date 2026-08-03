import { VerificationRunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveVerificationArtifactUrl,
  verificationComparisonRows,
  verificationStatusLabel,
  verificationStatusVariant,
} from "./verificationDisplay";

describe("verification display", () => {
  it("keeps interrupted, invalidated, skipped, and overridden states explicit", () => {
    expect(verificationStatusLabel("interrupted")).toBe("Verification interrupted");
    expect(verificationStatusLabel("invalidated")).toBe("Verification invalidated");
    expect(verificationStatusLabel("skipped")).toBe("Skipped");
    expect(verificationStatusLabel("overridden")).toBe("Verification overridden");
    expect(verificationStatusVariant("invalidated")).toBe("destructive");
    expect(verificationStatusVariant("overridden")).toBe("warning");
  });

  it("summarizes the material delta between two runs", () => {
    expect(
      verificationComparisonRows({
        previousRunId: VerificationRunId.make("previous"),
        currentRunId: VerificationRunId.make("current"),
        previouslyFailingNowPassing: ["Web typecheck"],
        newlyFailing: ["Unit tests"],
        noLongerApplicable: [],
        durationDeltaMilliseconds: 125,
      }),
    ).toEqual([
      { label: "Now passing", value: "Web typecheck" },
      { label: "Newly failing", value: "Unit tests" },
      { label: "No longer applicable", value: "None" },
      { label: "Duration change", value: "+125 ms" },
    ]);
  });

  it("only resolves managed artifact URLs on the environment origin", () => {
    expect(
      resolveVerificationArtifactUrl(
        "https://lyn.example/base",
        "/api/verification/artifacts/signed/report.xml",
      ),
    ).toBe("https://lyn.example/api/verification/artifacts/signed/report.xml");
    expect(
      resolveVerificationArtifactUrl("https://lyn.example", "https://evil.example/file"),
    ).toBeNull();
    expect(
      resolveVerificationArtifactUrl("https://lyn.example", "/api/assets/ambient/file"),
    ).toBeNull();
  });
});
