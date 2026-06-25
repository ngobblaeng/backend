import { Card, RoomState } from "./types";
import { dealUnevenHandsWithRemainder } from "./deck";
import { extractPairsFromHand, findMatchIndex, findTableMatchIndex } from "./game/sikukhmer";
import { decideSikuBotCard } from "./game/sikukhmerBot";
import { GameMoveError } from "./gameEngine";

/**
 * Si Ku Khmer deal: every player gets 5 cards except the leader (the host),
 * who gets 6 and opens the round. Leftover cards form the center pile.
 */
export function startSikuKhmer(room: RoomState): void {
  const hostIndex = room.players.findIndex((p) => p.id === room.hostId);
  const leaderIndex = hostIndex >= 0 ? hostIndex : 0;
  const { hands, remainder } = dealUnevenHandsWithRemainder(room.players.length, 5, leaderIndex, 1);

  room.points = {};
  room.players.forEach((p, i) => {
    const { hand, pairsFound } = extractPairsFromHand(hands[i]);
    p.hand = hand;
    p.finishedAt = null;
    room.points[p.id] = pairsFound;
  });

  room.sikuTable = [];
  room.sikuCenterPile = remainder;
  room.status = "playing";
  room.playedHistory = [];
  room.winnerOrder = [];
  room.gameStartedAt = Date.now();
  room.turnIndex = leaderIndex;

  // rare edge case: a player's dealt hand can be entirely pairs (e.g. all 6
  // of the leader's cards forming 3 pairs), emptying it before anyone takes
  // a turn — that's an instant win, not a hand to "play" from
  checkForWinner(room);
}

function nextSeat(room: RoomState, index: number): number {
  return (index + 1) % room.players.length;
}

function checkForWinner(room: RoomState): boolean {
  const winner = room.players.find((p) => p.hand.length === 0 && !p.finishedAt);
  if (!winner) return false;
  winner.finishedAt = Date.now();
  room.status = "finished";
  // winner first, then the rest ranked by pairs collected
  room.winnerOrder = [
    winner.id,
    ...room.players
      .filter((p) => p.id !== winner.id)
      .sort((a, b) => (room.points[b.id] ?? 0) - (room.points[a.id] ?? 0))
      .map((p) => p.id),
  ];
  return true;
}

function seatOrderFrom(room: RoomState, startIndex: number, count: number): number[] {
  const order: number[] = [];
  let seat = startIndex;
  for (let i = 0; i < count; i++) {
    order.push(seat);
    seat = nextSeat(room, seat);
  }
  return order;
}

/**
 * Try to pair `card` against the table first (credited to `tableMatchSeat`
 * — whoever "owns" this resolution), then against players' hands in
 * `handScanOrder`. Records the completed pair (both cards) in the discard
 * history, credited to whoever claimed it. Returns whether it was claimed.
 */
function tryPairCard(
  room: RoomState,
  card: Card,
  tableMatchSeat: number,
  handScanOrder: number[]
): boolean {
  const tableMatch = findTableMatchIndex(room.sikuTable, card.rank);
  if (tableMatch >= 0) {
    const [partner] = room.sikuTable.splice(tableMatch, 1);
    const claimerId = room.players[tableMatchSeat].id;
    room.points[claimerId] = (room.points[claimerId] ?? 0) + 1;
    room.playedHistory.push({ playerId: claimerId, cards: [card, partner] });
    return true;
  }

  for (const seat of handScanOrder) {
    const candidate = room.players[seat];
    const matchIdx = findMatchIndex(candidate.hand, card.rank);
    if (matchIdx >= 0) {
      const [partner] = candidate.hand.splice(matchIdx, 1);
      room.points[candidate.id] = (room.points[candidate.id] ?? 0) + 1;
      room.playedHistory.push({ playerId: candidate.id, cards: [card, partner] });
      return true;
    }
  }

  return false;
}

/**
 * Nobody could use the dropped card directly — draw one from the center
 * pile and reveal it. The player seated right after the dropper gets first
 * priority to use it; if they can't, priority cascades clockwise through
 * everyone else. If nobody can use it either, it joins the table.
 */
function drawAndResolve(room: RoomState, frontIndex: number): void {
  const card = room.sikuCenterPile.shift();
  if (!card) return;
  const order = seatOrderFrom(room, frontIndex, room.players.length);
  if (!tryPairCard(room, card, frontIndex, order)) {
    room.sikuTable.push(card);
  }
}

export function playSikuCard(room: RoomState, playerId: string, cardIndex: number): Card {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  const dropperIndex = room.turnIndex % room.players.length;
  if (room.players[dropperIndex].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }
  const card = player.hand[cardIndex];
  if (!card) throw new GameMoveError("INVALID_CARD_INDEX");

  player.hand.splice(cardIndex, 1);

  // a table match is credited to the dropper; otherwise anyone holding a
  // match gets priority going clockwise from the dropper. Only if nobody
  // can use the dropped card at all does the deck get drawn.
  const handScanOrder = seatOrderFrom(room, dropperIndex, room.players.length).filter(
    (seat) => seat !== dropperIndex
  );
  const claimed = tryPairCard(room, card, dropperIndex, handScanOrder);
  if (!claimed) {
    // the dropped card itself stays on the table, unclaimed — drawing from
    // the deck is a separate, additional action that follows it
    room.sikuTable.push(card);
    drawAndResolve(room, nextSeat(room, dropperIndex));
  }

  if (checkForWinner(room)) return card;

  room.turnIndex = nextSeat(room, dropperIndex);
  return card;
}

/** Compute the bot's card index for the current turn. */
export function computeSikuBotTurn(room: RoomState): { cardIndex: number } {
  const player = room.players[room.turnIndex % room.players.length];
  const cardIndex = decideSikuBotCard(player.hand, room.sikuTable);
  return { cardIndex };
}
