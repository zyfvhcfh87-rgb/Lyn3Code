import type {
  CreateMemoryEntryInput,
  MemoryEntry,
  MemoryEntryId,
  MemoryProposal,
  ReviewMemoryProposalInput,
} from "@t3tools/contracts";
import { MemoryEntryId as MemoryEntryIdSchema } from "@t3tools/contracts";
import { CircleAlertIcon, FileCheckIcon, GitMergeIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

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
import { Textarea } from "../ui/textarea";
import { humanizeMemoryValue } from "./MemoryEntryPanels";

export interface MemoryProposalReviewHints {
  readonly duplicateIds: ReadonlyArray<MemoryEntryId>;
  readonly contradictions: ReadonlyArray<{
    readonly id: MemoryEntryId;
    readonly relationship: "overlapping_scope" | "narrower_scope_exception";
  }>;
}

const scopeDepth: Readonly<Record<MemoryEntry["scopeType"], number>> = {
  user: 1,
  project: 2,
  branch: 3,
  mission: 4,
  task: 5,
};

const normalizedClaim = (value: string) => value.trim().replaceAll(/\s+/g, " ").toLowerCase();

function proposalScopeCanOverlap(proposal: MemoryProposal, memory: MemoryEntry): boolean {
  if (memory.projectId !== null && memory.projectId !== proposal.projectId) return false;
  if (
    proposal.branchName !== null &&
    memory.branchName !== null &&
    proposal.branchName !== memory.branchName
  ) {
    return false;
  }
  if (
    proposal.missionId !== null &&
    memory.missionId !== null &&
    proposal.missionId !== memory.missionId
  ) {
    return false;
  }
  return !(proposal.taskId !== null && memory.taskId !== null && proposal.taskId !== memory.taskId);
}

/** Explainable review hints; callers decide whether to merge, narrow, or retain both claims. */
export function findMemoryProposalReviewHints(
  proposal: MemoryProposal,
  memories: ReadonlyArray<MemoryEntry>,
): MemoryProposalReviewHints {
  const title = normalizedClaim(proposal.proposedTitle);
  const content = normalizedClaim(proposal.proposedContent);
  const applicable = memories.filter(
    (memory) =>
      memory.status === "active" &&
      proposalScopeCanOverlap(proposal, memory) &&
      normalizedClaim(memory.title) === title,
  );
  return {
    duplicateIds: applicable
      .filter((memory) => normalizedClaim(memory.content) === content)
      .map((memory) => memory.id),
    contradictions: applicable
      .filter((memory) => normalizedClaim(memory.content) !== content)
      .map((memory) => ({
        id: memory.id,
        relationship:
          scopeDepth[memory.scopeType] === scopeDepth[proposal.scopeType]
            ? ("overlapping_scope" as const)
            : ("narrower_scope_exception" as const),
      })),
  };
}

function editedEntryFromProposal(
  proposal: MemoryProposal,
  title: string,
  content: string,
): CreateMemoryEntryInput {
  return {
    scopeType: proposal.scopeType,
    scopeId: proposal.scopeId,
    projectId: proposal.scopeType === "user" ? null : proposal.projectId,
    branchName: proposal.branchName,
    missionId: proposal.missionId,
    taskId: proposal.taskId,
    type: proposal.proposedType,
    title: title.trim(),
    content: content.trim(),
    structuredData: proposal.proposedStructuredData,
    trustLevel: proposal.proposedTrustLevel,
    confidence: proposal.confidence,
    creationMode: "proposed",
    createdByType: "user",
    createdById: null,
    sources: proposal.sourceReferences,
    pinned: false,
    expiresAt: proposal.expiresAt,
  };
}

function ProposalReviewDialog({
  proposal,
  open,
  busy,
  onOpenChange,
  onReview,
}: {
  readonly proposal: MemoryProposal | null;
  readonly open: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReview: (input: ReviewMemoryProposalInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(proposal?.proposedTitle ?? "");
  const [content, setContent] = useState(proposal?.proposedContent ?? "");
  if (!proposal) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit and accept proposal</DialogTitle>
          <DialogDescription>
            Correct the reusable claim before it enters normal retrieval. Its proposal remains in
            the review history.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onReview({
              proposalId: proposal.id,
              action: "edit_and_accept",
              reviewedBy: "user",
              rejectionReason: null,
              duplicateOfMemoryEntryId: null,
              mergeIntoMemoryEntryId: null,
              editedEntry: editedEntryFromProposal(proposal, title, content),
            }).then((saved) => saved && onOpenChange(false));
          }}
        >
          <DialogPanel className="grid gap-3">
            <Input
              aria-label="Edited proposal title"
              required
              value={title}
              onValueChange={setTitle}
            />
            <Textarea
              aria-label="Edited proposal claim"
              required
              value={content}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !title.trim() || !content.trim()} type="submit">
              Accept corrected memory
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function MemoryProposalQueue({
  proposals,
  candidateMemories,
  total,
  loading,
  error,
  busy,
  onReview,
}: {
  readonly proposals: ReadonlyArray<MemoryProposal>;
  readonly candidateMemories: ReadonlyArray<MemoryEntry>;
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onReview: (input: ReviewMemoryProposalInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<MemoryProposal | null>(null);
  const [targetByProposal, setTargetByProposal] = useState<Record<string, string>>({});
  const review = (
    proposal: MemoryProposal,
    action: ReviewMemoryProposalInput["action"],
    target: MemoryEntryId | null = null,
  ) =>
    onReview({
      proposalId: proposal.id,
      action,
      reviewedBy: "user",
      rejectionReason: action === "reject" ? "Rejected in proposal review" : null,
      duplicateOfMemoryEntryId: action === "mark_duplicate" ? target : null,
      mergeIntoMemoryEntryId: action === "merge" ? target : null,
      editedEntry: null,
    });

  if (error) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-foreground">
        {error}
      </p>
    );
  }
  if (!loading && proposals.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center rounded-xl border border-dashed p-8 text-center">
        <div>
          <FileCheckIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="font-medium">Proposal queue is clear</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Agent-extracted claims wait here for human review before trusted retrieval.
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">{total} proposals in this review view</p>
      <div className="grid gap-3">
        {proposals.map((proposal) => {
          const targetValue = targetByProposal[proposal.id] ?? "";
          const target = targetValue.trim() ? MemoryEntryIdSchema.make(targetValue.trim()) : null;
          const hints = findMemoryProposalReviewHints(proposal, candidateMemories);
          return (
            <article
              key={proposal.id}
              className="grid gap-3 rounded-xl border bg-card p-4 [content-visibility:auto] [contain-intrinsic-size:auto_16rem]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto font-semibold">{proposal.proposedTitle}</h3>
                <Badge variant="warning">{humanizeMemoryValue(proposal.status)}</Badge>
                <Badge variant="outline">{humanizeMemoryValue(proposal.scopeType)}</Badge>
                <Badge variant="outline">{humanizeMemoryValue(proposal.proposedTrustLevel)}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm">{proposal.proposedContent}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Suggested type</dt>
                <dd>{humanizeMemoryValue(proposal.proposedType)}</dd>
                <dt className="text-muted-foreground">Confidence</dt>
                <dd>{Math.round(proposal.confidence * 100)}%</dd>
                <dt className="text-muted-foreground">Extraction source</dt>
                <dd>{proposal.extractionSource}</dd>
                <dt className="text-muted-foreground">Supporting references</dt>
                <dd>{proposal.sourceReferences.length}</dd>
                <dt className="text-muted-foreground">Potential duplicate</dt>
                <dd>{proposal.duplicateOfMemoryEntryId ?? "Not linked"}</dd>
              </dl>
              {hints.duplicateIds.length > 0 ? (
                <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
                  <strong>Potential duplicates:</strong>{" "}
                  <span className="break-all">{hints.duplicateIds.join(", ")}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Exact normalized title and claim match in an overlapping active scope.
                  </p>
                </div>
              ) : null}
              {hints.contradictions.length > 0 ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <strong>Potential contradiction or scoped exception:</strong>
                  <ul className="mt-1 grid gap-1">
                    {hints.contradictions.map((hint) => (
                      <li key={hint.id} className="break-all text-xs">
                        {hint.id} — {humanizeMemoryValue(hint.relationship)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Both claims remain visible. Review, narrow scope, supersede, or retain the
                    exception; the UI does not silently choose a winner.
                  </p>
                </div>
              ) : null}
              {proposal.sourceReferences.length === 0 ? (
                <p className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs">
                  <CircleAlertIcon className="mr-1 inline size-3.5" />
                  No supporting references are attached. Review this as unverified context.
                </p>
              ) : null}
              {proposal.status === "pending" || proposal.status === "deferred" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy}
                      size="sm"
                      onClick={() => void review(proposal, "accept")}
                    >
                      Accept
                    </Button>
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(proposal)}
                    >
                      <PencilIcon />
                      Edit and accept
                    </Button>
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => void review(proposal, "defer")}
                    >
                      Defer
                    </Button>
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => void review(proposal, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto]">
                    <Input
                      aria-label={`Existing memory ID for ${proposal.proposedTitle}`}
                      placeholder="Existing memory ID for duplicate or merge"
                      value={targetValue}
                      onValueChange={(value) =>
                        setTargetByProposal((current) => ({ ...current, [proposal.id]: value }))
                      }
                    />
                    <Button
                      disabled={busy || target === null}
                      size="sm"
                      variant="outline"
                      onClick={() => target && void review(proposal, "mark_duplicate", target)}
                    >
                      Mark duplicate
                    </Button>
                    <Button
                      disabled={busy || target === null}
                      size="sm"
                      variant="outline"
                      onClick={() => target && void review(proposal, "merge", target)}
                    >
                      <GitMergeIcon />
                      Merge
                    </Button>
                  </div>
                </>
              ) : null}
            </article>
          );
        })}
      </div>
      <ProposalReviewDialog
        key={editing?.id ?? "none"}
        proposal={editing}
        open={editing !== null}
        busy={busy}
        onOpenChange={(open) => !open && setEditing(null)}
        onReview={onReview}
      />
    </>
  );
}
