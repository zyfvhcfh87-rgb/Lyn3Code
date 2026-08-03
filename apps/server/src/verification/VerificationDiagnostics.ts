import * as Schema from "effect/Schema";

import type { VerificationDiagnosticParser } from "@t3tools/contracts";

const MAX_DIAGNOSTICS = 1_000;
const MAX_MESSAGE_LENGTH = 8_000;

export interface ParsedVerificationDiagnostic {
  readonly severity: "info" | "warning" | "error" | "fatal";
  readonly category: string;
  readonly message: string;
  readonly filePath: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly code: string | null;
}

export interface VerificationDiagnosticParseResult {
  readonly diagnostics: ReadonlyArray<ParsedVerificationDiagnostic>;
  readonly parserWarning: string | null;
  readonly truncated: boolean;
}

const EslintMessage = Schema.Struct({
  ruleId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  severity: Schema.optionalKey(Schema.Int),
  message: Schema.String,
  line: Schema.optionalKey(Schema.Int),
  column: Schema.optionalKey(Schema.Int),
});
const EslintResult = Schema.Struct({
  filePath: Schema.String,
  messages: Schema.Array(EslintMessage),
});
const EslintOutputFromJson = Schema.fromJsonString(Schema.Array(EslintResult));
const decodeEslintOutput = Schema.decodeUnknownOption(EslintOutputFromJson);

const normalizeFilePath = (value: string): string => value.replaceAll("\\", "/");
const safePosition = (value: number | undefined): number | null =>
  value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
const safeMessage = (value: string): string => value.trim().slice(0, MAX_MESSAGE_LENGTH);

const genericPatterns = [
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>fatal|error|warning|warn|info)?\s*(?<code>[A-Za-z]+\d+)?\s*:?\s*(?<message>.+)$/,
  /^(?<file>(?:[A-Za-z]:)?[^:\r\n]+?):(?<line>\d+):(?<column>\d+)(?:\s*[-:]\s*)?(?<severity>fatal|error|warning|warn|info)?\s*(?<code>[A-Za-z]+\d+)?\s*:?\s*(?<message>.+)$/,
] as const;

const parseGeneric = (
  text: string,
  category: string,
): ReadonlyArray<ParsedVerificationDiagnostic> => {
  const diagnostics: Array<ParsedVerificationDiagnostic> = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    for (const pattern of genericPatterns) {
      const match = pattern.exec(line);
      if (match?.groups === undefined) continue;
      const severity = match.groups.severity?.toLocaleLowerCase("en-US");
      diagnostics.push({
        severity:
          severity === "fatal"
            ? "fatal"
            : severity === "warning" || severity === "warn"
              ? "warning"
              : severity === "info"
                ? "info"
                : "error",
        category,
        message: safeMessage(match.groups.message ?? line),
        filePath: match.groups.file ? normalizeFilePath(match.groups.file.trim()) : null,
        line: match.groups.line ? Number(match.groups.line) : null,
        column: match.groups.column ? Number(match.groups.column) : null,
        code: match.groups.code ?? null,
      });
      break;
    }
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
  }
  return diagnostics;
};

const parseEslint = (text: string): VerificationDiagnosticParseResult => {
  const decoded = decodeEslintOutput(text.trim());
  if (decoded._tag === "None") {
    return {
      diagnostics: [],
      parserWarning: "ESLint output was not valid supported JSON; inspect the preserved raw log.",
      truncated: false,
    };
  }
  const diagnostics = decoded.value.flatMap((result) =>
    result.messages.map(
      (message): ParsedVerificationDiagnostic => ({
        severity: (message.severity ?? 2) >= 2 ? "error" : "warning",
        category: "lint_error",
        message: safeMessage(message.message),
        filePath: normalizeFilePath(result.filePath),
        line: safePosition(message.line),
        column: safePosition(message.column),
        code: message.ruleId ?? null,
      }),
    ),
  );
  return {
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    parserWarning: null,
    truncated: diagnostics.length > MAX_DIAGNOSTICS,
  };
};

export const parseVerificationDiagnostics = (input: {
  readonly parser: VerificationDiagnosticParser;
  readonly stdout: string;
  readonly stderr: string;
}): VerificationDiagnosticParseResult => {
  const text = [input.stdout, input.stderr].filter((value) => value.length > 0).join("\n");
  if (input.parser === "none") {
    return { diagnostics: [], parserWarning: null, truncated: false };
  }
  if (input.parser === "eslint") {
    return parseEslint(text);
  }
  const category =
    input.parser === "typescript"
      ? "type_error"
      : input.parser === "test"
        ? "test_failure"
        : input.parser === "build"
          ? "build_error"
          : "source_error";
  const diagnostics = parseGeneric(text, category);
  return {
    diagnostics,
    parserWarning:
      diagnostics.length === 0 && text.trim().length > 0
        ? `The ${input.parser} parser found no structured diagnostics; inspect the preserved raw log.`
        : null,
    truncated: diagnostics.length >= MAX_DIAGNOSTICS,
  };
};
