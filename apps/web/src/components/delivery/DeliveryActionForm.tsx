"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";

export function DeliveryActionForm({
  actionLabel,
  confirmationLabel,
  onConfirm,
  destructive = false,
}: {
  actionLabel: string;
  confirmationLabel: string;
  onConfirm: (reason: string) => void | Promise<void>;
  destructive?: boolean;
}) {
  const confirmationId = useId();
  const reasonId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const canSubmit = confirmed && trimmedReason.length > 0 && !isSubmitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmedReason);
      setConfirmed(false);
      setReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">{actionLabel}</summary>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <label className="flex items-start gap-2" htmlFor={confirmationId}>
          <Checkbox
            id={confirmationId}
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <span className="leading-relaxed">{confirmationLabel}</span>
        </label>
        <div>
          <label className="font-medium" htmlFor={reasonId}>
            Reason
          </label>
          <Textarea
            id={reasonId}
            className="mt-1"
            size="sm"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="Record why this action is appropriate"
            required
          />
        </div>
        {error ? (
          <p className="text-destructive-foreground" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          size="xs"
          variant={destructive ? "destructive" : "default"}
          disabled={!canSubmit}
          type="submit"
        >
          {isSubmitting ? "Submitting…" : `Confirm ${actionLabel.toLowerCase()}`}
        </Button>
      </form>
    </details>
  );
}
