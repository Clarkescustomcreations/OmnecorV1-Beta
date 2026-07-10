import { describe, it, expect, beforeEach } from "vitest";
import {
  pickQuote,
  poolFor,
  resetQuoteBags,
  SERIOUS_QUOTES,
  FUNNY_QUOTES,
} from "../quoteBag";

describe("quoteBag — shuffle-bag draw", () => {
  beforeEach(() => resetQuoteBags());

  it("has the expected pool sizes (14 / 14 / 28)", () => {
    expect(SERIOUS_QUOTES.length).toBe(14);
    expect(FUNNY_QUOTES.length).toBe(14);
    expect(poolFor("random").length).toBe(28);
  });

  it.each(["random", "funny", "serious"] as const)(
    "shows every %s quote once before any repeat (a full pool with no dupes)",
    (style) => {
      const size = poolFor(style).length;
      const drawn = Array.from({ length: size }, () => pickQuote(style));
      expect(new Set(drawn).size).toBe(size); // no repeats within one pool
      expect(new Set(drawn)).toEqual(new Set(poolFor(style))); // exactly the pool
    },
  );

  it("never repeats consecutively across a bag refill", () => {
    // Draw well past the pool boundary so refills happen repeatedly.
    const size = poolFor("funny").length;
    let prev = "";
    for (let i = 0; i < size * 5; i++) {
      const q = pickQuote("funny");
      expect(q).not.toBe(prev); // no back-to-back repeat, even at the seam
      prev = q;
    }
  });

  it("keeps separate bags per style", () => {
    const f = pickQuote("funny");
    const s = pickQuote("serious");
    expect(FUNNY_QUOTES).toContain(f);
    expect(SERIOUS_QUOTES).toContain(s);
  });
});
