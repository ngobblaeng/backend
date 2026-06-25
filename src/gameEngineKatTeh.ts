import { Card, RoomState } from "./types";
import { dealHands } from "./deck";
import {
  isValidKatTehPlay,
  trickWinner,
  decideKatTehBotCard,
  decideKatTehFinalFaceUp,
  kattehRankValue,
} from "./game/katteh";
import { GameMoveError } from "./gameEngine";

const CARDS_PER_PLAYER = 6;

export function startKatTeh(room: RoomState): void {
  const hands = dealHands(room.players.length, CARDS_PER_PLAYER);
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
  room.finalRound = false;
  room.finalPlacements = {};
  room.playedHistory = [];
  room.winnerOrder = [];
  room.gameStartedAt = Date.now();

  const hostIndex = room.players.findIndex((p) => p.id === room.hostId);
  room.turnIndex = hostIndex >= 0 ? hostIndex : 0;
}

function nextSeat(room: RoomState, index: number): number {
  return (index + 1) % room.players.length;
}

/** Fallback ranking if the game somehow ends without a final-round showdown. */
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

/**
 * Resolve the final 2-card showdown once everyone has placed. The leader's
 * face-up card sets the contested suit; whoever's face-down card matches
 * that suit with the highest value wins. If nobody's down card matches,
 * the leader (priority holder) wins by default.
 */
function finalizeKatTehShowdown(room: RoomState): void {
  const leader = room.players[room.turnIndex % room.players.length];
  const leadSuit = room.finalPlacements[leader.id].faceUp.suit;

  const contenders = room.players.filter(
    (p) => room.finalPlacements[p.id].faceDown.suit === leadSuit
  );

  const winnerId =
    contenders.length === 0
      ? leader.id
      : contenders.reduce((best, p) =>
          kattehRankValue(room.finalPlacements[p.id].faceDown.rank) >
          kattehRankValue(room.finalPlacements[best.id].faceDown.rank)
            ? p
            : best
        ).id;

  room.status = "finished";
  const now = Date.now();
  room.players.forEach((p) => {
    p.finishedAt = now;
  });
  room.winnerOrder = [
    winnerId,
    ...room.players
      .filter((p) => p.id !== winnerId)
      .sort((a, b) => (room.points[b.id] ?? 0) - (room.points[a.id] ?? 0))
      .map((p) => p.id),
  ];
}

export function playKatTehCard(room: RoomState, playerId: string, cardIndex: number): Card {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.finalRound) throw new GameMoveError("FINAL_ROUND_USE_PLACEMENT");
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
    room.points[winnerId] = (room.points[winnerId] ?? 0) + 1;
    room.playedHistory.push({ playerId: winnerId, cards: room.currentTrick.map((t) => t.card) });

    room.currentTrick = [];
    room.leadSuit = null;
    room.turnIndex = room.players.findIndex((p) => p.id === winnerId);

    if (room.players.every((p) => p.hand.length === 2)) {
      room.finalRound = true;
    } else if (room.players.every((p) => p.hand.length === 0)) {
      finalizeKatTeh(room);
    }
  } else {
    room.turnIndex = nextSeat(room, room.turnIndex);
  }

  return card;
}

export function placeKatTehFinalCard(room: RoomState, playerId: string, faceUpIndex: number): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (!room.finalRound) throw new GameMoveError("NOT_FINAL_ROUND");
  if (room.finalPlacements[playerId]) throw new GameMoveError("ALREADY_PLACED");
  if (player.hand.length !== 2) throw new GameMoveError("INVALID_HAND_STATE");
  if (faceUpIndex !== 0 && faceUpIndex !== 1) throw new GameMoveError("INVALID_CARD_INDEX");

  const faceUp = player.hand[faceUpIndex];
  const faceDown = player.hand[1 - faceUpIndex];
  player.hand = [];
  room.finalPlacements[playerId] = { faceUp, faceDown };

  if (Object.keys(room.finalPlacements).length === room.players.length) {
    finalizeKatTehShowdown(room);
  }
}

/** Compute the bot's card index for the current turn (normal trick play). */
export function computeKatTehBotTurn(room: RoomState): { card: Card; cardIndex: number } {
  const player = room.players[room.turnIndex % room.players.length];
  const card = decideKatTehBotCard(player.hand, room.leadSuit, room.currentTrick);
  const cardIndex = player.hand.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
  return { card, cardIndex };
}

/** Compute which of a bot's two remaining cards to play face up in the final round. */
export function computeKatTehFinalBotPlacement(room: RoomState, playerId: string): number {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.hand.length !== 2) return 0;
  const playedCards = room.playedHistory.flatMap((h) => h.cards);
  return decideKatTehFinalFaceUp([player.hand[0], player.hand[1]], playedCards);
}
