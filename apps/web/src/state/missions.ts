import { useAtomValue } from "@effect/atom-react";
import { createMissionCommandAtoms } from "@t3tools/client-runtime/state/mission-commands";
import {
  createMissionStateAtoms,
  EMPTY_ENVIRONMENT_MISSION_BOARD_STATE,
  EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE,
  type EnvironmentMissionBoardState,
  type EnvironmentMissionDetailState,
} from "@t3tools/client-runtime/state/missions";
import type { EnvironmentId, MissionId, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

const missionState = createMissionStateAtoms(connectionAtomRuntime);
const missionCommands = createMissionCommandAtoms(connectionAtomRuntime);

export const missionEnvironment = {
  ...missionState,
  ...missionCommands,
};

function unwrapBoardState(
  result: AsyncResult.AsyncResult<EnvironmentMissionBoardState, unknown>,
): EnvironmentMissionBoardState {
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_MISSION_BOARD_STATE);
}

function unwrapDetailState(
  result: AsyncResult.AsyncResult<EnvironmentMissionDetailState, unknown>,
): EnvironmentMissionDetailState {
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_MISSION_DETAIL_STATE);
}

export function useMissionBoardState(target: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId;
}): EnvironmentMissionBoardState {
  return unwrapBoardState(useAtomValue(missionEnvironment.boardStateAtom(target)));
}

export function useMissionDetailState(target: {
  readonly environmentId: EnvironmentId;
  readonly missionId: MissionId;
}): EnvironmentMissionDetailState {
  return unwrapDetailState(useAtomValue(missionEnvironment.detailStateAtom(target)));
}
