import {
  CommandId,
  type GitHubAccountId,
  type GitHubIssueRecordId,
  type GitHubOrchestrationEventType,
  type MissionId,
  type MissionTaskId,
  type ProjectId,
  type PullRequestRecordId,
  type RepositoryConnectionId,
  type ReviewCommentRecordId,
  type ReviewThreadRecordId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

export interface GitHubEventReference {
  readonly eventType: GitHubOrchestrationEventType;
  readonly projectId: ProjectId;
  readonly missionId?: MissionId | null;
  readonly taskId?: MissionTaskId | null;
  readonly accountId?: GitHubAccountId | null;
  readonly repositoryConnectionId?: RepositoryConnectionId | null;
  readonly issueRecordId?: GitHubIssueRecordId | null;
  readonly pullRequestRecordId?: PullRequestRecordId | null;
  readonly reviewThreadRecordId?: ReviewThreadRecordId | null;
  readonly reviewCommentRecordId?: ReviewCommentRecordId | null;
  readonly issueNumber?: number | null;
  readonly pullRequestNumber?: number | null;
  readonly headSha?: string | null;
  readonly summary?: string | null;
}

export class GitHubEventRecorder extends Context.Service<
  GitHubEventRecorder,
  {
    readonly record: (
      input: GitHubEventReference,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  }
>()("t3/github/GitHubEventRecorder") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const record = Effect.fn("GitHubEventRecorder.record")(function* (input: GitHubEventReference) {
    const [uuid, now] = yield* Effect.all([
      crypto.randomUUIDv4.pipe(Effect.orDie),
      DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    ]);
    return yield* engine.dispatch({
      type: "github.event.record",
      commandId: CommandId.make(uuid),
      eventType: input.eventType,
      payload: {
        projectId: input.projectId,
        missionId: input.missionId ?? null,
        taskId: input.taskId ?? null,
        accountId: input.accountId ?? null,
        repositoryConnectionId: input.repositoryConnectionId ?? null,
        issueRecordId: input.issueRecordId ?? null,
        pullRequestRecordId: input.pullRequestRecordId ?? null,
        reviewThreadRecordId: input.reviewThreadRecordId ?? null,
        reviewCommentRecordId: input.reviewCommentRecordId ?? null,
        issueNumber: input.issueNumber ?? null,
        pullRequestNumber: input.pullRequestNumber ?? null,
        headSha: input.headSha ?? null,
        summary: input.summary?.slice(0, 2_000) ?? null,
        occurredAt: now,
      },
    });
  });

  return GitHubEventRecorder.of({ record });
});

export const layer = Layer.effect(GitHubEventRecorder, make);
