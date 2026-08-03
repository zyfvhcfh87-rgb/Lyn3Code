import type {
  IndexedSource,
  MemoryIndexOperationType,
  MemoryRetrievalRecord,
  MemorySettings,
  MemoryStaleBehavior,
  MemoryWorkspaceSnapshot,
  UpdateMemorySettingsInput,
} from "@t3tools/contracts";
import { IsoDateTime } from "@t3tools/contracts";
import {
  CircleAlertIcon,
  DatabaseIcon,
  FileWarningIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { describesRemoteCodeUpload } from "@t3tools/client-runtime/state/memory";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { formatMemoryDate, humanizeMemoryValue } from "./MemoryEntryPanels";

function Stat({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function MemoryOverview({ snapshot }: { readonly snapshot: MemoryWorkspaceSnapshot }) {
  return (
    <div className="grid gap-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active memories" value={snapshot.activeMemoryCount} />
        <Stat label="Pending proposals" value={snapshot.proposalCount} />
        <Stat label="Stale memories" value={snapshot.staleMemoryCount} />
        <Stat label="Visible conflicts" value={snapshot.conflictCount} />
      </section>
      <section className="grid gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <DatabaseIcon className="mt-0.5 size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Source-backed project memory</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Trusted claims stay separate from raw conversation history. Each entry exposes its
              scope, trust, freshness, provenance, corrections, and retrieval usage.
            </p>
          </div>
          <Badge variant={snapshot.settings.enabled ? "success" : "secondary"}>
            {snapshot.settings.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <strong>Index:</strong> {humanizeMemoryValue(snapshot.indexStatus.status)}
          </p>
          <p>
            <strong>Current source:</strong> {snapshot.indexStatus.currentBranch ?? "No branch"}
            {snapshot.indexStatus.currentCommit
              ? ` @ ${snapshot.indexStatus.currentCommit.slice(0, 12)}`
              : ""}
          </p>
          <p>
            <strong>Retrieval:</strong>{" "}
            {snapshot.settings.lexicalOnly
              ? "Lexical only"
              : snapshot.settings.semanticRetrievalEnabled
                ? "Hybrid"
                : "Lexical"}
          </p>
          <p>
            <strong>Last retrieval:</strong> {formatMemoryDate(snapshot.lastRetrievalAt)}
          </p>
        </div>
      </section>
      <section className="grid gap-2 rounded-xl border bg-muted/24 p-5">
        <h2 className="font-semibold">Trust is visible, not implied</h2>
        <p className="text-sm text-muted-foreground">
          Authoritative current sources outrank inferred summaries. Disputed, stale, superseded,
          rejected, and branch-specific knowledge remains inspectable without silently overriding
          the current task, permissions, or safety rules.
        </p>
      </section>
    </div>
  );
}

export function MemoryRepositoryIndex({
  snapshot,
  sources,
  total,
  loading,
  error,
  busy,
  onRequest,
  onPauseChange,
}: {
  readonly snapshot: MemoryWorkspaceSnapshot;
  readonly sources: ReadonlyArray<IndexedSource>;
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onRequest: (operation: MemoryIndexOperationType) => Promise<boolean>;
  readonly onPauseChange: (paused: boolean) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState<"full_reindex" | "clear_derived_index" | null>(null);
  const status = snapshot.indexStatus;
  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Indexed files" value={status.indexedFiles} />
        <Stat label="Indexed chunks" value={status.indexedChunks} />
        <Stat label="Skipped paths" value={status.skippedPaths} />
        <Stat label="Failed files" value={status.failedFiles} />
      </section>
      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              status.status === "current"
                ? "success"
                : status.status === "failed"
                  ? "error"
                  : "warning"
            }
          >
            {humanizeMemoryValue(status.status)}
          </Badge>
          <Badge variant="outline">Embeddings: {humanizeMemoryValue(status.embeddingStatus)}</Badge>
          <span className="text-xs text-muted-foreground">
            Last indexed {formatMemoryDate(status.lastIndexedAt)}
          </span>
        </div>
        {status.currentOperation ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <strong>{humanizeMemoryValue(status.currentOperation.operationType)}</strong> —{" "}
            {humanizeMemoryValue(status.currentOperation.status)};{" "}
            {status.currentOperation.processedSources} processed,{" "}
            {status.currentOperation.changedSources} changed,{" "}
            {status.currentOperation.failedSources} failed.
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || snapshot.settings.indexingPaused}
            size="sm"
            onClick={() => void onRequest("refresh_changed")}
          >
            <RefreshCwIcon />
            Refresh changed files
          </Button>
          <Button
            disabled={busy}
            size="sm"
            variant="outline"
            onClick={() => setConfirming("full_reindex")}
          >
            Full safe reindex
          </Button>
          <Button
            disabled={busy}
            size="sm"
            variant="outline"
            onClick={() => void onPauseChange(!snapshot.settings.indexingPaused)}
          >
            {snapshot.settings.indexingPaused ? <PlayIcon /> : <PauseIcon />}
            {snapshot.settings.indexingPaused ? "Resume indexing" : "Pause indexing"}
          </Button>
          <Button
            disabled={busy}
            size="sm"
            variant="outline"
            onClick={() => setConfirming("clear_derived_index")}
          >
            <Trash2Icon />
            Clear derived index
          </Button>
        </div>
        {confirming ? (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
            <p className="font-medium">
              {confirming === "full_reindex"
                ? "Rebuild the safe derived index?"
                : "Clear only derived search data?"}
            </p>
            <p className="mt-1 text-muted-foreground">
              Manual and trusted memory history will not be deleted.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={busy}
                size="sm"
                onClick={() =>
                  void onRequest(confirming).then((done) => done && setConfirming(null))
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">
          Indexed sources ({total})
        </div>
        {loading && sources.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Loading index…</p>
        ) : null}
        {sources.map((source) => (
          <div
            key={source.id}
            className="grid gap-1 border-b p-4 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_6rem]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto break-all text-sm font-medium">
                {source.relativePath ?? source.sourceIdentifier}
              </span>
              <Badge
                variant={
                  source.indexStatus === "indexed"
                    ? "success"
                    : source.indexStatus === "failed"
                      ? "error"
                      : "warning"
                }
              >
                {humanizeMemoryValue(source.indexStatus)}
              </Badge>
              <Badge variant="outline">
                {source.commitHash
                  ? `Commit ${source.commitHash.slice(0, 10)}`
                  : "Dirty or external"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              <span>{source.language ?? humanizeMemoryValue(source.sourceType)}</span>
              <span>{source.sizeBytes.toLocaleString()} bytes</span>
              <span>{source.branchName ?? "Project source"}</span>
              <span>{formatMemoryDate(source.lastIndexedAt)}</span>
            </div>
            {source.skipReason ? (
              <p className="text-xs text-warning-foreground">Skipped: {source.skipReason}</p>
            ) : null}
            {source.lastError ? (
              <p className="text-xs text-destructive-foreground">
                <FileWarningIcon className="mr-1 inline size-3.5" />
                {source.lastError}
              </p>
            ) : null}
          </div>
        ))}
        {!loading && sources.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No sources indexed yet.</p>
        ) : null}
      </section>
    </div>
  );
}

export function MemoryRetrievalHistory({
  records,
  total,
  loading,
  error,
}: {
  readonly records: ReadonlyArray<MemoryRetrievalRecord>;
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  const [selected, setSelected] = useState<MemoryRetrievalRecord | null>(null);
  if (error)
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-foreground">
        {error}
      </p>
    );
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{total} audited agent retrievals</p>
      {loading && records.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading retrieval history…</p>
      ) : null}
      {records.map((record) => (
        <button
          key={record.id}
          className="grid gap-2 rounded-xl border bg-card p-4 text-left [content-visibility:auto] hover:bg-muted/35"
          type="button"
          onClick={() => setSelected(record)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto line-clamp-1 font-medium">
              {record.query || "Context assembled without a textual query"}
            </span>
            <Badge
              variant={
                record.status === "completed"
                  ? "success"
                  : record.status === "failed"
                    ? "error"
                    : "warning"
              }
            >
              {humanizeMemoryValue(record.status)}
            </Badge>
            <Badge variant="outline">{humanizeMemoryValue(record.retrievalMode)}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>{record.selectedMemoryIds.length} memories</span>
            <span>{record.selectedChunkIds.length} excerpts</span>
            <span>{record.tokenEstimate} estimated tokens</span>
            <span>{record.excludedCandidateCount} excluded</span>
            <span>{formatMemoryDate(record.createdAt)}</span>
          </div>
          {selected?.id === record.id ? (
            <div
              className="mt-1 grid gap-2 rounded-lg border bg-muted/25 p-3 text-xs"
              onClick={(event) => event.stopPropagation()}
            >
              <p>
                <strong>Scope:</strong> {record.branchName ?? "project"}
                {record.missionId ? ` · mission ${record.missionId}` : ""}
                {record.taskId ? ` · task ${record.taskId}` : ""}
              </p>
              <p className="break-all">
                <strong>Selected memory IDs:</strong>{" "}
                {record.selectedMemoryIds.join(", ") || "None"}
              </p>
              <p className="break-all">
                <strong>Selected chunk IDs:</strong> {record.selectedChunkIds.join(", ") || "None"}
              </p>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded bg-background p-2">
                {JSON.stringify(record.rankingMetadata, null, 2)}
              </pre>
              {record.errorSummary ? (
                <p className="text-destructive-foreground">{record.errorSummary}</p>
              ) : null}
            </div>
          ) : null}
        </button>
      ))}
      {!loading && records.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-xl border border-dashed p-8 text-center">
          <div>
            <SearchCheckIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="font-medium">No retrieval audits yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When an agent receives memory context, its query, selected records, token estimate,
              and ranking metadata appear here.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

export function MemorySettingsPanel({
  settings,
  busy,
  onSave,
}: {
  readonly settings: MemorySettings;
  readonly busy: boolean;
  readonly onSave: (input: UpdateMemorySettingsInput) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(settings);
  const [remoteConsent, setRemoteConsent] = useState(settings.remoteCodeUploadAcceptedAt !== null);
  const [exclusions, setExclusions] = useState(settings.repositoryExclusions.join("\n"));
  const privacyState = describesRemoteCodeUpload(draft);
  const remoteNeedsConsent = privacyState === "consent_required" && !remoteConsent;

  return (
    <form
      className="grid max-w-3xl gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const remoteAcceptedAt =
          draft.semanticRetrievalEnabled && draft.embeddingProviderKind === "remote"
            ? (draft.remoteCodeUploadAcceptedAt ??
              (remoteConsent ? IsoDateTime.make(new Date().toISOString()) : null))
            : null;
        void onSave({
          projectId: settings.projectId,
          enabled: draft.enabled,
          automaticProposalGeneration: draft.automaticProposalGeneration,
          automaticAuthoritativeIndexing: draft.automaticAuthoritativeIndexing,
          repositoryExclusions: exclusions
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean),
          maximumIndexedFileSizeBytes: draft.maximumIndexedFileSizeBytes,
          contextTokenBudget: draft.contextTokenBudget,
          lexicalOnly: draft.lexicalOnly,
          semanticRetrievalEnabled: draft.semanticRetrievalEnabled,
          embeddingProviderKind: draft.embeddingProviderKind,
          embeddingProviderId: draft.embeddingProviderId,
          embeddingModel: draft.embeddingModel,
          embeddingDimensions: draft.embeddingDimensions,
          remoteCodeUploadAcceptedAt: remoteAcceptedAt,
          proposalRetentionDays: draft.proposalRetentionDays,
          staleMemoryBehavior: draft.staleMemoryBehavior,
          indexingPaused: draft.indexingPaused,
        });
      }}
    >
      <section className="grid gap-3">
        <h2 className="font-semibold">Memory behavior</h2>
        <SettingRow
          label="Enable memory for this project"
          description="When disabled, agent context assembly returns no project memory."
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <SettingRow
          label="Generate review proposals"
          description="Agents may propose reusable knowledge; proposals do not become trusted automatically."
          checked={draft.automaticProposalGeneration}
          onCheckedChange={(automaticProposalGeneration) =>
            setDraft({ ...draft, automaticProposalGeneration })
          }
        />
        <SettingRow
          label="Index deterministic repository facts"
          description="Only directly sourced facts may activate automatically and they stale when sources change."
          checked={draft.automaticAuthoritativeIndexing}
          onCheckedChange={(automaticAuthoritativeIndexing) =>
            setDraft({ ...draft, automaticAuthoritativeIndexing })
          }
        />
      </section>

      <section className="grid gap-3 rounded-xl border p-4">
        <h2 className="font-semibold">Retrieval and privacy</h2>
        <SettingRow
          label="Lexical-only mode"
          description="Keeps retrieval fully local and deterministic without embeddings."
          checked={draft.lexicalOnly}
          onCheckedChange={(lexicalOnly) =>
            setDraft({
              ...draft,
              lexicalOnly,
              semanticRetrievalEnabled: lexicalOnly ? false : draft.semanticRetrievalEnabled,
            })
          }
        />
        <SettingRow
          label="Enable semantic retrieval"
          description="Optional. Lexical retrieval remains available whenever semantic search is disabled or unavailable."
          checked={draft.semanticRetrievalEnabled}
          onCheckedChange={(semanticRetrievalEnabled) =>
            setDraft({
              ...draft,
              semanticRetrievalEnabled,
              lexicalOnly: semanticRetrievalEnabled ? false : draft.lexicalOnly,
            })
          }
        />
        {draft.semanticRetrievalEnabled ? (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Embedding provider
              <select
                className="h-8 rounded-lg border border-input bg-background px-2"
                value={draft.embeddingProviderKind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    embeddingProviderKind: event.currentTarget
                      .value as MemorySettings["embeddingProviderKind"],
                    embeddingProviderId: null,
                    embeddingModel: null,
                    embeddingDimensions: null,
                    remoteCodeUploadAcceptedAt: null,
                  })
                }
              >
                <option value="none">None (lexical fallback)</option>
                <option value="local">Local</option>
                <option value="remote">Remote</option>
              </select>
            </label>
            {draft.embeddingProviderKind !== "none" ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label="Embedding provider ID"
                  placeholder="Provider ID"
                  value={draft.embeddingProviderId ?? ""}
                  onValueChange={(embeddingProviderId) =>
                    setDraft({ ...draft, embeddingProviderId: embeddingProviderId || null })
                  }
                />
                <Input
                  aria-label="Embedding model"
                  placeholder="Model and version"
                  value={draft.embeddingModel ?? ""}
                  onValueChange={(embeddingModel) =>
                    setDraft({ ...draft, embeddingModel: embeddingModel || null })
                  }
                />
                <Input
                  aria-label="Embedding dimensions"
                  min={1}
                  nativeInput
                  type="number"
                  placeholder="Dimensions"
                  value={draft.embeddingDimensions ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      embeddingDimensions: event.currentTarget.value
                        ? Number(event.currentTarget.value)
                        : null,
                    })
                  }
                />
              </div>
            ) : null}
            {draft.embeddingProviderKind === "remote" ? (
              <div className="grid gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <p>
                  <ShieldAlertIcon className="mr-1 inline size-4" />
                  <strong>Remote-code-upload warning:</strong> selected source chunks may leave this
                  machine for embedding. Provider identity, model, and consent are recorded. No
                  upload occurs until you save explicit consent.
                </p>
                <label className="flex items-start gap-2">
                  <Checkbox checked={remoteConsent} onCheckedChange={setRemoteConsent} />
                  <span>
                    I understand what repository content may be sent to the named remote provider.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 rounded-xl border p-4">
        <h2 className="font-semibold">Limits and retention</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            Context token budget
            <Input
              min={0}
              nativeInput
              type="number"
              value={draft.contextTokenBudget}
              onChange={(event) =>
                setDraft({ ...draft, contextTokenBudget: Number(event.currentTarget.value) })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Maximum file size (bytes)
            <Input
              min={1}
              nativeInput
              type="number"
              value={draft.maximumIndexedFileSizeBytes}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  maximumIndexedFileSizeBytes: Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Proposal retention (days)
            <Input
              min={1}
              nativeInput
              type="number"
              value={draft.proposalRetentionDays}
              onChange={(event) =>
                setDraft({ ...draft, proposalRetentionDays: Number(event.currentTarget.value) })
              }
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          Stale-memory behavior
          <select
            className="h-8 rounded-lg border border-input bg-background px-2"
            value={draft.staleMemoryBehavior}
            onChange={(event) =>
              setDraft({
                ...draft,
                staleMemoryBehavior: event.currentTarget.value as MemoryStaleBehavior,
              })
            }
          >
            <option value="exclude">Exclude</option>
            <option value="demote">Demote</option>
            <option value="include_labeled">Include with label</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Repository exclusions
          <Textarea
            aria-label="Repository exclusions"
            placeholder="One relative glob or path per line"
            value={exclusions}
            onChange={(event) => setExclusions(event.currentTarget.value)}
          />
          <span className="text-xs text-muted-foreground">
            Secret-bearing, generated, dependency, cache, binary, and out-of-root paths remain
            protected even when not listed here.
          </span>
        </label>
      </section>

      {remoteNeedsConsent ? (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <CircleAlertIcon className="mr-1 inline size-4" />
          Explicit consent is required before remote semantic retrieval can be saved.
        </p>
      ) : null}
      <Button className="justify-self-start" disabled={busy || remoteNeedsConsent} type="submit">
        Save memory settings
      </Button>
    </form>
  );
}
