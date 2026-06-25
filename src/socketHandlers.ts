import { Server, Socket } from "socket.io";
import {
  createRoom,
  createTrainingRoom,
  fillWithBots,
  getRoom,
  joinRoom,
  removePlayer,
  toPublicRoom,
} from "./roomManager";
import { startGame, playCards, passTurn, computeBotTurn, GameMoveError } from "./gameEngine";
import {
  startKatTeh,
  playKatTehCard,
  placeKatTehFinalCard,
  computeKatTehBotTurn,
  computeKatTehFinalBotPlacement,
} from "./gameEngineKatTeh";
import { startSikuKhmer, playSikuCard, computeSikuBotTurn } from "./gameEngineSikuKhmer";
import { saveMatchResult } from "./persistence";
import { BotLevel, GameType, RoomState } from "./types";

const RECONNECT_WINDOW_MS = 2 * 60 * 1000;
const disconnectTimers = new Map<string, NodeJS.Timeout>();
const VALID_GAME_TYPES: GameType[] = ["tienlen", "katteh", "sikukhmer"];

// Live voice chat is peer-to-peer (WebRTC) — the server only relays signaling
// messages between players in the same room and tracks who currently has
// their mic connection open. No audio ever passes through or is stored here.
const voiceParticipants = new Map<string, Set<string>>();

function leaveVoice(io: Server, roomCode: string, socketId: string): void {
  const set = voiceParticipants.get(roomCode);
  if (!set || !set.has(socketId)) return;
  set.delete(socketId);
  if (set.size === 0) voiceParticipants.delete(roomCode);
  io.to(roomCode).emit("voice:peer-left", { peerId: socketId });
}

function sanitizeName(name: string): string {
  return name.trim().slice(0, 20).replace(/[<>]/g, "");
}

function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/i.test(code);
}

function sanitizeGameType(value: unknown): GameType {
  return VALID_GAME_TYPES.includes(value as GameType) ? (value as GameType) : "tienlen";
}

function startGameForRoom(room: RoomState): void {
  if (room.gameType === "katteh") {
    startKatTeh(room);
  } else if (room.gameType === "sikukhmer") {
    startSikuKhmer(room);
  } else {
    startGame(room);
  }
}

function broadcastRoom(io: Server, room: RoomState): void {
  io.to(room.roomCode).emit("room:state", toPublicRoom(room));
  for (const player of room.players) {
    if (!player.isBot) {
      io.to(player.id).emit("hand:update", room.players.find((p) => p.id === player.id)?.hand ?? []);
    }
  }
}

function runBotsUntilHuman(io: Server, room: RoomState): void {
  let guard = 0;
  while (room.status === "playing" && !room.finalRound && guard < 100) {
    const current = room.players[room.turnIndex % room.players.length];
    if (!current.isBot) break;
    try {
      if (room.gameType === "katteh") {
        const { cardIndex } = computeKatTehBotTurn(room);
        playKatTehCard(room, current.id, cardIndex);
      } else if (room.gameType === "sikukhmer") {
        const { cardIndex } = computeSikuBotTurn(room);
        playSikuCard(room, current.id, cardIndex);
      } else {
        const { cardIndices } = computeBotTurn(room);
        if (cardIndices.length > 0) {
          playCards(room, current.id, cardIndices);
        } else {
          passTurn(room, current.id);
        }
      }
    } catch {
      break;
    }
    guard++;
  }

  // Kat Teh's final 2-card showdown isn't turn-based — every player places
  // independently, so have bots place as soon as the round starts.
  if (room.gameType === "katteh" && room.status === "playing" && room.finalRound) {
    for (const p of room.players) {
      if (!p.isBot || room.finalPlacements[p.id]) continue;
      try {
        const faceUpIndex = computeKatTehFinalBotPlacement(room, p.id);
        placeKatTehFinalCard(room, p.id, faceUpIndex);
      } catch {
        break;
      }
    }
  }
}

function emitGameEndIfFinished(io: Server, room: RoomState): void {
  if (room.status === "finished") {
    io.to(room.roomCode).emit("game:ended", { winnerOrder: room.winnerOrder });
    void saveMatchResult(room);
  }
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "room:create",
      (payload: { name: string; isTraining?: boolean; botLevel?: BotLevel; gameType?: GameType }) => {
        const name = sanitizeName(payload?.name ?? "");
        if (!name) return socket.emit("error:message", "Name is required");

        const botLevel = payload?.botLevel ?? "hard";
        const gameType = sanitizeGameType(payload?.gameType);
        const room = payload?.isTraining
          ? createTrainingRoom(name, socket.id, botLevel, gameType)
          : createRoom(name, socket.id, botLevel, gameType);

        socket.join(room.roomCode);
        socket.data.roomCode = room.roomCode;
        socket.data.playerName = name;

        if (room.isTraining) {
          startGameForRoom(room);
          runBotsUntilHuman(io, room);
        }

        broadcastRoom(io, room);
        socket.emit("room:created", { roomCode: room.roomCode });
        emitGameEndIfFinished(io, room);
      }
    );

    socket.on("room:join", (payload: { roomCode: string; name: string }) => {
      const roomCode = (payload?.roomCode ?? "").toUpperCase().trim();
      const name = sanitizeName(payload?.name ?? "");
      if (!isValidRoomCode(roomCode)) return socket.emit("error:message", "Invalid room code");
      if (!name) return socket.emit("error:message", "Name is required");

      try {
        const room = joinRoom(roomCode, name, socket.id);
        socket.join(room.roomCode);
        socket.data.roomCode = room.roomCode;
        socket.data.playerName = name;
        broadcastRoom(io, room);
        socket.emit("room:joined", { roomCode: room.roomCode });
        io.to(room.roomCode).emit("chat:system", `${name} joined the room`);
      } catch (err) {
        socket.emit("error:message", (err as Error).message);
      }
    });

    socket.on("room:rejoin", (payload: { roomCode: string; name: string }) => {
      const roomCode = (payload?.roomCode ?? "").toUpperCase().trim();
      const name = sanitizeName(payload?.name ?? "");
      const room = getRoom(roomCode);
      if (!room) return socket.emit("error:message", "Room no longer exists");

      // already a live member of this room under this exact socket (e.g. the
      // room page mounted its listeners just after room:create/room:join
      // fired, missing the original broadcast) — just resync, no transfer
      const alreadyHere = room.players.find((p) => p.id === socket.id);
      if (alreadyHere) {
        socket.join(room.roomCode);
        socket.data.roomCode = room.roomCode;
        socket.data.playerName = alreadyHere.name;
        broadcastRoom(io, room);
        return socket.emit("room:joined", { roomCode: room.roomCode });
      }

      const player = room.players.find(
        (p) => !p.connected && p.name.toLowerCase() === name.toLowerCase()
      );
      if (!player) return socket.emit("error:message", "Could not rejoin room");

      const oldTimer = disconnectTimers.get(player.id);
      if (oldTimer) {
        clearTimeout(oldTimer);
        disconnectTimers.delete(player.id);
      }

      const oldId = player.id;
      player.id = socket.id;
      player.connected = true;
      if (room.hostId === oldId) room.hostId = socket.id;
      if (room.lastPlayerId === oldId) room.lastPlayerId = socket.id;
      room.passedPlayerIds = room.passedPlayerIds.map((id) => (id === oldId ? socket.id : id));
      room.winnerOrder = room.winnerOrder.map((id) => (id === oldId ? socket.id : id));
      if (room.points[oldId] !== undefined) {
        room.points[socket.id] = room.points[oldId];
        delete room.points[oldId];
      }
      room.currentTrick = room.currentTrick.map((t) =>
        t.playerId === oldId ? { ...t, playerId: socket.id } : t
      );
      if (room.finalPlacements[oldId]) {
        room.finalPlacements[socket.id] = room.finalPlacements[oldId];
        delete room.finalPlacements[oldId];
      }

      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;
      socket.data.playerName = name;

      broadcastRoom(io, room);
      socket.emit("room:joined", { roomCode: room.roomCode });
    });

    socket.on("room:fillBots", () => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room || room.hostId !== socket.id) return;
      fillWithBots(room);
      broadcastRoom(io, room);
    });

    socket.on("game:start", () => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room || room.hostId !== socket.id) return socket.emit("error:message", "Only host can start");
      if (room.players.length < 2) return socket.emit("error:message", "Need at least 2 players");

      startGameForRoom(room);
      runBotsUntilHuman(io, room);
      broadcastRoom(io, room);
      io.to(room.roomCode).emit("game:started");
      emitGameEndIfFinished(io, room);
    });

    socket.on("game:playCards", (cardIndices: number[]) => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      try {
        if (room.gameType === "katteh") {
          if (!Array.isArray(cardIndices) || cardIndices.length !== 1) {
            throw new GameMoveError("KAT_TEH_SINGLE_CARD_ONLY");
          }
          playKatTehCard(room, socket.id, cardIndices[0]);
        } else if (room.gameType === "sikukhmer") {
          if (!Array.isArray(cardIndices) || cardIndices.length !== 1) {
            throw new GameMoveError("SIKU_KHMER_SINGLE_CARD_ONLY");
          }
          playSikuCard(room, socket.id, cardIndices[0]);
        } else {
          playCards(room, socket.id, cardIndices);
        }
        runBotsUntilHuman(io, room);
        broadcastRoom(io, room);
        emitGameEndIfFinished(io, room);
      } catch (err) {
        socket.emit("error:message", err instanceof GameMoveError ? err.message : "Move failed");
      }
    });

    socket.on("game:placeFinalCards", (payload: { faceUpIndex: number }) => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      try {
        placeKatTehFinalCard(room, socket.id, payload?.faceUpIndex);
        runBotsUntilHuman(io, room);
        broadcastRoom(io, room);
        emitGameEndIfFinished(io, room);
      } catch (err) {
        socket.emit("error:message", err instanceof GameMoveError ? err.message : "Placement failed");
      }
    });

    socket.on("game:pass", () => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      if (room.gameType === "katteh") {
        return socket.emit("error:message", "Kat Teh has no passing — you must follow suit or play a card");
      }
      if (room.gameType === "sikukhmer") {
        return socket.emit("error:message", "Si Ku Khmer has no passing — you must drop a card every turn");
      }
      try {
        passTurn(room, socket.id);
        runBotsUntilHuman(io, room);
        broadcastRoom(io, room);
        emitGameEndIfFinished(io, room);
      } catch (err) {
        socket.emit("error:message", err instanceof GameMoveError ? err.message : "Pass failed");
      }
    });

    socket.on("chat:message", (text: string) => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      const clean = String(text ?? "").trim().slice(0, 280);
      if (!clean) return;
      io.to(room.roomCode).emit("chat:message", {
        name: socket.data.playerName ?? "Player",
        text: clean,
        at: Date.now(),
      });
    });

    socket.on("voice:join", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode || !getRoom(roomCode)) return;
      const set = voiceParticipants.get(roomCode) ?? new Set<string>();
      const existingPeers = [...set];
      set.add(socket.id);
      voiceParticipants.set(roomCode, set);
      socket.emit("voice:peers", { peers: existingPeers });
      socket.to(roomCode).emit("voice:peer-joined", { peerId: socket.id });
    });

    socket.on("voice:leave", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      leaveVoice(io, roomCode, socket.id);
    });

    socket.on("voice:signal", (payload: { to: string; data: unknown }) => {
      const roomCode = socket.data.roomCode;
      if (!roomCode || !payload?.to) return;
      const set = voiceParticipants.get(roomCode);
      if (!set || !set.has(socket.id) || !set.has(payload.to)) return;
      io.to(payload.to).emit("voice:signal", { from: socket.id, data: payload.data });
    });

    socket.on("room:leave", () => {
      handleLeave(io, socket);
    });

    socket.on("disconnect", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      leaveVoice(io, roomCode, socket.id);
      const room = getRoom(roomCode);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (player) player.connected = false;
      broadcastRoom(io, room);

      const timer = setTimeout(() => {
        const r = getRoom(roomCode);
        if (!r) return;
        const p = r.players.find((pl) => pl.id === socket.id);
        if (p && !p.connected) {
          removePlayer(roomCode, socket.id);
          const updated = getRoom(roomCode);
          if (updated) broadcastRoom(io, updated);
        }
        disconnectTimers.delete(socket.id);
      }, RECONNECT_WINDOW_MS);
      disconnectTimers.set(socket.id, timer);
    });
  });
}

function handleLeave(io: Server, socket: Socket): void {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  leaveVoice(io, roomCode, socket.id);
  const timer = disconnectTimers.get(socket.id);
  if (timer) clearTimeout(timer);
  const room = removePlayer(roomCode, socket.id);
  socket.leave(roomCode);
  socket.data.roomCode = undefined;
  if (room) broadcastRoom(io, room);
}
