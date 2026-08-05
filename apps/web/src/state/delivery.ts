import {
  createDeliveryCommandAtoms,
  createDeliveryStateAtoms,
} from "@t3tools/client-runtime/state/delivery";

import { connectionAtomRuntime } from "../connection/runtime";

export const deliveryEnvironment: ReturnType<typeof createDeliveryStateAtoms> &
  ReturnType<typeof createDeliveryCommandAtoms> = {
  ...createDeliveryStateAtoms(connectionAtomRuntime),
  ...createDeliveryCommandAtoms(connectionAtomRuntime),
};
