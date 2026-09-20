export const state = {
  db: null,

  players: [],
  // Live roster from Firestore, used when ratings come from the precomputed file.
  knownPlayers: [],
  playerDatasets: {},
  ratingMode: "original",
  // True while the displayed ratings came from ratings.json rather than a replay.
  ratingsArePrecomputed: false,
  history: [],
  fullHistory: [],
  communityPredictions: [],

  // gameId -> { mode: "exclude" | "include", reason, updatedAt }
  matchOverrides: new Map(),

  currentUser: null,
  linkedPlayer: null,

  adminUnlocked: false,
  adminPass: null,

  selectedPlayerIds: new Set(),
  lastBalance: null,
  swapSource: null,

  playerSortKey: "elo",
  playerSortDirection: 1,

  importing: false,
  autoRecording: false,
};
