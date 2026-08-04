import {
  createRoutingCommandAtoms,
  createRoutingStateAtoms,
} from "@t3tools/client-runtime/state/routing";

import { connectionAtomRuntime } from "../connection/runtime";

export const routingEnvironment: ReturnType<typeof createRoutingStateAtoms> &
  ReturnType<typeof createRoutingCommandAtoms> = {
  ...createRoutingStateAtoms(connectionAtomRuntime),
  ...createRoutingCommandAtoms(connectionAtomRuntime),
};
