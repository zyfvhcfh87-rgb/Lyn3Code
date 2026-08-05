import { describe, expect, it } from "vite-plus/test";

import {
  normalizeCurrency,
  parseOptionalNonNegativeDecimal,
  parseOptionalNonNegativeInteger,
  parseRequiredPositiveInteger,
  requireTrimmed,
  toRequiredIsoDateTime,
} from "./analyticsControlLogic";

describe("analytics control input parsing", () => {
  it("keeps exact decimal text instead of coercing it through Number", () => {
    expect(parseOptionalNonNegativeDecimal("9007199254740993.000000001", "Limit")).toBe(
      "9007199254740993.000000001",
    );
    expect(parseOptionalNonNegativeDecimal("", "Limit")).toBeNull();
    expect(() => parseOptionalNonNegativeDecimal("1,000", "Limit")).toThrow(/no separators/);
    expect(() => parseOptionalNonNegativeDecimal("1.1234567890123456789", "Limit")).toThrow(
      /18 decimal places/,
    );
  });

  it("accepts only safe integer counts with the requested sign", () => {
    expect(parseRequiredPositiveInteger("30", "Retention")).toBe(30);
    expect(parseOptionalNonNegativeInteger("0", "Requests")).toBe(0);
    expect(() => parseRequiredPositiveInteger("0", "Retention")).toThrow(/positive/);
    expect(() => parseOptionalNonNegativeInteger("1.5", "Requests")).toThrow(/whole number/);
  });

  it("normalizes currencies and bounded required text", () => {
    expect(normalizeCurrency(" eur ")).toBe("EUR");
    expect(requireTrimmed(" note ", "Reason", 10)).toBe("note");
    expect(() => normalizeCurrency("EURO")).toThrow(/three-letter/);
    expect(() => requireTrimmed("   ", "Reason", 10)).toThrow(/required/);
  });

  it("turns local date-time input into an ISO timestamp", () => {
    expect(toRequiredIsoDateTime("2026-08-04T12:30", "Timestamp")).toMatch(
      /^2026-08-04T\d{2}:30:00\.000Z$/,
    );
    expect(() => toRequiredIsoDateTime("not-a-date", "Timestamp")).toThrow(/valid/);
  });
});
