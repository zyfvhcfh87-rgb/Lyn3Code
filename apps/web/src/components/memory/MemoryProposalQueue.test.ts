import { describe, expect, it } from "@effect/vitest";
import {
  IsoDateTime,
  MemoryEntryId,
  MemoryProposalId,
  ProjectId,
  type MemoryEntry,
  type MemoryProposal,
} from "@t3tools/contracts";

import { findMemoryProposalReviewHints } from "./MemoryProposalQueue";

const projectId = ProjectId.make("project-1");
const now = IsoDateTime.make("2026-08-03T20:00:00.000Z");

const memory = (id: string, content: string, branchName: string | null = null): MemoryEntry => ({
  id: MemoryEntryId.make(id),
  scopeType: branchName ? "branch" : "project",
  scopeId: branchName ?? projectId,
  projectId,
  branchName,
  missionId: null,
  taskId: null,
  type: "coding_convention",
  title: "Package manager",
  content,
  structuredData: null,
  trustLevel: "verified",
  status: "active",
  confidence: 1,
  createdByType: "user",
  createdById: null,
  creationMode: "explicit",
  pinned: false,
  createdAt: now,
  updatedAt: now,
  lastVerifiedAt: now,
  expiresAt: null,
  supersededById: null,
  contradictionGroupId: null,
  staleReason: null,
});

const proposal: MemoryProposal = {
  id: MemoryProposalId.make("proposal-1"),
  scopeType: "branch",
  scopeId: "feature/a",
  projectId,
  branchName: "feature/a",
  missionId: null,
  taskId: null,
  proposedType: "coding_convention",
  proposedTitle: "Package manager",
  proposedContent: "Use pnpm.",
  proposedStructuredData: null,
  proposedTrustLevel: "supported",
  confidence: 0.8,
  extractionSource: "test",
  sourceReferences: [],
  status: "pending",
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  duplicateOfMemoryEntryId: null,
  acceptedMemoryEntryId: null,
  createdAt: now,
  expiresAt: null,
};

describe("findMemoryProposalReviewHints", () => {
  it("shows duplicates and scoped contradictions without leaking other branches", () => {
    const hints = findMemoryProposalReviewHints(proposal, [
      memory("duplicate", "  Use   pnpm.  "),
      memory("project-conflict", "Use npm."),
      memory("other-branch", "Use yarn.", "feature/b"),
    ]);

    expect(hints.duplicateIds).toEqual([MemoryEntryId.make("duplicate")]);
    expect(hints.contradictions).toEqual([
      {
        id: MemoryEntryId.make("project-conflict"),
        relationship: "narrower_scope_exception",
      },
    ]);
  });
});
