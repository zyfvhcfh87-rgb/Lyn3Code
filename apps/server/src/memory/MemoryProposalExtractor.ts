import {
  MemoryAggregateId,
  type AgentHandoff,
  type CreateMemoryProposalInput,
  type MemoryEntry,
  type MemoryProposal,
  type MemorySourceDraft,
  type Mission,
  type MissionId,
  type VerificationCheckRun,
  type VerificationRun,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionMissionRepository } from "../persistence/Services/ProjectionMissions.ts";
import { ProjectionMissionTeamRepository } from "../persistence/Services/ProjectionMissionTeams.ts";
import { ProjectionVerificationRunRepository } from "../persistence/Services/ProjectionVerificationRuns.ts";
import {
  ProjectionMemoryRepository,
  type ProjectionMemoryRepositoryError,
} from "../persistence/Services/ProjectionMemory.ts";
import { forkParked } from "../serverActivation.ts";
import { MemoryEventRecorder } from "./MemoryEventRecorder.ts";
import { redactMemorySourceText } from "./MemorySourceSecurity.ts";

const TERMINAL_MISSION_STATUSES = new Set<Mission["status"]>(["completed", "failed", "cancelled"]);

export interface VerificationProposalEvidence {
  readonly run: VerificationRun;
  readonly checks: ReadonlyArray<VerificationCheckRun>;
}

export interface MissionProposalEvidence {
  readonly mission: Mission;
  readonly handoffs: ReadonlyArray<AgentHandoff>;
  readonly verification: ReadonlyArray<VerificationProposalEvidence>;
}

const bounded = (value: string, maximum: number) => value.trim().slice(0, maximum);
const normalized = (value: string) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
const claimKey = (proposal: CreateMemoryProposalInput) =>
  `${normalized(proposal.proposedTitle)}\u0000${normalized(proposal.proposedContent)}`;

const safeText = (value: string, maximum = 64_000) =>
  bounded(redactMemorySourceText(value).content, maximum);

const emptySource = (): Omit<MemorySourceDraft, "sourceType" | "sourceIdentifier"> => ({
  projectId: null,
  repositoryPath: null,
  filePath: null,
  startLine: null,
  endLine: null,
  commitHash: null,
  branchName: null,
  missionId: null,
  taskId: null,
  agentRunId: null,
  verificationRunId: null,
  githubRecordType: null,
  githubRecordId: null,
  messageReference: null,
  contentFingerprint: null,
});

const handoffSource = (mission: Mission, handoff: AgentHandoff): MemorySourceDraft => ({
  ...emptySource(),
  sourceType: "agent_handoff",
  sourceIdentifier: handoff.id,
  projectId: mission.projectId,
  missionId: mission.id,
  taskId: handoff.taskId,
  agentRunId: handoff.agentRunId,
});

const verificationSource = (run: VerificationRun): MemorySourceDraft => ({
  ...emptySource(),
  sourceType: "verification_result",
  sourceIdentifier: run.id,
  projectId: run.projectId,
  branchName: run.branchName,
  missionId: run.missionId,
  taskId: run.taskId,
  agentRunId: run.agentRunId,
  verificationRunId: run.id,
  commitHash: run.commitHash,
  contentFingerprint: run.sourceFingerprint,
});

const missionProposal = (
  mission: Mission,
  input: Omit<
    CreateMemoryProposalInput,
    "scopeType" | "scopeId" | "projectId" | "branchName" | "missionId" | "taskId" | "expiresAt"
  >,
): CreateMemoryProposalInput => ({
  scopeType: "mission",
  scopeId: mission.id,
  projectId: mission.projectId,
  branchName: null,
  missionId: mission.id,
  taskId: null,
  expiresAt: null,
  ...input,
});

/** Deterministic evidence extraction only. It never consumes chat transcripts or hidden reasoning. */
export const buildMissionMemoryProposalCandidates = (
  evidence: MissionProposalEvidence,
): ReadonlyArray<CreateMemoryProposalInput> => {
  const proposals: Array<CreateMemoryProposalInput> = [];
  for (const handoff of evidence.handoffs) {
    if (handoff.reconciliationStatus === "pending") continue;
    const source = handoffSource(evidence.mission, handoff);
    for (const decision of handoff.decisions) {
      const title = safeText(decision.decision, 500);
      const content = safeText(
        `${decision.decision}\nReason: ${decision.reason}\nImpact: ${decision.impact}`,
      );
      if (title.length === 0 || content.length === 0) continue;
      proposals.push(
        missionProposal(evidence.mission, {
          proposedType: "architecture_decision",
          proposedTitle: title,
          proposedContent: content,
          proposedStructuredData: {
            evidenceKind: "reconciled_handoff_decision",
            reconciliationStatus: handoff.reconciliationStatus,
          },
          proposedTrustLevel: "supported",
          confidence: handoff.reconciliationStatus === "matched" ? 0.85 : 0.75,
          extractionSource: "mission_terminal:agent_handoff",
          sources: [source],
        }),
      );
    }
    for (const problem of handoff.unresolvedProblems) {
      const content = safeText(problem);
      if (content.length === 0) continue;
      proposals.push(
        missionProposal(evidence.mission, {
          proposedType: "known_issue",
          proposedTitle: bounded(`Known issue: ${content}`, 500),
          proposedContent: content,
          proposedStructuredData: { evidenceKind: "reconciled_handoff_problem" },
          proposedTrustLevel: "supported",
          confidence: 0.7,
          extractionSource: "mission_terminal:agent_handoff",
          sources: [source],
        }),
      );
    }
  }
  for (const { run, checks } of evidence.verification) {
    if (run.invalidatedAt !== null || run.missionId !== evidence.mission.id) continue;
    const source = verificationSource(run);
    for (const check of checks) {
      if (check.result === "passed" || check.result === "warned") {
        const command = safeText(
          [check.commandSnapshot, ...check.argumentsSnapshot].join(" "),
          16_000,
        );
        if (command.length === 0) continue;
        proposals.push(
          missionProposal(evidence.mission, {
            proposedType: "test_procedure",
            proposedTitle: bounded(`Verified procedure: ${check.nameSnapshot}`, 500),
            proposedContent: `Run this verified check: ${command}`,
            proposedStructuredData: {
              evidenceKind: "passing_verification_check",
              result: check.result,
              sourceFingerprint: run.sourceFingerprint,
            },
            proposedTrustLevel: "verified",
            confidence: check.result === "passed" ? 0.95 : 0.8,
            extractionSource: "mission_terminal:verification_result",
            sources: [source],
          }),
        );
      }
    }
    if (run.result === "failed" && run.failureSummary !== null) {
      const failure = safeText(run.failureSummary);
      if (failure.length > 0) {
        proposals.push(
          missionProposal(evidence.mission, {
            proposedType: "known_issue",
            proposedTitle: bounded(`Verification failure: ${failure}`, 500),
            proposedContent: failure,
            proposedStructuredData: {
              evidenceKind: "failed_verification_run",
              sourceFingerprint: run.sourceFingerprint,
            },
            proposedTrustLevel: "supported",
            confidence: 0.8,
            extractionSource: "mission_terminal:verification_result",
            sources: [source],
          }),
        );
      }
    }
  }
  const deduplicated = new Map<string, CreateMemoryProposalInput>();
  for (const proposal of proposals) {
    const key = claimKey(proposal);
    if (!deduplicated.has(key)) deduplicated.set(key, proposal);
  }
  return [...deduplicated.values()];
};

export interface ContradictionCandidate {
  readonly memory: MemoryEntry;
  readonly relationship: "overlapping_scope" | "narrower_scope_exception";
}

const scopeDepth: Record<MemoryEntry["scopeType"], number> = {
  user: 1,
  project: 2,
  branch: 3,
  mission: 4,
  task: 5,
};

const scopesCanConflict = (proposal: CreateMemoryProposalInput, memory: MemoryEntry) => {
  if (memory.projectId !== null && memory.projectId !== proposal.projectId) return false;
  if (
    proposal.branchName !== null &&
    memory.branchName !== null &&
    proposal.branchName !== memory.branchName
  ) {
    return false;
  }
  if (
    proposal.missionId !== null &&
    memory.missionId !== null &&
    proposal.missionId !== memory.missionId
  ) {
    return false;
  }
  if (proposal.taskId !== null && memory.taskId !== null && proposal.taskId !== memory.taskId) {
    return false;
  }
  return true;
};

/** Finds review candidates; it never marks either claim disputed automatically. */
export const findPotentialContradictions = (
  proposal: CreateMemoryProposalInput,
  memories: ReadonlyArray<MemoryEntry>,
): ReadonlyArray<ContradictionCandidate> =>
  memories
    .filter(
      (memory) =>
        memory.status === "active" &&
        normalized(memory.title) === normalized(proposal.proposedTitle) &&
        normalized(memory.content) !== normalized(proposal.proposedContent) &&
        scopesCanConflict(proposal, memory),
    )
    .map(
      (memory): ContradictionCandidate => ({
        memory,
        relationship:
          scopeDepth[proposal.scopeType] === scopeDepth[memory.scopeType]
            ? "overlapping_scope"
            : "narrower_scope_exception",
      }),
    )
    .sort((left, right) => left.memory.id.localeCompare(right.memory.id));

/** Adds inspectable review hints without changing either claim's lifecycle state. */
export const annotateProposalContradictions = (
  proposal: CreateMemoryProposalInput,
  memories: ReadonlyArray<MemoryEntry>,
): CreateMemoryProposalInput => {
  const contradictions = findPotentialContradictions(proposal, memories);
  if (contradictions.length === 0) return proposal;
  const existingStructuredData =
    typeof proposal.proposedStructuredData === "object" &&
    proposal.proposedStructuredData !== null &&
    !Array.isArray(proposal.proposedStructuredData)
      ? proposal.proposedStructuredData
      : { extractedEvidence: proposal.proposedStructuredData };
  return {
    ...proposal,
    proposedStructuredData: {
      ...existingStructuredData,
      contradictionCandidates: contradictions.map((candidate) => ({
        memoryEntryId: candidate.memory.id,
        relationship: candidate.relationship,
        scopeType: candidate.memory.scopeType,
        branchName: candidate.memory.branchName,
        trustLevel: candidate.memory.trustLevel,
      })),
    },
  };
};

export interface MemoryProposalExtractorShape {
  readonly generateForMission: (
    missionId: MissionId,
  ) => Effect.Effect<ReadonlyArray<MemoryProposal>, ProjectionMemoryRepositoryError>;
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class MemoryProposalExtractor extends Context.Service<
  MemoryProposalExtractor,
  MemoryProposalExtractorShape
>()("t3/memory/MemoryProposalExtractor") {}

const make = Effect.gen(function* () {
  const missions = yield* ProjectionMissionRepository;
  const teams = yield* ProjectionMissionTeamRepository;
  const verification = yield* ProjectionVerificationRunRepository;
  const memory = yield* ProjectionMemoryRepository;
  const engine = yield* OrchestrationEngineService;
  const eventRecorder = yield* Effect.serviceOption(MemoryEventRecorder);

  const generateForMission = Effect.fn("MemoryProposalExtractor.generateForMission")(function* (
    missionId: MissionId,
  ) {
    const missionOption = yield* missions.getById({ missionId });
    if (
      Option.isNone(missionOption) ||
      !TERMINAL_MISSION_STATUSES.has(missionOption.value.status)
    ) {
      return [];
    }
    const mission = missionOption.value;
    const settings = yield* memory.getOrCreateSettings(mission.projectId);
    if (!settings.enabled || !settings.automaticProposalGeneration) return [];
    const [handoffs, projectRuns, existing, activeMemories] = yield* Effect.all([
      teams.listAgentHandoffsByMissionId({ missionId }),
      verification.listRunsByProjectId({ projectId: mission.projectId }),
      memory.listProposals({
        projectId: mission.projectId,
        statuses: [
          "pending",
          "accepted",
          "edited_and_accepted",
          "rejected",
          "expired",
          "duplicate",
          "deferred",
        ],
        limit: 10_000,
        offset: 0,
      }),
      memory.listEntries({
        projectId: mission.projectId,
        scopeTypes: ["project", "branch", "mission", "task"],
        types: [],
        statuses: ["active"],
        trustLevels: [],
        sourceTypes: [],
        branchName: null,
        missionId: null,
        taskId: null,
        query: "",
        createdAfter: null,
        staleOnly: false,
        pinnedOnly: false,
        limit: 10_000,
        offset: 0,
      }),
    ]);
    const missionRuns = projectRuns.filter((run) => run.missionId === mission.id);
    const verificationEvidence = yield* Effect.forEach(
      missionRuns,
      (run) =>
        verification
          .listCheckRunsByRunId({ verificationRunId: run.id })
          .pipe(Effect.map((checks) => ({ run, checks }))),
      { concurrency: 4 },
    );
    const existingKeys = new Set(
      existing.map((proposal) =>
        claimKey({
          scopeType: proposal.scopeType,
          scopeId: proposal.scopeId,
          projectId: proposal.projectId,
          branchName: proposal.branchName,
          missionId: proposal.missionId,
          taskId: proposal.taskId,
          proposedType: proposal.proposedType,
          proposedTitle: proposal.proposedTitle,
          proposedContent: proposal.proposedContent,
          proposedStructuredData: proposal.proposedStructuredData,
          proposedTrustLevel: proposal.proposedTrustLevel,
          confidence: proposal.confidence,
          extractionSource: proposal.extractionSource,
          sources: [],
          expiresAt: proposal.expiresAt,
        }),
      ),
    );
    const candidates = buildMissionMemoryProposalCandidates({
      mission,
      handoffs,
      verification: verificationEvidence,
    })
      .filter((candidate) => !existingKeys.has(claimKey(candidate)))
      .map((candidate) => annotateProposalContradictions(candidate, activeMemories));
    const created = yield* Effect.forEach(
      candidates,
      (candidate) =>
        memory.createProposal(candidate).pipe(
          Effect.tap((proposal) =>
            Option.isNone(eventRecorder)
              ? Effect.void
              : eventRecorder.value
                  .record({
                    eventType: "memory.proposal_created",
                    aggregateId: MemoryAggregateId.make(`proposal:${proposal.id}`),
                    projectId: proposal.projectId,
                    missionId: proposal.missionId,
                    taskId: proposal.taskId,
                    proposalId: proposal.id,
                    summary: "Source-backed memory proposal created from terminal mission evidence",
                  })
                  .pipe(Effect.ignoreCause({ log: true })),
          ),
          Effect.catchTag("MemoryConflictError", () => Effect.succeed(null)),
        ),
      { concurrency: 1 },
    );
    return created.filter((proposal): proposal is MemoryProposal => proposal !== null);
  });

  const processMissionSafely = (missionId: MissionId) =>
    generateForMission(missionId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("memory proposal extraction failed", {
          missionId,
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.asVoid,
    );
  const worker = yield* makeDrainableWorker(processMissionSafely);
  const start: MemoryProposalExtractorShape["start"] = Effect.gen(function* () {
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "mission.completed" ||
        event.type === "mission.failed" ||
        event.type === "mission.cancelled"
          ? worker.enqueue(event.payload.missionId)
          : Effect.void,
      ),
    );
    const terminalMissions = yield* missions.listAll().pipe(
      Effect.map((all) => all.filter((mission) => TERMINAL_MISSION_STATUSES.has(mission.status))),
      Effect.catchCause((cause) =>
        Effect.logWarning("memory proposal recovery scan failed", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as([] as ReadonlyArray<Mission>)),
      ),
    );
    yield* Effect.forEach(terminalMissions, (mission) => worker.enqueue(mission.id), {
      concurrency: 1,
      discard: true,
    });
  });
  return MemoryProposalExtractor.of({ generateForMission, start, drain: worker.drain });
});

export const MemoryProposalExtractorLive = Layer.effect(MemoryProposalExtractor, make);
