import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface MissionRunReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class MissionRunReactor extends Context.Service<MissionRunReactor, MissionRunReactorShape>()(
  "t3/orchestration/Services/MissionRunReactor",
) {}
