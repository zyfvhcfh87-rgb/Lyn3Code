import {
  type MemoryEntryStatus,
  type MemoryEntryType,
  type MemoryListFilter,
  type MemoryScopeType,
  type MemorySourceType,
  type MemoryTrustLevel,
  type ProjectId,
  WS_METHODS,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export const MEMORY_WORKSPACE_SECTIONS = [
  "overview",
  "active",
  "proposals",
  "architecture",
  "conventions",
  "known_issues",
  "failed_approaches",
  "repository_index",
  "conflicts",
  "stale",
  "retrieval_history",
  "settings",
] as const;

export type MemoryWorkspaceSection = (typeof MEMORY_WORKSPACE_SECTIONS)[number];

export const MEMORY_WORKSPACE_SECTION_LABELS: Readonly<Record<MemoryWorkspaceSection, string>> = {
  overview: "Overview",
  active: "Active memories",
  proposals: "Proposals",
  architecture: "Architecture decisions",
  conventions: "Conventions",
  known_issues: "Known issues",
  failed_approaches: "Failed approaches",
  repository_index: "Repository index",
  conflicts: "Conflicts",
  stale: "Stale memories",
  retrieval_history: "Retrieval history",
  settings: "Settings",
};

const SECTION_TYPES: Partial<
  Readonly<Record<MemoryWorkspaceSection, ReadonlyArray<MemoryEntryType>>>
> = {
  architecture: ["architecture_decision"],
  conventions: ["coding_convention", "constraint", "security_rule"],
  known_issues: ["known_issue"],
  failed_approaches: ["failed_approach"],
};

const SECTION_STATUSES: Partial<
  Readonly<Record<MemoryWorkspaceSection, ReadonlyArray<MemoryEntryStatus>>>
> = {
  active: ["active"],
  architecture: ["active"],
  conventions: ["active"],
  known_issues: ["active"],
  failed_approaches: ["active"],
  conflicts: ["disputed"],
  stale: ["stale"],
};

export interface MemoryEntryFilterSelection {
  readonly scopeType: MemoryScopeType | null;
  readonly type: MemoryEntryType | null;
  readonly status: MemoryEntryStatus | null;
  readonly trust: MemoryTrustLevel | null;
  readonly sourceType: MemorySourceType | null;
  readonly branchName: string | null;
  readonly staleOnly: boolean;
}

export const EMPTY_MEMORY_FILTER_SELECTION: MemoryEntryFilterSelection = {
  scopeType: null,
  type: null,
  status: null,
  trust: null,
  sourceType: null,
  branchName: null,
  staleOnly: false,
};

/** Builds the server-side list filter shared by each memory workspace section. */
export function buildMemoryListFilter(input: {
  readonly projectId: ProjectId;
  readonly section: MemoryWorkspaceSection;
  readonly query: string;
  readonly selection?: MemoryEntryFilterSelection;
  readonly limit?: number;
  readonly offset?: number;
}): MemoryListFilter {
  const selection = input.selection ?? EMPTY_MEMORY_FILTER_SELECTION;
  const sectionTypes = SECTION_TYPES[input.section] ?? [];
  const sectionStatuses = SECTION_STATUSES[input.section] ?? [];
  return {
    projectId: input.projectId,
    scopeTypes: selection.scopeType === null ? [] : [selection.scopeType],
    types: selection.type === null ? [...sectionTypes] : [selection.type],
    statuses: selection.status === null ? [...sectionStatuses] : [selection.status],
    trustLevels: selection.trust === null ? [] : [selection.trust],
    sourceTypes: selection.sourceType === null ? [] : [selection.sourceType],
    branchName: selection.branchName,
    missionId: null,
    taskId: null,
    query: input.query.trim(),
    createdAfter: null,
    staleOnly: input.section === "stale" || selection.staleOnly,
    pinnedOnly: false,
    limit: input.limit ?? 100,
    offset: input.offset ?? 0,
  };
}

export function describesRemoteCodeUpload(input: {
  readonly semanticRetrievalEnabled: boolean;
  readonly embeddingProviderKind: "none" | "local" | "remote";
  readonly remoteCodeUploadAcceptedAt: string | null;
}): "not_applicable" | "consent_required" | "consented" {
  if (!input.semanticRetrievalEnabled || input.embeddingProviderKind !== "remote") {
    return "not_applicable";
  }
  return input.remoteCodeUploadAcceptedAt === null ? "consent_required" : "consented";
}

/** Project-memory reads are short-lived because lifecycle and indexing updates can change them. */
export function createMemoryStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    workspaceAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:workspace",
      tag: WS_METHODS.memoryGetWorkspace,
      staleTimeMs: 10_000,
      refreshIntervalMs: 30_000,
    }),
    entriesAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:entries",
      tag: WS_METHODS.memoryListEntries,
      staleTimeMs: 10_000,
    }),
    entryDetailAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:entry-detail",
      tag: WS_METHODS.memoryGetEntry,
      staleTimeMs: 10_000,
      idleTtlMs: 10 * 60_000,
    }),
    proposalsAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:proposals",
      tag: WS_METHODS.memoryListProposals,
      staleTimeMs: 10_000,
    }),
    indexedSourcesAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:indexed-sources",
      tag: WS_METHODS.memoryListIndexedSources,
      staleTimeMs: 10_000,
    }),
    searchAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:search",
      tag: WS_METHODS.memorySearch,
      staleTimeMs: 5_000,
      idleTtlMs: 5 * 60_000,
    }),
    retrievalsAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:retrievals",
      tag: WS_METHODS.memoryListRetrievals,
      staleTimeMs: 10_000,
    }),
    retrievalDetailAtom: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "memory:retrieval-detail",
      tag: WS_METHODS.memoryGetRetrieval,
      staleTimeMs: 30_000,
      idleTtlMs: 10 * 60_000,
    }),
  };
}

/** Serializes memory writes per environment while keeping retrieval queries concurrent. */
export function createMemoryCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  return {
    createEntry: createEnvironmentRpcCommand(runtime, {
      label: "memory:create-entry",
      tag: WS_METHODS.memoryCreateEntry,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    updateEntry: createEnvironmentRpcCommand(runtime, {
      label: "memory:update-entry",
      tag: WS_METHODS.memoryUpdateEntry,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    actionEntry: createEnvironmentRpcCommand(runtime, {
      label: "memory:action-entry",
      tag: WS_METHODS.memoryActionEntry,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    supersedeEntry: createEnvironmentRpcCommand(runtime, {
      label: "memory:supersede-entry",
      tag: WS_METHODS.memorySupersedeEntry,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    addSource: createEnvironmentRpcCommand(runtime, {
      label: "memory:add-source",
      tag: WS_METHODS.memoryAddSource,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createRelation: createEnvironmentRpcCommand(runtime, {
      label: "memory:create-relation",
      tag: WS_METHODS.memoryCreateRelation,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    createProposal: createEnvironmentRpcCommand(runtime, {
      label: "memory:create-proposal",
      tag: WS_METHODS.memoryCreateProposal,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    reviewProposal: createEnvironmentRpcCommand(runtime, {
      label: "memory:review-proposal",
      tag: WS_METHODS.memoryReviewProposal,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    requestIndex: createEnvironmentRpcCommand(runtime, {
      label: "memory:request-index",
      tag: WS_METHODS.memoryRequestIndex,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "memory:update-settings",
      tag: WS_METHODS.memoryUpdateSettings,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    exportMemory: createEnvironmentRpcCommand(runtime, {
      label: "memory:export",
      tag: WS_METHODS.memoryExport,
      scheduler,
      concurrency: serialByEnvironment,
    }),
    importMemory: createEnvironmentRpcCommand(runtime, {
      label: "memory:import",
      tag: WS_METHODS.memoryImport,
      scheduler,
      concurrency: serialByEnvironment,
    }),
  };
}
