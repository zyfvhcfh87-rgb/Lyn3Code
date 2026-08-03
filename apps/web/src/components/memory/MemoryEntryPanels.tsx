import type {
  CreateMemoryEntryInput,
  MemoryEntry,
  MemoryEntryActionInput,
  MemoryEntryDetail,
  MemoryEntryStatus,
  MemoryEntryType,
  MemoryRelationType,
  MemoryScopeType,
  MemorySourceDraft,
  MemorySourceType,
  MemoryTrustLevel,
  ProjectId,
  UpdateMemoryEntryInput,
} from "@t3tools/contracts";
import { IsoDateTime, MemoryEntryId, MissionId, MissionTaskId } from "@t3tools/contracts";
import {
  ArchiveIcon,
  BookOpenIcon,
  CircleAlertIcon,
  GitBranchIcon,
  LinkIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useDeferredValue, useState } from "react";

import type { MemoryEntryFilterSelection } from "@t3tools/client-runtime/state/memory";
import { EMPTY_MEMORY_FILTER_SELECTION } from "@t3tools/client-runtime/state/memory";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";
import { Textarea } from "../ui/textarea";

export const MEMORY_TYPES: ReadonlyArray<MemoryEntryType> = [
  "architecture_decision",
  "constraint",
  "coding_convention",
  "product_requirement",
  "known_issue",
  "failed_approach",
  "successful_pattern",
  "dependency_fact",
  "environment_fact",
  "command",
  "test_procedure",
  "release_procedure",
  "security_rule",
  "user_preference",
  "repository_fact",
  "mission_summary",
  "task_result",
  "review_feedback",
  "custom",
];

export const MEMORY_SCOPES: ReadonlyArray<MemoryScopeType> = [
  "user",
  "project",
  "branch",
  "mission",
  "task",
];

export const MEMORY_STATUSES: ReadonlyArray<MemoryEntryStatus> = [
  "proposed",
  "active",
  "stale",
  "superseded",
  "disputed",
  "rejected",
  "archived",
];

export const MEMORY_TRUST_LEVELS: ReadonlyArray<MemoryTrustLevel> = [
  "authoritative",
  "verified",
  "supported",
  "inferred",
  "unverified",
  "disputed",
];

const SOURCE_TYPES: ReadonlyArray<MemorySourceType> = [
  "repository_file",
  "agents_file",
  "documentation",
  "user_instruction",
  "mission_event",
  "agent_handoff",
  "verification_result",
  "github_issue",
  "github_pull_request",
  "github_review",
  "manual_entry",
  "derived",
];

const RELATION_TYPES: ReadonlyArray<MemoryRelationType> = [
  "supports",
  "contradicts",
  "supersedes",
  "refines",
  "depends_on",
  "applies_to",
  "derived_from",
  "related_to",
];

export function humanizeMemoryValue(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function formatMemoryDate(value: string | null): string {
  if (value === null) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function trustVariant(trust: MemoryTrustLevel): "success" | "info" | "warning" | "error" {
  if (trust === "authoritative" || trust === "verified") return "success";
  if (trust === "supported") return "info";
  if (trust === "disputed") return "error";
  return "warning";
}

function statusVariant(status: MemoryEntryStatus): "default" | "secondary" | "warning" | "error" {
  if (status === "active") return "default";
  if (status === "stale" || status === "proposed") return "warning";
  if (status === "disputed" || status === "rejected") return "error";
  return "secondary";
}

function FilterSelect<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly values: ReadonlyArray<T>;
  readonly onChange: (value: T | null) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.currentTarget.value === "" ? null : (event.currentTarget.value as T))
        }
      >
        <option value="">All</option>
        {values.map((candidate) => (
          <option key={candidate} value={candidate}>
            {humanizeMemoryValue(candidate)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MemoryEntryFilters({
  query,
  selection,
  onQueryChange,
  onSelectionChange,
}: {
  readonly query: string;
  readonly selection: MemoryEntryFilterSelection;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectionChange: (selection: MemoryEntryFilterSelection) => void;
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-muted/24 p-3">
      <label className="relative block">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search project memories"
          className="pl-8"
          placeholder="Search claims, titles, paths, and sources"
          type="search"
          value={query}
          onValueChange={onQueryChange}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <FilterSelect
          label="Scope"
          value={selection.scopeType}
          values={MEMORY_SCOPES}
          onChange={(scopeType) => onSelectionChange({ ...selection, scopeType })}
        />
        <FilterSelect
          label="Type"
          value={selection.type}
          values={MEMORY_TYPES}
          onChange={(type) => onSelectionChange({ ...selection, type })}
        />
        <FilterSelect
          label="Status"
          value={selection.status}
          values={MEMORY_STATUSES}
          onChange={(status) => onSelectionChange({ ...selection, status })}
        />
        <FilterSelect
          label="Trust"
          value={selection.trust}
          values={MEMORY_TRUST_LEVELS}
          onChange={(trust) => onSelectionChange({ ...selection, trust })}
        />
        <FilterSelect
          label="Source"
          value={selection.sourceType}
          values={SOURCE_TYPES}
          onChange={(sourceType) => onSelectionChange({ ...selection, sourceType })}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Input
          aria-label="Branch filter"
          placeholder="Branch"
          value={selection.branchName ?? ""}
          onValueChange={(branchName) =>
            onSelectionChange({ ...selection, branchName: branchName.trim() || null })
          }
        />
        <Input
          aria-label="Mission filter"
          placeholder="Mission ID"
          value={selection.missionId ?? ""}
          onValueChange={(missionId) =>
            onSelectionChange({ ...selection, missionId: missionId.trim() || null })
          }
        />
        <Input
          aria-label="Task filter"
          placeholder="Task ID"
          value={selection.taskId ?? ""}
          onValueChange={(taskId) =>
            onSelectionChange({ ...selection, taskId: taskId.trim() || null })
          }
        />
        <Input
          aria-label="Created after filter"
          type="date"
          value={selection.createdAfter ?? ""}
          onValueChange={(createdAfter) =>
            onSelectionChange({ ...selection, createdAfter: createdAfter || null })
          }
        />
      </div>
      {selection !== EMPTY_MEMORY_FILTER_SELECTION ? (
        <Button
          className="justify-self-start"
          size="sm"
          variant="ghost"
          onClick={() => onSelectionChange(EMPTY_MEMORY_FILTER_SELECTION)}
        >
          Reset filters
        </Button>
      ) : null}
    </div>
  );
}

export function MemoryEntryList({
  entries,
  total,
  selectedId,
  loading,
  error,
  onSelect,
}: {
  readonly entries: ReadonlyArray<MemoryEntry>;
  readonly total: number;
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (entry: MemoryEntry) => void;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-foreground">
        <CircleAlertIcon className="mr-2 inline size-4" />
        {error}
      </div>
    );
  }
  if (!loading && entries.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center rounded-xl border border-dashed p-8 text-center">
        <div>
          <BookOpenIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="font-medium">No memories match this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust the filters or save a concise, source-backed project fact.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        Showing {entries.length} of {total} memories
      </p>
      <div className="grid gap-2">
        {entries.map((entry) => (
          <button
            key={entry.id}
            aria-pressed={selectedId === entry.id}
            className={cn(
              "grid w-full gap-2 rounded-xl border bg-card p-4 text-left [content-visibility:auto] [contain-intrinsic-size:auto_9rem] hover:bg-muted/35 aria-pressed:border-primary/50 aria-pressed:bg-primary/5",
              entry.status === "disputed" && "border-destructive/35",
            )}
            type="button"
            onClick={() => onSelect(entry)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <h3 className="mr-auto min-w-0 truncate font-medium">{entry.title}</h3>
              {entry.pinned ? (
                <PinIcon className="size-3.5 text-primary" aria-label="Pinned" />
              ) : null}
              <Badge variant={statusVariant(entry.status)}>
                {humanizeMemoryValue(entry.status)}
              </Badge>
              <Badge variant={trustVariant(entry.trustLevel)}>
                {humanizeMemoryValue(entry.trustLevel)}
              </Badge>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{entry.content}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{humanizeMemoryValue(entry.scopeType)} scope</span>
              <span>{humanizeMemoryValue(entry.type)}</span>
              <span>{Math.round(entry.confidence * 100)}% confidence</span>
              <span>Verified {formatMemoryDate(entry.lastVerifiedAt)}</span>
              <span>Open for provenance</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceReference({ source }: { readonly source: MemoryEntryDetail["sources"][number] }) {
  const path = source.filePath ?? source.repositoryPath;
  const lines =
    source.startLine === null
      ? null
      : source.endLine === null
        ? `:${source.startLine}`
        : `:${source.startLine}-${source.endLine}`;
  return (
    <li className="rounded-lg border p-3 [content-visibility:auto]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={source.sourceStatus === "resolved" ? "success" : "warning"}>
          {humanizeMemoryValue(source.sourceStatus)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {humanizeMemoryValue(source.sourceType)}
        </span>
      </div>
      <p className="mt-2 break-all text-sm font-medium">
        {path ? `${path}${lines ?? ""}` : source.sourceIdentifier}
      </p>
      <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
        {source.commitHash ? <span>Commit {source.commitHash}</span> : null}
        {source.branchName ? <span>Branch {source.branchName}</span> : null}
        {source.verificationRunId ? <span>Verification {source.verificationRunId}</span> : null}
        {source.githubRecordId ? (
          <span>
            GitHub {source.githubRecordType}: {source.githubRecordId}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function MemoryEntryDetailSheet({
  detail,
  projectId,
  loading,
  open,
  busy,
  onOpenChange,
  onUpdate,
  onAction,
  onSupersede,
  onAddSource,
  onCreateRelation,
}: {
  readonly detail: MemoryEntryDetail | null;
  readonly projectId: ProjectId;
  readonly loading: boolean;
  readonly open: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUpdate: (input: UpdateMemoryEntryInput) => Promise<boolean>;
  readonly onAction: (
    action: MemoryEntryActionInput["action"],
    reason: string | null,
  ) => Promise<boolean>;
  readonly onSupersede: (replacementId: string, reason: string) => Promise<boolean>;
  readonly onAddSource: (source: MemorySourceDraft) => Promise<boolean>;
  readonly onCreateRelation: (
    targetMemoryId: string,
    relationType: MemoryRelationType,
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editScopeType, setEditScopeType] = useState<MemoryScopeType>("project");
  const [editType, setEditType] = useState<MemoryEntryType>("custom");
  const [editTrust, setEditTrust] = useState<MemoryTrustLevel>("unverified");
  const [editConfidence, setEditConfidence] = useState(0.5);
  const [editBranch, setEditBranch] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editTask, setEditTask] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [supersedeReason, setSupersedeReason] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sourceCommit, setSourceCommit] = useState("");
  const [relatedMemoryId, setRelatedMemoryId] = useState("");
  const [relationType, setRelationType] = useState<MemoryRelationType>("related_to");

  const entry = detail?.entry ?? null;
  const startEditing = () => {
    if (!entry) return;
    setTitle(entry.title);
    setContent(entry.content);
    setEditScopeType(entry.scopeType);
    setEditType(entry.type);
    setEditTrust(entry.trustLevel);
    setEditConfidence(entry.confidence);
    setEditBranch(entry.branchName ?? "");
    setEditMission(entry.missionId ?? "");
    setEditTask(entry.taskId ?? "");
    setEditing(true);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup className="max-w-2xl" side="right">
        <SheetHeader>
          <SheetTitle>{entry?.title ?? "Memory detail"}</SheetTitle>
          <SheetDescription>
            Claim, scope, provenance, lifecycle, relationships, and retrieval usage.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel className="grid gap-5">
          {loading || !detail ? (
            <p className="text-sm text-muted-foreground">Loading source-backed memory detail…</p>
          ) : (
            <>
              <section className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(entry!.status)}>
                    {humanizeMemoryValue(entry!.status)}
                  </Badge>
                  <Badge variant={trustVariant(entry!.trustLevel)}>
                    {humanizeMemoryValue(entry!.trustLevel)}
                  </Badge>
                  <Badge variant="outline">{humanizeMemoryValue(entry!.scopeType)}</Badge>
                  <Badge variant="outline">{humanizeMemoryValue(entry!.type)}</Badge>
                </div>
                {editing ? (
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const branch = editScopeType === "branch" ? editBranch.trim() : null;
                      const mission =
                        editScopeType === "mission" || editScopeType === "task"
                          ? MissionId.make(editMission.trim())
                          : null;
                      const task =
                        editScopeType === "task" ? MissionTaskId.make(editTask.trim()) : null;
                      void onUpdate({
                        memoryEntryId: entry!.id,
                        title,
                        content,
                        type: editType,
                        trustLevel: editTrust,
                        confidence: editConfidence,
                        scope: {
                          scopeType: editScopeType,
                          scopeId:
                            editScopeType === "user"
                              ? null
                              : editScopeType === "project"
                                ? projectId
                                : editScopeType === "branch"
                                  ? branch
                                  : editScopeType === "mission"
                                    ? mission
                                    : task,
                          projectId: editScopeType === "user" ? null : projectId,
                          branchName: branch,
                          missionId: mission,
                          taskId: task,
                        },
                        reason: "Edited in the memory workspace",
                        actorType: "user",
                        actorId: null,
                      }).then((saved) => saved && setEditing(false));
                    }}
                  >
                    <Input
                      aria-label="Memory title"
                      required
                      value={title}
                      onValueChange={setTitle}
                    />
                    <Textarea
                      aria-label="Memory claim"
                      required
                      value={content}
                      onChange={(event) => setContent(event.currentTarget.value)}
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <FilterSelect
                        label="Scope"
                        value={editScopeType}
                        values={MEMORY_SCOPES}
                        onChange={(value) => value && setEditScopeType(value)}
                      />
                      <FilterSelect
                        label="Type"
                        value={editType}
                        values={MEMORY_TYPES}
                        onChange={(value) => value && setEditType(value)}
                      />
                      <FilterSelect
                        label="Trust"
                        value={editTrust}
                        values={MEMORY_TRUST_LEVELS}
                        onChange={(value) => value && setEditTrust(value)}
                      />
                    </div>
                    {editScopeType === "branch" ? (
                      <Input
                        aria-label="Edited branch scope"
                        required
                        placeholder="Branch name"
                        value={editBranch}
                        onValueChange={setEditBranch}
                      />
                    ) : null}
                    {editScopeType === "mission" || editScopeType === "task" ? (
                      <Input
                        aria-label="Edited mission scope"
                        required
                        placeholder="Mission ID"
                        value={editMission}
                        onValueChange={setEditMission}
                      />
                    ) : null}
                    {editScopeType === "task" ? (
                      <Input
                        aria-label="Edited task scope"
                        required
                        placeholder="Task ID"
                        value={editTask}
                        onValueChange={setEditTask}
                      />
                    ) : null}
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Confidence ({Math.round(editConfidence * 100)}%)
                      <input
                        className="accent-primary"
                        max={1}
                        min={0}
                        step={0.05}
                        type="range"
                        value={editConfidence}
                        onChange={(event) => setEditConfidence(Number(event.currentTarget.value))}
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button disabled={busy} size="sm" type="submit">
                        Save correction
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry!.content}</p>
                    <Button
                      className="justify-self-start"
                      size="sm"
                      variant="outline"
                      onClick={startEditing}
                    >
                      Edit claim
                    </Button>
                  </>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd>{Math.round(entry!.confidence * 100)}%</dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>
                    {formatMemoryDate(entry!.createdAt)} by {entry!.createdByType}
                  </dd>
                  <dt className="text-muted-foreground">Last verified</dt>
                  <dd>{formatMemoryDate(entry!.lastVerifiedAt)}</dd>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd>{formatMemoryDate(entry!.expiresAt)}</dd>
                  <dt className="text-muted-foreground">Retrievals</dt>
                  <dd>{detail.retrievalCount}</dd>
                  <dt className="text-muted-foreground">Scope ID</dt>
                  <dd className="break-all">{entry!.scopeId ?? "Global user scope"}</dd>
                </dl>
                {entry!.staleReason ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                    <strong>Staleness reason:</strong> {entry!.staleReason}
                  </div>
                ) : null}
                {entry!.structuredData !== null ? (
                  <details className="rounded-lg border p-3 text-xs">
                    <summary className="cursor-pointer font-medium">Structured fields</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(entry!.structuredData, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </section>

              <Separator />
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <LinkIcon className="size-4" />
                  <h3 className="font-semibold">Sources</h3>
                </div>
                {detail.sources.length === 0 ? (
                  <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                    No resolvable source is attached. Treat this claim as unsupported until
                    provenance is added.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {detail.sources.map((source) => (
                      <SourceReference key={source.id} source={source} />
                    ))}
                  </ul>
                )}
                <form
                  className="mt-3 grid grid-cols-[1fr_auto] gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (sourcePath.trim().length === 0) return;
                    void onAddSource({
                      sourceType: "repository_file",
                      sourceIdentifier: sourcePath.trim(),
                      projectId: entry!.projectId,
                      repositoryPath: sourcePath.trim(),
                      filePath: sourcePath.trim(),
                      startLine: null,
                      endLine: null,
                      commitHash: sourceCommit.trim() || null,
                      branchName: entry!.branchName,
                      missionId: entry!.missionId,
                      taskId: entry!.taskId,
                      agentRunId: null,
                      verificationRunId: null,
                      githubRecordType: null,
                      githubRecordId: null,
                      messageReference: null,
                      contentFingerprint: null,
                    }).then((saved) => {
                      if (saved) {
                        setSourcePath("");
                        setSourceCommit("");
                      }
                    });
                  }}
                >
                  <div className="grid gap-2">
                    <Input
                      aria-label="Repository source path"
                      placeholder="Attach repository path"
                      value={sourcePath}
                      onValueChange={setSourcePath}
                    />
                    <Input
                      aria-label="Source commit"
                      placeholder="Commit (optional)"
                      value={sourceCommit}
                      onValueChange={setSourceCommit}
                    />
                  </div>
                  <Button disabled={busy || sourcePath.trim().length === 0} size="sm" type="submit">
                    <PlusIcon />
                    Add source
                  </Button>
                </form>
              </section>

              <Separator />
              <section className="grid gap-2">
                <h3 className="font-semibold">Lifecycle and corrections</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() => void onAction(entry!.pinned ? "unpin" : "pin", null)}
                  >
                    <PinIcon />
                    {entry!.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() => void onAction("verify", "Verified by user in memory workspace")}
                  >
                    <ShieldCheckIcon />
                    Verify
                  </Button>
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() => void onAction("mark_stale", "Marked stale by user")}
                  >
                    <CircleAlertIcon />
                    Mark stale
                  </Button>
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    onClick={() => void onAction("dispute", "Disputed by user")}
                  >
                    <GitBranchIcon />
                    Dispute
                  </Button>
                  {entry!.status === "archived" ||
                  entry!.status === "stale" ||
                  entry!.status === "disputed" ? (
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => void onAction("restore", "Restored by user")}
                    >
                      <BookOpenIcon />
                      Restore
                    </Button>
                  ) : (
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => void onAction("archive", "Archived by user")}
                    >
                      <ArchiveIcon />
                      Archive
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Archiving preserves history. This workspace intentionally has no casual
                  permanent-delete action.
                </p>
                <form
                  className="mt-2 grid gap-2 rounded-lg border p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!replacementId.trim() || !supersedeReason.trim()) return;
                    void onSupersede(replacementId.trim(), supersedeReason.trim());
                  }}
                >
                  <p className="text-sm font-medium">Supersede with another memory</p>
                  <Input
                    aria-label="Replacement memory ID"
                    placeholder="Replacement memory ID"
                    value={replacementId}
                    onValueChange={setReplacementId}
                  />
                  <Textarea
                    aria-label="Supersession reason"
                    placeholder="Why does the newer claim replace this one?"
                    value={supersedeReason}
                    onChange={(event) => setSupersedeReason(event.currentTarget.value)}
                  />
                  <Button
                    className="justify-self-start"
                    disabled={busy || !replacementId.trim() || !supersedeReason.trim()}
                    size="sm"
                    type="submit"
                  >
                    Supersede, preserving history
                  </Button>
                </form>
              </section>

              <Separator />
              <section className="grid gap-2">
                <h3 className="font-semibold">Relations</h3>
                {detail.relations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No related, supporting, superseding, or contradicting memories.
                  </p>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {detail.relations.map((relation) => (
                      <li key={relation.id} className="rounded-lg border p-2">
                        <Badge variant="outline">
                          {humanizeMemoryValue(relation.relationType)}
                        </Badge>{" "}
                        <span className="break-all">
                          {relation.fromMemoryEntryId === entry!.id
                            ? relation.toMemoryEntryId
                            : relation.fromMemoryEntryId}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="mt-2 grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!relatedMemoryId.trim()) return;
                    void onCreateRelation(relatedMemoryId.trim(), relationType).then((saved) => {
                      if (saved) setRelatedMemoryId("");
                    });
                  }}
                >
                  <Input
                    aria-label="Related memory ID"
                    placeholder="Related memory ID"
                    value={relatedMemoryId}
                    onValueChange={setRelatedMemoryId}
                  />
                  <select
                    aria-label="Memory relationship"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={relationType}
                    onChange={(event) =>
                      setRelationType(event.currentTarget.value as MemoryRelationType)
                    }
                  >
                    {RELATION_TYPES.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {humanizeMemoryValue(candidate)}
                      </option>
                    ))}
                  </select>
                  <Button disabled={busy || !relatedMemoryId.trim()} size="sm" type="submit">
                    Add relation
                  </Button>
                </form>
              </section>

              <Separator />
              <section className="grid gap-2">
                <h3 className="font-semibold">Lifecycle history</h3>
                <ol className="grid gap-2">
                  {detail.lifecycle.map((record) => (
                    <li
                      key={record.id}
                      className="rounded-lg border p-3 text-sm [content-visibility:auto]"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{humanizeMemoryValue(record.action)}</span>
                        <time className="text-xs text-muted-foreground">
                          {formatMemoryDate(record.createdAt)}
                        </time>
                      </div>
                      {record.reason ? (
                        <p className="mt-1 text-muted-foreground">{record.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

export interface CreateMemoryPreset {
  readonly type?: MemoryEntryType;
  readonly scopeType?: MemoryScopeType;
  readonly branchName?: string | null;
  readonly title?: string;
}

export function CreateMemoryDialog({
  open,
  projectId,
  currentBranch,
  preset,
  busy,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly projectId: ProjectId;
  readonly currentBranch: string | null;
  readonly preset: CreateMemoryPreset | null;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: CreateMemoryEntryInput) => Promise<boolean>;
}) {
  const [scopeType, setScopeType] = useState<MemoryScopeType>(preset?.scopeType ?? "project");
  const [type, setType] = useState<MemoryEntryType>(preset?.type ?? "custom");
  const [trustLevel, setTrustLevel] = useState<MemoryTrustLevel>("authoritative");
  const [title, setTitle] = useState(preset?.title ?? "");
  const [content, setContent] = useState("");
  const [branchName, setBranchName] = useState(preset?.branchName ?? currentBranch ?? "");
  const [missionId, setMissionId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [sourcePath, setSourcePath] = useState("");

  const scopeReady =
    (scopeType !== "branch" || branchName.trim().length > 0) &&
    (scopeType !== "mission" || missionId.trim().length > 0) &&
    (scopeType !== "task" || (missionId.trim().length > 0 && taskId.trim().length > 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save project knowledge</DialogTitle>
          <DialogDescription>
            The selected scope is always visible. Explicit memories retain a manual source, and
            repository paths may be attached for stronger provenance.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const branch = scopeType === "branch" ? branchName.trim() : null;
            const mission =
              scopeType === "mission" || scopeType === "task"
                ? MissionId.make(missionId.trim())
                : null;
            const task = scopeType === "task" ? MissionTaskId.make(taskId.trim()) : null;
            const scopedProjectId = scopeType === "user" ? null : projectId;
            const scopeId =
              scopeType === "user"
                ? null
                : scopeType === "project"
                  ? projectId
                  : scopeType === "branch"
                    ? branch
                    : scopeType === "mission"
                      ? mission
                      : task;
            const repositorySource: MemorySourceDraft | null =
              sourcePath.trim().length === 0
                ? null
                : {
                    sourceType: "repository_file",
                    sourceIdentifier: sourcePath.trim(),
                    projectId: scopedProjectId,
                    repositoryPath: sourcePath.trim(),
                    filePath: sourcePath.trim(),
                    startLine: null,
                    endLine: null,
                    commitHash: null,
                    branchName: branch,
                    missionId: mission,
                    taskId: task,
                    agentRunId: null,
                    verificationRunId: null,
                    githubRecordType: null,
                    githubRecordId: null,
                    messageReference: null,
                    contentFingerprint: null,
                  };
            const manualSource: MemorySourceDraft = {
              sourceType: "manual_entry",
              sourceIdentifier: "Explicitly saved in the memory workspace",
              projectId: scopedProjectId,
              repositoryPath: null,
              filePath: null,
              startLine: null,
              endLine: null,
              commitHash: null,
              branchName: branch,
              missionId: mission,
              taskId: task,
              agentRunId: null,
              verificationRunId: null,
              githubRecordType: null,
              githubRecordId: null,
              messageReference: null,
              contentFingerprint: null,
            };
            void onCreate({
              scopeType,
              scopeId,
              projectId: scopedProjectId,
              branchName: branch,
              missionId: mission,
              taskId: task,
              type,
              title: title.trim(),
              content: content.trim(),
              structuredData: null,
              trustLevel,
              confidence: trustLevel === "authoritative" ? 1 : 0.9,
              creationMode: "explicit",
              createdByType: "user",
              createdById: null,
              sources:
                repositorySource === null ? [manualSource] : [manualSource, repositorySource],
              pinned: false,
              expiresAt: null,
            }).then((created) => created && onOpenChange(false));
          }}
        >
          <DialogPanel className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FilterSelect
                label="Scope"
                value={scopeType}
                values={MEMORY_SCOPES}
                onChange={(value) => value && setScopeType(value)}
              />
              <FilterSelect
                label="Type"
                value={type}
                values={MEMORY_TYPES}
                onChange={(value) => value && setType(value)}
              />
              <FilterSelect
                label="Trust"
                value={trustLevel}
                values={MEMORY_TRUST_LEVELS.filter((value) => value !== "disputed")}
                onChange={(value) => value && setTrustLevel(value)}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <strong>Applies to:</strong> {humanizeMemoryValue(scopeType)}
              {scopeType === "project" ? ` ${projectId}` : ""}
            </div>
            {scopeType === "branch" ? (
              <Input
                aria-label="Branch name"
                required
                placeholder="agent/mission/task"
                value={branchName}
                onValueChange={setBranchName}
              />
            ) : null}
            {scopeType === "mission" || scopeType === "task" ? (
              <Input
                aria-label="Mission ID"
                required
                placeholder="Mission ID"
                value={missionId}
                onValueChange={setMissionId}
              />
            ) : null}
            {scopeType === "task" ? (
              <Input
                aria-label="Task ID"
                required
                placeholder="Task ID"
                value={taskId}
                onValueChange={setTaskId}
              />
            ) : null}
            <Input
              aria-label="Memory title"
              required
              placeholder="Concise claim title"
              value={title}
              onValueChange={setTitle}
            />
            <Textarea
              aria-label="Memory content"
              required
              placeholder="What should future agents know? Keep it concise and reusable."
              value={content}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
            <Input
              aria-label="Repository source path"
              placeholder="Repository source path (optional)"
              value={sourcePath}
              onValueChange={setSourcePath}
            />
            <p className="text-xs text-muted-foreground">
              A path without a resolved fingerprint remains visibly unresolved; the UI never invents
              commit or line citations.
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !scopeReady || !title.trim() || !content.trim()}
              type="submit"
            >
              Save memory
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function useDeferredMemoryQuery(query: string): string {
  return useDeferredValue(query);
}

export function replacementMemoryId(value: string) {
  return MemoryEntryId.make(value);
}

export function currentIsoDateTime() {
  return IsoDateTime.make(new Date().toISOString());
}
