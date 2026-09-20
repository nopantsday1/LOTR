import assert from "node:assert/strict";
import fs from "node:fs";
import {
  activeInactivityPenalty,
  applyCommunityRatingContext,
  applyRatingResult,
  civBiasAdjustment,
  civElo,
  balanceElo,
  decayedElo,
  effectiveK,
  expectedTeamScore,
  hardCivLowEloPenalty,
  hardCivThresholds,
  mainEloDelta,
  assignmentPenalty,
  ratingBreakdown,
  rebuildInactivityState,
} from "../js/elo/elo.js";
import {
  COMMUNITY_ELO_SEEDS,
  communityEloSeed
} from "../js/data/communityEloSeeds.js";
import { state } from "../js/core/state.js";
import {
  BASE_RATING_MODE,
  ensureRatingDataset,
  initializeRatingModes,
  RATING_1000_MODE,
  RATING_MODES,
  toggleRatingMode
} from "../js/elo/ratingModes.js";
import {
  buildMatchRatingChanges,
  matchRatingKey
} from "../js/elo/progress.js";
import {
  buildBalancerBacktest,
  summarizeBalancerBacktest
} from "../js/elo/backtest.js";
import {
  LOBBY_KEYWORDS,
  OVERRIDABLE_REJECTIONS,
  REJECT_COMMUNITY,
  REJECT_LABELS,
  REJECT_LOBBY_NAME,
  REJECT_PLAYER_COUNT,
  REJECT_TOO_SHORT,
  feedMatchMeta,
  isEloExcluded,
  lobbyNameAllowed,
  lobbyNameOf,
  ratingEligibleHistory,
  softRejectionReason
} from "../js/core/matchRules.js";
import {
  findDuplicatePlayer,
  parseAltProfileIds,
  parseEloAdjustment,
  parsePlayerName,
  parseProfileId,
  parseSeedElo
} from "../js/core/playerInput.js";

const CIV_IDS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
const DAY = 86400000;

function player(mainElo, gamesPlayed = 0) {
  return {
    id: `p-${mainElo}-${gamesPlayed}`,
    name: `Player ${mainElo}`,
    mainElo,
    gamesPlayed,
    wins: 0,
    losses: 0,
    lastPlayedAt: null,
    inactivityPenaltyBank: 0,
    returnGamesInWindow: 0,
    returnWindowStartedAt: 0,
    ratingModelVersion: 2,
    civStats: Object.fromEntries(CIV_IDS.map(id => [
      id,
      { games: 10, wins: 5 },
    ])),
  };
}

// Hard-position difficulty follows the active community's top-five benchmark.
{
  const community = [
    player(2000),
    player(2000),
    player(2000),
    player(2000),
    player(2000),
    player(1100)
  ];
  applyCommunityRatingContext(community);
  const withContext = mainElo => ({
    ...player(mainElo),
    ratingContext: community[5].ratingContext
  });

  assert.deepEqual(hardCivThresholds(community[5]), {
    benchmarkElo: 2000,
    startElo: 1400,
    floorElo: 800
  });
  assert.equal(hardCivLowEloPenalty(withContext(1400), "p2"), 0);
  assert.equal(hardCivLowEloPenalty(withContext(1100), "p2"), -60);
  assert.equal(hardCivLowEloPenalty(withContext(800), "p2"), -120);
  assert.equal(hardCivLowEloPenalty(withContext(800), "p1"), 0);
}

// The balancer backtest uses pre-match ratings and the actual winner.
{
  const backtestPlayers = Array.from({ length: 8 }, (_, index) => ({
    ...player(index < 4 ? 1500 : 1000),
    id: `backtest-${index}`,
    name: `Backtest ${index}`,
    profileId: `backtest-profile-${index}`,
    ratingSeed: { mainElo: index < 4 ? 1500 : 1000 }
  }));
  applyCommunityRatingContext(backtestPlayers);
  const backtestMatch = {
    id: "backtest-match",
    timestamp: Date.UTC(2026, 0, 1),
    duration: 1800,
    winner: "evil",
    evilAssign: backtestPlayers.slice(0, 4).map((backtestPlayer, index) => ({
      name: backtestPlayer.name,
      profileId: backtestPlayer.profileId,
      civId: `p${index + 1}`
    })),
    goodAssign: backtestPlayers.slice(4).map((backtestPlayer, index) => ({
      name: backtestPlayer.name,
      profileId: backtestPlayer.profileId,
      civId: `p${index + 5}`
    }))
  };
  const backtest = buildBalancerBacktest(backtestPlayers, [backtestMatch]);

  assert.equal(backtest.matches.length, 1);
  assert.equal(backtest.prediction.correct, 1);
  assert.equal(backtest.prediction.incorrect, 0);
  assert.equal(backtest.prediction.weightedAccuracy, 1);
  assert.ok(backtest.matches[0].evilWinProbability > 0.9);
  assert.ok(backtest.matches[0].confidenceWeight > 0.8);
  assert.equal(backtest.duration.matches[0].durationSeconds, 1800);
  assert.ok(backtest.matches[0].evilTotal > backtest.matches[0].goodTotal);
  assert.equal(
    summarizeBalancerBacktest(backtest.matches.slice(-1)).prediction.correct,
    1
  );

  const weightedSummary = summarizeBalancerBacktest([
    { predictedWinner: "evil", correct: true, confidenceWeight: 0.1 },
    { predictedWinner: "good", correct: false, confidenceWeight: 0.9 }
  ]);
  assert.equal(weightedSummary.prediction.accuracy, 0.5);
  assert.ok(Math.abs(weightedSummary.prediction.weightedAccuracy - 0.1) < 1e-12);
}

// Original replays from community seeds. Which optional modes are enabled is a
// deployment choice (rating1000 is currently commented out in the registry), so
// assert the invariants that must hold for whatever set is enabled rather than
// pinning an exact list.
{
  // The alternate-seed replay path is exercised through the dormant rating1000
  // registration, so this block covers it regardless of which modes the
  // deployment happens to enable.
  const rating1000WasEnabled = "rating1000" in RATING_MODES;
  if (!rating1000WasEnabled) RATING_MODES.rating1000 = RATING_1000_MODE;

  const initiallyEnabledModes = Object.keys(RATING_MODES);
  const baseWasEnabled = initiallyEnabledModes.includes("base");

  // "original" is the fallback mode everywhere, so it must exist and come first.
  assert.equal(initiallyEnabledModes[0], "original");
  assert.ok(initiallyEnabledModes.length >= 1);
  assert.ok(initiallyEnabledModes.every(mode => (
    typeof RATING_MODES[mode].startingElo === "function" &&
    RATING_MODES[mode].mainEloChangeMultiplier === 1
  )));
  assert.equal(RATING_MODES.original.mainEloChangeMultiplier, 1);
  assert.equal(
    new Set(COMMUNITY_ELO_SEEDS.map(seed => seed.playerId)).size,
    COMMUNITY_ELO_SEEDS.length
  );
  const localData = JSON.parse(fs.readFileSync(
    new URL("../js/data/lotr-local-data.json", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(
    localData.players
      .filter(localPlayer => !COMMUNITY_ELO_SEEDS.some(
        seed => seed.playerId === String(localPlayer.id)
      ))
      .map(localPlayer => localPlayer.name),
    []
  );

  const evilSeed = COMMUNITY_ELO_SEEDS[0];
  const goodSeed = COMMUNITY_ELO_SEEDS[1];
  const seededPlayers = [
    {
      ...player(777),
      id: evilSeed.playerId,
      name: evilSeed.name,
      profileId: "seed-evil"
    },
    {
      ...player(777),
      id: goodSeed.playerId,
      name: goodSeed.name,
      profileId: "seed-good"
    }
  ];
  const history = [{
    timestamp: Date.UTC(2026, 0, 1),
    winner: "evil",
    evilAssign: [{
      playerId: evilSeed.playerId,
      name: evilSeed.name,
      profileId: "seed-evil",
      civId: "p1"
    }],
    goodAssign: [{
      playerId: goodSeed.playerId,
      name: goodSeed.name,
      profileId: "seed-good",
      civId: "p5"
    }]
  }];

  initializeRatingModes(seededPlayers, history);

  const originalEvil = state.playerDatasets.original.find(
    seeded => seeded.id === evilSeed.playerId
  );
  const rating1000Evil = ensureRatingDataset("rating1000").find(
    seeded => seeded.id === evilSeed.playerId
  );

  assert.equal(communityEloSeed(originalEvil), evilSeed.elo);
  assert.equal(originalEvil.ratingSeed.mainElo, evilSeed.elo);
  assert.equal(rating1000Evil.ratingSeed.mainElo, 1000);
  assert.equal(originalEvil.gamesPlayed, 1);
  assert.equal(rating1000Evil.gamesPlayed, 1);
  assert.notEqual(originalEvil.mainElo, 777);
  assert.notEqual(originalEvil.mainElo, evilSeed.elo);
  assert.notEqual(rating1000Evil.mainElo, 1000);

  const originalChanges = buildMatchRatingChanges(
    state.playerDatasets.original,
    history
  ).get(matchRatingKey(history[0]));
  const rating1000Changes = buildMatchRatingChanges(
    state.playerDatasets.rating1000,
    history
  ).get(matchRatingKey(history[0]));

  assert.ok(originalChanges.get(evilSeed.playerId) > 0);
  assert.ok(originalChanges.get(goodSeed.playerId) < 0);
  assert.ok(rating1000Changes.get(evilSeed.playerId) > 0);
  assert.ok(rating1000Changes.get(goodSeed.playerId) < 0);

  assert.equal(state.ratingMode, "original");
  for (let index = 1; index <= initiallyEnabledModes.length; index++) {
    assert.equal(toggleRatingMode(), true);
    assert.equal(
      state.ratingMode,
      initiallyEnabledModes[index % initiallyEnabledModes.length]
    );
  }

  // The dormant Base registration is the only switch needed for three modes.
  if (!baseWasEnabled) RATING_MODES.base = BASE_RATING_MODE;
  initializeRatingModes(seededPlayers, history);

  const allModes = Object.keys(RATING_MODES);
  assert.deepEqual(
    new Set(allModes),
    new Set(["original", "rating1000", "base"])
  );

  // Datasets are built on demand, not all upfront: a full replay per registered
  // mode on every page load was the single largest cost in the app. Only
  // "original" is eager, because the rest of the app reads it as the identity
  // source for players.
  assert.deepEqual(Object.keys(state.playerDatasets), ["original"]);
  assert.ok(state.playerDatasets.original.length > 0);

  // Selecting a mode builds it, and toggling walks the registry in order.
  assert.equal(state.ratingMode, "original");
  for (let index = 1; index <= allModes.length; index++) {
    assert.equal(toggleRatingMode(), true);
    const expected = allModes[index % allModes.length];
    assert.equal(state.ratingMode, expected);
    // The mode just selected must now have a real replayed dataset.
    assert.ok(state.playerDatasets[expected]?.length > 0, `${expected} not built`);
  }
  assert.equal(state.ratingMode, "original");

  // Having cycled every mode, all of them are now present.
  assert.deepEqual(new Set(Object.keys(state.playerDatasets)), new Set(allModes));

  // ensureRatingDataset is idempotent and returns the same cached array.
  assert.equal(ensureRatingDataset("base"), state.playerDatasets.base);
  assert.equal(ensureRatingDataset("nonexistent-mode"), null);

  const baseChanges = buildMatchRatingChanges(
    ensureRatingDataset("base"),
    history
  ).get(matchRatingKey(history[0]));
  assert.equal(baseChanges.get(evilSeed.playerId), 0);
  assert.equal(baseChanges.get(goodSeed.playerId), 0);

  // Restore the registry so later blocks see the real deployment config.
  if (!baseWasEnabled) delete RATING_MODES.base;
  if (!rating1000WasEnabled) delete RATING_MODES.rating1000;
  initializeRatingModes(seededPlayers, history);
}

// Civ bias never raises a player above real Elo. The two best civs are treated
// as real Elo, and the remaining civs carry only negative bias.
{
  const specialist = player(1500, 60);
  const wins = [8, 7, 6, 5, 4, 3, 2, 1];
  CIV_IDS.forEach((civId, index) => {
    specialist.civStats[civId].wins = wins[index];
  });

  const civElos = CIV_IDS.map(civId => civElo(specialist, civId));
  const zeroBiasCivs = CIV_IDS.filter(civId => civBiasAdjustment(specialist, civId) === 0);

  assert.deepEqual(zeroBiasCivs, ["p1", "p2"]);
  assert.ok(civElos.every(elo => elo <= 1500));
  assert.equal(civElo(specialist, "p1"), 1500);
  assert.equal(civElo(specialist, "p2"), 1500);
  assert.ok(civElo(specialist, "p3") < 1500);
}

// Under five games is included before choosing the two zero-bias civs.
{
  const inexperienced = player(1500, 60);

  for (const civId of CIV_IDS) {
    inexperienced.civStats[civId].games = 5;
    inexperienced.civStats[civId].wins = 3;
  }

  inexperienced.civStats.p1.games = 0;
  inexperienced.civStats.p1.wins = 0;
  inexperienced.civStats.p2.games = 4;
  inexperienced.civStats.p2.wins = 2;

  const zeroBiasCivs = CIV_IDS.filter(civId => civBiasAdjustment(inexperienced, civId) === 0);

  assert.deepEqual(zeroBiasCivs, ["p3", "p4"]);
  assert.equal(civBiasAdjustment(inexperienced, "p1"), -60);
  assert.equal(civBiasAdjustment(inexperienced, "p2"), -27);
  assert.equal(civBiasAdjustment(inexperienced, "p3"), 0);
  assert.equal(civBiasAdjustment(inexperienced, "p5"), -20);
  assert.equal(civElo(inexperienced, "p1"), 1440);
  assert.equal(civElo(inexperienced, "p2"), 1473);
  assert.equal(civElo(inexperienced, "p3"), 1500);
  assert.equal(civElo(inexperienced, "p5"), 1480);
}

// Equal raw penalties use win rate, not position order, to choose zero bias.
{
  const tied = player(1500, 60);
  tied.civStats.p1 = { games: 85, wins: 52 };
  tied.civStats.p2 = { games: 44, wins: 23 };
  tied.civStats.p3 = { games: 62, wins: 44 };
  tied.civStats.p4 = { games: 38, wins: 21 };

  const zeroBiasCivs = CIV_IDS.filter(
    civId => civBiasAdjustment(tied, civId) === 0
  );

  assert.deepEqual(zeroBiasCivs, ["p1", "p3"]);
  assert.equal(civBiasAdjustment(tied, "p2"), -20);
  assert.equal(civBiasAdjustment(tied, "p3"), 0);
}

// Very low civ win rates can reach -200 but never exceed that floor.
{
  const weakCivs = player(1500, 60);

  CIV_IDS.forEach((civId, index) => {
    weakCivs.civStats[civId].games = index === 7 ? 1 : 10;
    weakCivs.civStats[civId].wins = index < 2 ? 8 : 0;
  });

  assert.equal(civBiasAdjustment(weakCivs, "p1"), 0);
  assert.equal(civBiasAdjustment(weakCivs, "p2"), 0);
  const biases = CIV_IDS.map(civId => civBiasAdjustment(weakCivs, civId));
  assert.ok(biases.every(bias => bias >= -200 && bias <= 0));
  assert.equal(civBiasAdjustment(weakCivs, "p3"), -170);
  assert.equal(civBiasAdjustment(weakCivs, "p8"), -200);
}

// Legacy favorite and avoid metadata has no effect on ratings or assignments.
{
  const neutral = player(1500, 60);
  const preferred = structuredClone(neutral);
  preferred.favCivs = ["p1"];
  preferred.avoidCivs = ["p2"];
  preferred.civStats.p1.manualPreference = "fav";
  preferred.civStats.p2.manualPreference = "avoid";

  assert.deepEqual(
    ratingBreakdown(preferred, "p1"),
    ratingBreakdown(neutral, "p1")
  );
  assert.equal(
    assignmentPenalty(preferred, "p1"),
    assignmentPenalty(neutral, "p1")
  );
  assert.equal(
    assignmentPenalty(preferred, "p2"),
    assignmentPenalty(neutral, "p2")
  );
}

// 1. Slightly positive grinder: extreme volume lowers K and a 53% result
// against a 53% expectation does not produce net upward drift.
{
  const grinder = player(1500, 400);
  assert.ok(Math.abs(effectiveK(grinder, 80) - 16.8) < 0.0001);

  const deltas = [
    ...Array.from({ length: 53 }, () => mainEloDelta(grinder, true, 0.53, 80)),
    ...Array.from({ length: 47 }, () => mainEloDelta(grinder, false, 0.53, 80)),
  ];
  assert.ok(Math.abs(deltas.reduce((sum, delta) => sum + delta, 0)) <= 1);
}

// 2-3. Upsets pay more; highly expected wins pay very little.
{
  const newcomer = player(1200, 5);
  const upsetExpected = expectedTeamScore(1200, 1600);
  const equalExpected = expectedTeamScore(1400, 1400);
  const favoriteExpected = expectedTeamScore(1600, 1200);

  assert.ok(mainEloDelta(newcomer, true, upsetExpected, 20) >
    mainEloDelta(newcomer, true, equalExpected, 20));
  assert.ok(mainEloDelta(newcomer, true, favoriteExpected, 20) <= 4);
}

// 4. Inactivity starts at 50 after one week, reaches 300 after one month,
// and remains temporary.
{
  const now = Date.UTC(2026, 5, 7);
  const inactive = player(1800, 50);
  inactive.lastPlayedAt = now - 7 * DAY;

  assert.equal(decayedElo(inactive, now), 1750);
  assert.equal(inactive.mainElo, 1800);
  assert.equal(balanceElo(inactive, "p1", now), 1770);

  inactive.lastPlayedAt = now - 31 * DAY;
  assert.equal(decayedElo(inactive, now), 1500);
  assert.equal(inactive.mainElo, 1800);
  assert.equal(balanceElo(inactive, "p1", now), 1620);
}

// 5. Recovery clears after two games within seven days, without adding Elo.
{
  const firstReturn = Date.UTC(2026, 5, 7);
  const returning = player(1800, 50);
  returning.lastPlayedAt = firstReturn - 31 * DAY;

  const beforeFirst = returning.mainElo;
  const firstChange = applyRatingResult(
    returning,
    "p1",
    true,
    0.5,
    firstReturn,
    50
  );
  assert.equal(returning.mainElo, beforeFirst + firstChange.mainDelta);
  assert.equal(activeInactivityPenalty(returning, firstReturn), 300);
  assert.equal(returning.returnGamesInWindow, 1);

  const beforeSecond = returning.mainElo;
  const secondChange = applyRatingResult(
    returning,
    "p1",
    true,
    0.5,
    firstReturn + 6 * DAY,
    50
  );
  assert.equal(returning.mainElo, beforeSecond + secondChange.mainDelta);
  assert.equal(activeInactivityPenalty(returning, firstReturn + 6 * DAY), 0);
  assert.equal(returning.returnGamesInWindow, 0);
  assert.equal(returning.inactivityPenaltyBank, 0);
}

// Games more than seven days apart restart the recovery window.
{
  const firstReturn = Date.UTC(2026, 5, 7);
  const returning = player(1800, 50);
  returning.lastPlayedAt = firstReturn - 31 * DAY;

  applyRatingResult(returning, "p1", true, 0.5, firstReturn, 50);
  applyRatingResult(returning, "p1", true, 0.5, firstReturn + 8 * DAY, 50);

  assert.equal(returning.inactivityPenaltyBank, 300);
  assert.equal(returning.returnGamesInWindow, 1);
  assert.equal(returning.returnWindowStartedAt, firstReturn + 8 * DAY);
}

// Stored inactivity fields are rebuilt from chronological match history.
{
  const returning = player(1800, 50);
  returning.id = "returning";
  returning.inactivityPenaltyBank = 0;
  returning.returnGamesInWindow = 0;

  const april3 = Date.UTC(2026, 3, 3);
  const june2 = Date.UTC(2026, 5, 2);
  const match = timestamp => ({
    timestamp,
    evilAssign: [{ playerId: returning.id }],
    goodAssign: [],
  });

  rebuildInactivityState([returning], [
    match(june2),
    match(april3),
  ]);

  assert.equal(returning.inactivityPenaltyBank, 300);
  assert.equal(returning.returnGamesInWindow, 1);
  assert.equal(returning.lastPlayedAt, june2);
}

// Four games on the return day clear a penalty caused by a long absence.
{
  const returning = player(1800, 50);
  returning.id = "active-returner";
  const april3 = Date.UTC(2026, 3, 3);
  const june7 = Date.UTC(2026, 5, 7);
  const match = timestamp => ({
    timestamp,
    evilAssign: [{ playerId: returning.id }],
    goodAssign: [],
  });

  rebuildInactivityState([returning], [
    match(april3),
    match(june7),
    match(june7 + 1000),
    match(june7 + 2000),
    match(june7 + 3000),
  ]);

  assert.equal(returning.inactivityPenaltyBank, 0);
  assert.equal(returning.returnGamesInWindow, 0);
  assert.equal(activeInactivityPenalty(returning, june7 + 3000), 0);
}

// 6. Players consumes the canonical rating breakdown.
{
  const source = fs.readFileSync(
    new URL("../js/pages/playersPage.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /sort\(\(a, b\) => rankingElo\(b, selectedCiv\) - rankingElo\(a, selectedCiv\)\)/);
  assert.match(source, /ratingBreakdown\(/);
  assert.match(source, /rating\.displayedCivElo/);
  assert.match(source, /player-real-elo/);
}

console.log("rating sanity checks passed");

// ── Match eligibility rules ──────────────────────────────────────────────────
// The lobby-name keyword gate, the soft import gates, and the admin override
// that bypasses them.
{
  assert.deepEqual(LOBBY_KEYWORDS, ["lotr", "bfme", "hobbit", "bobbit"]);

  // Case-insensitive substring match on the lobby name. "Bobbit" is a
  // community misspelling of Hobbit that names real games, so it is a keyword.
  for (const name of [
    "HOBBIT LOTR",
    "bfme hobbit",
    "LOTR/Hobbit",
    "xxBFMExx",
    "Bobbit",
    "bobbit into +1"
  ]) {
    assert.equal(lobbyNameAllowed(name), true, `expected ${name} to pass`);
  }
  for (const name of ["DIPLOMACY", "Sands of Time", "CBA", "", null]) {
    assert.equal(lobbyNameAllowed(name), false, `expected ${name} to fail`);
  }

  // Raw feed matches carry the name in `description`, stored ones in `mapName`.
  assert.equal(lobbyNameOf({ description: "HOBBIT" }), "HOBBIT");
  assert.equal(lobbyNameOf({ mapName: "LOTR Match" }), "LOTR Match");

  const communityIds = new Set([1, 2, 3, 4]);
  const goodMembers = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(profile_id => ({ profile_id }));
  const feedMatch = {
    match_id: 900,
    description: "LOTR Hobbit",
    startgametime: 1000,
    completiontime: 1000 + 1800,
    matchhistorymember: goodMembers
  };

  const meta = feedMatchMeta(feedMatch, communityIds);
  assert.equal(meta.gameId, "900");
  assert.equal(meta.memberCount, 8);
  assert.equal(meta.communityCount, 4);
  assert.equal(meta.duration, 1800);
  assert.equal(softRejectionReason(meta, false), null);

  // Each soft gate rejects for its own reason, and a force-include bypasses it.
  const rejection = (patch, expected) => {
    const patched = { ...feedMatch, ...patch };
    assert.equal(
      softRejectionReason(feedMatchMeta(patched, communityIds), false),
      expected
    );
    assert.equal(
      softRejectionReason(feedMatchMeta(patched, communityIds), true),
      null
    );
  };

  rejection({ description: "DIPLOMACY" }, REJECT_LOBBY_NAME);
  rejection({ matchhistorymember: goodMembers.slice(0, 6) }, REJECT_PLAYER_COUNT);
  rejection({ completiontime: 1000 + 120 }, REJECT_TOO_SHORT);
  rejection(
    {
      matchhistorymember: [9, 10, 11, 12, 13, 14, 15, 16]
        .map(profile_id => ({ profile_id }))
    },
    REJECT_COMMUNITY
  );

  // Every overridable reason must have a human-readable label.
  for (const reason of OVERRIDABLE_REJECTIONS) {
    assert.equal(typeof REJECT_LABELS[reason], "string");
    assert.ok(REJECT_LABELS[reason].length > 0);
  }
  // A missing result or teams cannot be overridden into existence.
  assert.equal(OVERRIDABLE_REJECTIONS.has("noResult"), false);
  assert.equal(OVERRIDABLE_REJECTIONS.has("noTeams"), false);

  // ratingEligibleHistory drops only flagged matches, preserving order.
  const history = [
    { gameId: "a" },
    { gameId: "b", eloExcluded: true },
    { gameId: "c" }
  ];
  assert.deepEqual(
    ratingEligibleHistory(history).map(match => match.gameId),
    ["a", "c"]
  );
  assert.equal(isEloExcluded(history[1]), true);
  assert.equal(isEloExcluded(history[0]), false);
  assert.deepEqual(ratingEligibleHistory([]), []);
  assert.deepEqual(ratingEligibleHistory(null), []);
}

// ── Excluding a match removes its rating effect entirely ─────────────────────
// Excluding is not a soft flag: the replay must land on exactly the ratings it
// would have produced had the match never been recorded.
{
  const seeds = [COMMUNITY_ELO_SEEDS[0], COMMUNITY_ELO_SEEDS[1]];
  const roster = seeds.map((seed, index) => ({
    ...player(1200),
    id: seed.playerId,
    name: seed.name,
    profileId: `excl-${index}`
  }));
  const matchOne = {
    gameId: "keep-1",
    timestamp: 1_700_000_000_000,
    winner: "evil",
    evilAssign: [{ playerId: seeds[0].playerId, name: seeds[0].name, civId: "p1" }],
    goodAssign: [{ playerId: seeds[1].playerId, name: seeds[1].name, civId: "p5" }]
  };
  const matchTwo = {
    ...matchOne,
    gameId: "drop-2",
    timestamp: 1_700_000_100_000
  };

  const ladderFor = history => {
    initializeRatingModes(roster, history);
    const dataset = state.playerDatasets.original;
    return seeds.map(seed => {
      const found = dataset.find(candidate => candidate.id === seed.playerId);
      return { elo: found.mainElo, games: found.gamesPlayed };
    });
  };

  const withBoth = ladderFor([matchOne, matchTwo]);
  const withSecondExcluded = ladderFor([
    matchOne,
    { ...matchTwo, eloExcluded: true }
  ]);
  const withOnlyFirst = ladderFor([matchOne]);

  // Excluding the second match reproduces the one-match ladder exactly.
  assert.deepEqual(withSecondExcluded, withOnlyFirst);
  assert.equal(withSecondExcluded[0].games, 1);
  // ...and is genuinely different from counting both.
  assert.notDeepEqual(withSecondExcluded, withBoth);
  assert.equal(withBoth[0].games, 2);
}

// ── Manual Elo knobs ────────────────────────────────────────────────────────
// A seed override moves where the replay starts; an adjustment shifts the
// finished rating. Both must survive the replay, since ratings are derived.
{
  const seed = COMMUNITY_ELO_SEEDS[0];
  const base = { ...player(1200), id: seed.playerId, name: seed.name };

  const ratingFor = patch => {
    initializeRatingModes([{ ...base, ...patch }], []);
    return state.playerDatasets.original[0];
  };

  // No overrides: the community seed wins.
  assert.equal(ratingFor({}).mainElo, seed.elo);
  assert.equal(ratingFor({}).ratingSeed.mainElo, seed.elo);

  // Seed override replaces the starting point.
  const seeded = ratingFor({ ratingSeedOverride: 1234 });
  assert.equal(seeded.mainElo, 1234);
  assert.equal(seeded.ratingSeed.mainElo, 1234);

  // Adjustment is applied on top of the replayed result.
  assert.equal(ratingFor({ eloAdjustment: 50 }).mainElo, seed.elo + 50);
  assert.equal(ratingFor({ eloAdjustment: -75 }).mainElo, seed.elo - 75);

  // Both together compose.
  assert.equal(
    ratingFor({ ratingSeedOverride: 1000, eloAdjustment: 25 }).mainElo,
    1025
  );

  // Ignored values fall back to the seed rather than producing NaN.
  for (const bad of [null, undefined, 0, -10, "abc", NaN]) {
    const result = ratingFor({ ratingSeedOverride: bad });
    assert.equal(result.mainElo, seed.elo, `seed override ${bad} should be ignored`);
    assert.ok(Number.isFinite(result.mainElo));
  }
  for (const bad of [null, undefined, "abc", NaN]) {
    const result = ratingFor({ eloAdjustment: bad });
    assert.equal(result.mainElo, seed.elo, `adjustment ${bad} should be ignored`);
    assert.ok(Number.isFinite(result.mainElo));
  }
}

// ── Admin player input validation ───────────────────────────────────────────
{
  assert.deepEqual(parseAltProfileIds("123, 456  789"), [123, 456, 789]);
  assert.deepEqual(parseAltProfileIds(""), []);
  assert.deepEqual(parseAltProfileIds(null), []);
  assert.deepEqual(parseAltProfileIds([1, 2]), [1, 2]);
  assert.equal(parseProfileId(""), null);
  assert.equal(parseProfileId("  1162254 "), 1162254);
  assert.throws(() => parseProfileId("abc"), /not a valid AoE2 profile id/);
  assert.throws(() => parseProfileId("12.5"), /not a valid AoE2 profile id/);

  assert.equal(parseSeedElo("1200"), 1200);
  assert.throws(() => parseSeedElo(50), /between/);
  assert.throws(() => parseSeedElo(9999), /between/);
  assert.throws(() => parseSeedElo("abc"), /between/);

  assert.equal(parseEloAdjustment("-50"), -50);
  assert.equal(parseEloAdjustment(0), 0);
  assert.throws(() => parseEloAdjustment(5000), /between/);

  assert.equal(parsePlayerName("  Frodo  "), "Frodo");
  assert.throws(() => parsePlayerName("   "), /name is required/);
  assert.throws(() => parsePlayerName("x".repeat(61)), /too long/);

  // Duplicate detection covers name (case-insensitive) and every profile id.
  const roster = [{ name: "Frodo", profileId: 111, altProfileIds: [222] }];
  assert.ok(findDuplicatePlayer(roster, "frodo", null));
  assert.ok(findDuplicatePlayer(roster, "  FRODO ", null));
  assert.ok(findDuplicatePlayer(roster, "Sam", 111));
  assert.ok(findDuplicatePlayer(roster, "Sam", 222));
  assert.equal(findDuplicatePlayer(roster, "Sam", 333), null);
  assert.equal(findDuplicatePlayer(roster, "Sam", null), null);
  assert.equal(findDuplicatePlayer([], "Frodo", 111), null);
}

console.log("match rules, exclusion, manual Elo and admin input checks passed");
