export const state = {
  db: null,
  auth: null,

  players: [],
  history: [],
  fullHistory: [],

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
