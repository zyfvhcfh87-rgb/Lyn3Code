import {
  createVerificationCommandAtoms,
  createVerificationStateAtoms,
} from "@t3tools/client-runtime/state/verification";

import { connectionAtomRuntime } from "../connection/runtime";

export const verificationEnvironment: ReturnType<typeof createVerificationStateAtoms> &
  ReturnType<typeof createVerificationCommandAtoms> = {
  ...createVerificationStateAtoms(connectionAtomRuntime),
  ...createVerificationCommandAtoms(connectionAtomRuntime),
};
