import type {
  CreateMemoryEntryInput,
  AgentRunId,
  EnvironmentId,
  MemoryEntryActionInput,
  MemoryIndexOperationType,
  MemoryProposalStatus,
  MemoryRelationType,
  MemorySourceDraft,
  ProjectId,
  ReviewMemoryProposalInput,
  UpdateMemoryEntryInput,
  UpdateMemorySettingsInput,
} from "@t3tools/contracts";
import { MemoryEntryId, MemoryExportBundle } from "@t3tools/contracts";
import {
  BookOpenIcon,
  BrainCircuitIcon,
  CircleAlertIcon,
  DownloadIcon,
  GitBranchIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import * as Schema from "effect/Schema";

import {
  buildMemoryListFilter,
  EMPTY_MEMORY_FILTER_SELECTION,
  MEMORY_WORKSPACE_SECTION_LABELS,
  MEMORY_WORKSPACE_SECTIONS,
  type MemoryEntryFilterSelection,
  type MemoryWorkspaceSection,
} from "@t3tools/client-runtime/state/memory";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import {
  CreateMemoryDialog,
  type CreateMemoryPreset,
  MemoryEntryDetailSheet,
  MemoryEntryFilters,
  MemoryEntryList,
  replacementMemoryId,
  useDeferredMemoryQuery,
} from "./MemoryEntryPanels";
import {
  MemoryOverview,
  MemoryRepositoryIndex,
  MemoryRetrievalHistory,
  MemorySettingsPanel,
} from "./MemoryIndexAndSettings";
import { MemoryProposalQueue } from "./MemoryProposalQueue";

const ENTRY_SECTIONS: ReadonlySet<MemoryWorkspaceSection> = new Set([
  "active",
  "architecture",
  "conventions",
  "known_issues",
  "failed_approaches",
  "conflicts",
  "stale",
]);

const decodeMemoryExportBundle = Schema.decodeUnknownPromise(MemoryExportBundle);

function commandError<E>(
  result: Extract<AtomCommandResult<unknown, E>, { readonly _tag: "Failure" }>,
) {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error && failure.message.trim()
    ? failure.message
    : "The memory operation failed.";
}

export function MemoryWorkspace({
  environmentId,
  projectId,
  projectTitle,
  initialAgentRunId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly initialAgentRunId: AgentRunId | null;
}) {
  const [section, setSection] = useState<MemoryWorkspaceSection>(
    initialAgentRunId === null ? "overview" : "retrieval_history",
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredMemoryQuery(query);
  const [filters, setFilters] = useState<MemoryEntryFilterSelection>(EMPTY_MEMORY_FILTER_SELECTION);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<CreateMemoryPreset | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());

  const workspaceQuery = useEnvironmentQuery(
    memoryEnvironment.workspaceAtom({ environmentId, input: { projectId } }),
  );
  const entryFilter = useMemo(
    () => buildMemoryListFilter({ projectId, section, query: deferredQuery, selection: filters }),
    [deferredQuery, filters, projectId, section],
  );
  const entriesQuery = useEnvironmentQuery(
    ENTRY_SECTIONS.has(section)
      ? memoryEnvironment.entriesAtom({ environmentId, input: entryFilter })
      : null,
  );
  const proposalStatuses: ReadonlyArray<MemoryProposalStatus> = ["pending", "deferred"];
  const proposalsQuery = useEnvironmentQuery(
    section === "proposals"
      ? memoryEnvironment.proposalsAtom({
          environmentId,
          input: { projectId, statuses: proposalStatuses, limit: 100, offset: 0 },
        })
      : null,
  );
  const proposalMemoriesQuery = useEnvironmentQuery(
    section === "proposals"
      ? memoryEnvironment.entriesAtom({
          environmentId,
          input: buildMemoryListFilter({
            projectId,
            section: "active",
            query: "",
            limit: 500,
          }),
        })
      : null,
  );
  const sourcesQuery = useEnvironmentQuery(
    section === "repository_index"
      ? memoryEnvironment.indexedSourcesAtom({
          environmentId,
          input: { projectId, statuses: [], pathPrefix: null, limit: 200, offset: 0 },
        })
      : null,
  );
  const retrievalsQuery = useEnvironmentQuery(
    section === "retrieval_history"
      ? memoryEnvironment.retrievalsAtom({
          environmentId,
          input: {
            projectId,
            agentRunId: initialAgentRunId,
            threadId: null,
            limit: 100,
            offset: 0,
          },
        })
      : null,
  );
  const detailQuery = useEnvironmentQuery(
    selectedMemoryId
      ? memoryEnvironment.entryDetailAtom({
          environmentId,
          input: { memoryEntryId: MemoryEntryId.make(selectedMemoryId) },
        })
      : null,
  );

  const createEntry = useAtomCommand(memoryEnvironment.createEntry, { reportFailure: false });
  const updateEntry = useAtomCommand(memoryEnvironment.updateEntry, { reportFailure: false });
  const actionEntry = useAtomCommand(memoryEnvironment.actionEntry, { reportFailure: false });
  const supersedeEntry = useAtomCommand(memoryEnvironment.supersedeEntry, { reportFailure: false });
  const addSource = useAtomCommand(memoryEnvironment.addSource, { reportFailure: false });
  const createRelation = useAtomCommand(memoryEnvironment.createRelation, {
    reportFailure: false,
  });
  const reviewProposal = useAtomCommand(memoryEnvironment.reviewProposal, { reportFailure: false });
  const requestIndex = useAtomCommand(memoryEnvironment.requestIndex, { reportFailure: false });
  const updateSettings = useAtomCommand(memoryEnvironment.updateSettings, { reportFailure: false });
  const exportMemory = useAtomCommand(memoryEnvironment.exportMemory, { reportFailure: false });
  const importMemory = useAtomCommand(memoryEnvironment.importMemory, { reportFailure: false });

  const run = async <A, E>(
    key: string,
    operation: () => Promise<AtomCommandResult<A, E>>,
    success: string,
  ): Promise<A | null> => {
    setBusyKeys((current) => new Set([...current, key]));
    try {
      const result = await operation();
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: "Memory operation failed",
          description: commandError(result),
        });
        return null;
      }
      toastManager.add({ type: "success", title: success });
      return result.value;
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const refreshMemory = () => {
    workspaceQuery.refresh();
    entriesQuery.refresh();
    detailQuery.refresh();
  };
  const openCreate = (preset: CreateMemoryPreset | null = null) => {
    setCreatePreset(preset);
    setCreateKey((value) => value + 1);
    setCreateOpen(true);
  };
  const handleCreate = async (input: CreateMemoryEntryInput) => {
    const result = await run(
      "create",
      () => createEntry({ environmentId, input }),
      "Memory saved with provenance",
    );
    if (!result) return false;
    refreshMemory();
    setSelectedMemoryId(result.entry.id);
    setDetailOpen(true);
    return true;
  };
  const handleUpdate = async (input: UpdateMemoryEntryInput) => {
    const result = await run(
      "update",
      () => updateEntry({ environmentId, input }),
      "Memory corrected; history preserved",
    );
    if (!result) return false;
    refreshMemory();
    return true;
  };
  const handleAction = async (action: MemoryEntryActionInput["action"], reason: string | null) => {
    if (!selectedMemoryId) return false;
    const result = await run(
      `action:${action}`,
      () =>
        actionEntry({
          environmentId,
          input: {
            memoryEntryId: MemoryEntryId.make(selectedMemoryId),
            action,
            reason,
            actorType: "user",
            actorId: null,
          },
        }),
      `Memory ${action.replaceAll("_", " ")}`,
    );
    if (!result) return false;
    refreshMemory();
    return true;
  };
  const handleSupersede = async (replacementId: string, reason: string) => {
    if (!selectedMemoryId) return false;
    const result = await run(
      "supersede",
      () =>
        supersedeEntry({
          environmentId,
          input: {
            supersededMemoryEntryId: MemoryEntryId.make(selectedMemoryId),
            replacementMemoryEntryId: replacementMemoryId(replacementId),
            reason,
            actorType: "user",
            actorId: null,
          },
        }),
      "Memory superseded; historical entry retained",
    );
    if (!result) return false;
    refreshMemory();
    return true;
  };
  const handleAddSource = async (source: MemorySourceDraft) => {
    if (!selectedMemoryId) return false;
    const result = await run(
      "add-source",
      () =>
        addSource({
          environmentId,
          input: { memoryEntryId: MemoryEntryId.make(selectedMemoryId), source },
        }),
      "Source attached",
    );
    if (!result) return false;
    detailQuery.refresh();
    return true;
  };
  const handleCreateRelation = async (targetMemoryId: string, relationType: MemoryRelationType) => {
    if (!selectedMemoryId) return false;
    const result = await run(
      "create-relation",
      () =>
        createRelation({
          environmentId,
          input: {
            fromMemoryEntryId: MemoryEntryId.make(selectedMemoryId),
            toMemoryEntryId: MemoryEntryId.make(targetMemoryId),
            relationType,
          },
        }),
      "Memory relationship recorded",
    );
    if (!result) return false;
    detailQuery.refresh();
    workspaceQuery.refresh();
    return true;
  };
  const handleReview = async (input: ReviewMemoryProposalInput) => {
    const result = await run(
      `proposal:${input.action}`,
      () => reviewProposal({ environmentId, input }),
      `Proposal ${input.action.replaceAll("_", " ")}`,
    );
    if (!result) return false;
    proposalsQuery.refresh();
    workspaceQuery.refresh();
    entriesQuery.refresh();
    return true;
  };
  const handleIndexRequest = async (operationType: MemoryIndexOperationType) => {
    const result = await run(
      `index:${operationType}`,
      () =>
        requestIndex({
          environmentId,
          input: {
            projectId,
            operationType,
            branchName: workspaceQuery.data?.indexStatus.currentBranch ?? null,
          },
        }),
      "Index operation queued",
    );
    if (!result) return false;
    workspaceQuery.refresh();
    sourcesQuery.refresh();
    return true;
  };
  const handleSettings = async (input: UpdateMemorySettingsInput) => {
    const result = await run(
      "settings",
      () => updateSettings({ environmentId, input }),
      "Memory settings saved",
    );
    if (!result) return false;
    workspaceQuery.refresh();
    return true;
  };
  const handleExport = async () => {
    const bundle = await run(
      "export",
      () => exportMemory({ environmentId, input: { projectId } }),
      "Memory export prepared",
    );
    if (!bundle) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectTitle.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-memory.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = async (file: File) => {
    try {
      const bundle = await decodeMemoryExportBundle(JSON.parse(await file.text()));
      const result = await run(
        "import",
        () =>
          importMemory({
            environmentId,
            input: {
              bundle,
              targetProjectId: projectId,
              conflictPolicy: "propose",
              importedBy: "user",
            },
          }),
        "Memory imported for safe review",
      );
      if (result) {
        workspaceQuery.refresh();
        entriesQuery.refresh();
        proposalsQuery.refresh();
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Memory import rejected",
        description:
          error instanceof Error
            ? error.message
            : "The selected file is not a valid memory export.",
      });
    }
  };

  if (workspaceQuery.isPending && !workspaceQuery.data) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Loading project memory…
      </div>
    );
  }
  if (workspaceQuery.error || !workspaceQuery.data) {
    return (
      <div className="p-6">
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertTitle>Memory workspace unavailable</AlertTitle>
          <AlertDescription>
            {workspaceQuery.error ?? "The server did not return a memory workspace."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  const snapshot = workspaceQuery.data;
  const busy = busyKeys.size > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <BrainCircuitIcon className="size-5 text-primary" />
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-semibold">{projectTitle} memory</h1>
          <p className="text-sm text-muted-foreground">
            Persistent, scoped knowledge with inspectable evidence.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openCreate({
              scopeType: "branch",
              branchName: snapshot.indexStatus.currentBranch,
              type: "architecture_decision",
              title: "",
            })
          }
        >
          <GitBranchIcon />
          Save branch decision
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openCreate({ scopeType: "project", type: "failed_approach", title: "" })}
        >
          <BookOpenIcon />
          Save failed approach
        </Button>
        <Button size="sm" onClick={() => openCreate()}>
          <PlusIcon />
          New memory
        </Button>
        <Button
          aria-label="Export memory"
          size="icon-sm"
          title="Export memory"
          variant="ghost"
          onClick={() => void handleExport()}
        >
          <DownloadIcon />
        </Button>
        <label
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
          title="Import memory"
        >
          <UploadIcon className="size-4" />
          <input
            accept="application/json,.json"
            className="sr-only"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleImport(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </header>

      {!snapshot.settings.enabled && section !== "settings" && section !== "overview" ? (
        <Alert className="mx-4 mt-3 sm:mx-6" variant="warning">
          <CircleAlertIcon />
          <AlertTitle>Project memory is disabled</AlertTitle>
          <AlertDescription>
            Historical entries remain available for review, but no memory is supplied to agents.
            Enable it in Settings when you are ready.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Memory workspace sections"
          className="shrink-0 border-b lg:w-56 lg:border-b-0 lg:border-r"
        >
          <ScrollArea className="h-auto w-full lg:h-full">
            <div className="flex gap-1 p-2 lg:grid">
              {MEMORY_WORKSPACE_SECTIONS.map((candidate) => {
                const count =
                  candidate === "active"
                    ? snapshot.activeMemoryCount
                    : candidate === "proposals"
                      ? snapshot.proposalCount
                      : candidate === "conflicts"
                        ? snapshot.conflictCount
                        : candidate === "stale"
                          ? snapshot.staleMemoryCount
                          : null;
                return (
                  <button
                    key={candidate}
                    aria-current={section === candidate ? "page" : undefined}
                    className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary"
                    type="button"
                    onClick={() => {
                      setSection(candidate);
                      setSelectedMemoryId(null);
                      setDetailOpen(false);
                    }}
                  >
                    <span className="mr-auto whitespace-nowrap">
                      {MEMORY_WORKSPACE_SECTION_LABELS[candidate]}
                    </span>
                    {count !== null ? <Badge variant="secondary">{count}</Badge> : null}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </nav>

        <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
          <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
            <div>
              <h2 className="text-xl font-semibold">{MEMORY_WORKSPACE_SECTION_LABELS[section]}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {section === "proposals"
                  ? "Review model-generated candidates before they can become trusted active memory."
                  : section === "repository_index"
                    ? "Inspect source freshness, safe exclusions, failures, branch state, and optional embedding status."
                    : section === "retrieval_history"
                      ? "Audit exactly what scoped memory was supplied to each agent run."
                      : section === "settings"
                        ? "Control indexing, retrieval, proposal behavior, token bounds, and privacy."
                        : section === "overview"
                          ? "Current health, trust posture, and retrieval readiness."
                          : "Filter reusable project knowledge and inspect every claim's provenance."}
              </p>
            </div>
            {ENTRY_SECTIONS.has(section) ? (
              <>
                <MemoryEntryFilters
                  query={query}
                  selection={filters}
                  onQueryChange={setQuery}
                  onSelectionChange={setFilters}
                />
                <MemoryEntryList
                  entries={entriesQuery.data?.entries ?? []}
                  total={entriesQuery.data?.total ?? 0}
                  selectedId={selectedMemoryId}
                  loading={entriesQuery.isPending}
                  error={entriesQuery.error}
                  onSelect={(entry) => {
                    setSelectedMemoryId(entry.id);
                    setDetailOpen(true);
                  }}
                />
              </>
            ) : null}
            {section === "overview" ? <MemoryOverview snapshot={snapshot} /> : null}
            {section === "proposals" ? (
              <MemoryProposalQueue
                proposals={proposalsQuery.data?.proposals ?? []}
                candidateMemories={proposalMemoriesQuery.data?.entries ?? []}
                total={proposalsQuery.data?.total ?? 0}
                loading={proposalsQuery.isPending}
                error={proposalsQuery.error}
                busy={busy}
                onReview={handleReview}
              />
            ) : null}
            {section === "repository_index" ? (
              <MemoryRepositoryIndex
                snapshot={snapshot}
                sources={sourcesQuery.data?.sources ?? []}
                total={sourcesQuery.data?.total ?? 0}
                loading={sourcesQuery.isPending}
                error={sourcesQuery.error}
                busy={busy}
                onRequest={handleIndexRequest}
                onPauseChange={(indexingPaused) => handleSettings({ projectId, indexingPaused })}
              />
            ) : null}
            {section === "retrieval_history" ? (
              <MemoryRetrievalHistory
                records={retrievalsQuery.data?.records ?? []}
                total={retrievalsQuery.data?.total ?? 0}
                loading={retrievalsQuery.isPending}
                error={retrievalsQuery.error}
              />
            ) : null}
            {section === "settings" ? (
              <MemorySettingsPanel
                key={snapshot.settings.updatedAt}
                settings={snapshot.settings}
                busy={busy}
                onSave={handleSettings}
              />
            ) : null}
          </main>
        </ScrollArea>
      </div>

      <CreateMemoryDialog
        key={createKey}
        open={createOpen}
        projectId={projectId}
        currentBranch={snapshot.indexStatus.currentBranch}
        preset={createPreset}
        busy={busy}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
      <MemoryEntryDetailSheet
        key={selectedMemoryId ?? "none"}
        detail={detailQuery.data}
        projectId={projectId}
        loading={detailQuery.isPending}
        open={detailOpen}
        busy={busy}
        onOpenChange={setDetailOpen}
        onUpdate={handleUpdate}
        onAction={handleAction}
        onSupersede={handleSupersede}
        onAddSource={handleAddSource}
        onCreateRelation={handleCreateRelation}
      />
    </div>
  );
}
