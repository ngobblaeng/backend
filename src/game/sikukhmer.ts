import { Card, Combo } from "../types";
import { identifyCombo as identifyTienLenCombo } from "./tienlen";

const ALLOWED_TYPES = new Set(["single", "pair", "triple", "straight"]);

/**
 * Si Ku Khmer uses the same single/pair/triple/straight shapes as Tiến Lên,
 * but has no bombs and no "beat the 2" exception — house rules vary across
 * Cambodia, so this is deliberately the simplest baseline ruleset.
 */
export function identifyCombo(cards: Card[]): Combo | null {
  const combo = identifyTienLenCombo(cards);
  if (!combo || !ALLOWED_TYPES.has(combo.type)) return null;
  return combo;
}

/**
 * Can `next` legally be played on top of `prev`? Same type, same length,
 * strictly higher power — no bombs, no special-case exceptions.
 */
export function canBeat(prev: Combo | null, next: Combo): boolean {
  if (!prev) return true;
  if (next.type !== prev.type) return false;
  if (next.length !== prev.length) return false;
  return next.power > prev.power;
}
