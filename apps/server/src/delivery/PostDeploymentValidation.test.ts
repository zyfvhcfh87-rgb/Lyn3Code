import { describe, expect, it } from "@effect/vitest";

import { runPostDeploymentValidation, type HttpProbe } from "./PostDeploymentValidation.ts";

const probe: HttpProbe = async () => ({
  status: 200,
  headers: { "x-release-version": "1.2.2" },
  body: "healthy",
});

describe("PostDeploymentValidation", () => {
  it("does not turn provider success into delivery success when validation fails", async () => {
    const result = await runPostDeploymentValidation({
      providerStatus: "succeeded",
      probe,
      checks: [
        {
          id: "release-version",
          kind: "version",
          url: "https://example.test/version?region=eu",
          expectedVersion: "1.2.3",
          responseHeader: "x-release-version",
        },
      ],
    });

    expect(result.status).toBe("validation_failed");
    expect(result.durableStatus).toBe("failed");
    expect(result.checks[0]).toMatchObject({ status: "failed", httpStatus: 200 });
    expect(result.checks[0]?.url).toBe("https://example.test/version");
    expect(result.checks[0]?.url).not.toContain("region=eu");
  });

  it("bounds validation plans and refuses insecure non-loopback endpoints", async () => {
    const insecure = await runPostDeploymentValidation({
      providerStatus: "succeeded",
      probe,
      checks: [
        {
          id: "health",
          kind: "http",
          url: "http://example.test/health",
          expectedStatuses: [200],
        },
      ],
    });
    expect(insecure.status).toBe("validation_failed");
    expect(insecure.checks[0]?.detail).toContain("requires HTTPS");

    const oversized = await runPostDeploymentValidation({
      providerStatus: "succeeded",
      probe,
      checks: Array.from({ length: 17 }, (_, index) => ({
        id: `check-${index}`,
        kind: "http" as const,
        url: "https://example.test/health",
        expectedStatuses: [200],
      })),
    });
    expect(oversized.status).toBe("validation_failed");
    expect(oversized.checks).toHaveLength(1);
  });

  it("never runs post-deployment checks before provider success", async () => {
    let calls = 0;
    const result = await runPostDeploymentValidation({
      providerStatus: "running",
      checks: [],
      probe: async (input) => {
        calls += 1;
        return probe(input);
      },
    });
    expect(result.status).toBe("provider_incomplete");
    expect(calls).toBe(0);
  });
});
