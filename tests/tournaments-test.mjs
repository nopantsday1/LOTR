// Checks for the pure tournament helpers in js/core/tournaments.js.
import assert from "node:assert/strict";
import {
  buildChampionStandings,
  formatTournamentDate,
  isCompleted,
  normalizeTournament,
  sortTournaments
} from "../js/core/tournaments.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("normalize trims, drops blank and duplicate entrants", () => {
  const { tournament, errors } = normalizeTournament({
    name: "  The   Battle for Erebor ",
    date: "2026-05-17",
    entrants: [
      { name: "Sito", playerId: "p1", placement: "champion" },
      { name: "sito again", playerId: "p1", placement: "" },
      { name: "Guest", playerId: "" },
      { name: "GUEST", playerId: "" },
      { name: "   " },
      { name: "Bob", placement: "bogus" }
    ]
  });
  assert.deepEqual(errors, []);
  assert.equal(tournament.name, "The Battle for Erebor");
  assert.deepEqual(
    tournament.entrants.map(e => [e.name, e.placement]),
    [["Sito", "champion"], ["Guest", ""], ["Bob", ""]]
  );
});

test("normalize requires a name and a valid date", () => {
  assert.equal(normalizeTournament({ name: "" }).errors.length, 1);
  assert.equal(normalizeTournament({ name: "X", date: "17/05/2026" }).errors.length, 1);
  assert.equal(normalizeTournament({ name: "X", date: "" }).errors.length, 0);
});

test("a tournament is completed once it has a champion", () => {
  assert.equal(isCompleted({ entrants: [{ name: "A", placement: "" }] }), false);
  assert.equal(isCompleted({ entrants: [{ name: "A", placement: "champion" }] }), true);
});

test("sort puts newest first and undated last", () => {
  const sorted = sortTournaments([
    { name: "old", date: "2025-01-01" },
    { name: "none", date: "" },
    { name: "new", date: "2026-06-01" }
  ]);
  assert.deepEqual(sorted.map(t => t.name), ["new", "old", "none"]);
});

test("standings count titles by player id and use current roster names", () => {
  const standings = buildChampionStandings(
    [
      { name: "T1", entrants: [
        { name: "OldName", playerId: "p1", placement: "champion" },
        { name: "Bob", playerId: "p2", placement: "runnerUp" },
        { name: "Carl", playerId: "p3", placement: "" }
      ] },
      { name: "T2", entrants: [
        { name: "NewName", playerId: "p1", placement: "champion" },
        { name: "Guest", playerId: "", placement: "champion" }
      ] }
    ],
    new Map([["p1", "Current"]])
  );
  assert.deepEqual(
    standings.map(r => [r.name, r.titles, r.runnerUps, r.played]),
    [["Current", 2, 0, 2], ["Guest", 1, 0, 1], ["Bob", 0, 1, 1]]
  );
});

test("dates format as a local calendar day", () => {
  assert.equal(formatTournamentDate("2026-05-17", "en-US"), "May 17, 2026");
  assert.equal(formatTournamentDate("nope"), "");
});

console.log(`\n${passed} tournament checks passed`);
