import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { T3ProjectFile } from "./t3ProjectFile.ts";

const decode = Schema.decodeUnknownSync(T3ProjectFile);

describe("T3ProjectFile", () => {
  it("decodes a full project file", () => {
    const decoded = decode({
      $schema: "https://t3.codes/schema/t3.json",
      iconPath: "assets/logo.svg",
      scripts: [
        {
          name: "Dev",
          command: "pnpm dev",
          icon: "play",
          runOnWorktreeCreate: false,
          previewUrl: "http://localhost:3000",
          autoOpenPreview: true,
        },
        { name: "Test", command: "pnpm test" },
      ],
      verification: {
        version: 1,
        defaultProfile: "fast",
        profiles: {
          fast: {
            gates: [
              {
                id: "types",
                category: "typecheck",
                checks: [
                  {
                    id: "web-types",
                    name: "Web typecheck",
                    command: { executable: "pnpm", args: ["run", "typecheck:web"] },
                    workingDirectory: ".",
                    timeoutSeconds: 300,
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts).toHaveLength(2);
    expect(decoded.scripts?.[1]).toEqual({ name: "Test", command: "pnpm test" });
    expect(decoded.verification?.profiles.fast?.gates[0]?.checks[0]?.command).toEqual({
      executable: "pnpm",
      args: ["run", "typecheck:web"],
    });
  });

  it("decodes an empty object and ignores unknown fields", () => {
    expect(decode({})).toEqual({});
    expect(decode({ futureField: true })).toEqual({});
  });

  it("trims icon paths and script fields", () => {
    const decoded = decode({
      iconPath: " assets/logo.svg ",
      scripts: [{ name: " Dev ", command: " pnpm dev " }],
    });

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev" });
  });

  it("rejects scripts without a command", () => {
    expect(() => decode({ scripts: [{ name: "Dev" }] })).toThrow();
  });

  it("rejects unknown script icons", () => {
    expect(() =>
      decode({ scripts: [{ name: "Dev", command: "pnpm dev", icon: "rocket" }] }),
    ).toThrow();
  });

  it("rejects shell-string verification commands and unsupported config versions", () => {
    expect(() =>
      decode({
        verification: {
          version: 1,
          profiles: {
            fast: {
              gates: [
                {
                  id: "lint",
                  category: "lint",
                  checks: [{ id: "lint", name: "Lint", command: "pnpm lint" }],
                },
              ],
            },
          },
        },
      }),
    ).toThrow();
    expect(() => decode({ verification: { version: 2, profiles: {} } })).toThrow();
  });
});
