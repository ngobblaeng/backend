import { Card, Combo, ComboType } from "../types";
import { rankValue } from "../deck";

const BOMB_TYPES: ComboType[] = [
  "fourOfAKind",
  "threeConsecutivePairs",
  "fourConsecutivePairs",
];

/** tier used to compare bombs of different kinds against each other */
const BOMB_TIER: Record<string, number> = {
  threeConsecutivePairs: 1,
  fourOfAKind: 2,
  fourConsecutivePairs: 3,
};

export function isBomb(combo: Combo): boolean {
  return BOMB_TYPES.includes(combo.type);
}

function sorted(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
}

function sameRank(cards: Card[]): boolean {
  return cards.every((c) => c.rank === cards[0].rank);
}

function isConsecutiveRanks(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/**
 * Identify the combo type of a set of cards (cards must already belong to
 * the player's hand). Returns null if the cards don't form any legal combo.
 */
export function identifyCombo(cards: Card[]): Combo | null {
  if (cards.length === 0) return null;
  const cs = sorted(cards);
  const power = cs[cs.length - 1].value;

  if (cs.length === 1) {
    return { type: "single", cards: cs, power, length: 1 };
  }

  if (cs.length === 2 && sameRank(cs)) {
    return { type: "pair", cards: cs, power, length: 2 };
  }

  if (cs.length === 3 && sameRank(cs)) {
    return { type: "triple", cards: cs, power, length: 3 };
  }

  if (cs.length === 4 && sameRank(cs)) {
    return { type: "fourOfAKind", cards: cs, power, length: 4 };
  }

  // straight: >=3 distinct consecutive ranks, no "2"s, one card per rank
  if (cs.length >= 3) {
    const ranks = cs.map((c) => rankValue(c.rank));
    const hasTwo = cs.some((c) => c.rank === "2");
    const uniqueRanks = new Set(ranks);
    if (!hasTwo && uniqueRanks.size === cs.length && isConsecutiveRanks(ranks)) {
      return { type: "straight", cards: cs, power, length: cs.length };
    }
  }

  // consecutive pairs bombs: 3 or 4 pairs of consecutive ranks, no "2"s
  if (cs.length === 6 || cs.length === 8) {
    const hasTwo = cs.some((c) => c.rank === "2");
    if (!hasTwo) {
      const groups: Card[][] = [];
      for (let i = 0; i < cs.length; i += 2) groups.push(cs.slice(i, i + 2));
      const allPairs = groups.every((g) => g.length === 2 && g[0].rank === g[1].rank);
      const ranks = groups.map((g) => rankValue(g[0].rank));
      if (allPairs && isConsecutiveRanks(ranks)) {
        return {
          type: cs.length === 6 ? "threeConsecutivePairs" : "fourConsecutivePairs",
          cards: cs,
          power,
          length: cs.length,
        };
      }
    }
  }

  return null;
}

function isSingleTwo(combo: Combo): boolean {
  return combo.type === "single" && combo.cards[0].rank === "2";
}

function isPairOfTwos(combo: Combo): boolean {
  return combo.type === "pair" && combo.cards[0].rank === "2";
}

/**
 * Can `next` legally be played on top of `prev`?
 * `prev === null` means next starts a fresh trick (anything goes).
 */
export function canBeat(prev: Combo | null, next: Combo): boolean {
  if (!prev) return true;

  const nextIsBomb = isBomb(next);
  const prevIsBomb = isBomb(prev);

  // bomb logic: a bomb can beat a single "2" or a pair of "2"s
  if (nextIsBomb && (isSingleTwo(prev) || isPairOfTwos(prev))) return true;

  if (prevIsBomb && nextIsBomb) {
    const prevTier = BOMB_TIER[prev.type];
    const nextTier = BOMB_TIER[next.type];
    if (nextTier !== prevTier) return nextTier > prevTier;
    return next.power > prev.power;
  }

  if (prevIsBomb && !nextIsBomb) return false;
  if (!prevIsBomb && nextIsBomb) return false;

  if (next.type !== prev.type) return false;
  if (next.length !== prev.length) return false;
  return next.power > prev.power;
}
