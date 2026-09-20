// Guards the precomputed-ratings pipeline.
//
// ratings.json exists so the browser can skip a full Firestore fetch and a full
// rating replay. That is only safe if the precomputed players produce exactly
// the same displayed ratings as a live replay, and if the fingerprint reliably
// detects when the file has gone stale.
//
// Both halves are checked here against the committed local snapshot.
//
// Run with:  node tests/precomputed-ratings-test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CIVS } from "../js/core/constants.js";
import {
  fingerprintsMatch,
  ratingsFingerprint
} from "../js/core/ratingsFingerprint.js";
import {
  balanceElo,
  civElo,
  decayedElo,
  overallElo,
  ratingBreakdown
} from "../js/elo/elo.js";
import {
  ensureRatingDataset,
  initializeRatingModes
} from "../js/elo/ratingModes.js";
import { state } from "../js/core/state.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.UTC(2026, 8, 20);

const snapshot = JSON.parse(
  fs.readFileSync(path.join(ROOT, "js", "data", "lotr-local-data.json"), "utf8")
);
const players = snapshot.players;
const history = snapshot.fullHistory?.length
  ? snapshot.fullHistory
  : snapshot.history;

// ── Generate ratings.json into a temp dir, exactly as CI does ────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lotr-ratings-"));
const outFile = path.join(tmpDir, "ratings.json");

execFileSync(
  process.execPath,
  [path.join(ROOT, "scripts", "build-ratings.mjs"), "--local", "--out", outFile],
  { cwd: ROOT, stdio: "pipe" }
);

const precomputed = JSON.parse(fs.readFileSync(outFile, "utf8"));

assert.ok(precomputed.modes.original?.length, "original mode missing");
// A --local build must be tagged as such, so the client refuses to serve it.
assert.equal(
  precomputed.source,
  "local-snapshot",
  "a --local build must be tagged local-snapshot"
);
assert.ok(precomputed.generatedAt > 0, "generatedAt missing");
assert.ok(precomputed.ratingModelVersion > 0, "ratingModelVersion missing");

// ── The precomputed ratings must equal a live replay, field for field ────────
initializeRatingModes(players, history);

for (const modeId of Object.keys(precomputed.modes)) {
  const live = ensureRatingDataset(modeId);
  const cached = precomputed.modes[modeId];

  assert.equal(cached.length, live.length, `${modeId}: player count differs`);

  const liveById = new Map(live.map(p => [String(p.id), p]));

  for (const cachedPlayer of cached) {
    const livePlayer = liveById.get(String(cachedPlayer.id));
    assert.ok(livePlayer, `${modeId}: ${cachedPlayer.id} missing from live replay`);

    // The numbers every page actually displays.
    assert.equal(
      decayedElo(cachedPlayer, NOW),
      decayedElo(livePlayer, NOW),
      `${modeId}: decayedElo differs for ${cachedPlayer.name}`
    );
    assert.equal(
      overallElo(cachedPlayer),
      overallElo(livePlayer),
      `${modeId}: overallElo differs for ${cachedPlayer.name}`
    );
    assert.equal(
      cachedPlayer.gamesPlayed,
      livePlayer.gamesPlayed,
      `${modeId}: gamesPlayed differs for ${cachedPlayer.name}`
    );
    assert.equal(cachedPlayer.wins, livePlayer.wins);
    assert.equal(cachedPlayer.losses, livePlayer.losses);

    // Per-civ ratings drive the balancer, so they matter as much as main Elo.
    for (const civ of CIVS) {
      assert.equal(
        civElo(cachedPlayer, civ.id),
        civElo(livePlayer, civ.id),
        `${modeId}: civElo(${civ.id}) differs for ${cachedPlayer.name}`
      );
      assert.equal(
        balanceElo(cachedPlayer, civ.id, NOW),
        balanceElo(livePlayer, civ.id, NOW),
        `${modeId}: balanceElo(${civ.id}) differs for ${cachedPlayer.name}`
      );
    }

    // The full breakdown shown on the profile page.
    assert.deepEqual(
      ratingBreakdown(cachedPlayer, null, NOW),
      ratingBreakdown(livePlayer, null, NOW),
      `${modeId}: ratingBreakdown differs for ${cachedPlayer.name}`
    );

    // Replays seeded from a cached player must start where the live one does,
    // otherwise the History and Profile pages would show different deltas.
    assert.deepEqual(
      cachedPlayer.ratingSeed,
      livePlayer.ratingSeed,
      `${modeId}: ratingSeed differs for ${cachedPlayer.name}`
    );
  }
}

// Stripping legacy fields must not have removed anything still in use.
const sample = precomputed.modes.original[0];
for (const dropped of ["civPct", "civElo", "civWins", "civLosses"]) {
  assert.equal(sample[dropped], undefined, `${dropped} should have been stripped`);
}
assert.ok(sample.civStats, "civStats must survive");
assert.ok(Number.isFinite(sample.mainElo), "mainElo must survive");

// ── The fingerprint must match its own source and reject any change ──────────
{
  const live = ratingsFingerprint(players, history, new Map());
  assert.ok(
    fingerprintsMatch(precomputed.fingerprint, live),
    "fingerprint should match the data it was built from"
  );

  // Every kind of change that moves ratings must invalidate the file.
  const mutations = {
    "added match": () => [
      ...history,
      {
        gameId: "brand-new",
        timestamp: Date.now(),
        winner: "evil",
        evilAssign: [{ name: players[0].name, civId: "p1" }],
        goodAssign: [{ name: players[1].name, civId: "p5" }]
      }
    ],
    "removed match": () => history.slice(0, -1),
    "flipped winner": () => history.map((m, i) =>
      i === 0 ? { ...m, winner: m.winner === "evil" ? "good" : "evil" } : m
    ),
    "excluded match": () => history.map((m, i) =>
      i === 0 ? { ...m, eloExcluded: true } : m
    ),
    "changed timestamp": () => history.map((m, i) =>
      i === 0 ? { ...m, timestamp: Number(m.timestamp || 0) + 1 } : m
    ),
    "swapped civ": () => history.map((m, i) =>
      i === 0 && m.evilAssign?.length
        ? { ...m, evilAssign: [{ ...m.evilAssign[0], civId: "p4" }, ...m.evilAssign.slice(1)] }
        : m
    )
  };

  for (const [label, mutate] of Object.entries(mutations)) {
    const changed = ratingsFingerprint(players, mutate(), new Map());
    assert.ok(
      !fingerprintsMatch(precomputed.fingerprint, changed),
      `fingerprint should have changed after: ${label}`
    );
  }

  // Admin rating knobs change the outcome, so they must change the fingerprint.
  const seeded = players.map((p, i) =>
    i === 0 ? { ...p, ratingSeedOverride: 1234 } : p
  );
  assert.ok(
    !fingerprintsMatch(precomputed.fingerprint, ratingsFingerprint(seeded, history, new Map())),
    "fingerprint should have changed after a seed override"
  );
  const adjusted = players.map((p, i) =>
    i === 0 ? { ...p, eloAdjustment: -25 } : p
  );
  assert.ok(
    !fingerprintsMatch(precomputed.fingerprint, ratingsFingerprint(adjusted, history, new Map())),
    "fingerprint should have changed after an Elo adjustment"
  );

  // null and undefined must hash alike: Firestore REST and the JS SDK disagree
  // about which one an absent field becomes.
  const withNulls = players.map(p => ({
    ...p,
    ratingSeedOverride: null,
    eloAdjustment: null
  }));
  const withUndefined = players.map(p => {
    const copy = { ...p };
    delete copy.ratingSeedOverride;
    delete copy.eloAdjustment;
    return copy;
  });
  assert.ok(
    fingerprintsMatch(
      ratingsFingerprint(withNulls, history, new Map()),
      ratingsFingerprint(withUndefined, history, new Map())
    ),
    "null and undefined admin fields must fingerprint identically"
  );

  // Reordering must not matter: Firestore returns documents in arbitrary order.
  const shuffledPlayers = players.slice().reverse();
  const shuffledHistory = history.slice().reverse();
  assert.ok(
    fingerprintsMatch(
      precomputed.fingerprint,
      ratingsFingerprint(shuffledPlayers, shuffledHistory, new Map())
    ),
    "fingerprint must be order-independent"
  );
}

// ── The generator must be deterministic ──────────────────────────────────────
{
  const second = path.join(tmpDir, "ratings-2.json");
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "build-ratings.mjs"), "--local", "--out", second],
    { cwd: ROOT, stdio: "pipe" }
  );
  const a = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const b = JSON.parse(fs.readFileSync(second, "utf8"));
  // generatedAt is a timestamp and is expected to differ.
  delete a.generatedAt;
  delete b.generatedAt;
  assert.deepEqual(a, b, "two runs over identical input must produce identical output");
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("precomputed ratings checks passed");
