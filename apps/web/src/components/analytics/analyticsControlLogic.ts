export function parseRequiredPositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

export function parseOptionalPositiveInteger(value: string, label: string): number | null {
  return value.trim() === "" ? null : parseRequiredPositiveInteger(value, label);
}

export function parseOptionalNonNegativeInteger(value: string, label: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  return parsed;
}

export function parseOptionalNonNegativeDecimal(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(trimmed)) {
    throw new Error(
      `${label} must be a non-negative decimal with no separators and at most 18 decimal places.`,
    );
  }
  return trimmed;
}

export function parseRequiredNonNegativeDecimal(value: string, label: string): string {
  const parsed = parseOptionalNonNegativeDecimal(value, label);
  if (parsed === null) throw new Error(`${label} is required.`);
  return parsed;
}

export function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter code such as USD or EUR.");
  }
  return currency;
}

export function requireTrimmed(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} is required.`);
  if (trimmed.length > maxLength)
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

export function toOptionalIsoDateTime(value: string, label: string): string | null {
  if (value.trim() === "") return null;
  return toRequiredIsoDateTime(value, label);
}

export function toRequiredIsoDateTime(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return date.toISOString();
}

export function toDateTimeLocalValue(isoDateTime: string | null): string {
  if (isoDateTime === null) return "";
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}
