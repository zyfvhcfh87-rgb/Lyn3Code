import {
  AgentRunId,
  MissionAgentId,
  MissionId,
  ProviderDriverKind,
  type AgentRun,
  type MissionAgent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import {
  classifyRunCompletion,
  countNewProviderRequest,
  deriveParentAgentRunId,
  estimateTokensFromCharacterCount,
  providerCostDecimal,
  recoveredRunCompletion,
  summarizeMemoryRetrievals,
  toolMetricCategory,
  usageSourceForProvider,
} from "./UsageAnalyticsLifecycle.ts";

const missionId = MissionId.make("mission-run-tree");
const coordinatorAgentId = MissionAgentId.make("agent-coordinator");
const implementerOneId = MissionAgentId.make("agent-implementer-one");
const implementerTwoId = MissionAgentId.make("agent-implementer-two");

const missionAgent = (id: MissionAgentId, roleKind: MissionAgent["roleKind"]): MissionAgent =>
  ({ id, missionId, roleKind }) as MissionAgent;

const agentRun = (id: string, missionAgentId: MissionAgentId, startedAt: string): AgentRun =>
  ({
    id: AgentRunId.make(id),
    missionId,
    missionAgentId,
    taskId: null,
    startedAt,
  }) as AgentRun;

const terminal = (
  type:
    | "agent_run.completed"
    | "agent_run.failed"
    | "agent_run.cancelled"
    | "agent_run.interrupted",
  runtimeErrorClass?:
    | "provider_error"
    | "transport_error"
    | "permission_error"
    | "validation_error"
    | "unknown",
) =>
  ({
    type,
    eventId: "event-1",
    aggregateKind: "mission",
    aggregateId: "mission-1",
    aggregateVersion: 1,
    globalSequence: 1,
    occurredAt: "2026-08-04T12:00:00.000Z",
    payload: {
      missionId: "mission-1",
      taskId: null,
      agentRunId: "run-1",
      occurredAt: "2026-08-04T12:00:00.000Z",
      runtimeErrorClass: runtimeErrorClass ?? null,
    },
  }) as unknown as Parameters<typeof classifyRunCompletion>[0];

it("distinguishes provider, transport, source, and permission failures", () => {
  assert.strictEqual(
    classifyRunCompletion(terminal("agent_run.failed", "provider_error")),
    "failed_provider",
  );
  assert.strictEqual(
    classifyRunCompletion(terminal("agent_run.failed", "transport_error")),
    "failed_transport",
  );
  assert.strictEqual(
    classifyRunCompletion(terminal("agent_run.failed", "validation_error")),
    "failed_source",
  );
  assert.strictEqual(
    classifyRunCompletion(terminal("agent_run.failed", "permission_error")),
    "permission_blocked",
  );
  assert.strictEqual(classifyRunCompletion(terminal("agent_run.completed")), "completed");
});

it("keeps recovered failures unknown when their runtime error class is unavailable", () => {
  assert.strictEqual(recoveredRunCompletion("completed"), "completed");
  assert.strictEqual(recoveredRunCompletion("cancelled"), "cancelled");
  assert.strictEqual(recoveredRunCompletion("interrupted"), "interrupted");
  assert.strictEqual(recoveredRunCompletion("failed"), "unknown");
});

it("keeps provider cost decimal and rejects invalid amounts", () => {
  assert.strictEqual(providerCostDecimal(0.000001), "0.000001");
  assert.strictEqual(providerCostDecimal(1.25), "1.25");
  assert.strictEqual(providerCostDecimal(Number.NaN), null);
  assert.strictEqual(providerCostDecimal(-1), null);
});

it("classifies only operational tool lifecycle items", () => {
  assert.strictEqual(toolMetricCategory("command_execution"), "command");
  assert.strictEqual(toolMetricCategory("file_change"), "file_write");
  assert.strictEqual(toolMetricCategory("assistant_message"), null);
});

it("keeps provider reports distinct from adapter-normalized provider coverage", () => {
  assert.strictEqual(usageSourceForProvider(ProviderDriverKind.make("codex")), "provider_reported");
  assert.strictEqual(
    usageSourceForProvider(ProviderDriverKind.make("claude")),
    "provider_reported",
  );
  assert.strictEqual(
    usageSourceForProvider(ProviderDriverKind.make("cursor")),
    "adapter_calculated",
  );
  assert.strictEqual(usageSourceForProvider(ProviderDriverKind.make("grok")), "adapter_calculated");
  assert.strictEqual(
    usageSourceForProvider(ProviderDriverKind.make("opencode")),
    "adapter_calculated",
  );
});

it("counts one provider request across repeated streaming usage frames", () => {
  const seen = new Set<string>();
  assert.strictEqual(countNewProviderRequest(seen, "turn-1"), 1);
  assert.strictEqual(countNewProviderRequest(seen, "turn-1"), 0);
  assert.strictEqual(countNewProviderRequest(seen, "turn-2"), 1);
});

it("labels only observed streamed characters as a low-confidence token estimate", () => {
  assert.strictEqual(estimateTokensFromCharacterCount(0), null);
  assert.strictEqual(estimateTokensFromCharacterCount(1), 1);
  assert.strictEqual(estimateTokensFromCharacterCount(8), 2);
  assert.strictEqual(estimateTokensFromCharacterCount(9), 3);
});

it("summarizes memory references and failures without retaining retrieved content", () => {
  const records = [
    {
      tokenEstimate: 120,
      selectedMemoryIds: ["memory-1", "memory-2"],
      selectedChunkIds: ["chunk-1"],
      status: "completed",
    },
    {
      tokenEstimate: 0,
      selectedMemoryIds: [],
      selectedChunkIds: [],
      status: "failed",
    },
  ] as unknown as Parameters<typeof summarizeMemoryRetrievals>[0];

  assert.deepStrictEqual(summarizeMemoryRetrievals(records), {
    retrievalCount: 2,
    memoryTokenEstimate: 120,
    selectedMemoryCount: 2,
    sourceChunkCount: 1,
    retrievalFailureCount: 1,
  });
});

it("derives one coordinator with two subagents from the durable mission team", () => {
  const coordinator = agentRun("run-coordinator", coordinatorAgentId, "2026-08-04T12:00:00.000Z");
  const subagentOne = agentRun("run-subagent-one", implementerOneId, "2026-08-04T12:00:01.000Z");
  const subagentTwo = agentRun("run-subagent-two", implementerTwoId, "2026-08-04T12:00:02.000Z");
  const relations = {
    runs: [coordinator, subagentOne, subagentTwo],
    missionAgents: [
      missionAgent(coordinatorAgentId, "coordinator"),
      missionAgent(implementerOneId, "implementer"),
      missionAgent(implementerTwoId, "researcher"),
    ],
    taskDependencies: [],
    handoffs: [],
  };

  assert.strictEqual(deriveParentAgentRunId({ run: coordinator, relations }), null);
  assert.strictEqual(deriveParentAgentRunId({ run: subagentOne, relations }), coordinator.id);
  assert.strictEqual(deriveParentAgentRunId({ run: subagentTwo, relations }), coordinator.id);
});
