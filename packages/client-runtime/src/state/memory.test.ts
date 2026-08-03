import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";

import {
  buildMemoryListFilter,
  describesRemoteCodeUpload,
  EMPTY_MEMORY_FILTER_SELECTION,
} from "./memory.ts";

const projectId = ProjectId.make("project-1");

describe("buildMemoryListFilter", () => {
  it("applies section defaults while preserving project isolation", () => {
    expect(
      buildMemoryListFilter({
        projectId,
        section: "architecture",
        query: "  preload bridge  ",
      }),
    ).toMatchObject({
      projectId,
      types: ["architecture_decision"],
      statuses: ["active"],
      query: "preload bridge",
      staleOnly: false,
    });
  });

  it("lets explicit filters override section defaults", () => {
    expect(
      buildMemoryListFilter({
        projectId,
        section: "known_issues",
        query: "",
        selection: {
          ...EMPTY_MEMORY_FILTER_SELECTION,
          scopeType: "branch",
          type: "constraint",
          status: "disputed",
          trust: "verified",
          sourceType: "repository_file",
          branchName: "agent/mission/task",
        },
      }),
    ).toMatchObject({
      scopeTypes: ["branch"],
      types: ["constraint"],
      statuses: ["disputed"],
      trustLevels: ["verified"],
      sourceTypes: ["repository_file"],
      branchName: "agent/mission/task",
    });
  });

  it("always asks the server for stale-only results in the stale section", () => {
    expect(buildMemoryListFilter({ projectId, section: "stale", query: "" })).toMatchObject({
      statuses: ["stale"],
      staleOnly: true,
    });
  });
});

describe("describesRemoteCodeUpload", () => {
  it("requires affirmative consent only for enabled remote embeddings", () => {
    expect(
      describesRemoteCodeUpload({
        semanticRetrievalEnabled: true,
        embeddingProviderKind: "remote",
        remoteCodeUploadAcceptedAt: null,
      }),
    ).toBe("consent_required");
    expect(
      describesRemoteCodeUpload({
        semanticRetrievalEnabled: true,
        embeddingProviderKind: "local",
        remoteCodeUploadAcceptedAt: null,
      }),
    ).toBe("not_applicable");
  });
});
