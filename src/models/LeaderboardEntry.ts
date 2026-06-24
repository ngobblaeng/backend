import { Schema, model, models } from "mongoose";

export interface LeaderboardEntryDoc {
  playerName: string;
  wins: number;
  losses: number;
}

const leaderboardSchema = new Schema<LeaderboardEntryDoc>({
  playerName: { type: String, required: true, unique: true },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
});

export const LeaderboardEntry =
  models.LeaderboardEntry ?? model<LeaderboardEntryDoc>("LeaderboardEntry", leaderboardSchema);
