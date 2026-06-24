import { BotLevel, Card, Combo } from "./types";
import { isBomb } from "./game/tienlen";

const BOT_NAME_POOL = [
  "ប្រូ បុល", "ប្រូ វី", "ប្រូ ឃី", "ចែ នី", "ចែ នូ", "ចែ លី", "RG (Riven GO)", "Srey Sart",
];

export function generateBotName(taken: Set<string>): string {
  const pool = BOT_NAME_POOL.filter((n) => !taken.has(n) && !taken.has(`${n} (Bot)`));
  const base = pool.length > 0 ? pool[0] : `Bot${Math.floor(Math.random() * 1000)}`;
  return `${base} (Bot)`;
}

/** All legal combos a hand can currently form, under the given ruleset. */
function enumerateCombos(hand: Card[], identifyCombo: (cards: Card[]) => Combo | null): Combo[] {
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

  // consecutive pair bombs (3 or 4 pairs) — only Tiến Lên's identifyCombo will
  // ever recognize these; other rulesets simply return null for them
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

/**
 * Cards that can't join a pair/triple/quad and don't sit inside any straight
 * this hand can form. These are "dead weight" — best played off early as
 * singles, since holding them serves no future combo.
 */
function findLooseSingles(hand: Card[], allCombos: Combo[]): Card[] {
  const inMultiCardCombo = new Set<string>();
  for (const combo of allCombos) {
    if (combo.cards.length > 1) {
      for (const c of combo.cards) inMultiCardCombo.add(`${c.rank}${c.suit}`);
    }
  }
  return hand.filter((c) => !inMultiCardCombo.has(`${c.rank}${c.suit}`));
}

function smallest(combos: Combo[]): Combo {
  return [...combos].sort((a, b) => a.power - b.power)[0];
}

/** Prefer disposing of more cards per turn — sort by length desc, then power asc. */
function biggestDump(combos: Combo[]): Combo {
  return [...combos].sort((a, b) => b.length - a.length || a.power - b.power)[0];
}

function isSingleOrPairOfTwos(combo: Combo): boolean {
  return (combo.type === "single" || combo.type === "pair") && combo.cards[0].rank === "2";
}

/** How many of this rank have been seen so far, across the bot's hand and everything played. */
function countSeen(rank: string, hand: Card[], playedCards: Card[]): number {
  return (
    hand.filter((c) => c.rank === rank).length + playedCards.filter((c) => c.rank === rank).length
  );
}

interface BotDecisionInput {
  hand: Card[];
  lastCombo: Combo | null;
  botLevel: BotLevel;
  isFreshTrick: boolean;
  /** Fewest cards held by any opponent still in the hand — signals urgency. */
  minOpponentCardCount: number;
  /** Every card played so far this hand, across all players. */
  playedCards: Card[];
  /** Combo rules for whichever shedding game is being played. */
  identifyCombo: (cards: Card[]) => Combo | null;
  canBeat: (prev: Combo | null, next: Combo) => boolean;
}

/** Pick a move for the bot, or null to pass. */
export function decideBotMove(input: BotDecisionInput): Combo | null {
  const { hand, lastCombo, botLevel, isFreshTrick, minOpponentCardCount, playedCards, identifyCombo, canBeat } = input;
  const legalCombos = enumerateCombos(hand, identifyCombo);

  const playable = legalCombos.filter((c) => (isFreshTrick ? true : canBeat(lastCombo, c)));
  if (playable.length === 0) return null;

  // winning move available right now — always take it, regardless of level
  const winningMove = playable.find((c) => c.cards.length === hand.length);
  if (winningMove) return winningMove;

  if (isFreshTrick) {
    return chooseLead(hand, legalCombos, playable, botLevel);
  }

  return chooseDefense(playable, lastCombo, botLevel, minOpponentCardCount, hand, playedCards);
}

function chooseLead(hand: Card[], allCombos: Combo[], playable: Combo[], botLevel: BotLevel): Combo {
  const nonBombs = playable.filter((c) => !isBomb(c));
  const pool = nonBombs.length > 0 ? nonBombs : playable;

  if (botLevel === "easy") {
    return smallest(pool);
  }

  // medium/hard: clear "dead weight" singles before touching pairs/straights,
  // since those cards can never become anything more useful
  const looseSingles = findLooseSingles(hand, allCombos);
  const looseSingleCombos = pool.filter(
    (c) => c.type === "single" && looseSingles.some((ls) => ls.rank === c.cards[0].rank && ls.suit === c.cards[0].suit)
  );
  if (looseSingleCombos.length > 0) {
    return smallest(looseSingleCombos);
  }

  if (botLevel === "medium") {
    return smallest(pool);
  }

  // hard: once there's no dead weight left, dump the longest structured
  // combo available (clears the most cards per turn) instead of always
  // leading with a lone single
  const endgame = hand.length <= 5;
  return endgame ? biggestDump(pool) : smallest(pool);
}

function chooseDefense(
  playable: Combo[],
  lastCombo: Combo | null,
  botLevel: BotLevel,
  minOpponentCardCount: number,
  hand: Card[],
  playedCards: Card[]
): Combo | null {
  if (botLevel === "easy") {
    return Math.random() < 0.3 ? null : smallest(playable);
  }

  const nonBombPlayable = playable.filter((c) => !isBomb(c));

  if (nonBombPlayable.length > 0) {
    return smallest(nonBombPlayable);
  }

  // only bombs can beat this trick — decide whether it's worth spending one
  if (!lastCombo) return smallest(playable);

  const opponentIsClose = minOpponentCardCount <= 3;
  const noMoreTwosComing = isSingleOrPairOfTwos(lastCombo) && countSeen("2", hand, playedCards) >= 4;

  if (botLevel === "medium") {
    // medium plays bombs whenever it has one and must respond
    return smallest(playable);
  }

  // hard: conserve bombs unless an opponent is about to win, or this is
  // provably the last "2" trick that will ever threaten this hand
  if (opponentIsClose || noMoreTwosComing) {
    return smallest(playable);
  }

  return null;
}
