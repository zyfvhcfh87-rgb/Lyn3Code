import { describe, expect, it } from "@effect/vitest";
import { IsoDateTime, MemoryEntryId, ProjectId, type MemoryEntry } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { MemoryEntryList } from "./MemoryEntryPanels";

const entry: MemoryEntry = {
  id: MemoryEntryId.make("memory-1"),
  scopeType: "project",
  scopeId: "project-1",
  projectId: ProjectId.make("project-1"),
  branchName: null,
  missionId: null,
  taskId: null,
  type: "architecture_decision",
  title: "Use the preload bridge",
  content: "Desktop filesystem access stays behind the preload bridge.",
  structuredData: null,
  trustLevel: "verified",
  status: "active",
  confidence: 0.96,
  createdByType: "user",
  createdById: null,
  creationMode: "explicit",
  pinned: true,
  createdAt: IsoDateTime.make("2026-08-03T20:00:00.000Z"),
  updatedAt: IsoDateTime.make("2026-08-03T20:00:00.000Z"),
  lastVerifiedAt: IsoDateTime.make("2026-08-03T20:00:00.000Z"),
  expiresAt: null,
  supersededById: null,
  contradictionGroupId: null,
  staleReason: null,
};

describe("MemoryEntryList", () => {
  it("makes scope, trust, status, confidence, and provenance access visible", () => {
    const markup = renderToStaticMarkup(
      <MemoryEntryList
        entries={[entry]}
        total={1}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Use the preload bridge");
    expect(markup).toContain("Project scope");
    expect(markup).toContain("Verified");
    expect(markup).toContain("Active");
    expect(markup).toContain("96% confidence");
    expect(markup).toContain("Open for provenance");
  });

  it("explains that empty memory views should remain source backed", () => {
    expect(
      renderToStaticMarkup(
        <MemoryEntryList
          entries={[]}
          total={0}
          selectedId={null}
          loading={false}
          error={null}
          onSelect={() => undefined}
        />,
      ),
    ).toContain("source-backed project fact");
  });
});
