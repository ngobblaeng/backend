import { BotLevel, Card, Combo } from "./types";
import { identifyCombo, canBeat, isBomb } from "./game/tienlen";

const BOT_NAME_POOL = [
  "ប្រូ បុល", "ប្រូ វី", "ប្រូ ឃី", "ចែ នី", "ចែ នូ", "ចែ លី", "RG (Riven GO)", "Srey Sart",
];

export function generateBotName(taken: Set<string>): string {
  const pool = BOT_NAME_POOL.filter((n) => !taken.has(n) && !taken.has(`${n} (Bot)`));
  const base = pool.length > 0 ? pool[0] : `Bot${Math.floor(Math.random() * 1000)}`;
  return `${base} (Bot)`;
}

/** All legal combos a hand can currently form. */
function enumerateCombos(hand: Card[]): Combo[] {
  const combos: Combo[] = [];

  for (const card of hand) {
    const c = identifyCombo([card]);
    if (c) combos.push(c);
  }

  const byRank = new Map<string, Card[]>();
  for (const card of hand) {
    const list = byRank.get(card.rank) ?? [];
    list.push(card);
    byRank.set(card.rank, list);
  }
  for (const group of byRank.values()) {
    if (group.length >= 2) {
      const pair = identifyCombo(group.slice(0, 2));
      if (pair) combos.push(pair);
    }
    if (group.length >= 3) {
      const triple = identifyCombo(group.slice(0, 3));
      if (triple) combos.push(triple);
    }
    if (group.length >= 4) {
      const four = identifyCombo(group.slice(0, 4));
      if (four) combos.push(four);
    }
  }

  const sortedHand = [...hand].sort((a, b) => a.value - b.value);
  for (let len = 3; len <= sortedHand.length; len++) {
    for (let start = 0; start + len <= sortedHand.length; start++) {
      const slice = sortedHand.slice(start, start + len);
      const straight = identifyCombo(slice);
      if (straight) combos.push(straight);
    }
  }

  // consecutive pair bombs (3 or 4 pairs)
  const pairRanks = [...byRank.entries()].filter(([, g]) => g.length >= 2);
  pairRanks.sort((a, b) => a[1][0].value - b[1][0].value);
  for (const size of [3, 4]) {
    for (let i = 0; i + size <= pairRanks.length; i++) {
      const slice = pairRanks.slice(i, i + size);
      const cards = slice.flatMap(([, g]) => g.slice(0, 2));
      const combo = identifyCombo(cards);
      if (combo) combos.push(combo);
    }
  }

  return combos;
}

interface BotDecisionInput {
  hand: Card[];
  lastCombo: Combo | null;
  botLevel: BotLevel;
  isFreshTrick: boolean;
}

/** Pick a move for the bot, or null to pass. */
export function decideBotMove(input: BotDecisionInput): Combo | null {
  const { hand, lastCombo, botLevel, isFreshTrick } = input;
  const legalCombos = enumerateCombos(hand);

  const playable = legalCombos.filter((c) =>
    isFreshTrick ? true : canBeat(lastCombo, c)
  );

  if (playable.length === 0) return null;

  if (isFreshTrick) {
    // lead with the smallest non-bomb combo, save bombs for defense
    const nonBombs = playable.filter((c) => !isBomb(c));
    const pool = nonBombs.length > 0 ? nonBombs : playable;
    return smallest(pool);
  }

  if (botLevel === "easy") {
    return Math.random() < 0.3 ? null : smallest(playable);
  }

  if (botLevel === "medium") {
    return smallest(playable);
  }

  // hard: avoid breaking up bombs/big pairs unless forced; play smallest
  // viable combo, preferring single/pair over triggering a bomb
  const nonBombPlayable = playable.filter((c) => !isBomb(c));
  if (nonBombPlayable.length > 0) {
    return smallest(nonBombPlayable);
  }
  return smallest(playable);
}

function smallest(combos: Combo[]): Combo {
  return [...combos].sort((a, b) => a.power - b.power)[0];
}
