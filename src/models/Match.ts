import { Schema, model, models } from "mongoose";

export interface MatchDoc {
  roomCode: string;
  gameType: string;
  players: { name: string; isBot: boolean; placement: number }[];
  winnerName: string;
  startedAt: Date;
  endedAt: Date;
}

const matchSchema = new Schema<MatchDoc>({
  roomCode: { type: String, required: true },
  gameType: { type: String, required: true },
  players: [
    {
      name: { type: String, required: true },
      isBot: { type: Boolean, required: true },
      placement: { type: Number, required: true },
    },
  ],
  winnerName: { type: String, required: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, required: true },
});

export const Match = models.Match ?? model<MatchDoc>("Match", matchSchema);
