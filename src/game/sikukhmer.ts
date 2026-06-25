import { Card, Rank } from "../types";

/**
 * Si Ku Khmer is a pair-matching ("fishing") game, not a combo-shedding game:
 * players drop one card at a time and pairs of matching rank get claimed and
 * discarded. Whoever empties their hand first wins. This file holds the pure
 * matching logic shared by the engine and the bot.
 */

/**
 * Remove any same-rank pairs already sitting inside a single hand (this
 * happens right after the deal, and can also happen if a player draws/holds
 * two of a kind without anyone claiming them). Returns the reduced hand and
 * the actual pairs removed, so the caller can both credit a score and log
 * them to the discard history — otherwise a hand dealt with built-in pairs
 * just looks like it was dealt short, with no explanation visible anywhere.
 */
export function extractPairsFromHand(hand: Card[]): { hand: Card[]; pairs: [Card, Card][] } {
  const byRank = new Map<Rank, Card[]>();
  for (const card of hand) {
    const list = byRank.get(card.rank) ?? [];
    list.push(card);
    byRank.set(card.rank, list);
  }

  const kept: Card[] = [];
  const pairs: [Card, Card][] = [];
  for (const cards of byRank.values()) {
    const pairCount = Math.floor(cards.length / 2);
    for (let i = 0; i < pairCount; i++) {
      pairs.push([cards[i * 2], cards[i * 2 + 1]]);
    }
    if (cards.length % 2 === 1) kept.push(cards[cards.length - 1]);
  }
  return { hand: kept, pairs };
}

/** Index of the first card in `hand` matching `rank`, or -1 if none. */
export function findMatchIndex(hand: Card[], rank: Rank): number {
  return hand.findIndex((c) => c.rank === rank);
}

/** Index of the first card on the table matching `rank`, or -1 if none. */
export function findTableMatchIndex(table: Card[], rank: Rank): number {
  return table.findIndex((c) => c.rank === rank);
}

/**
 * How many copies of `rank` are still unaccounted for (not in this hand and
 * not visible on the table) — i.e. could still be hiding in an opponent's
 * hand or the center pile. Used by the bot to judge how "dead" a card is.
 */
export function unseenCopiesOfRank(rank: Rank, hand: Card[], table: Card[]): number {
  const inHand = hand.filter((c) => c.rank === rank).length;
  const onTable = table.filter((c) => c.rank === rank).length;
  return Math.max(0, 4 - inHand - onTable);
}
