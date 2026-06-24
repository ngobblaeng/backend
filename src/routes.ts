import { Router } from "express";
import { Match } from "./models/Match";
import { LeaderboardEntry } from "./models/LeaderboardEntry";
import { isDbConnected } from "./db";

export const apiRouter = Router();

apiRouter.get("/leaderboard", async (_req, res) => {
  if (!isDbConnected()) return res.json([]);
  const top = await LeaderboardEntry.find().sort({ wins: -1 }).limit(50).lean();
  res.json(top);
});

apiRouter.get("/matches", async (req, res) => {
  if (!isDbConnected()) return res.json([]);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const playerName = typeof req.query.playerName === "string" ? req.query.playerName : undefined;
  const filter = playerName ? { "players.name": playerName } : {};
  const matches = await Match.find(filter).sort({ endedAt: -1 }).limit(limit).lean();
  res.json(matches);
});
