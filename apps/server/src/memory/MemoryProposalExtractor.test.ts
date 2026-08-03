import {
  AgentHandoffId,
  AgentRunId,
  MemoryEntryId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  ProjectId,
  VerificationCheckDefinitionId,
  VerificationCheckRunId,
  VerificationGateId,
  VerificationRunId,
  type AgentHandoff,
  type CreateMemoryProposalInput,
  type MemoryEntry,
  type Mission,
  type VerificationCheckRun,
  type VerificationRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  annotateProposalContradictions,
  buildMissionMemoryProposalCandidates,
  findPotentialContradictions,
} from "./MemoryProposalExtractor.ts";

const now = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("proposal-project");
const missionId = MissionId.make("proposal-mission");
const taskId = MissionTaskId.make("proposal-task");

const mission: Mission = {
  id: missionId,
  projectId,
  title: "Remember the mission",
  description: "Extract reusable evidence.",
  status: "completed",
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: now,
  cancelledAt: null,
  teamSettings: {
    maximumConcurrentAgents: 2,
    maximumConcurrentWriteAgents: 1,
    defaultMaximumTaskAttempts: 3,
    autoStartReadyTasks: true,
    integrationMode: "manual",
  },
  schedulerStatus: "idle",
};

const handoff = (reconciliationStatus: AgentHandoff["reconciliationStatus"]): AgentHandoff => ({
  id: AgentHandoffId.make(`handoff-${reconciliationStatus}`),
  missionId,
  taskId,
  agentRunId: AgentRunId.make("proposal-run"),
  fromMissionAgentId: MissionAgentId.make("proposal-agent"),
  toMissionAgentId: null,
  summary: "Implemented the boundary.",
  decisions: [
    {
      decision: "Keep memory outside raw transcripts",
      reason: "api_key=sk-abcdefghijklmnopqrstuvwxyz must never be retained",
      impact: "Agent context uses reviewed evidence",
    },
  ],
  changedFiles: [],
  commandsRun: [],
  unresolvedProblems: ["Older sources still need a staleness refresh"],
  recommendedNextAction: "Review the proposals.",
  artifacts: [],
  reconciliationStatus,
  reconciledAt: reconciliationStatus === "pending" ? null : now,
  createdAt: now,
});

const verificationRun = {
  id: VerificationRunId.make("proposal-verification"),
  projectId,
  missionId,
  taskId,
  agentRunId: AgentRunId.make("proposal-run"),
  branchName: "agent/proposal-task",
  commitHash: "abc123",
  sourceFingerprint: "source-fingerprint",
  invalidatedAt: null,
  result: "passed",
  failureSummary: null,
} as VerificationRun;

const verificationCheck = {
  id: VerificationCheckRunId.make("proposal-check"),
  verificationRunId: verificationRun.id,
  gateId: VerificationGateId.make("proposal-gate"),
  checkDefinitionId: VerificationCheckDefinitionId.make("proposal-definition"),
  nameSnapshot: "Focused memory tests",
  commandSnapshot: "vp",
  argumentsSnapshot: ["test", "run", "memory"],
  result: "passed",
} as unknown as VerificationCheckRun;

const activeMemory = (branchName: string | null): MemoryEntry => ({
  id: MemoryEntryId.make(`memory-${branchName ?? "project"}`),
  scopeType: branchName === null ? "project" : "branch",
  scopeId: branchName === null ? projectId : branchName,
  projectId,
  branchName,
  missionId: null,
  taskId: null,
  type: "coding_convention",
  title: "Package manager",
  content: "Use npm.",
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

const proposal = (branchName: string | null): CreateMemoryProposalInput => ({
  scopeType: branchName === null ? "project" : "branch",
  scopeId: branchName === null ? projectId : branchName,
  projectId,
  branchName,
  missionId: null,
  taskId: null,
  proposedType: "coding_convention",
  proposedTitle: "Package manager",
  proposedContent: "Use pnpm.",
  proposedStructuredData: null,
  proposedTrustLevel: "supported",
  confidence: 0.8,
  extractionSource: "test",
  sources: [],
  expiresAt: null,
});

describe("MemoryProposalExtractor", () => {
  it("creates review-only, source-backed candidates from reconciled handoffs and verification", () => {
    const candidates = buildMissionMemoryProposalCandidates({
      mission,
      handoffs: [handoff("pending"), handoff("matched")],
      verification: [{ run: verificationRun, checks: [verificationCheck] }],
    });

    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.proposedType)).toEqual([
      "architecture_decision",
      "known_issue",
      "test_procedure",
    ]);
    expect(candidates.every((candidate) => candidate.scopeType === "mission")).toBe(true);
    expect(candidates.every((candidate) => candidate.sources.length === 1)).toBe(true);
    expect(candidates.map((candidate) => candidate.sources[0]?.sourceType)).toEqual([
      "agent_handoff",
      "agent_handoff",
      "verification_result",
    ]);
    expect(candidates[2]?.proposedTrustLevel).toBe("verified");
    expect(JSON.stringify(candidates)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(candidates)).toContain("[REDACTED]");
  });

  it("flags overlapping claims but treats separate branches as separate scopes", () => {
    expect(findPotentialContradictions(proposal(null), [activeMemory(null)])).toHaveLength(1);
    expect(
      findPotentialContradictions(proposal("feature/a"), [activeMemory(null)])[0],
    ).toMatchObject({ relationship: "narrower_scope_exception" });
    expect(findPotentialContradictions(proposal("feature/a"), [activeMemory("feature/b")])).toEqual(
      [],
    );
    expect(
      annotateProposalContradictions(proposal("feature/a"), [activeMemory(null)])
        .proposedStructuredData,
    ).toMatchObject({
      contradictionCandidates: [
        {
          memoryEntryId: MemoryEntryId.make("memory-project"),
          relationship: "narrower_scope_exception",
          scopeType: "project",
        },
      ],
    });
  });
});
