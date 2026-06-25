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

/** A player must follow the lead suit if they hold any card of it. */
export function isValidKatTehPlay(hand: Card[], card: Card, leadSuit: Suit | null): boolean {
  if (!leadSuit) return true;
  const hasLeadSuit = hand.some((c) => c.suit === leadSuit);
  if (!hasLeadSuit) return true;
  return card.suit === leadSuit;
}

/** Highest card of the lead suit wins the trick; off-suit cards never win. */
export function trickWinner(trick: TrickPlay[], leadSuit: Suit): string {
  const ofLeadSuit = trick.filter((t) => t.card.suit === leadSuit);
  const winner = ofLeadSuit.reduce((best, t) =>
    kattehRankValue(t.card.rank) > kattehRankValue(best.card.rank) ? t : best
  );
  return winner.playerId;
}

function lowestCard(cards: Card[]): Card {
  return [...cards].sort((a, b) => kattehRankValue(a.rank) - kattehRankValue(b.rank))[0];
}

function bestOfSuit(trick: TrickPlay[], suit: Suit): Card {
  const ofSuit = trick.filter((t) => t.card.suit === suit).map((t) => t.card);
  return ofSuit.reduce((best, c) => (kattehRankValue(c.rank) > kattehRankValue(best.rank) ? c : best));
}

/**
 * Choose which card a Kat Teh bot should play. Priority (winning the trick
 * to lead next) matters more than any single card's value here, so the bot
 * tries to win cheaply when it can, but holds onto A/K/Q as long as
 * possible — they're the cards that matter most in the final 2-card round.
 */
export function decideKatTehBotCard(hand: Card[], leadSuit: Suit | null, currentTrick: TrickPlay[]): Card {
  const nonPremium = hand.filter((c) => !PREMIUM_RANKS.has(c.rank));

  if (!leadSuit) {
    return lowestCard(nonPremium.length > 0 ? nonPremium : hand);
  }

  const ofSuit = hand.filter((c) => c.suit === leadSuit);
  if (ofSuit.length === 0) {
    // can't follow suit — fold with the safest card we can spare
    return lowestCard(nonPremium.length > 0 ? nonPremium : hand);
  }

  const bestInTrick = bestOfSuit(currentTrick, leadSuit);
  const winningCards = ofSuit.filter((c) => kattehRankValue(c.rank) > kattehRankValue(bestInTrick.rank));
  if (winningCards.length > 0) return lowestCard(winningCards);

  // can't win this trick — play the smallest of-suit card to lose as cheaply as possible
  return lowestCard(ofSuit);
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
