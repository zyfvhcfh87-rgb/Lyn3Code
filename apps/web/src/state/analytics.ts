import {
  createAnalyticsCommandAtoms,
  createAnalyticsStateAtoms,
} from "@t3tools/client-runtime/state/analytics";

import { connectionAtomRuntime } from "../connection/runtime";

export const analyticsEnvironment: ReturnType<typeof createAnalyticsStateAtoms> &
  ReturnType<typeof createAnalyticsCommandAtoms> = {
  ...createAnalyticsStateAtoms(connectionAtomRuntime),
  ...createAnalyticsCommandAtoms(connectionAtomRuntime),
};
