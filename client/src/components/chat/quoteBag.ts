/**
 * Loading-quote pools + a shuffle-bag picker, kept as a pure (React-free) module
 * so the no-repeat guarantee is unit-testable and the bag lives at module scope.
 *
 * Why module scope: the typewriter `LoadingQuote` is an unkeyed sibling after a
 * block list that grows as a response streams, so it remounts mid-turn. A
 * component-local bag would reset on every remount and repeat quotes within a
 * single response. Drawing from a module-level bag (one per style) means every
 * quote is shown once before any repeat across the whole session, and the last
 * drawn quote is tracked globally so no two consecutive draws ever match.
 */

export const SERIOUS_QUOTES = [
  "Computing the optimal response...",
  "Consulting the neural archives...",
  "Synthesizing information...",
  "Parsing the space-time continuum...",
  "Analyzing context vectors...",
  "Compiling thought processes...",
  "Running heuristics...",
  "Aligning dimensional parameters...",
  "Gathering intelligence...",
  "Formulating a reply...",
  "Connecting to quantum processing units...",
  "Calibrating conversational matrices...",
  "Retrieving historical context...",
  "Decoding input semantics...",
];

export const FUNNY_QUOTES = [
  "No One messes with Boris! Slughead... I Am Invincible",
  "Go Ahead, Make My Day... Show Me The Error Fool",
  "Nobody Codes Me Into a Corner",
  "But Wait Theres More...",
  "Waskely Bug ! ... I Like Huntin Waskely Bugs",
  "Hey Hey NOW! DONT DO THAT",
  "Oh.. Im Sorry That Last Hand Nearly Killed Me",
  "I Can't Find The Blasted thing",
  "awwww Jeeezz Ah I.. I Dont Know Abot This...",
  "Processing Pure Confabulation.. Please Hold... Just Kidding!",
  "Why! DO I Always Get The Hardest Tasks.. Oh Ya Right Because I'M AI",
  "Formulating Opinions... Realizing You Don't Care.. Retracting Opinions NVM",
  "Ewwww That's One Ugly....",
  "Kick Butt An Chew BubbleGum!..",
];

export type QuoteStyle = "random" | "funny" | "serious";

/** The full quote pool for a style (random = both sets). */
export function poolFor(style: QuoteStyle): string[] {
  if (style === "funny") return FUNNY_QUOTES;
  if (style === "serious") return SERIOUS_QUOTES;
  return [...FUNNY_QUOTES, ...SERIOUS_QUOTES];
}

/** Fisher–Yates shuffle over a copy (never mutates the source array). */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const quoteBags: Record<QuoteStyle, string[]> = { random: [], funny: [], serious: [] };
let lastDrawnQuote = "";

/**
 * Draw the next quote for a style without replacement. Refills (reshuffles) the
 * bag when empty, swapping the first-to-pop element away if it would repeat the
 * previous quote across the refill boundary.
 */
export function pickQuote(style: QuoteStyle): string {
  let bag = quoteBags[style];
  if (bag.length === 0) {
    bag = shuffle(poolFor(style));
    if (bag.length > 1 && bag[bag.length - 1] === lastDrawnQuote) {
      [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
    }
    quoteBags[style] = bag;
  }
  const q = bag.pop()!;
  lastDrawnQuote = q;
  return q;
}

/** Reset all bags + the last-quote guard. Test-only. */
export function resetQuoteBags(): void {
  quoteBags.random = [];
  quoteBags.funny = [];
  quoteBags.serious = [];
  lastDrawnQuote = "";
}
