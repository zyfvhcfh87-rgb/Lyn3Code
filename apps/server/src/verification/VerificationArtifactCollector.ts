// @effect-diagnostics nodeBuiltinImport:off - bounded artifact copying is a Node filesystem boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type {
  T3ProjectVerificationArtifactRule,
  VerificationArtifactType,
} from "@t3tools/contracts";

import { matchesVerificationGlob } from "./VerificationPlan.ts";
import type { AuthorizedVerificationWorktree } from "./VerificationPathGuard.ts";
import { redactVerificationText } from "./VerificationRedaction.ts";

const DEFAULT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TOTAL_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_FILES = 200;
const DENIED_SEGMENTS = new Set([".git", ".t3", ".ssh"]);
const DENIED_FILE_PATTERN = /^(?:\.env(?:\..*)?|.*(?:secret|credential|private[-_.]?key).*)$/i;
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
};

const safeEvidenceSegment = (value: string): string => {
  const prefix = value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const digest = NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
  return `${prefix || "evidence"}-${digest}`;
};

export interface CollectedVerificationArtifact {
  readonly type: VerificationArtifactType;
  readonly name: string;
  readonly sourcePath: string;
  readonly path: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export class VerificationArtifactCollectionError extends Schema.TaggedErrorClass<VerificationArtifactCollectionError>()(
  "VerificationArtifactCollectionError",
  {
    reason: Schema.Literals([
      "invalid_pattern",
      "unsafe_path",
      "required_missing",
      "file_too_large",
      "total_too_large",
      "too_many_files",
      "secret_detected",
      "read_failed",
      "write_failed",
    ]),
    sourcePath: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification artifact rejected (${this.reason}): ${this.detail}`;
  }
}

const isVerificationArtifactCollectionError = Schema.is(VerificationArtifactCollectionError);

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

const isDenied = (relativePath: string): boolean => {
  const segments = normalizePath(relativePath).split("/");
  return (
    segments.some((segment) => DENIED_SEGMENTS.has(segment.toLocaleLowerCase("en-US"))) ||
    DENIED_FILE_PATTERN.test(segments.at(-1) ?? "")
  );
};

const staticPatternRoot = (pattern: string): string => {
  const normalized = normalizePath(pattern);
  const wildcard = normalized.search(/[?*]/u);
  const fixed = wildcard < 0 ? normalized : normalized.slice(0, wildcard);
  const slash = fixed.lastIndexOf("/");
  return slash < 0 ? "." : fixed.slice(0, slash) || ".";
};

const looksLikeText = (bytes: Buffer, extension: string): boolean =>
  [".json", ".xml", ".html", ".txt", ".log", ".md", ".csv", ".lcov", ".tap"].includes(extension) ||
  !bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);

const containsSecret = (bytes: Buffer, secrets: ReadonlyArray<string>): boolean =>
  secrets.some((secret) => secret.length >= 4 && bytes.includes(Buffer.from(secret)));

export class VerificationArtifactCollector extends Context.Service<
  VerificationArtifactCollector,
  {
    readonly collect: (input: {
      readonly worktree: AuthorizedVerificationWorktree;
      readonly artifactRoot: string;
      readonly runId: string;
      readonly checkRunId: string;
      readonly rules: ReadonlyArray<T3ProjectVerificationArtifactRule>;
      readonly secrets: ReadonlyArray<string>;
      readonly maxFiles?: number;
      readonly maxTotalBytes?: number;
    }) => Effect.Effect<
      ReadonlyArray<CollectedVerificationArtifact>,
      VerificationArtifactCollectionError
    >;
  }
>()("t3/verification/VerificationArtifactCollector") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const collect: VerificationArtifactCollector["Service"]["collect"] = Effect.fn(
    "VerificationArtifactCollector.collect",
  )(function* (input) {
    if (
      input.runId.length === 0 ||
      input.checkRunId.length === 0 ||
      input.runId.length > 1_000 ||
      input.checkRunId.length > 1_000 ||
      input.runId.includes("\0") ||
      input.checkRunId.includes("\0")
    ) {
      return yield* new VerificationArtifactCollectionError({
        reason: "unsafe_path",
        sourcePath: input.artifactRoot,
        detail: "Run and check identifiers must be safe single path segments.",
      });
    }
    const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
    const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_TOTAL_MAX_BYTES;
    const outputDirectory = path.resolve(
      input.artifactRoot,
      safeEvidenceSegment(input.runId),
      safeEvidenceSegment(input.checkRunId),
    );
    yield* fileSystem.makeDirectory(outputDirectory, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new VerificationArtifactCollectionError({
            reason: "write_failed",
            sourcePath: outputDirectory,
            detail: "Unable to create the managed verification artifact directory.",
            cause,
          }),
      ),
    );

    const seen = new Set<string>();
    const selected: Array<{
      readonly rule: T3ProjectVerificationArtifactRule;
      readonly relativePath: string;
      readonly canonicalPath: string;
    }> = [];
    for (const rule of input.rules) {
      const normalizedPattern = normalizePath(rule.pattern);
      if (
        normalizedPattern === "*" ||
        normalizedPattern === "**" ||
        normalizedPattern === "**/*" ||
        path.isAbsolute(rule.pattern) ||
        normalizedPattern.split("/").includes("..")
      ) {
        return yield* new VerificationArtifactCollectionError({
          reason: "invalid_pattern",
          sourcePath: rule.pattern,
          detail: "Artifact patterns must be bounded beneath the assigned worktree.",
        });
      }
      const searchRoot = path.resolve(
        input.worktree.canonicalRoot,
        staticPatternRoot(rule.pattern),
      );
      const searchRelative = path.relative(input.worktree.canonicalRoot, searchRoot);
      if (
        searchRelative === ".." ||
        searchRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(searchRelative)
      ) {
        return yield* new VerificationArtifactCollectionError({
          reason: "unsafe_path",
          sourcePath: rule.pattern,
          detail: "Artifact search root escapes the assigned worktree.",
        });
      }
      const rootExists = yield* fileSystem
        .exists(searchRoot)
        .pipe(Effect.orElseSucceed(() => false));
      if (!rootExists) {
        if (rule.required ?? false) {
          return yield* new VerificationArtifactCollectionError({
            reason: "required_missing",
            sourcePath: rule.pattern,
            detail: "The required artifact pattern produced no files.",
          });
        }
        continue;
      }
      const candidates = yield* Effect.tryPromise({
        try: async () => {
          const found: Array<string> = [];
          const walk = async (directory: string): Promise<void> => {
            const entries = await NodeFS.promises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
              const absolute = path.join(directory, entry.name);
              const relative = normalizePath(path.relative(input.worktree.canonicalRoot, absolute));
              if (isDenied(relative)) continue;
              if (entry.isSymbolicLink()) {
                if (matchesVerificationGlob(relative, normalizedPattern)) {
                  throw new VerificationArtifactCollectionError({
                    reason: "unsafe_path",
                    sourcePath: relative,
                    detail: "Artifact collection does not follow symbolic links or junctions.",
                  });
                }
                continue;
              }
              if (entry.isDirectory()) {
                await walk(absolute);
              } else if (entry.isFile() && matchesVerificationGlob(relative, normalizedPattern)) {
                found.push(relative);
              }
              if (found.length > maxFiles) {
                throw new VerificationArtifactCollectionError({
                  reason: "too_many_files",
                  sourcePath: rule.pattern,
                  detail: `Artifact collection exceeded the ${maxFiles} file limit.`,
                });
              }
            }
          };
          const rootInfo = await NodeFS.promises.lstat(searchRoot);
          if (rootInfo.isSymbolicLink()) {
            throw new VerificationArtifactCollectionError({
              reason: "unsafe_path",
              sourcePath: rule.pattern,
              detail: "Artifact search root is a symbolic link or junction.",
            });
          }
          if (rootInfo.isDirectory()) await walk(searchRoot);
          else {
            const relative = normalizePath(path.relative(input.worktree.canonicalRoot, searchRoot));
            if (matchesVerificationGlob(relative, normalizedPattern)) found.push(relative);
          }
          return found.sort();
        },
        catch: (cause) =>
          isVerificationArtifactCollectionError(cause)
            ? cause
            : new VerificationArtifactCollectionError({
                reason: "read_failed",
                sourcePath: searchRoot,
                detail: "Unable to enumerate configured artifacts.",
                cause,
              }),
      });
      if (candidates.length === 0 && (rule.required ?? false)) {
        return yield* new VerificationArtifactCollectionError({
          reason: "required_missing",
          sourcePath: rule.pattern,
          detail: "The required artifact pattern produced no files.",
        });
      }
      for (const relativePath of candidates) {
        const canonicalPath = yield* fileSystem
          .realPath(path.resolve(input.worktree.canonicalRoot, relativePath))
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerificationArtifactCollectionError({
                  reason: "unsafe_path",
                  sourcePath: relativePath,
                  detail: "Unable to canonicalize artifact candidate.",
                  cause,
                }),
            ),
          );
        const canonicalRelative = path.relative(input.worktree.canonicalRoot, canonicalPath);
        if (
          canonicalRelative === ".." ||
          canonicalRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(canonicalRelative)
        ) {
          return yield* new VerificationArtifactCollectionError({
            reason: "unsafe_path",
            sourcePath: relativePath,
            detail: "Artifact candidate resolves outside the assigned worktree.",
          });
        }
        if (!seen.has(canonicalPath)) {
          seen.add(canonicalPath);
          selected.push({ rule, relativePath, canonicalPath });
        }
      }
    }

    let totalBytes = 0;
    const collected: Array<CollectedVerificationArtifact> = [];
    for (const [index, candidate] of selected.entries()) {
      const info = yield* fileSystem.stat(candidate.canonicalPath).pipe(
        Effect.mapError(
          (cause) =>
            new VerificationArtifactCollectionError({
              reason: "read_failed",
              sourcePath: candidate.relativePath,
              detail: "Unable to inspect artifact candidate.",
              cause,
            }),
        ),
      );
      const fileMaxBytes = candidate.rule.maxBytes ?? DEFAULT_FILE_MAX_BYTES;
      if (Number(info.size) > fileMaxBytes) {
        return yield* new VerificationArtifactCollectionError({
          reason: "file_too_large",
          sourcePath: candidate.relativePath,
          detail: `Artifact is ${info.size} bytes; limit is ${fileMaxBytes}.`,
        });
      }
      totalBytes += Number(info.size);
      if (totalBytes > maxTotalBytes) {
        return yield* new VerificationArtifactCollectionError({
          reason: "total_too_large",
          sourcePath: candidate.relativePath,
          detail: `Artifact collection exceeds the ${maxTotalBytes} byte total limit.`,
        });
      }
      const raw = yield* Effect.try({
        try: () => NodeFS.readFileSync(candidate.canonicalPath),
        catch: (cause) =>
          new VerificationArtifactCollectionError({
            reason: "read_failed",
            sourcePath: candidate.relativePath,
            detail: "Unable to read artifact candidate.",
            cause,
          }),
      });
      const extension = path.extname(candidate.relativePath).toLocaleLowerCase("en-US");
      let evidence = raw;
      let redacted = false;
      if (looksLikeText(raw, extension)) {
        const original = raw.toString("utf8");
        const safe = redactVerificationText(original, input.secrets);
        evidence = Buffer.from(safe, "utf8");
        redacted = safe !== original;
      } else if (containsSecret(raw, input.secrets)) {
        return yield* new VerificationArtifactCollectionError({
          reason: "secret_detected",
          sourcePath: candidate.relativePath,
          detail: "A binary artifact contained a known secret and was not collected.",
        });
      }
      const outputName = `${String(index).padStart(4, "0")}-${path.basename(candidate.relativePath)}`;
      const outputPath = path.join(outputDirectory, outputName);
      yield* Effect.try({
        try: () => NodeFS.writeFileSync(outputPath, evidence, { flag: "wx", mode: 0o600 }),
        catch: (cause) =>
          new VerificationArtifactCollectionError({
            reason: "write_failed",
            sourcePath: candidate.relativePath,
            detail: "Unable to write immutable artifact evidence.",
            cause,
          }),
      });
      const checksum = NodeCrypto.createHash("sha256").update(evidence).digest("hex");
      collected.push({
        type: candidate.rule.type ?? "custom",
        name: candidate.rule.name ?? path.basename(candidate.relativePath),
        sourcePath: candidate.relativePath,
        path: normalizePath(path.relative(input.artifactRoot, outputPath)),
        mimeType: MIME_TYPES[extension] ?? null,
        sizeBytes: evidence.byteLength,
        checksum,
        metadata: {
          configuredPattern: candidate.rule.pattern,
          redacted,
          originalSizeBytes: Number(info.size),
        },
      });
    }
    return collected;
  });

  return VerificationArtifactCollector.of({ collect });
});

export const layer = Layer.effect(VerificationArtifactCollector, make);
