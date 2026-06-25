import { Card, Rank, Suit, TrickPlay } from "../types";

// Kat Teh uses the standard high-card order (A is highest, 2 is lowest) —
// unlike Tiến Lên/Si Ku Khmer, the 2 has no special status here.
const KATTEH_RANK_ORDER: Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

export function kattehRankValue(rank: Rank): number {
  return KATTEH_RANK_ORDER.indexOf(rank);
}

const PREMIUM_RANKS = new Set(["A", "K", "Q"]);

/** The strongest non-folded card of the lead suit currently in the trick. */
function bestOfSuit(trick: TrickPlay[], suit: Suit): Card {
  const ofSuit = trick.filter((t) => !t.folded && t.card.suit === suit).map((t) => t.card);
  return ofSuit.reduce((best, c) => (kattehRankValue(c.rank) > kattehRankValue(best.rank) ? c : best));
}

/**
 * Can this card beat the current trick? Only a card of the lead suit with a
 * higher rank than the best non-folded card so far counts as a beat — a
 * player unable to beat must fold instead of just under-playing a card.
 */
export function canBeatCurrent(card: Card, leadSuit: Suit, currentTrick: TrickPlay[]): boolean {
  if (card.suit !== leadSuit) return false;
  if (currentTrick.length === 0) return true;
  const best = bestOfSuit(currentTrick, leadSuit);
  return kattehRankValue(card.rank) > kattehRankValue(best.rank);
}

/** Does this hand contain any card that could beat the current trick? */
export function hasBeatingCard(hand: Card[], leadSuit: Suit, currentTrick: TrickPlay[]): boolean {
  return hand.some((c) => canBeatCurrent(c, leadSuit, currentTrick));
}

/** Highest non-folded card of the lead suit wins the trick. */
export function trickWinner(trick: TrickPlay[], leadSuit: Suit): string {
  const ofLeadSuit = trick.filter((t) => !t.folded && t.card.suit === leadSuit);
  const winner = ofLeadSuit.reduce((best, t) =>
    kattehRankValue(t.card.rank) > kattehRankValue(best.card.rank) ? t : best
  );
  return winner.playerId;
}

function lowestCard(cards: Card[]): Card {
  return [...cards].sort((a, b) => kattehRankValue(a.rank) - kattehRankValue(b.rank))[0];
}

/**
 * Decide a bot's move for a normal trick. Leading: play a low card, holding
 * onto A/K/Q for the final round. Following: beat cheaply if possible (to
 * gain priority) — preferring to keep premium cards in reserve — otherwise
 * fold with the safest card we can spare.
 */
export function decideKatTehMove(
  hand: Card[],
  leadSuit: Suit | null,
  currentTrick: TrickPlay[]
): { action: "lead" | "beat" | "fold"; card: Card } {
  const nonPremium = hand.filter((c) => !PREMIUM_RANKS.has(c.rank));

  if (!leadSuit || currentTrick.length === 0) {
    return { action: "lead", card: lowestCard(nonPremium.length > 0 ? nonPremium : hand) };
  }

  const beatingCards = hand.filter((c) => canBeatCurrent(c, leadSuit, currentTrick));
  if (beatingCards.length > 0) {
    const nonPremiumBeats = beatingCards.filter((c) => !PREMIUM_RANKS.has(c.rank));
    return { action: "beat", card: lowestCard(nonPremiumBeats.length > 0 ? nonPremiumBeats : beatingCards) };
  }

  return { action: "fold", card: lowestCard(nonPremium.length > 0 ? nonPremium : hand) };
}

/**
 * How many copies of `suit` are still unaccounted for — not in this hand,
 * and not already played out — i.e. could still be hiding in an opponent's
 * hand. Used to judge how safe a suit is to expose in the final round.
 */
function unseenOfSuit(suit: Suit, hand: Card[], playedCards: Card[]): number {
  const inHand = hand.filter((c) => c.suit === suit).length;
  const played = playedCards.filter((c) => c.suit === suit).length;
  return Math.max(0, 13 - inHand - played);
}

/**
 * Final 2-card round: decide which of the two remaining cards to play face
 * up (the contested suit) versus face down (the card that actually wins or
 * loses). If both cards share a suit, keep the stronger one face down so it
 * can win the contest. Otherwise, show up whichever suit is least likely to
 * still be sitting in an opponent's hand — if nobody can match it, we win
 * by default regardless of what's face down.
 */
export function decideKatTehFinalFaceUp(hand: [Card, Card], playedCards: Card[]): number {
  const [a, b] = hand;
  if (a.suit === b.suit) {
    return kattehRankValue(a.rank) >= kattehRankValue(b.rank) ? 1 : 0;
  }
  const unseenA = unseenOfSuit(a.suit, hand, playedCards);
  const unseenB = unseenOfSuit(b.suit, hand, playedCards);
  return unseenA <= unseenB ? 0 : 1;
}
