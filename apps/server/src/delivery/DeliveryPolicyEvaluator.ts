import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import type { DeploymentStrategy } from "@t3tools/contracts";

export type DeliveryApprovalRequirement = "none" | "manual";

export type DeliveryStrategy = DeploymentStrategy;

export interface DeliveryPolicyWindow {
  readonly daysOfWeek: ReadonlyArray<number>;
  readonly startMinuteUtc: number;
  readonly endMinuteUtc: number;
}

export interface DeliveryFreeze {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
  readonly environments?: ReadonlyArray<string>;
}

export interface DeliveryPolicyRule {
  readonly environments?: ReadonlyArray<string>;
  readonly allowedStrategies?: ReadonlyArray<DeliveryStrategy>;
  readonly approval?: DeliveryApprovalRequirement;
  readonly windows?: ReadonlyArray<DeliveryPolicyWindow>;
}

export interface DeliveryPolicyDefinition {
  readonly defaultApproval: DeliveryApprovalRequirement;
  readonly allowedStrategies: ReadonlyArray<DeliveryStrategy>;
  readonly windows?: ReadonlyArray<DeliveryPolicyWindow>;
  readonly freezes?: ReadonlyArray<DeliveryFreeze>;
  readonly rules?: ReadonlyArray<DeliveryPolicyRule>;
}

export interface DeliveryPolicyEvaluation {
  readonly allowed: boolean;
  readonly approval: DeliveryApprovalRequirement;
  readonly approvalSatisfied: boolean;
  readonly withinDeliveryWindow: boolean;
  readonly activeFreeze: DeliveryFreeze | null;
  readonly allowedStrategies: ReadonlyArray<DeliveryStrategy>;
  readonly reasons: ReadonlyArray<
    "approval_required" | "outside_delivery_window" | "delivery_frozen" | "strategy_not_allowed"
  >;
}

const isValidWindow = (window: DeliveryPolicyWindow): boolean =>
  window.daysOfWeek.length > 0 &&
  window.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
  Number.isInteger(window.startMinuteUtc) &&
  window.startMinuteUtc >= 0 &&
  window.startMinuteUtc < 24 * 60 &&
  Number.isInteger(window.endMinuteUtc) &&
  window.endMinuteUtc >= 0 &&
  window.endMinuteUtc < 24 * 60;

const containsUtcInstant = (window: DeliveryPolicyWindow, now: DateTime.DateTime): boolean => {
  if (!isValidWindow(window)) return false;
  const parts = DateTime.toPartsUtc(now);
  const minute = parts.hour * 60 + parts.minute;
  const day = parts.weekDay;
  if (window.startMinuteUtc === window.endMinuteUtc) {
    return window.daysOfWeek.includes(day);
  }
  if (window.startMinuteUtc < window.endMinuteUtc) {
    return (
      window.daysOfWeek.includes(day) &&
      minute >= window.startMinuteUtc &&
      minute < window.endMinuteUtc
    );
  }
  if (minute >= window.startMinuteUtc) return window.daysOfWeek.includes(day);
  const previousDay = (day + 6) % 7;
  return minute < window.endMinuteUtc && window.daysOfWeek.includes(previousDay);
};

const parseInstant = (value: string): DateTime.DateTime | null =>
  Option.getOrNull(DateTime.make(value));

const appliesToEnvironment = (
  environments: ReadonlyArray<string> | undefined,
  environment: string,
): boolean => environments === undefined || environments.includes(environment);

const orderedUnique = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(values)];

export const evaluateDeliveryPolicy = (input: {
  readonly policy: DeliveryPolicyDefinition;
  readonly environment: string;
  readonly strategy: DeliveryStrategy;
  readonly now: string;
  readonly approvalGranted: boolean;
}): DeliveryPolicyEvaluation => {
  const now = parseInstant(input.now);
  if (now === null) {
    throw new Error(`Invalid delivery policy instant: ${input.now}`);
  }
  const timestamp = DateTime.toEpochMillis(now);
  const matchingRules = (input.policy.rules ?? []).filter((rule) =>
    appliesToEnvironment(rule.environments, input.environment),
  );
  const approval =
    matchingRules.findLast((rule) => rule.approval !== undefined)?.approval ??
    input.policy.defaultApproval;
  const allowedStrategies = orderedUnique(
    matchingRules.findLast((rule) => rule.allowedStrategies !== undefined)?.allowedStrategies ??
      input.policy.allowedStrategies,
  );
  const applicableWindows = matchingRules.flatMap((rule) => rule.windows ?? []);
  const windows = applicableWindows.length > 0 ? applicableWindows : (input.policy.windows ?? []);
  const withinDeliveryWindow =
    windows.length === 0 || windows.some((window) => containsUtcInstant(window, now));
  for (const freeze of input.policy.freezes ?? []) {
    const startsAt = parseInstant(freeze.startsAt);
    const endsAt = parseInstant(freeze.endsAt);
    if (
      startsAt === null ||
      endsAt === null ||
      DateTime.toEpochMillis(startsAt) >= DateTime.toEpochMillis(endsAt)
    ) {
      throw new Error(`Invalid delivery freeze: ${freeze.reason}`);
    }
  }
  const activeFreeze =
    (input.policy.freezes ?? []).find((freeze) => {
      if (!appliesToEnvironment(freeze.environments, input.environment)) return false;
      const startsAt = parseInstant(freeze.startsAt);
      const endsAt = parseInstant(freeze.endsAt);
      return (
        startsAt !== null &&
        endsAt !== null &&
        DateTime.toEpochMillis(startsAt) < DateTime.toEpochMillis(endsAt) &&
        timestamp >= DateTime.toEpochMillis(startsAt) &&
        timestamp < DateTime.toEpochMillis(endsAt)
      );
    }) ?? null;
  const approvalSatisfied = approval === "none" || input.approvalGranted;
  const reasons: Array<DeliveryPolicyEvaluation["reasons"][number]> = [];
  if (!approvalSatisfied) reasons.push("approval_required");
  if (!withinDeliveryWindow) reasons.push("outside_delivery_window");
  if (activeFreeze !== null) reasons.push("delivery_frozen");
  if (!allowedStrategies.includes(input.strategy)) reasons.push("strategy_not_allowed");
  return Object.freeze({
    allowed: reasons.length === 0,
    approval,
    approvalSatisfied,
    withinDeliveryWindow,
    activeFreeze,
    allowedStrategies: Object.freeze([...allowedStrategies]),
    reasons: Object.freeze(reasons),
  });
};
