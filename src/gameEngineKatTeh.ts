import { Card, RoomState } from "./types";
import { dealHands } from "./deck";
import { isValidKatTehPlay, trickPoints, trickWinner, decideKatTehBotCard } from "./game/katteh";
import { GameMoveError } from "./gameEngine";

export function startKatTeh(room: RoomState): void {
  const hands = dealHands(room.players.length);
  room.players.forEach((p, i) => {
    p.hand = hands[i];
    p.finishedAt = null;
  });
  room.status = "playing";
  room.currentTrick = [];
  room.leadSuit = null;
  room.points = {};
  room.players.forEach((p) => {
    room.points[p.id] = 0;
  });
  room.playedHistory = [];
  room.winnerOrder = [];
  room.gameStartedAt = Date.now();

  const hostIndex = room.players.findIndex((p) => p.id === room.hostId);
  room.turnIndex = hostIndex >= 0 ? hostIndex : 0;
}

function nextSeat(room: RoomState, index: number): number {
  return (index + 1) % room.players.length;
}

function finalizeKatTeh(room: RoomState): void {
  room.status = "finished";
  const now = Date.now();
  room.players.forEach((p) => {
    p.finishedAt = now;
  });
  room.winnerOrder = [...room.players]
    .sort((a, b) => (room.points[b.id] ?? 0) - (room.points[a.id] ?? 0))
    .map((p) => p.id);
}

export function playKatTehCard(room: RoomState, playerId: string, cardIndex: number): Card {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.players[room.turnIndex % room.players.length].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }

  const card = player.hand[cardIndex];
  if (!card) throw new GameMoveError("INVALID_CARD_INDEX");
  if (!isValidKatTehPlay(player.hand, card, room.leadSuit)) {
    throw new GameMoveError("MUST_FOLLOW_SUIT");
  }

  player.hand.splice(cardIndex, 1);
  if (room.currentTrick.length === 0) room.leadSuit = card.suit;
  room.currentTrick.push({ playerId, card });

  if (room.currentTrick.length === room.players.length) {
    const winnerId = trickWinner(room.currentTrick, room.leadSuit!);
    const points = trickPoints(room.currentTrick);
    room.points[winnerId] = (room.points[winnerId] ?? 0) + points;
    room.playedHistory.push({ playerId: winnerId, cards: room.currentTrick.map((t) => t.card) });

    room.currentTrick = [];
    room.leadSuit = null;
    room.turnIndex = room.players.findIndex((p) => p.id === winnerId);

    if (room.players.every((p) => p.hand.length === 0)) {
      finalizeKatTeh(room);
    }
  } else {
    room.turnIndex = nextSeat(room, room.turnIndex);
  }

  return card;
}

/** Compute the bot's card index for the current turn. */
export function computeKatTehBotTurn(room: RoomState): { card: Card; cardIndex: number } {
  const player = room.players[room.turnIndex % room.players.length];
  const card = decideKatTehBotCard(player.hand, room.leadSuit, room.currentTrick);
  const cardIndex = player.hand.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
  return { card, cardIndex };
}
