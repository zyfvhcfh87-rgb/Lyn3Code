import { describe, expect, it } from "@effect/vitest";

import { chunkMemorySource, detectMemorySourceLanguage } from "./MemoryChunking.ts";

describe("MemoryChunking", () => {
  it("chunks Markdown on headings with exact, non-overlapping line ranges", () => {
    const chunks = chunkMemorySource({
      relativePath: "docs/architecture.md",
      content:
        "# Architecture\nIntro\n\n## Persistence\nSQLite facts\n\n## Retrieval\nLexical first\n",
    });

    expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
      [1, 3],
      [4, 6],
      [7, 8],
    ]);
    expect(chunks.map((chunk) => chunk.symbolMetadata.heading)).toEqual([
      "Architecture",
      "Persistence",
      "Retrieval",
    ]);
  });

  it("chunks code by symbols and test cases while retaining imports", () => {
    const chunks = chunkMemorySource({
      relativePath: "src/example.test.ts",
      content: [
        'import { expect } from "vitest";',
        "",
        "export function makeValue() {",
        "  return 1;",
        "}",
        "",
        'it("returns the value", () => {',
        "  expect(makeValue()).toBe(1);",
        "});",
      ].join("\n"),
    });

    expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
      [1, 2],
      [3, 6],
      [7, 9],
    ]);
    expect(chunks[0]?.symbolMetadata.imports).toEqual(["vitest"]);
    expect(chunks[1]?.symbolMetadata.symbols).toContain("makeValue");
    expect(chunks[2]?.symbolMetadata).toMatchObject({
      structure: "test_case",
      symbols: ["returns the value"],
    });
  });

  it("chunks YAML and JSON by logical top-level sections", () => {
    const yaml = chunkMemorySource({
      relativePath: "config.yml",
      content: "server:\n  port: 3000\ndatabase:\n  driver: sqlite\n",
    });
    const json = chunkMemorySource({
      relativePath: "package.json",
      content:
        '{\n  "scripts": {\n    "test": "vp test"\n  },\n  "dependencies": {\n    "effect": "latest"\n  }\n}\n',
    });

    expect(yaml.map((chunk) => chunk.symbolMetadata.symbols)).toEqual([["server"], ["database"]]);
    expect(json.map((chunk) => chunk.symbolMetadata.symbols)).toEqual([
      ["scripts"],
      ["dependencies"],
    ]);
  });

  it("splits oversized logical blocks by whole lines and preserves a bounded token estimate", () => {
    const chunks = chunkMemorySource({
      relativePath: "notes.txt",
      content: Array.from({ length: 20 }, (_, index) => `line-${index}-${"x".repeat(60)}`).join(
        "\n",
      ),
      maximumChunkCharacters: 512,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(20);
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.startLine).toBe((chunks[index - 1]?.endLine ?? 0) + 1);
    }
  });

  it("detects common source languages without filesystem-dependent path parsing", () => {
    expect(detectMemorySourceLanguage("apps/server/src/index.ts")).toBe("typescript");
    expect(detectMemorySourceLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectMemorySourceLanguage("README.unknown")).toBeNull();
  });
});
