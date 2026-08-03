import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MissionTimeline } from "./MissionTimeline";

describe("MissionTimeline", () => {
  it("renders provider-neutral activity in stable sequence order", () => {
    const markup = renderToStaticMarkup(
      <MissionTimeline
        items={[
          {
            sequence: 20,
            type: "Mission completed",
            summary: "All work is complete.",
            createdAt: "2026-08-03T12:00:00.000Z",
            tone: "success",
          },
          {
            sequence: 10,
            type: "Agent run started",
            summary: "The agent started task one.",
            createdAt: "2026-08-03T11:00:00.000Z",
            tone: "agent",
          },
        ]}
      />,
    );

    expect(markup.indexOf("Agent run started")).toBeLessThan(markup.indexOf("Mission completed"));
    expect(markup).not.toContain("providerPayload");
  });

  it("renders an explicit empty state", () => {
    expect(renderToStaticMarkup(<MissionTimeline items={[]} />)).toContain("No activity yet.");
  });
});
