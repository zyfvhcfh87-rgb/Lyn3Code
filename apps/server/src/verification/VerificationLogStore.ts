// @effect-diagnostics nodeBuiltinImport:off - durable verification logs use explicit file descriptors.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { makeVerificationChunkRedactor, redactVerificationText } from "./VerificationRedaction.ts";
import type { VerificationOutputChunk } from "./VerificationProcessRunner.ts";

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const TRUNCATION_TEXT = "\n[verification log truncated: configured byte limit reached]\n";

const safeEvidenceSegment = (value: string): string => {
  const prefix = value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  const digest = NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
  return `${prefix || "evidence"}-${digest}`;
};

export interface VerificationLogRecord {
  readonly cursor: number;
  readonly observedAt: string;
  readonly stream: "stdout" | "stderr" | "system";
  readonly text: string;
  readonly truncated: boolean;
}

const VerificationLogRecordSchema = Schema.Struct({
  cursor: Schema.Int,
  observedAt: Schema.String,
  stream: Schema.Literals(["stdout", "stderr", "system"]),
  text: Schema.String,
  truncated: Schema.Boolean,
});
const VerificationLogRecordFromJson = Schema.fromJsonString(VerificationLogRecordSchema);
const decodeLogRecord = Schema.decodeUnknownOption(VerificationLogRecordFromJson);

export interface VerificationLogPage {
  readonly records: ReadonlyArray<VerificationLogRecord>;
  readonly nextCursor: number;
  readonly hasMore: boolean;
}

export interface VerificationLogWriter {
  readonly logReference: string;
  readonly textReference: string;
  readonly append: (
    chunk: VerificationOutputChunk,
  ) => Effect.Effect<ReadonlyArray<VerificationLogRecord>, VerificationLogStoreError>;
  readonly close: () => Effect.Effect<
    ReadonlyArray<VerificationLogRecord>,
    VerificationLogStoreError
  >;
}

export class VerificationLogStoreError extends Schema.TaggedErrorClass<VerificationLogStoreError>()(
  "VerificationLogStoreError",
  {
    operation: Schema.Literals(["open", "append", "close", "read"]),
    filePath: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Verification log ${this.operation} failed at ${this.filePath}: ${this.detail}`;
  }
}

interface WriterState {
  readonly ndjsonDescriptor: number;
  readonly textDescriptor: number;
  readonly nextCursor: number;
  readonly bytesWritten: number;
  readonly truncated: boolean;
  readonly closed: boolean;
}

const encodeRecord = (record: VerificationLogRecord): string => `${JSON.stringify(record)}\n`;

const formatTextRecord = (record: VerificationLogRecord): string =>
  `[${record.observedAt}] [${record.stream}] ${record.text}`;

export class VerificationLogStore extends Context.Service<
  VerificationLogStore,
  {
    readonly open: (input: {
      readonly rootDirectory: string;
      readonly runId: string;
      readonly checkRunId: string;
      readonly secrets: ReadonlyArray<string>;
      readonly maxBytes?: number;
    }) => Effect.Effect<VerificationLogWriter, VerificationLogStoreError>;
    readonly read: (input: {
      readonly rootDirectory: string;
      readonly logReference: string;
      readonly cursor?: number;
      readonly limit?: number;
    }) => Effect.Effect<VerificationLogPage, VerificationLogStoreError>;
  }
>()("t3/verification/VerificationLogStore") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const open: VerificationLogStore["Service"]["open"] = Effect.fn("VerificationLogStore.open")(
    function* (input) {
      if (
        input.runId.length === 0 ||
        input.checkRunId.length === 0 ||
        input.runId.length > 1_000 ||
        input.checkRunId.length > 1_000 ||
        input.runId.includes("\0") ||
        input.checkRunId.includes("\0")
      ) {
        return yield* new VerificationLogStoreError({
          operation: "open",
          filePath: input.rootDirectory,
          detail: "Run and check identifiers must be safe single path segments.",
        });
      }
      const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 * 1024) {
        return yield* new VerificationLogStoreError({
          operation: "open",
          filePath: input.rootDirectory,
          detail: "Log byte limit must be a positive integer no larger than 2 GiB.",
        });
      }
      const rootDirectory = path.resolve(input.rootDirectory);
      const runSegment = safeEvidenceSegment(input.runId);
      const checkSegment = safeEvidenceSegment(input.checkRunId);
      const runDirectory = path.join(rootDirectory, runSegment);
      yield* fileSystem.makeDirectory(runDirectory, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new VerificationLogStoreError({
              operation: "open",
              filePath: runDirectory,
              detail: "Unable to create the managed verification log directory.",
              cause,
            }),
        ),
      );
      const logReference = `${runSegment}/${checkSegment}.ndjson`;
      const textReference = `${runSegment}/${checkSegment}.log`;
      const ndjsonPath = path.join(rootDirectory, runSegment, `${checkSegment}.ndjson`);
      const textPath = path.join(rootDirectory, runSegment, `${checkSegment}.log`);
      const [ndjsonDescriptor, textDescriptor] = yield* Effect.try({
        try: () => {
          const ndjson = NodeFS.openSync(ndjsonPath, "wx", 0o600);
          try {
            return [ndjson, NodeFS.openSync(textPath, "wx", 0o600)] as const;
          } catch (cause) {
            NodeFS.closeSync(ndjson);
            throw cause;
          }
        },
        catch: (cause) =>
          new VerificationLogStoreError({
            operation: "open",
            filePath: ndjsonPath,
            detail: "Unable to create new durable log files without overwriting prior evidence.",
            cause,
          }),
      });
      const redactor = makeVerificationChunkRedactor(input.secrets);
      const state = yield* SynchronizedRef.make<WriterState>({
        ndjsonDescriptor,
        textDescriptor,
        nextCursor: 0,
        bytesWritten: 0,
        truncated: false,
        closed: false,
      });

      const persist = (
        records: ReadonlyArray<Omit<VerificationLogRecord, "cursor">>,
      ): Effect.Effect<ReadonlyArray<VerificationLogRecord>, VerificationLogStoreError> =>
        SynchronizedRef.modifyEffect(state, (current) => {
          if (current.closed || current.truncated || records.length === 0) {
            const empty: Array<VerificationLogRecord> = [];
            return Effect.succeed([empty, current] as const);
          }
          const persisted: Array<VerificationLogRecord> = [];
          let nextCursor = current.nextCursor;
          let bytesWritten = current.bytesWritten;
          let truncated = false;
          for (const candidate of records) {
            const record: VerificationLogRecord = { ...candidate, cursor: nextCursor++ };
            const ndjson = encodeRecord(record);
            const text = formatTextRecord(record);
            const bytes = Buffer.byteLength(ndjson) + Buffer.byteLength(text);
            if (bytesWritten + bytes > maxBytes) {
              const truncationRecord: VerificationLogRecord = {
                cursor: nextCursor++,
                observedAt: record.observedAt,
                stream: "system",
                text: TRUNCATION_TEXT,
                truncated: true,
              };
              persisted.push(truncationRecord);
              bytesWritten +=
                Buffer.byteLength(encodeRecord(truncationRecord)) +
                Buffer.byteLength(formatTextRecord(truncationRecord));
              truncated = true;
              break;
            }
            persisted.push(record);
            bytesWritten += bytes;
          }
          return Effect.try({
            try: () => {
              for (const record of persisted) {
                NodeFS.writeSync(current.ndjsonDescriptor, encodeRecord(record));
                NodeFS.writeSync(current.textDescriptor, formatTextRecord(record));
              }
              return [persisted, { ...current, nextCursor, bytesWritten, truncated }] as const;
            },
            catch: (cause) =>
              new VerificationLogStoreError({
                operation: "append",
                filePath: ndjsonPath,
                detail: "Unable to append redacted verification output.",
                cause,
              }),
          });
        });

      const append: VerificationLogWriter["append"] = Effect.fn("VerificationLogWriter.append")(
        function* (chunk) {
          const redacted = redactor.push(chunk.stream, chunk.text);
          return yield* persist(
            redacted.map((text) => ({
              observedAt: chunk.observedAt,
              stream: chunk.stream,
              text,
              truncated: false,
            })),
          );
        },
      );

      const close: VerificationLogWriter["close"] = Effect.fn("VerificationLogWriter.close")(
        function* () {
          const now = DateTime.formatIso(yield* DateTime.now);
          const flushed = yield* persist(
            redactor.flush().map((entry) => ({
              observedAt: now,
              stream: entry.stream,
              text: entry.text,
              truncated: false,
            })),
          );
          yield* SynchronizedRef.modifyEffect(state, (current) => {
            if (current.closed) return Effect.succeed([undefined, current] as const);
            return Effect.try({
              try: () => {
                NodeFS.fsyncSync(current.ndjsonDescriptor);
                NodeFS.fsyncSync(current.textDescriptor);
                NodeFS.closeSync(current.ndjsonDescriptor);
                NodeFS.closeSync(current.textDescriptor);
                return [undefined, { ...current, closed: true }] as const;
              },
              catch: (cause) =>
                new VerificationLogStoreError({
                  operation: "close",
                  filePath: ndjsonPath,
                  detail: "Unable to flush and close durable verification logs.",
                  cause,
                }),
            });
          });
          return flushed;
        },
      );

      return { logReference, textReference, append, close } satisfies VerificationLogWriter;
    },
  );

  const read: VerificationLogStore["Service"]["read"] = Effect.fn("VerificationLogStore.read")(
    function* (input) {
      const rootDirectory = path.resolve(input.rootDirectory);
      const requested = path.resolve(rootDirectory, input.logReference);
      const relative = path.relative(rootDirectory, requested);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return yield* new VerificationLogStoreError({
          operation: "read",
          filePath: requested,
          detail: "Log reference escapes the managed verification log root.",
        });
      }
      const raw = yield* fileSystem.readFileString(requested).pipe(
        Effect.mapError(
          (cause) =>
            new VerificationLogStoreError({
              operation: "read",
              filePath: requested,
              detail: "Unable to read durable verification log evidence.",
              cause,
            }),
        ),
      );
      const cursor = Math.max(0, input.cursor ?? 0);
      const limit = Math.min(1_000, Math.max(1, input.limit ?? 200));
      const all = raw
        .split("\n")
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          const decoded = decodeLogRecord(line);
          return decoded._tag === "Some" ? [decoded.value] : [];
        });
      const records = all.filter((record) => record.cursor >= cursor).slice(0, limit);
      const nextCursor = records.at(-1)?.cursor === undefined ? cursor : records.at(-1)!.cursor + 1;
      return {
        records,
        nextCursor,
        hasMore: all.some((record) => record.cursor >= nextCursor),
      } satisfies VerificationLogPage;
    },
  );

  return VerificationLogStore.of({ open, read });
});

export const layer = Layer.effect(VerificationLogStore, make);

export { redactVerificationText };
