import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const REDACTION_MARKER = "[REDACTED]";

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pnpm",
  ".t3",
  ".turbo",
  ".yarn",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".tiff",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
]);

const SECRET_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
  "service-account.json",
]);

const SECRET_EXTENSIONS = new Set([".der", ".jks", ".key", ".keystore", ".p12", ".pfx", ".pem"]);

const LOCK_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

const normalizeRelativePath = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");

const pathKey = (path: Path.Path, value: string): string =>
  path.sep === "\\" ? value.toLocaleLowerCase("en-US") : value;

const isContainedPath = (path: Path.Path, root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const fileExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegExp = (glob: string): RegExp => {
  const normalized = normalizeRelativePath(glob.trim()).replace(/^\//, "");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? "";
    const next = normalized[index + 1] ?? "";
    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  if (normalized.endsWith("/")) source += ".*";
  return new RegExp(`^(?:${source}|.*/${source})$`, "i");
};

const matchesExclusion = (relativePath: string, exclusions: ReadonlyArray<string>): boolean => {
  let excluded = false;
  for (const rawRule of exclusions) {
    const rule = rawRule.trim();
    if (rule.length === 0 || rule.startsWith("#")) continue;
    const negate = rule.startsWith("!");
    const pattern = negate ? rule.slice(1) : rule;
    if (pattern.length > 0 && globToRegExp(pattern).test(relativePath)) excluded = !negate;
  }
  return excluded;
};

export type MemorySourceSkipReason =
  | "binary"
  | "explicit_exclusion"
  | "generated_or_dependency"
  | "large_lockfile"
  | "minified"
  | "outside_repository"
  | "secret_bearing_path"
  | "size_limit"
  | "symlink_escape";

export interface MemorySourceSecurityOptions {
  readonly exclusions?: ReadonlyArray<string>;
  readonly maximumFileSizeBytes?: number;
  readonly maximumLockFileSizeBytes?: number;
}

export interface MemorySourceClassification {
  readonly indexable: boolean;
  readonly reason: MemorySourceSkipReason | null;
  readonly relativePath: string;
}

export interface ResolvedRepositoryFile {
  readonly repositoryRoot: string;
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface RedactedMemorySource {
  readonly content: string;
  readonly redactionCount: number;
}

export class MemorySourcePathError extends Schema.TaggedErrorClass<MemorySourcePathError>()(
  "MemorySourcePathError",
  {
    reason: Schema.Literals(["unavailable", "outside_repository", "symlink_escape", "wrong_type"]),
    repositoryRoot: Schema.String,
    relativePath: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const fingerprintMemorySource = (content: string | Uint8Array): string =>
  NodeCrypto.createHash("sha256").update(content).digest("hex");

export const isBinaryMemorySource = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) return true;
  const sampleSize = Math.min(bytes.length, 8_192);
  if (sampleSize === 0) return false;
  let suspiciousControlBytes = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const byte = bytes[index] ?? 0;
    if (byte < 7 || (byte > 13 && byte < 32)) suspiciousControlBytes += 1;
  }
  return suspiciousControlBytes / sampleSize > 0.08;
};

export const classifyMemorySourcePath = (
  inputPath: string,
  sizeBytes: number,
  options: MemorySourceSecurityOptions = {},
): MemorySourceClassification => {
  const relativePath = normalizeRelativePath(inputPath);
  const lowerPath = relativePath.toLocaleLowerCase("en-US");
  const segments = lowerPath.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  const extension = fileExtension(fileName);
  const maximumFileSizeBytes = options.maximumFileSizeBytes ?? 1_000_000;
  const maximumLockFileSizeBytes = options.maximumLockFileSizeBytes ?? 256_000;

  if (
    relativePath.length === 0 ||
    /^[A-Za-z]:[\\/]/.test(inputPath) ||
    inputPath.startsWith("/") ||
    inputPath.startsWith("\\\\") ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    return { indexable: false, reason: "outside_repository", relativePath };
  }
  if (matchesExclusion(relativePath, options.exclusions ?? [])) {
    return { indexable: false, reason: "explicit_exclusion", relativePath };
  }
  if (segments.slice(0, -1).some((segment) => DEFAULT_EXCLUDED_DIRECTORIES.has(segment))) {
    return { indexable: false, reason: "generated_or_dependency", relativePath };
  }
  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".env") ||
    SECRET_FILE_NAMES.has(fileName) ||
    SECRET_EXTENSIONS.has(extension) ||
    lowerPath.includes("/.ssh/") ||
    lowerPath.includes("/.aws/") ||
    lowerPath.includes("/keychains/")
  ) {
    return { indexable: false, reason: "secret_bearing_path", relativePath };
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    return { indexable: false, reason: "binary", relativePath };
  }
  if (/\.(?:min|bundle)\.(?:css|js|mjs|cjs)$/i.test(fileName)) {
    return { indexable: false, reason: "minified", relativePath };
  }
  if (LOCK_FILE_NAMES.has(fileName) && sizeBytes > maximumLockFileSizeBytes) {
    return { indexable: false, reason: "large_lockfile", relativePath };
  }
  if (sizeBytes > maximumFileSizeBytes) {
    return { indexable: false, reason: "size_limit", relativePath };
  }
  return { indexable: true, reason: null, relativePath };
};

export const resolveRepositoryRoot = Effect.fn("MemorySourceSecurity.resolveRepositoryRoot")(
  function* (repositoryRoot: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolved = path.resolve(repositoryRoot);
    const canonical = yield* fileSystem.realPath(resolved).pipe(
      Effect.mapError(
        (cause) =>
          new MemorySourcePathError({
            reason: "unavailable",
            repositoryRoot,
            relativePath: ".",
            detail: `Repository root is unavailable: ${repositoryRoot}`,
            cause,
          }),
      ),
    );
    const stat = yield* fileSystem.stat(canonical).pipe(
      Effect.mapError(
        (cause) =>
          new MemorySourcePathError({
            reason: "unavailable",
            repositoryRoot,
            relativePath: ".",
            detail: `Repository root cannot be inspected: ${repositoryRoot}`,
            cause,
          }),
      ),
    );
    if (stat.type !== "Directory") {
      return yield* new MemorySourcePathError({
        reason: "wrong_type",
        repositoryRoot,
        relativePath: ".",
        detail: `Repository root is not a directory: ${repositoryRoot}`,
      });
    }
    return canonical;
  },
);

export const resolveContainedRepositoryFile = Effect.fn(
  "MemorySourceSecurity.resolveContainedRepositoryFile",
)(function* (repositoryRoot: string, relativePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const canonicalRoot = yield* resolveRepositoryRoot(repositoryRoot);
  const normalized = normalizeRelativePath(relativePath);
  if (path.isAbsolute(relativePath) || normalized === ".." || normalized.startsWith("../")) {
    return yield* new MemorySourcePathError({
      reason: "outside_repository",
      repositoryRoot: canonicalRoot,
      relativePath,
      detail: `Repository source path escapes the validated root: ${relativePath}`,
    });
  }
  const lexical = path.resolve(canonicalRoot, normalized);
  if (!isContainedPath(path, canonicalRoot, lexical)) {
    return yield* new MemorySourcePathError({
      reason: "outside_repository",
      repositoryRoot: canonicalRoot,
      relativePath,
      detail: `Repository source path escapes the validated root: ${relativePath}`,
    });
  }
  const canonicalFile = yield* fileSystem.realPath(lexical).pipe(
    Effect.mapError(
      (cause) =>
        new MemorySourcePathError({
          reason: "unavailable",
          repositoryRoot: canonicalRoot,
          relativePath,
          detail: `Repository source is unavailable: ${relativePath}`,
          cause,
        }),
    ),
  );
  if (!isContainedPath(path, pathKey(path, canonicalRoot), pathKey(path, canonicalFile))) {
    return yield* new MemorySourcePathError({
      reason: "symlink_escape",
      repositoryRoot: canonicalRoot,
      relativePath,
      detail: `Repository source resolves through a symlink or junction outside the root: ${relativePath}`,
    });
  }
  const stat = yield* fileSystem.stat(canonicalFile).pipe(
    Effect.mapError(
      (cause) =>
        new MemorySourcePathError({
          reason: "unavailable",
          repositoryRoot: canonicalRoot,
          relativePath,
          detail: `Repository source cannot be inspected: ${relativePath}`,
          cause,
        }),
    ),
  );
  if (stat.type !== "File") {
    return yield* new MemorySourcePathError({
      reason: "wrong_type",
      repositoryRoot: canonicalRoot,
      relativePath,
      detail: `Repository source is not a file: ${relativePath}`,
    });
  }
  return { repositoryRoot: canonicalRoot, absolutePath: canonicalFile, relativePath: normalized };
});

const isEnvironmentReference = (value: string): boolean =>
  /^(?:process\.env|import\.meta\.env|Deno\.env|env\b|os\.(?:environ|getenv)|System\.getenv|\$\{|\$[A-Z_])/i.test(
    value.trim().replace(/^['"]|['"]$/g, ""),
  );

export const redactMemorySourceText = (
  value: string,
  knownSecrets: ReadonlyArray<string> = [],
): RedactedMemorySource => {
  let content = value;
  let redactionCount = 0;
  const replace = (pattern: RegExp, replacer: (...matches: string[]) => string): void => {
    content = content.replace(pattern, (...matches) => {
      redactionCount += 1;
      return replacer(...(matches as string[]));
    });
  };

  for (const secret of [...new Set(knownSecrets.filter((entry) => entry.length >= 4))].sort(
    (left, right) => right.length - left.length,
  )) {
    replace(new RegExp(escapeRegExp(secret), "g"), () => REDACTION_MARKER);
  }

  replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    () => REDACTION_MARKER,
  );
  replace(
    /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
    () => REDACTION_MARKER,
  );
  replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, () => REDACTION_MARKER);
  replace(
    /(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;"']+/gi,
    (_match, prefix) => `${prefix}${REDACTION_MARKER}`,
  );
  replace(
    /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)(@)/gi,
    (_match, prefix, _password, suffix) => `${prefix}${REDACTION_MARKER}${suffix}`,
  );
  replace(
    /((?:["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret|private[_-]?key)["']?)\s*[:=]\s*)(["']?[^\s,;}]+["']?)/gi,
    (match, prefix, secretValue) =>
      isEnvironmentReference(secretValue) ? match : `${prefix}${REDACTION_MARKER}`,
  );
  replace(
    /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)=)[^&#\s]+/gi,
    (_match, prefix) => `${prefix}${REDACTION_MARKER}`,
  );

  return { content, redactionCount };
};

export const memorySourceSecurityDefaults = {
  excludedDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  binaryExtensions: BINARY_EXTENSIONS,
  secretFileNames: SECRET_FILE_NAMES,
  lockFileNames: LOCK_FILE_NAMES,
} as const;
