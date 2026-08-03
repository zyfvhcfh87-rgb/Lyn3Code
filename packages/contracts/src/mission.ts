import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AgentRunId,
  IsoDateTime,
  MissionId,
  MissionTaskId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const MissionStatus = Schema.Literals([
  "backlog",
  "planning",
  "ready",
  "running",
  "verification",
  "review",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
export type MissionStatus = typeof MissionStatus.Type;

export const MissionTaskStatus = Schema.Literals([
  "backlog",
  "ready",
  "running",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
export type MissionTaskStatus = typeof MissionTaskStatus.Type;

export const AgentRunStatus = Schema.Literals([
  "starting",
  "running",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type AgentRunStatus = typeof AgentRunStatus.Type;

export const Mission = Schema.Struct({
  id: MissionId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: MissionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
});
export type Mission = typeof Mission.Type;

export const MissionTask = Schema.Struct({
  id: MissionTaskId,
  missionId: MissionId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  status: MissionTaskStatus,
  position: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type MissionTask = typeof MissionTask.Type;

export const AgentRun = Schema.Struct({
  id: AgentRunId,
  missionId: MissionId,
  taskId: Schema.NullOr(MissionTaskId),
  threadId: ThreadId,
  provider: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  status: AgentRunStatus,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  errorSummary: Schema.NullOr(TrimmedNonEmptyString),
});
export type AgentRun = typeof AgentRun.Type;

export const MissionTaskProgress = Schema.Struct({
  total: NonNegativeInt,
  completed: NonNegativeInt,
});
export type MissionTaskProgress = typeof MissionTaskProgress.Type;

export const MissionSummary = Schema.Struct({
  mission: Mission,
  taskProgress: MissionTaskProgress,
  activeAgentRun: Schema.NullOr(AgentRun),
  latestAgentRun: Schema.NullOr(AgentRun),
});
export type MissionSummary = typeof MissionSummary.Type;

export const MissionBoardSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projectId: Schema.NullOr(ProjectId),
  missions: Schema.Array(MissionSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  updatedAt: IsoDateTime,
});
export type MissionBoardSnapshot = typeof MissionBoardSnapshot.Type;

const missionTransitions: Readonly<Record<MissionStatus, ReadonlySet<MissionStatus>>> = {
  backlog: new Set(["planning", "ready", "running", "cancelled"]),
  planning: new Set(["backlog", "ready", "running", "blocked", "cancelled", "failed"]),
  ready: new Set(["backlog", "planning", "running", "blocked", "cancelled", "failed"]),
  running: new Set([
    "ready",
    "verification",
    "review",
    "blocked",
    "completed",
    "cancelled",
    "failed",
  ]),
  verification: new Set(["running", "review", "blocked", "completed", "cancelled", "failed"]),
  review: new Set(["running", "verification", "blocked", "completed", "cancelled", "failed"]),
  blocked: new Set(["planning", "ready", "running", "cancelled", "failed"]),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(["planning", "ready", "running", "cancelled"]),
};

const taskTransitions: Readonly<Record<MissionTaskStatus, ReadonlySet<MissionTaskStatus>>> = {
  backlog: new Set(["ready", "running", "cancelled"]),
  ready: new Set(["backlog", "running", "blocked", "cancelled", "failed"]),
  running: new Set(["ready", "blocked", "completed", "cancelled", "failed"]),
  blocked: new Set(["ready", "running", "cancelled", "failed"]),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(["ready", "running", "cancelled"]),
};

const agentRunTransitions: Readonly<Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>> = {
  starting: new Set(["running", "cancelling", "completed", "cancelled", "failed", "interrupted"]),
  running: new Set(["cancelling", "completed", "cancelled", "failed", "interrupted"]),
  cancelling: new Set(["cancelled", "failed", "interrupted"]),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  interrupted: new Set(),
};

export const canTransitionMission = (from: MissionStatus, to: MissionStatus): boolean =>
  from === to || missionTransitions[from].has(to);

export const canTransitionMissionTask = (from: MissionTaskStatus, to: MissionTaskStatus): boolean =>
  from === to || taskTransitions[from].has(to);

export const canTransitionAgentRun = (from: AgentRunStatus, to: AgentRunStatus): boolean =>
  from === to || agentRunTransitions[from].has(to);

export const isActiveAgentRunStatus = (status: AgentRunStatus): boolean =>
  status === "starting" || status === "running" || status === "cancelling";

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
  status === "completed" ||
  status === "cancelled" ||
  status === "failed" ||
  status === "interrupted";
