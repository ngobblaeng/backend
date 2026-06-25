import { Card } from "../types";
import { unseenCopiesOfRank } from "./sikukhmer";

/**
 * Pick which card the bot should drop on its turn. Mirrors the strategy
 * described for human players: take a free pair off the table if you can,
 * otherwise get rid of the card least likely to ever pair (its rank is
 * mostly "dead"), instead of holding onto cards at random.
 */
export function decideSikuBotCard(hand: Card[], table: Card[]): number {
  if (hand.length === 0) return -1;

  // 1. If any card in hand matches a card already on the table, drop it —
  //    that's an instant, guaranteed pair for us.
  const tableRanks = new Set(table.map((c) => c.rank));
  const freePairIndex = hand.findIndex((c) => tableRanks.has(c.rank));
  if (freePairIndex >= 0) return freePairIndex;

  // 2. Otherwise drop the card whose rank has the fewest unseen copies left
  //    in the game — it's the least likely to ever find a match, and the
  //    safest to let go without handing an opponent a free pair.
  let bestIndex = 0;
  let bestUnseen = Infinity;
  hand.forEach((card, i) => {
    const unseen = unseenCopiesOfRank(card.rank, hand, table);
    if (unseen < bestUnseen) {
      bestUnseen = unseen;
      bestIndex = i;
    }
  });
  return bestIndex;
}
