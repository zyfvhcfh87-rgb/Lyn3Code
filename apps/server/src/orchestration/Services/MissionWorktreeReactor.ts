import type { MissionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface MissionWorktreeReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileMission: (missionId: MissionId) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export class MissionWorktreeReactor extends Context.Service<
  MissionWorktreeReactor,
  MissionWorktreeReactorShape
>()("t3/orchestration/Services/MissionWorktreeReactor") {}
