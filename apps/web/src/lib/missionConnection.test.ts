import { describe, expect, it } from "vite-plus/test";

import { isMissionEnvironmentUnavailable } from "./missionConnection";

describe("mission connection state", () => {
  it("keeps loading while the environment catalog initializes", () => {
    expect(isMissionEnvironmentUnavailable(false, undefined)).toBe(false);
  });

  it("stops loading when the requested environment is absent from a ready catalog", () => {
    expect(isMissionEnvironmentUnavailable(true, undefined)).toBe(true);
  });

  it("allows initial connection and live connection states", () => {
    expect(isMissionEnvironmentUnavailable(true, "connecting")).toBe(false);
    expect(isMissionEnvironmentUnavailable(true, "connected")).toBe(false);
  });

  it("reports disconnected and reconnecting environments as unavailable without a snapshot", () => {
    expect(isMissionEnvironmentUnavailable(true, "disconnected")).toBe(true);
    expect(isMissionEnvironmentUnavailable(true, "reconnecting")).toBe(true);
  });
});
