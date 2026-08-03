import { describe, expect, it } from "vite-plus/test";

import { parseVerificationDiagnostics } from "./VerificationDiagnostics.ts";
import { makeVerificationChunkRedactor, redactVerificationText } from "./VerificationRedaction.ts";

describe("verification redaction", () => {
  it("redacts known values even when a process splits them across chunks", () => {
    const redactor = makeVerificationChunkRedactor(["super-secret-token"]);
    const first = redactor.push("stdout", "token=super-secret-");
    const second = redactor.push("stdout", "token\nready\n");
    const flushed = redactor.flush();
    const evidence = [...first, ...second, ...flushed.map((entry) => entry.text)].join("");

    expect(evidence).not.toContain("super-secret-token");
    expect(evidence).toContain("[REDACTED]");
  });

  it("redacts common credential-shaped output without known values", () => {
    expect(redactVerificationText("Authorization: Bearer abc123\nAPI_KEY=oh-no", [])).toBe(
      "Authorization: Bearer [REDACTED]\nAPI_KEY=[REDACTED]",
    );
  });
});

describe("verification diagnostics", () => {
  it("parses TypeScript and generic file positions while retaining raw-log independence", () => {
    const parsed = parseVerificationDiagnostics({
      parser: "typescript",
      stdout: "",
      stderr: "apps/web/src/App.tsx(12,7): error TS2322: Type 'x' is not assignable",
    });

    expect(parsed.parserWarning).toBeNull();
    expect(parsed.diagnostics).toEqual([
      {
        severity: "error",
        category: "type_error",
        message: "Type 'x' is not assignable",
        filePath: "apps/web/src/App.tsx",
        line: 12,
        column: 7,
        code: "TS2322",
      },
    ]);
  });

  it("reports parser failure without fabricating diagnostics", () => {
    const parsed = parseVerificationDiagnostics({
      parser: "eslint",
      stdout: "human-readable lint output",
      stderr: "",
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.parserWarning).toContain("preserved raw log");
  });
});
