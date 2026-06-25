import { Card, Rank, Suit } from "./types";

const RANK_ORDER: Rank[] = [
  "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2",
];
const SUIT_ORDER: Suit[] = ["spades", "clubs", "diamonds", "hearts"];

export function rankValue(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

function suitValue(suit: Suit): number {
  return SUIT_ORDER.indexOf(suit);
}

export function cardValue(rank: Rank, suit: Suit): number {
  return rankValue(rank) * 4 + suitValue(suit);
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUIT_ORDER) {
    for (const rank of RANK_ORDER) {
      deck.push({ rank, suit, value: cardValue(rank, suit) });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deal `cardsPerPlayer` cards to each player from a freshly shuffled deck.
 * Defaults to dealing the whole deck evenly (e.g. 13 each for 4 players).
 * Any undealt remainder stays out of play.
 */
export function dealHands(playerCount: number, cardsPerPlayer?: number): Card[][] {
  const deck = shuffle(buildDeck());
  const perPlayer = cardsPerPlayer ?? Math.floor(deck.length / playerCount);
  const counts = Array.from({ length: playerCount }, () => perPlayer);
  return dealByCounts(deck, counts);
}

/**
 * Deal uneven hands: every player gets `baseCount` cards except `extraIndex`,
 * who gets `baseCount + extra`, and also return the undealt remainder of the
 * deck (the center pile) instead of discarding it. Used by Si Ku Khmer, where
 * leftover cards are opened one at a time as the round progresses.
 */
export function dealUnevenHandsWithRemainder(
  playerCount: number,
  baseCount: number,
  extraIndex: number,
  extra = 1
): { hands: Card[][]; remainder: Card[] } {
  const deck = shuffle(buildDeck());
  const counts = Array.from({ length: playerCount }, (_, i) => (i === extraIndex ? baseCount + extra : baseCount));
  const hands = dealByCounts(deck, counts);
  const dealt = counts.reduce((a, b) => a + b, 0);
  return { hands, remainder: deck.slice(dealt) };
}

function dealByCounts(deck: Card[], counts: number[]): Card[][] {
  const hands: Card[][] = [];
  let offset = 0;
  for (const count of counts) {
    hands.push(sortHand(deck.slice(offset, offset + count)));
    offset += count;
  }
  return hands;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => a.value - b.value);
}
