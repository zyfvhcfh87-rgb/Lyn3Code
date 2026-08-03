import {
  AgentRunId,
  MissionAgentId,
  MissionId,
  MissionTaskId,
  TaskDependencyId,
} from "@t3tools/contracts";

import { randomUUID } from "./utils";

export const newMissionId = (): MissionId => MissionId.make(randomUUID());
export const newMissionTaskId = (): MissionTaskId => MissionTaskId.make(randomUUID());
export const newAgentRunId = (): AgentRunId => AgentRunId.make(randomUUID());
export const newMissionAgentId = (): MissionAgentId => MissionAgentId.make(randomUUID());
export const newTaskDependencyId = (): TaskDependencyId => TaskDependencyId.make(randomUUID());
