import {
  createMemoryCommandAtoms,
  createMemoryStateAtoms,
} from "@t3tools/client-runtime/state/memory";

import { connectionAtomRuntime } from "../connection/runtime";

export const memoryEnvironment: ReturnType<typeof createMemoryStateAtoms> &
  ReturnType<typeof createMemoryCommandAtoms> = {
  ...createMemoryStateAtoms(connectionAtomRuntime),
  ...createMemoryCommandAtoms(connectionAtomRuntime),
};
