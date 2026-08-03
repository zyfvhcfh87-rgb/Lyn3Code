import {
  createGitHubCommandAtoms,
  createGitHubStateAtoms,
} from "@t3tools/client-runtime/state/github";

import { connectionAtomRuntime } from "../connection/runtime";

export const githubEnvironment: ReturnType<typeof createGitHubStateAtoms> &
  ReturnType<typeof createGitHubCommandAtoms> = {
  ...createGitHubStateAtoms(connectionAtomRuntime),
  ...createGitHubCommandAtoms(connectionAtomRuntime),
};
