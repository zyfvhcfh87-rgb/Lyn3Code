import type { AnalyticsCurrency } from "@t3tools/contracts";

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d{1,18}))?$/;
const MAX_WIRE_SCALE = 18;

interface ScaledInteger {
  readonly coefficient: bigint;
  readonly scale: number;
}

export interface DecimalMoney {
  readonly amount: string;
  readonly currency: AnalyticsCurrency;
}

export type MoneySumResult =
  | {
      readonly status: "ok";
      readonly value: DecimalMoney | null;
      readonly missingCount: number;
    }
  | {
      readonly status: "mixed_currencies";
      readonly currencies: ReadonlyArray<AnalyticsCurrency>;
      readonly missingCount: number;
    };

const powerOfTen = (exponent: number): bigint => 10n ** BigInt(exponent);

const normalize = ({ coefficient, scale }: ScaledInteger): ScaledInteger => {
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 };

  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedScale -= 1;
  }
  return { coefficient: normalizedCoefficient, scale: normalizedScale };
};

const parse = (value: string): ScaledInteger => {
  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError(`Invalid analytics decimal: ${value}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const coefficient = BigInt(`${sign}${whole}${fraction}`);
  return normalize({ coefficient, scale: fraction.length });
};

const rescale = (value: ScaledInteger, scale: number): bigint =>
  value.coefficient * powerOfTen(scale - value.scale);

const roundToScale = (value: ScaledInteger, scale: number): ScaledInteger => {
  if (value.scale <= scale) return value;
  const divisor = powerOfTen(value.scale - scale);
  const quotient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  const magnitude = remainder < 0n ? -remainder : remainder;
  const adjustment = magnitude * 2n >= divisor ? (value.coefficient < 0n ? -1n : 1n) : 0n;
  return normalize({ coefficient: quotient + adjustment, scale });
};

const format = (unrounded: ScaledInteger): string => {
  const value = normalize(roundToScale(unrounded, MAX_WIRE_SCALE));
  if (value.scale === 0) return value.coefficient.toString();

  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const split = digits.length - value.scale;
  return `${negative ? "-" : ""}${digits.slice(0, split)}.${digits.slice(split)}`;
};

export const isAnalyticsDecimal = (value: string): boolean => DECIMAL_PATTERN.test(value);

export const normalizeDecimal = (value: string): string => format(parse(value));

export const compareDecimal = (left: string, right: string): -1 | 0 | 1 => {
  const parsedLeft = parse(left);
  const parsedRight = parse(right);
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const difference = rescale(parsedLeft, scale) - rescale(parsedRight, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

export const addDecimal = (left: string, right: string): string => {
  const parsedLeft = parse(left);
  const parsedRight = parse(right);
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  return format({
    coefficient: rescale(parsedLeft, scale) + rescale(parsedRight, scale),
    scale,
  });
};

export const subtractDecimal = (left: string, right: string): string => {
  const parsedLeft = parse(left);
  const parsedRight = parse(right);
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  return format({
    coefficient: rescale(parsedLeft, scale) - rescale(parsedRight, scale),
    scale,
  });
};

export const multiplyDecimal = (left: string, right: string): string => {
  const parsedLeft = parse(left);
  const parsedRight = parse(right);
  return format({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale: parsedLeft.scale + parsedRight.scale,
  });
};

export const divideDecimal = (
  dividend: string,
  divisor: string,
  maximumScale = MAX_WIRE_SCALE,
): string => {
  if (!Number.isInteger(maximumScale) || maximumScale < 0 || maximumScale > MAX_WIRE_SCALE) {
    throw new RangeError(`Invalid decimal scale: ${maximumScale}`);
  }
  const numerator = parse(dividend);
  const denominator = parse(divisor);
  if (denominator.coefficient === 0n) throw new RangeError("Cannot divide by zero");

  const scaledNumerator = numerator.coefficient * powerOfTen(maximumScale + denominator.scale);
  const scaledDenominator = denominator.coefficient * powerOfTen(numerator.scale);
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const remainderMagnitude = remainder < 0n ? -remainder : remainder;
  const denominatorMagnitude = scaledDenominator < 0n ? -scaledDenominator : scaledDenominator;
  const sameSign =
    (scaledNumerator >= 0n && scaledDenominator > 0n) ||
    (scaledNumerator <= 0n && scaledDenominator < 0n);
  const adjustment = remainderMagnitude * 2n >= denominatorMagnitude ? (sameSign ? 1n : -1n) : 0n;
  return format({ coefficient: quotient + adjustment, scale: maximumScale });
};

export const sumDecimals = (values: ReadonlyArray<string>): string | null => {
  if (values.length === 0) return null;
  return values.reduce(addDecimal);
};

/**
 * Adds only like-currency amounts. Missing values remain visible in the result,
 * and an all-missing collection is unknown rather than an invented zero.
 */
export const sumMoney = (values: ReadonlyArray<DecimalMoney | null>): MoneySumResult => {
  const known = values.filter((value): value is DecimalMoney => value !== null);
  const missingCount = values.length - known.length;
  const currencies = [...new Set(known.map((value) => value.currency))].toSorted();
  if (currencies.length > 1) {
    return { status: "mixed_currencies", currencies, missingCount };
  }
  if (known.length === 0) {
    return { status: "ok", value: null, missingCount };
  }
  return {
    status: "ok",
    value: {
      currency: known[0]!.currency,
      amount: known.map(({ amount }) => amount).reduce(addDecimal),
    },
    missingCount,
  };
};

/** Produces independent totals so currencies can never be combined accidentally. */
export const sumMoneyByCurrency = (
  values: ReadonlyArray<DecimalMoney>,
): ReadonlyArray<DecimalMoney> => {
  const grouped = new Map<AnalyticsCurrency, string>();
  for (const value of values) {
    grouped.set(value.currency, addDecimal(grouped.get(value.currency) ?? "0", value.amount));
  }
  return [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount }));
};
