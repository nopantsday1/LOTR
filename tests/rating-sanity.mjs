import assert from "node:assert/strict";
import fs from "node:fs";
import {
  activeInactivityPenalty,
  applyRatingResult,
  balanceElo,
  decayedElo,
  effectiveK,
  expectedTeamScore,
  mainEloDelta,
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
      { games: 10, wins: 5, modifier: 0, manualPreference: null },
    ])),
  };
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
  assert.ok(Math.abs(deltas.reduce((sum, delta) => sum + delta, 0)) < 0.01);
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

// 6. Players is the leaderboard and explicitly sorts/displays real Elo.
{
  const source = fs.readFileSync(
    new URL("../js/pages/playersPage.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /sort\(\(a, b\) => displayElo\(b\) - displayElo\(a\)\)/);
  assert.match(source, /const realElo = displayElo\(player\)/);
  assert.match(source, /player-real-elo/);
}

console.log("rating sanity checks passed");
