import { Card, Suit, TrickPlay } from "../types";
import { rankValue } from "../deck";

const POINT_RANKS = new Set(["A", "10", "K"]);

export function cardPoints(card: Card): number {
  return POINT_RANKS.has(card.rank) ? 1 : 0;
}

export function trickPoints(trick: TrickPlay[]): number {
  return trick.reduce((sum, t) => sum + cardPoints(t.card), 0);
}

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
    rankValue(t.card.rank) > rankValue(best.card.rank) ? t : best
  );
  return winner.playerId;
}

function lowestCard(cards: Card[]): Card {
  return [...cards].sort((a, b) => a.value - b.value)[0];
}

/**
 * Choose which card a Kat Teh bot should play. Leads with a low non-point
 * card to avoid handing away free points; when following, wins cheaply if
 * points are on the table and ducks otherwise; when forced off-suit, dumps
 * a non-point card rather than discarding A/10/K for nothing.
 */
export function decideKatTehBotCard(hand: Card[], leadSuit: Suit | null, currentTrick: TrickPlay[]): Card {
  if (!leadSuit) {
    const nonPoint = hand.filter((c) => cardPoints(c) === 0);
    return lowestCard(nonPoint.length > 0 ? nonPoint : hand);
  }

  const ofSuit = hand.filter((c) => c.suit === leadSuit);

  if (ofSuit.length === 0) {
    const nonPoint = hand.filter((c) => cardPoints(c) === 0);
    return lowestCard(nonPoint.length > 0 ? nonPoint : hand);
  }

  const pointsOnTable = trickPoints(currentTrick);
  const bestInTrick = bestOfSuit(currentTrick, leadSuit);
  const winningCards = ofSuit.filter((c) => rankValue(c.rank) > rankValue(bestInTrick.rank));

  if (pointsOnTable > 0 && winningCards.length > 0) {
    return lowestCard(winningCards);
  }

  return lowestCard(ofSuit);
}

function bestOfSuit(trick: TrickPlay[], suit: Suit): Card {
  const ofSuit = trick.filter((t) => t.card.suit === suit).map((t) => t.card);
  return ofSuit.reduce((best, c) => (rankValue(c.rank) > rankValue(best.rank) ? c : best));
}
