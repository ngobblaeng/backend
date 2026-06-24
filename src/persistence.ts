import { isDbConnected } from "./db";
import { Match } from "./models/Match";
import { LeaderboardEntry } from "./models/LeaderboardEntry";
import { RoomState } from "./types";

export async function saveMatchResult(room: RoomState): Promise<void> {
  if (!isDbConnected()) return;

  const placementOf = (playerId: string) => {
    const idx = room.winnerOrder.indexOf(playerId);
    return idx >= 0 ? idx + 1 : room.players.length;
  };

  const winnerId = room.winnerOrder[0];
  const winner = room.players.find((p) => p.id === winnerId);
  if (!winner) return;

  try {
    await Match.create({
      roomCode: room.roomCode,
      gameType: room.gameType,
      players: room.players.map((p) => ({
        name: p.name,
        isBot: p.isBot,
        placement: placementOf(p.id),
      })),
      winnerName: winner.name,
      startedAt: new Date(room.gameStartedAt ?? Date.now()),
      endedAt: new Date(),
    });

    const humanPlayers = room.players.filter((p) => !p.isBot);
    await Promise.all(
      humanPlayers.map((p) => {
        const placement = placementOf(p.id);
        const update = placement === 1 ? { $inc: { wins: 1 } } : { $inc: { losses: 1 } };
        return LeaderboardEntry.updateOne({ playerName: p.name }, update, { upsert: true });
      })
    );
  } catch (err) {
    console.error("Failed to save match result:", err);
  }
}
