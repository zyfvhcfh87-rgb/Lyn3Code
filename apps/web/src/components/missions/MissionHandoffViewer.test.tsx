import {
  AgentHandoffId,
  AgentRunId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  type AgentHandoff,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MissionHandoffViewer } from "./MissionHandoffViewer";

const handoff = {
  id: AgentHandoffId.make("handoff-1"),
  missionId: MissionId.make("mission-1"),
  taskId: MissionTaskId.make("task-1"),
  agentRunId: AgentRunId.make("run-1"),
  fromMissionAgentId: MissionAgentId.make("agent-1"),
  toMissionAgentId: null,
  summary: "Implemented the isolated task.",
  decisions: [
    { decision: "Keep the adapter boundary", reason: "It is the smallest seam", impact: "server" },
  ],
  changedFiles: [{ path: "src/task.ts", change: "modified", summary: "Added the task" }],
  commandsRun: [{ command: "vp test run", exitCode: 0, summary: "Tests passed" }],
  unresolvedProblems: ["Integration still needs approval."],
  recommendedNextAction: "Review and integrate the branch.",
  artifacts: [],
  reconciliationStatus: "matched",
  reconciledAt: "2026-08-03T12:00:00.000Z",
  createdAt: "2026-08-03T12:00:00.000Z",
} satisfies AgentHandoff;

describe("MissionHandoffViewer", () => {
  it("renders structured, Git-reconciled handoff evidence", () => {
    const markup = renderToStaticMarkup(<MissionHandoffViewer handoff={handoff} />);

    expect(markup).toContain("Implemented the isolated task");
    expect(markup).toContain("src/task.ts");
    expect(markup).toContain("vp test run");
    expect(markup).toContain("Integration still needs approval");
    expect(markup).toContain("Git matched");
  });
});
