import mongoose from "mongoose";

let connected = false;
let connecting: Promise<void> | null = null;

export function isDbConnected(): boolean {
  return connected;
}

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI not set — running without persistence (match history/leaderboard disabled)");
    return;
  }
  if (connected || connecting) return connecting ?? undefined;

  connecting = mongoose
    .connect(uri)
    .then(() => {
      connected = true;
      console.log("Connected to MongoDB");
    })
    .catch((err) => {
      console.error("MongoDB connection failed, continuing without persistence:", err.message);
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}
