export type Suit = "spades" | "clubs" | "diamonds" | "hearts";
export type Rank =
  | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A" | "2";

export interface Card {
  rank: Rank;
  suit: Suit;
  /** combined sortable rank value, low to high: 3..2, suit breaks ties */
  value: number;
}

export type ComboType =
  | "single"
  | "pair"
  | "triple"
  | "straight"
  | "fourOfAKind"
  | "threeConsecutivePairs"
  | "fourConsecutivePairs";

export interface Combo {
  type: ComboType;
  cards: Card[];
  /** highest card value in the combo, used for comparisons */
  power: number;
  length: number;
}

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  hand: Card[];
  connected: boolean;
  finishedAt: number | null;
}

export type RoomStatus = "lobby" | "playing" | "finished";

export type BotLevel = "easy" | "medium" | "hard";

export type GameType = "tienlen" | "katteh" | "sikukhmer";

/** One played card in an active Kat Teh trick. */
export interface TrickPlay {
  playerId: string;
  card: Card;
}

export interface RoomState {
  id: string;
  roomCode: string;
  gameType: GameType;
  hostId: string;
  status: RoomStatus;
  players: PlayerState[];
  createdAt: number;
  expiresAt: number;
  isTraining: boolean;
  botLevel: BotLevel;
  // game state shared by Tiến Lên and Si Ku Khmer (combo shedding games)
  turnIndex: number;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  passedPlayerIds: string[];
  playedHistory: { playerId: string; cards: Card[] }[];
  winnerOrder: string[];
  gameStartedAt: number | null;
  // Kat Teh-only trick-taking state
  currentTrick: TrickPlay[];
  leadSuit: Suit | null;
  points: Record<string, number>;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  cardCount: number;
  finishedAt: number | null;
  points?: number;
}

export interface PublicRoomState {
  roomCode: string;
  gameType: GameType;
  status: RoomStatus;
  hostId: string;
  players: PublicPlayer[];
  turnIndex: number;
  currentTurnPlayerId: string | null;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  playedHistory: { playerId: string; cards: Card[] }[];
  winnerOrder: string[];
  isTraining: boolean;
  currentTrick: TrickPlay[];
  leadSuit: Suit | null;
}
