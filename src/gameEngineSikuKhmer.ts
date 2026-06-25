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
}

function nextSeat(room: RoomState, index: number): number {
  return (index + 1) % room.players.length;
}

function finishIfEmpty(room: RoomState, player: RoomState["players"][number]): boolean {
  if (player.hand.length !== 0) return false;
  player.finishedAt = Date.now();
  room.status = "finished";
  // winner first, then the rest ranked by pairs collected
  room.winnerOrder = [
    player.id,
    ...room.players.filter((p) => p.id !== player.id).sort((a, b) => (room.points[b.id] ?? 0) - (room.points[a.id] ?? 0)).map((p) => p.id),
  ];
  return true;
}

/**
 * Open one card from the center pile in front of the next player, who gets
 * first priority to claim it (against their own hand, then the table).
 * If unclaimed, it joins the table as a face-up single.
 */
function openCenterCard(room: RoomState, frontOfIndex: number): void {
  const card = room.sikuCenterPile.shift();
  if (!card) return;
  const frontPlayer = room.players[frontOfIndex];

  const handMatch = findMatchIndex(frontPlayer.hand, card.rank);
  if (handMatch >= 0) {
    frontPlayer.hand.splice(handMatch, 1);
    room.points[frontPlayer.id] = (room.points[frontPlayer.id] ?? 0) + 1;
    room.playedHistory.push({ playerId: frontPlayer.id, cards: [card] });
    return;
  }

  const tableMatch = findTableMatchIndex(room.sikuTable, card.rank);
  if (tableMatch >= 0) {
    room.sikuTable.splice(tableMatch, 1);
    room.points[frontPlayer.id] = (room.points[frontPlayer.id] ?? 0) + 1;
    room.playedHistory.push({ playerId: frontPlayer.id, cards: [card] });
    return;
  }

  room.sikuTable.push(card);
}

export function playSikuCard(room: RoomState, playerId: string, cardIndex: number): Card {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new GameMoveError("PLAYER_NOT_FOUND");
  if (room.status !== "playing") throw new GameMoveError("GAME_NOT_ACTIVE");
  if (room.players[room.turnIndex % room.players.length].id !== playerId) {
    throw new GameMoveError("NOT_YOUR_TURN");
  }
  const card = player.hand[cardIndex];
  if (!card) throw new GameMoveError("INVALID_CARD_INDEX");

  player.hand.splice(cardIndex, 1);

  // A card that matches one already sitting on the table pairs immediately,
  // credited to the player who dropped it.
  const tableMatch = findTableMatchIndex(room.sikuTable, card.rank);
  if (tableMatch >= 0) {
    room.sikuTable.splice(tableMatch, 1);
    room.points[playerId] = (room.points[playerId] ?? 0) + 1;
    room.playedHistory.push({ playerId, cards: [card] });
  } else {
    // Otherwise, whoever holds a matching card may claim it — priority goes
    // to whoever is seated closest going clockwise from the dropper.
    let claimedBy: string | null = null;
    let seat = nextSeat(room, room.turnIndex);
    for (let step = 0; step < room.players.length - 1; step++) {
      const candidate = room.players[seat];
      const matchIdx = findMatchIndex(candidate.hand, card.rank);
      if (matchIdx >= 0) {
        candidate.hand.splice(matchIdx, 1);
        room.points[candidate.id] = (room.points[candidate.id] ?? 0) + 1;
        room.playedHistory.push({ playerId: candidate.id, cards: [card] });
        claimedBy = candidate.id;
        break;
      }
      seat = nextSeat(room, seat);
    }
    if (!claimedBy) {
      room.sikuTable.push(card);
    }
  }

  if (finishIfEmpty(room, player)) return card;

  const nextIndex = nextSeat(room, room.turnIndex);
  openCenterCard(room, nextIndex);

  const frontPlayer = room.players[nextIndex];
  if (finishIfEmpty(room, frontPlayer)) return card;

  room.turnIndex = nextIndex;
  return card;
}

/** Compute the bot's card index for the current turn. */
export function computeSikuBotTurn(room: RoomState): { cardIndex: number } {
  const player = room.players[room.turnIndex % room.players.length];
  const cardIndex = decideSikuBotCard(player.hand, room.sikuTable);
  return { cardIndex };
}
