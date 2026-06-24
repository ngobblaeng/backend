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

export function dealHands(playerCount: number): Card[][] {
  const deck = shuffle(buildDeck());
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  deck.forEach((card, i) => hands[i % playerCount].push(card));
  hands.forEach((h) => h.sort((a, b) => a.value - b.value));
  return hands;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => a.value - b.value);
}
