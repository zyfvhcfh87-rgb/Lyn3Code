import type { VerificationOutputStream } from "./VerificationProcessRunner.ts";

const REDACTION_MARKER = "[REDACTED]";
const MAX_UNTERMINATED_BUFFER = 64 * 1024;
const PATTERN_OVERLAP = 4 * 1024;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const redactCredentialPatterns = (value: string): string =>
  value
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, `$1${REDACTION_MARKER}`)
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\s*[=:]\s*)[^\s,;]+/gi,
      `$1${REDACTION_MARKER}`,
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)=)[^&#\s]+/gi,
      `$1${REDACTION_MARKER}`,
    );

export const redactVerificationText = (value: string, secrets: ReadonlyArray<string>): string => {
  let redacted = value;
  for (const secret of [...new Set(secrets.filter((entry) => entry.length >= 4))].sort(
    (left, right) => right.length - left.length,
  )) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), "g"), REDACTION_MARKER);
  }
  return redactCredentialPatterns(redacted);
};

/**
 * Redacts output before it reaches either live subscribers or durable storage.
 * Per-stream tails keep secrets safe even when a process splits them across
 * arbitrary byte chunks.
 */
export const makeVerificationChunkRedactor = (secrets: ReadonlyArray<string>) => {
  const maximumSecretLength = Math.max(0, ...secrets.map((secret) => secret.length));
  const protectedTailLength = Math.max(PATTERN_OVERLAP, maximumSecretLength - 1);
  const buffers: Record<VerificationOutputStream, string> = { stdout: "", stderr: "" };

  const push = (stream: VerificationOutputStream, text: string): ReadonlyArray<string> => {
    const combined = buffers[stream] + text;
    const lastNewline = Math.max(combined.lastIndexOf("\n"), combined.lastIndexOf("\r"));
    if (lastNewline >= 0) {
      const complete = combined.slice(0, lastNewline + 1);
      buffers[stream] = combined.slice(lastNewline + 1);
      return [redactVerificationText(complete, secrets)];
    }
    if (combined.length <= MAX_UNTERMINATED_BUFFER + protectedTailLength) {
      buffers[stream] = combined;
      return [];
    }
    const emitLength = combined.length - protectedTailLength;
    buffers[stream] = combined.slice(emitLength);
    return [redactVerificationText(combined.slice(0, emitLength), secrets)];
  };

  const flush = (
    stream?: VerificationOutputStream,
  ): ReadonlyArray<{
    readonly stream: VerificationOutputStream;
    readonly text: string;
  }> => {
    const streams: ReadonlyArray<VerificationOutputStream> =
      stream === undefined ? ["stdout", "stderr"] : [stream];
    return streams.flatMap((streamName) => {
      const text = buffers[streamName];
      buffers[streamName] = "";
      return text.length === 0
        ? []
        : [{ stream: streamName, text: redactVerificationText(text, secrets) }];
    });
  };

  return { push, flush };
};
