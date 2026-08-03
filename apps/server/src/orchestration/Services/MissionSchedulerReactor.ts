import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface MissionSchedulerReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class MissionSchedulerReactor extends Context.Service<
  MissionSchedulerReactor,
  MissionSchedulerReactorShape
>()("t3/orchestration/Services/MissionSchedulerReactor") {}
