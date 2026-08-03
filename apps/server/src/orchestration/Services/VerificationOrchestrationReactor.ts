import type { MissionTaskId, VerificationRunId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface VerificationOrchestrationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly cancel: (verificationRunId: VerificationRunId) => Effect.Effect<boolean>;
  readonly revalidateTask: (taskId: MissionTaskId) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export class VerificationOrchestrationReactor extends Context.Service<
  VerificationOrchestrationReactor,
  VerificationOrchestrationReactorShape
>()("t3/orchestration/Services/VerificationOrchestrationReactor") {}
