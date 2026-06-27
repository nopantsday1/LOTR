import assert from "node:assert/strict";
import fs from "node:fs";
import {
  activeInactivityPenalty,
  applyRatingResult,
  civBiasAdjustment,
  civElo,
  balanceElo,
  decayedElo,
  effectiveK,
  expectedTeamScore,
  mainEloDelta,
  assignmentPenalty,
  ratingBreakdown,
  rebuildInactivityState,
} from "../js/elo/elo.js";

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
  assert.equal(civBiasAdjustment(inexperienced, "p1"), -40);
  assert.equal(civBiasAdjustment(inexperienced, "p2"), -23);
  assert.equal(civBiasAdjustment(inexperienced, "p3"), 0);
  assert.equal(civBiasAdjustment(inexperienced, "p5"), -20);
  assert.equal(civElo(inexperienced, "p1"), 1460);
  assert.equal(civElo(inexperienced, "p2"), 1477);
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
  assert.equal(civBiasAdjustment(weakCivs, "p3"), -200);
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
