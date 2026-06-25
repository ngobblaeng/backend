import { customAlphabet } from "nanoid";
import {
  BotLevel,
  GameType,
  PlayerState,
  PublicPlayer,
  PublicRoomState,
  RoomState,
} from "./types";
import { generateBotName } from "./bot";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 6);

const ROOM_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
const MAX_PLAYERS = 4;

const rooms = new Map<string, RoomState>();

export function createRoom(
  hostName: string,
  hostId: string,
  botLevel: BotLevel = "hard",
  gameType: GameType = "tienlen"
): RoomState {
  let roomCode = generateRoomCode();
  while (rooms.has(roomCode)) roomCode = generateRoomCode();

  const now = Date.now();
  const host: PlayerState = {
    id: hostId,
    name: hostName,
    isBot: false,
    isHost: true,
    hand: [],
    connected: true,
    finishedAt: null,
  };

  const room: RoomState = {
    id: roomCode,
    roomCode,
    gameType,
    hostId,
    status: "lobby",
    players: [host],
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    isTraining: false,
    botLevel,
    turnIndex: 0,
    lastCombo: null,
    lastPlayerId: null,
    passedPlayerIds: [],
    playedHistory: [],
    winnerOrder: [],
    gameStartedAt: null,
    currentTrick: [],
    leadSuit: null,
    points: {},
    finalRound: false,
    finalPlacements: {},
    sikuTable: [],
    sikuCenterPile: [],
  };

  rooms.set(roomCode, room);
  return room;
}

export function createTrainingRoom(
  hostName: string,
  hostId: string,
  botLevel: BotLevel,
  gameType: GameType = "tienlen"
): RoomState {
  const room = createRoom(hostName, hostId, botLevel, gameType);
  room.isTraining = true;
  const taken = new Set([hostName]);
  for (let i = 0; i < 3; i++) {
    const name = generateBotName(taken);
    taken.add(name);
    room.players.push({
      id: `bot_${room.roomCode}_${i}`,
      name,
      isBot: true,
      isHost: false,
      hand: [],
      connected: true,
      finishedAt: null,
    });
  }
  return room;
}

export function getRoom(roomCode: string): RoomState | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function deleteRoom(roomCode: string): void {
  rooms.delete(roomCode.toUpperCase());
}

export function joinRoom(roomCode: string, playerName: string, playerId: string): RoomState {
  const room = getRoom(roomCode);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.status !== "lobby") throw new Error("GAME_ALREADY_STARTED");
  if (room.players.filter((p) => !p.isBot).length >= MAX_PLAYERS) {
    throw new Error("ROOM_FULL");
  }
  const nameTaken = room.players.some(
    (p) => p.name.toLowerCase() === playerName.toLowerCase()
  );
  if (nameTaken) throw new Error("NAME_TAKEN");

  room.players.push({
    id: playerId,
    name: playerName,
    isBot: false,
    isHost: false,
    hand: [],
    connected: true,
    finishedAt: null,
  });
  return room;
}

export function fillWithBots(room: RoomState): void {
  const taken = new Set(room.players.map((p) => p.name));
  while (room.players.length < MAX_PLAYERS) {
    const name = generateBotName(taken);
    taken.add(name);
    room.players.push({
      id: `bot_${room.roomCode}_${room.players.length}`,
      name,
      isBot: true,
      isHost: false,
      hand: [],
      connected: true,
      finishedAt: null,
    });
  }
}

export function removePlayer(roomCode: string, playerId: string): RoomState | undefined {
  const room = getRoom(roomCode);
  if (!room) return undefined;
  room.players = room.players.filter((p) => p.id !== playerId);
  if (room.players.length === 0) {
    deleteRoom(roomCode);
    return undefined;
  }
  if (room.hostId === playerId) {
    const nextHost = room.players.find((p) => !p.isBot) ?? room.players[0];
    room.hostId = nextHost.id;
    nextHost.isHost = true;
  }
  return room;
}

export function toPublicRoom(room: RoomState): PublicRoomState {
  const players: PublicPlayer[] = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isHost: p.isHost,
    connected: p.connected,
    cardCount: p.hand.length,
    finishedAt: p.finishedAt,
    points:
      room.gameType === "katteh" || room.gameType === "sikukhmer" ? room.points[p.id] ?? 0 : undefined,
  }));

  const activePlayers = room.players.filter((p) => !p.finishedAt);
  const currentTurnPlayerId =
    room.status === "playing" && activePlayers.length > 0
      ? room.players[room.turnIndex % room.players.length].id
      : null;

  return {
    roomCode: room.roomCode,
    gameType: room.gameType,
    status: room.status,
    hostId: room.hostId,
    players,
    turnIndex: room.turnIndex,
    currentTurnPlayerId,
    lastCombo: room.lastCombo,
    lastPlayerId: room.lastPlayerId,
    playedHistory: room.playedHistory,
    winnerOrder: room.winnerOrder,
    isTraining: room.isTraining,
    currentTrick: room.currentTrick,
    leadSuit: room.leadSuit,
    sikuTable: room.sikuTable,
    sikuCenterRemaining: room.sikuCenterPile.length,
    finalRound: room.finalRound,
    finalPlacements: Object.fromEntries(
      Object.entries(room.finalPlacements).map(([id, placement]) => [
        id,
        { faceUp: placement.faceUp, faceDown: room.status === "finished" ? placement.faceDown : null },
      ])
    ),
  };
}

export function sweepExpiredRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.expiresAt < now) rooms.delete(code);
  }
}
