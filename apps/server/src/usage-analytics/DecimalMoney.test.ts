import { AnalyticsCurrency } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  normalizeDecimal,
  sumMoney,
  sumMoneyByCurrency,
} from "./DecimalMoney.ts";

describe("DecimalMoney", () => {
  it("performs decimal arithmetic without binary floating point", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(multiplyDecimal("123456789.123456789", "3")).toBe("370370367.370370367");
    expect(divideDecimal("1", "8")).toBe("0.125");
    expect(normalizeDecimal("-0.000")).toBe("0");
    expect(compareDecimal("10.000", "10")).toBe(0);
  });

  it("keeps unknown and mixed-currency sums explicit", () => {
    const usd = AnalyticsCurrency.make("USD");
    const eur = AnalyticsCurrency.make("EUR");

    expect(sumMoney([null, null])).toEqual({ status: "ok", value: null, missingCount: 2 });
    expect(
      sumMoney([{ currency: usd, amount: "1.10" }, null, { currency: usd, amount: "2.20" }]),
    ).toEqual({
      status: "ok",
      value: { currency: usd, amount: "3.3" },
      missingCount: 1,
    });
    expect(
      sumMoney([
        { currency: usd, amount: "1" },
        { currency: eur, amount: "1" },
      ]),
    ).toEqual({ status: "mixed_currencies", currencies: [eur, usd], missingCount: 0 });
    expect(
      sumMoneyByCurrency([
        { currency: usd, amount: "1" },
        { currency: eur, amount: "2" },
        { currency: usd, amount: "3" },
      ]),
    ).toEqual([
      { currency: eur, amount: "2" },
      { currency: usd, amount: "4" },
    ]);
  });
});
