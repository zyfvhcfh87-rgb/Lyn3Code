import type { DeploymentValidationRun } from "@t3tools/contracts";

export type DeploymentProviderStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface HttpPostDeploymentCheck {
  readonly id: string;
  readonly kind: "http";
  readonly url: string;
  readonly expectedStatuses: ReadonlyArray<number>;
  readonly bodyIncludes?: string;
  readonly timeoutMilliseconds?: number;
  readonly maximumBodyBytes?: number;
  readonly allowInsecureLoopback?: boolean;
}

export interface VersionPostDeploymentCheck {
  readonly id: string;
  readonly kind: "version";
  readonly url: string;
  readonly expectedVersion: string;
  readonly responseHeader?: string;
  readonly timeoutMilliseconds?: number;
  readonly maximumBodyBytes?: number;
  readonly allowInsecureLoopback?: boolean;
}

export type PostDeploymentCheck = HttpPostDeploymentCheck | VersionPostDeploymentCheck;

export interface HttpProbeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpProbe = (input: {
  readonly url: string;
  readonly timeoutMilliseconds: number;
  readonly maximumBodyBytes: number;
}) => Promise<HttpProbeResponse>;

export interface PostDeploymentCheckResult {
  readonly checkId: string;
  readonly kind: PostDeploymentCheck["kind"];
  readonly url: string;
  readonly status: "passed" | "failed";
  readonly httpStatus: number | null;
  readonly detail: string;
}

export interface DeploymentValidationResult {
  readonly providerStatus: DeploymentProviderStatus;
  readonly status: "passed" | "provider_incomplete" | "provider_failed" | "validation_failed";
  readonly checks: ReadonlyArray<PostDeploymentCheckResult>;
  readonly durableStatus: DeploymentValidationRun["status"];
}

const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_TIMEOUT_MILLISECONDS = 30_000;
const DEFAULT_MAXIMUM_BODY_BYTES = 256 * 1024;
const MAXIMUM_BODY_BYTES = 1024 * 1024;
const MAXIMUM_CHECKS = 16;

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname.endsWith(".localhost");

const validateCheckUrl = (check: PostDeploymentCheck): URL => {
  const url = new URL(check.url);
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Post-deployment validation URLs must not contain credentials.");
  }
  if (url.protocol !== "https:") {
    if (
      !(
        url.protocol === "http:" &&
        check.allowInsecureLoopback === true &&
        isLoopback(url.hostname)
      )
    ) {
      throw new Error(
        "Post-deployment validation requires HTTPS except for explicit loopback checks.",
      );
    }
  }
  if (url.hash.length > 0)
    throw new Error("Post-deployment validation URLs must not contain fragments.");
  for (const name of url.searchParams.keys()) {
    if (/(?:token|key|password|passwd|secret|signature|credential)/i.test(name)) {
      throw new Error("Post-deployment validation URLs must not contain secret query parameters.");
    }
  }
  return url;
};

const safeUrl = (url: URL): string => {
  const sanitized = new URL(url.toString());
  sanitized.search = "";
  return sanitized.toString();
};

const normalizedLimit = (value: number | undefined, fallback: number, maximum: number): number => {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new Error(`Validation bound must be between 1 and ${maximum}.`);
  }
  return candidate;
};

const normalizeHeaders = (headers: Headers): Readonly<Record<string, string>> => {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
};

export const makeFetchHttpProbe =
  (fetchImplementation: typeof globalThis.fetch = globalThis.fetch): HttpProbe =>
  async (input) => {
    const response = await fetchImplementation(input.url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMilliseconds),
      headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
    });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      return { status: response.status, headers: normalizeHeaders(response.headers), body: "" };
    }
    const chunks: Array<Uint8Array> = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > input.maximumBodyBytes) {
        await reader.cancel();
        throw new Error("Validation response exceeded its body limit.");
      }
      chunks.push(next.value);
    }
    const body = new TextDecoder().decode(
      chunks.length === 1
        ? chunks[0]
        : chunks.reduce((combined, chunk) => {
            const next = new Uint8Array(combined.length + chunk.length);
            next.set(combined);
            next.set(chunk, combined.length);
            return next;
          }, new Uint8Array()),
    );
    return { status: response.status, headers: normalizeHeaders(response.headers), body };
  };

const failedResult = (
  check: PostDeploymentCheck,
  url: string,
  detail: string,
  httpStatus: number | null = null,
): PostDeploymentCheckResult => ({
  checkId: check.id,
  kind: check.kind,
  url,
  status: "failed",
  httpStatus,
  detail,
});

const safeFailureDetail = (cause: unknown, unsafeUrl: string, renderedUrl: string): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replaceAll(unsafeUrl, renderedUrl).slice(0, 2_000);
};

const executeCheck = async (
  check: PostDeploymentCheck,
  probe: HttpProbe,
): Promise<PostDeploymentCheckResult> => {
  let url: URL;
  try {
    url = validateCheckUrl(check);
  } catch (cause) {
    return failedResult(
      check,
      "[invalid URL]",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const renderedUrl = safeUrl(url);
  try {
    const response = await probe({
      url: url.toString(),
      timeoutMilliseconds: normalizedLimit(
        check.timeoutMilliseconds,
        DEFAULT_TIMEOUT_MILLISECONDS,
        MAXIMUM_TIMEOUT_MILLISECONDS,
      ),
      maximumBodyBytes: normalizedLimit(
        check.maximumBodyBytes,
        DEFAULT_MAXIMUM_BODY_BYTES,
        MAXIMUM_BODY_BYTES,
      ),
    });
    if (check.kind === "http") {
      if (
        check.expectedStatuses.length === 0 ||
        !check.expectedStatuses.includes(response.status)
      ) {
        return failedResult(
          check,
          renderedUrl,
          `HTTP status ${response.status} did not match the expected set.`,
          response.status,
        );
      }
      if (check.bodyIncludes !== undefined && !response.body.includes(check.bodyIncludes)) {
        return failedResult(
          check,
          renderedUrl,
          "Response body did not contain the expected text.",
          response.status,
        );
      }
    } else {
      if (response.status < 200 || response.status >= 300) {
        return failedResult(
          check,
          renderedUrl,
          `Version endpoint returned HTTP ${response.status}.`,
          response.status,
        );
      }
      const actualVersion =
        check.responseHeader === undefined
          ? response.body.trim()
          : response.headers[check.responseHeader.toLowerCase()]?.trim();
      if (actualVersion !== check.expectedVersion) {
        return failedResult(
          check,
          renderedUrl,
          "Deployed version did not match expected source.",
          response.status,
        );
      }
    }
    return {
      checkId: check.id,
      kind: check.kind,
      url: renderedUrl,
      status: "passed",
      httpStatus: response.status,
      detail: "Validation passed.",
    };
  } catch (cause) {
    return failedResult(check, renderedUrl, safeFailureDetail(cause, url.toString(), renderedUrl));
  }
};

export const runPostDeploymentValidation = async (input: {
  readonly providerStatus: DeploymentProviderStatus;
  readonly checks: ReadonlyArray<PostDeploymentCheck>;
  readonly probe?: HttpProbe;
}): Promise<DeploymentValidationResult> => {
  if (
    input.providerStatus === "pending" ||
    input.providerStatus === "running" ||
    input.providerStatus === "unknown"
  ) {
    return {
      providerStatus: input.providerStatus,
      status: "provider_incomplete",
      checks: [],
      durableStatus: "pending",
    };
  }
  if (input.providerStatus !== "succeeded") {
    return {
      providerStatus: input.providerStatus,
      status: "provider_failed",
      checks: [],
      durableStatus: "failed",
    };
  }
  if (input.checks.length > MAXIMUM_CHECKS) {
    return {
      providerStatus: input.providerStatus,
      status: "validation_failed",
      durableStatus: "failed",
      checks: [
        {
          checkId: "validation-plan",
          kind: "http",
          url: "[validation plan]",
          status: "failed",
          httpStatus: null,
          detail: `Validation plan exceeds the ${MAXIMUM_CHECKS} check limit.`,
        },
      ],
    };
  }
  const probe = input.probe ?? makeFetchHttpProbe();
  const checks: Array<PostDeploymentCheckResult> = [];
  for (const check of input.checks) checks.push(await executeCheck(check, probe));
  return {
    providerStatus: input.providerStatus,
    status: checks.every((check) => check.status === "passed") ? "passed" : "validation_failed",
    durableStatus: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks: Object.freeze(checks),
  };
};
