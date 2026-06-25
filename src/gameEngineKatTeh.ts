import { Card, RoomState } from "./types";
import { dealHands } from "./deck";
import {
  canBeatCurrent,
  trickWinner,
  decideKatTehMove,
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

function resolveTrickIfComplete(room: RoomState): void {
  if (room.currentTrick.length !== room.players.length) {
    room.turnIndex = nextSeat(room, room.turnIndex);
    return;
  }

  const winnerId = trickWinner(room.currentTrick, room.leadSuit!);
  room.points[winnerId] = (room.points[winnerId] ?? 0) + 1;
  // folded cards are never revealed — they're excluded from history so
  // nobody (including bots) can use them for card-counting
  const revealedCards = room.currentTrick.filter((t) => !t.folded).map((t) => t.card);
  room.playedHistory.push({ playerId: winnerId, cards: revealedCards });

  room.currentTrick = [];
  room.leadSuit = null;
  room.turnIndex = room.players.findIndex((p) => p.id === winnerId);

  if (room.players.every((p) => p.hand.length === 2)) {
    room.finalRound = true;
  } else if (room.players.every((p) => p.hand.length === 0)) {
    finalizeKatTeh(room);
  }
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

  if (room.currentTrick.length === 0) {
    player.hand.splice(cardIndex, 1);
    room.leadSuit = card.suit;
    room.currentTrick.push({ playerId, card, folded: false });
  } else {
    if (!canBeatCurrent(card, room.leadSuit!, room.currentTrick)) {
      throw new GameMoveError("MUST_BEAT_OR_FOLD");
    }
    player.hand.splice(cardIndex, 1);
    room.currentTrick.push({ playerId, card, folded: false });
  }

  resolveTrickIfComplete(room);
  return card;
}

export function foldKatTehCard(room: RoomState, playerId: string, cardIndex: number): Card {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.finalRound) throw new GameMoveError("FINAL_ROUND_USE_PLACEMENT");
  if (room.players[room.turnIndex % room.players.length].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }
  if (room.currentTrick.length === 0) throw new GameMoveError("CANNOT_FOLD_WHEN_LEADING");

  const card = player.hand[cardIndex];
  if (!card) throw new GameMoveError("INVALID_CARD_INDEX");

  player.hand.splice(cardIndex, 1);
  room.currentTrick.push({ playerId, card, folded: true });

  resolveTrickIfComplete(room);
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

/** Compute the bot's move for the current turn (normal trick play). */
export function computeKatTehBotTurn(
  room: RoomState
): { action: "lead" | "beat" | "fold"; cardIndex: number } {
  const player = room.players[room.turnIndex % room.players.length];
  const { action, card } = decideKatTehMove(player.hand, room.leadSuit, room.currentTrick);
  const cardIndex = player.hand.findIndex((c) => c.rank === card.rank && c.suit === card.suit);
  return { action, cardIndex };
}

/** Compute which of a bot's two remaining cards to play face up in the final round. */
export function computeKatTehFinalBotPlacement(room: RoomState, playerId: string): number {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.hand.length !== 2) return 0;
  const playedCards = room.playedHistory.flatMap((h) => h.cards);
  return decideKatTehFinalFaceUp([player.hand[0], player.hand[1]], playedCards);
}
