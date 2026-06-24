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
import { saveMatchResult } from "./persistence";
import { BotLevel, RoomState } from "./types";

const RECONNECT_WINDOW_MS = 2 * 60 * 1000;
const disconnectTimers = new Map<string, NodeJS.Timeout>();

function sanitizeName(name: string): string {
  return name.trim().slice(0, 20).replace(/[<>]/g, "");
}

function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/i.test(code);
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
  while (room.status === "playing" && guard < 50) {
    const current = room.players[room.turnIndex % room.players.length];
    if (!current.isBot) break;
    const { cardIndices } = computeBotTurn(room);
    try {
      if (cardIndices.length > 0) {
        playCards(room, current.id, cardIndices);
      } else {
        passTurn(room, current.id);
      }
    } catch {
      break;
    }
    guard++;
  }
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    socket.on("room:create", (payload: { name: string; isTraining?: boolean; botLevel?: BotLevel }) => {
      const name = sanitizeName(payload?.name ?? "");
      if (!name) return socket.emit("error:message", "Name is required");

      const botLevel = payload?.botLevel ?? "hard";
      const room = payload?.isTraining
        ? createTrainingRoom(name, socket.id, botLevel)
        : createRoom(name, socket.id, botLevel);

      socket.join(room.roomCode);
      socket.data.roomCode = room.roomCode;
      socket.data.playerName = name;

      if (room.isTraining) {
        startGame(room);
        runBotsUntilHuman(io, room);
      }

      broadcastRoom(io, room);
      socket.emit("room:created", { roomCode: room.roomCode });
      if (room.status === "finished") {
        io.to(room.roomCode).emit("game:ended", { winnerOrder: room.winnerOrder });
        void saveMatchResult(room);
      }
    });

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

      startGame(room);
      runBotsUntilHuman(io, room);
      broadcastRoom(io, room);
      io.to(room.roomCode).emit("game:started");
      if (room.status === "finished") {
        io.to(room.roomCode).emit("game:ended", { winnerOrder: room.winnerOrder });
        void saveMatchResult(room);
      }
    });

    socket.on("game:playCards", (cardIndices: number[]) => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      try {
        playCards(room, socket.id, cardIndices);
        runBotsUntilHuman(io, room);
        broadcastRoom(io, room);
        if (room.status === "finished") {
          io.to(room.roomCode).emit("game:ended", { winnerOrder: room.winnerOrder });
          void saveMatchResult(room);
        }
      } catch (err) {
        socket.emit("error:message", err instanceof GameMoveError ? err.message : "Move failed");
      }
    });

    socket.on("game:pass", () => {
      const room = getRoom(socket.data.roomCode ?? "");
      if (!room) return;
      try {
        passTurn(room, socket.id);
        runBotsUntilHuman(io, room);
        broadcastRoom(io, room);
        if (room.status === "finished") {
          io.to(room.roomCode).emit("game:ended", { winnerOrder: room.winnerOrder });
          void saveMatchResult(room);
        }
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

    socket.on("room:leave", () => {
      handleLeave(io, socket);
    });

    socket.on("disconnect", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
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
  const timer = disconnectTimers.get(socket.id);
  if (timer) clearTimeout(timer);
  const room = removePlayer(roomCode, socket.id);
  socket.leave(roomCode);
  socket.data.roomCode = undefined;
  if (room) broadcastRoom(io, room);
}
