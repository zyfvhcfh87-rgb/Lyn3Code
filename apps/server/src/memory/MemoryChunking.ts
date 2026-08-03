import { fingerprintMemorySource } from "./MemorySourceSecurity.ts";

const DEFAULT_MAXIMUM_CHUNK_CHARACTERS = 16_000;

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".php": "php",
  ".prisma": "prisma",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shell",
};

export type MemoryChunkStructure =
  | "code_symbol"
  | "configuration_section"
  | "document_heading"
  | "logical_block"
  | "test_case";

export interface MemoryChunkSymbolMetadata {
  readonly structure: MemoryChunkStructure;
  readonly language: string | null;
  readonly symbols: ReadonlyArray<string>;
  readonly imports: ReadonlyArray<string>;
  readonly heading: string | null;
}

export interface MemorySourceChunk {
  readonly chunkIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly contentFingerprint: string;
  readonly tokenEstimate: number;
  readonly symbolMetadata: MemoryChunkSymbolMetadata;
}

export interface ChunkMemorySourceInput {
  readonly relativePath: string;
  readonly content: string;
  readonly maximumChunkCharacters?: number;
}

interface ChunkBoundary {
  readonly line: number;
  readonly structure: MemoryChunkStructure;
  readonly name: string | null;
}

interface RawChunk {
  readonly startLine: number;
  readonly endLine: number;
  readonly structure: MemoryChunkStructure;
  readonly name: string | null;
}

const uniqueSortedBoundaries = (boundaries: ReadonlyArray<ChunkBoundary>): ChunkBoundary[] => {
  const byLine = new Map<number, ChunkBoundary>();
  for (const boundary of boundaries) {
    const existing = byLine.get(boundary.line);
    if (
      existing === undefined ||
      (existing.structure === "logical_block" && boundary.structure !== "logical_block")
    ) {
      byLine.set(boundary.line, boundary);
    }
  }
  return [...byLine.values()].sort((left, right) => left.line - right.line);
};

const markdownBoundaries = (lines: ReadonlyArray<string>): ReadonlyArray<ChunkBoundary> =>
  lines.flatMap((line, index) => {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    return match === null
      ? []
      : [{ line: index + 1, structure: "document_heading" as const, name: match[1] ?? null }];
  });

const configurationBoundaries = (
  lines: ReadonlyArray<string>,
  language: string | null,
): ReadonlyArray<ChunkBoundary> => {
  if (language === "json") {
    const boundaries: ChunkBoundary[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^(?: {2}|\t)"([^"\\]+)"\s*:/.exec(lines[index] ?? "");
      if (match !== null) {
        boundaries.push({
          line: boundaries.length === 0 ? 1 : index + 1,
          structure: "configuration_section",
          name: match[1] ?? null,
        });
      }
    }
    return boundaries;
  }
  if (language === "yaml" || language === "toml") {
    return lines.flatMap((line, index) => {
      const yaml = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
      const toml = /^\[([^\]]+)\]\s*$/.exec(line);
      const name = yaml?.[1] ?? toml?.[1];
      return name === undefined
        ? []
        : [{ line: index + 1, structure: "configuration_section" as const, name }];
    });
  }
  return [];
};

const TEST_DECLARATION =
  /^\s*(?:(?:describe|suite|context|it|test)(?:\.(?:only|skip|todo|each))?\s*\(\s*[`'"]([^`'"]+)|(?:def|async\s+def)\s+(test_[A-Za-z0-9_]+)|(?:func\s+)(Test[A-Za-z0-9_]+))/;

const CODE_DECLARATIONS: ReadonlyArray<RegExp> = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl|mod)\s+([A-Za-z_][\w]*)/,
  /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/,
  /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+)*(?:class|interface|enum|record|struct)\s+([A-Za-z_][\w]*)/,
  /^\s*(?:export\s+)?(?:func|type)\s+([A-Za-z_][\w]*)/,
  /^\s*(?:open\s+|public\s+|private\s+|internal\s+|fileprivate\s+)*(?:final\s+)?(?:class|struct|enum|protocol|actor|func)\s+([A-Za-z_][\w]*)/,
];

const codeBoundaries = (lines: ReadonlyArray<string>): ReadonlyArray<ChunkBoundary> => {
  const boundaries: ChunkBoundary[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const test = TEST_DECLARATION.exec(line);
    const testName = test?.[1] ?? test?.[2] ?? test?.[3];
    if (testName !== undefined) {
      boundaries.push({ line: index + 1, structure: "test_case", name: testName });
      continue;
    }
    for (const declaration of CODE_DECLARATIONS) {
      const match = declaration.exec(line);
      if (match?.[1] !== undefined) {
        boundaries.push({ line: index + 1, structure: "code_symbol", name: match[1] });
        break;
      }
    }
  }
  return boundaries;
};

const fallbackBoundaries = (lines: ReadonlyArray<string>): ReadonlyArray<ChunkBoundary> => {
  const boundaries: ChunkBoundary[] = [];
  let previousWasBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const isBlank = (lines[index] ?? "").trim().length === 0;
    if (!isBlank && previousWasBlank) {
      boundaries.push({ line: index + 1, structure: "logical_block", name: null });
    }
    previousWasBlank = isBlank;
  }
  return boundaries;
};

const rangesFromBoundaries = (
  boundaries: ReadonlyArray<ChunkBoundary>,
  lineCount: number,
): ReadonlyArray<RawChunk> => {
  if (lineCount === 0) return [];
  const sorted = uniqueSortedBoundaries([
    { line: 1, structure: "logical_block", name: null },
    ...boundaries,
  ]).filter((boundary) => boundary.line >= 1 && boundary.line <= lineCount);
  return sorted.map((boundary, index) => ({
    startLine: boundary.line,
    endLine: (sorted[index + 1]?.line ?? lineCount + 1) - 1,
    structure: boundary.structure,
    name: boundary.name,
  }));
};

const splitOversizedRange = (
  range: RawChunk,
  lines: ReadonlyArray<string>,
  maximumCharacters: number,
): ReadonlyArray<RawChunk> => {
  const chunks: RawChunk[] = [];
  let startLine = range.startLine;
  let currentCharacters = 0;
  for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber += 1) {
    const lineCharacters = (lines[lineNumber - 1]?.length ?? 0) + 1;
    if (lineNumber > startLine && currentCharacters + lineCharacters > maximumCharacters) {
      chunks.push({ ...range, startLine, endLine: lineNumber - 1 });
      startLine = lineNumber;
      currentCharacters = 0;
    }
    currentCharacters += lineCharacters;
  }
  chunks.push({ ...range, startLine, endLine: range.endLine });
  return chunks;
};

const importsForContent = (content: string): ReadonlyArray<string> => {
  const imports = new Set<string>();
  for (const line of content.split("\n")) {
    const match =
      /^\s*import(?:[\s\S]*?from\s*)?["']([^"']+)["']/.exec(line) ??
      /^\s*(?:const|let|var)\s+.*?=\s*require\(["']([^"']+)["']\)/.exec(line) ??
      /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line) ??
      /^\s*use\s+([^;]+);/.exec(line);
    const imported = match?.[1] ?? match?.[2];
    if (imported !== undefined) imports.add(imported);
  }
  return [...imports].sort();
};

const symbolsForContent = (content: string, initialName: string | null): ReadonlyArray<string> => {
  const symbols = new Set<string>();
  if (initialName !== null) symbols.add(initialName);
  for (const line of content.split("\n")) {
    const test = TEST_DECLARATION.exec(line);
    const testName = test?.[1] ?? test?.[2] ?? test?.[3];
    if (testName !== undefined) symbols.add(testName);
    for (const declaration of CODE_DECLARATIONS) {
      const match = declaration.exec(line);
      if (match?.[1] !== undefined) symbols.add(match[1]);
    }
  }
  return [...symbols];
};

export const detectMemorySourceLanguage = (relativePath: string): string | null => {
  const fileName = (relativePath.replaceAll("\\", "/").split("/").at(-1) ?? "").toLowerCase();
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "makefile";
  const dot = fileName.lastIndexOf(".");
  const extension = dot <= 0 ? "" : fileName.slice(dot);
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
};

export const estimateMemoryTokens = (content: string): number =>
  content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));

export const chunkMemorySource = (
  input: ChunkMemorySourceInput,
): ReadonlyArray<MemorySourceChunk> => {
  const normalizedContent = input.content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalizedContent.length === 0) return [];
  const lines = normalizedContent.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return [];
  const language = detectMemorySourceLanguage(input.relativePath);
  const structuralBoundaries =
    language === "markdown"
      ? markdownBoundaries(lines)
      : [...configurationBoundaries(lines, language), ...codeBoundaries(lines)];
  const boundaries =
    structuralBoundaries.length > 0 ? structuralBoundaries : fallbackBoundaries(lines);
  const maximumCharacters = Math.min(
    60_000,
    Math.max(512, input.maximumChunkCharacters ?? DEFAULT_MAXIMUM_CHUNK_CHARACTERS),
  );
  const ranges = rangesFromBoundaries(boundaries, lines.length).flatMap((range) =>
    splitOversizedRange(range, lines, maximumCharacters),
  );

  return ranges.flatMap((range, chunkIndex) => {
    const content = lines
      .slice(range.startLine - 1, range.endLine)
      .join("\n")
      .trimEnd();
    if (content.trim().length === 0) return [];
    return [
      {
        chunkIndex,
        startLine: range.startLine,
        endLine: range.endLine,
        content,
        contentFingerprint: fingerprintMemorySource(content),
        tokenEstimate: estimateMemoryTokens(content),
        symbolMetadata: {
          structure: range.structure,
          language,
          symbols: symbolsForContent(content, range.name),
          imports: importsForContent(content),
          heading: range.structure === "document_heading" ? range.name : null,
        },
      },
    ];
  });
};
