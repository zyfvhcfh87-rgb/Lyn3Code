import { AgentRunId, MissionId, MissionTaskId } from "@t3tools/contracts";

import { randomUUID } from "./utils";

export const newMissionId = (): MissionId => MissionId.make(randomUUID());
export const newMissionTaskId = (): MissionTaskId => MissionTaskId.make(randomUUID());
export const newAgentRunId = (): AgentRunId => AgentRunId.make(randomUUID());
