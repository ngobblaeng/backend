import { Card, Combo, RoomState } from "./types";
import { dealHands, sortHand } from "./deck";
import { canBeat, identifyCombo } from "./game/tienlen";
import { decideBotMove } from "./bot";

export function startGame(room: RoomState): void {
  const hands = dealHands(room.players.length);
  room.players.forEach((p, i) => {
    p.hand = hands[i];
    p.finishedAt = null;
  });
  room.status = "playing";
  room.lastCombo = null;
  room.lastPlayerId = null;
  room.passedPlayerIds = [];
  room.playedHistory = [];
  room.winnerOrder = [];
  room.gameStartedAt = Date.now();

  // player holding the 3 of spades leads, classic Tiến Lên rule
  const starterIndex = room.players.findIndex((p) =>
    p.hand.some((c) => c.rank === "3" && c.suit === "spades")
  );
  room.turnIndex = starterIndex >= 0 ? starterIndex : 0;
}

function activePlayerIndexes(room: RoomState): number[] {
  return room.players
    .map((p, i) => i)
    .filter((i) => !room.players[i].finishedAt);
}

function advanceTurn(room: RoomState): void {
  const active = activePlayerIndexes(room);
  if (active.length <= 1) return;
  let next = (room.turnIndex + 1) % room.players.length;
  while (room.players[next].finishedAt) {
    next = (next + 1) % room.players.length;
  }
  room.turnIndex = next;
}

function isFreshTrick(room: RoomState): boolean {
  if (!room.lastPlayerId) return true;
  const active = activePlayerIndexes(room);
  const stillIn = active.filter((i) => !room.passedPlayerIds.includes(room.players[i].id));
  return stillIn.length <= 1;
}

export class GameMoveError extends Error {}

export function playCards(room: RoomState, playerId: string, cardIndices: number[]): Combo {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.players[room.turnIndex % room.players.length].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }
  if (cardIndices.length === 0) throw new GameMoveError("NO_CARDS_SELECTED");

  const cards: Card[] = cardIndices.map((i) => player.hand[i]).filter(Boolean);
  if (cards.length !== cardIndices.length) throw new GameMoveError("INVALID_CARD_INDEX");

  const combo = identifyCombo(cards);
  if (!combo) throw new GameMoveError("INVALID_COMBO");

  const fresh = isFreshTrick(room);
  const prevCombo = fresh ? null : room.lastCombo;
  if (!canBeat(prevCombo, combo)) throw new GameMoveError("MOVE_TOO_WEAK");

  const sortedIndices = [...cardIndices].sort((a, b) => b - a);
  for (const idx of sortedIndices) player.hand.splice(idx, 1);

  room.lastCombo = combo;
  room.lastPlayerId = playerId;
  room.passedPlayerIds = [];
  room.playedHistory.push({ playerId, cards: combo.cards });

  if (player.hand.length === 0) {
    player.finishedAt = Date.now();
    room.winnerOrder.push(playerId);
    const active = activePlayerIndexes(room);
    if (active.length <= 1) {
      if (active.length === 1) {
        const lastPlayer = room.players[active[0]];
        lastPlayer.finishedAt = Date.now();
        room.winnerOrder.push(lastPlayer.id);
      }
      room.status = "finished";
      return combo;
    }
  }

  advanceTurn(room);
  return combo;
}

export function passTurn(room: RoomState, playerId: string): void {
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.players[room.turnIndex % room.players.length].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }
  if (!room.lastPlayerId) throw new GameMoveError("CANNOT_PASS_FRESH_TRICK");
  if (room.lastPlayerId === playerId) throw new GameMoveError("CANNOT_PASS_OWN_LEAD");

  if (!room.passedPlayerIds.includes(playerId)) {
    room.passedPlayerIds.push(playerId);
  }
  advanceTurn(room);

  const active = activePlayerIndexes(room);
  const stillIn = active.filter((i) => !room.passedPlayerIds.includes(room.players[i].id));
  if (stillIn.length <= 1) {
    room.lastCombo = null;
    room.passedPlayerIds = [];
  }
}

/** Compute the bot's move for the current turn, or null if it should pass. */
export function computeBotTurn(room: RoomState): { combo: Combo | null; cardIndices: number[] } {
  const player = room.players[room.turnIndex % room.players.length];
  const fresh = isFreshTrick(room);
  const combo = decideBotMove({
    hand: player.hand,
    lastCombo: fresh ? null : room.lastCombo,
    botLevel: room.botLevel,
    isFreshTrick: fresh,
  });
  if (!combo) return { combo: null, cardIndices: [] };

  const cardIndices: number[] = [];
  const used = new Set<number>();
  for (const card of combo.cards) {
    const idx = player.hand.findIndex(
      (c, i) => !used.has(i) && c.rank === card.rank && c.suit === card.suit
    );
    if (idx >= 0) {
      used.add(idx);
      cardIndices.push(idx);
    }
  }
  return { combo, cardIndices };
}

export function currentPlayerId(room: RoomState): string {
  return room.players[room.turnIndex % room.players.length].id;
}

export function rehandSorted(room: RoomState): void {
  room.players.forEach((p) => (p.hand = sortHand(p.hand)));
}
