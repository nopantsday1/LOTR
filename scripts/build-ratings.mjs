#!/usr/bin/env node
/**
 * Precomputes player ratings and writes ratings.json.
 *
 * Ratings are derived by replaying the entire match history, which costs the
 * browser a full Firestore fetch of ~1,000 documents plus several hundred
 * milliseconds of replay on every page load. That work is identical for every
 * visitor and only changes when history changes, so it is done once here.
 *
 * This script imports the REAL rating modules from js/elo/. That is the whole
 * point: a second implementation of the Elo model (in Python, say) would
 * silently drift from the browser's and corrupt the ladder. If it runs here it
 * is the same code the client runs.
 *
 * Usage:
 *   node scripts/build-ratings.mjs [--out ratings.json] [--local]
 *
 *   --local  read from js/data/lotr-local-data.json instead of Firestore,
 *            for testing without network access.
 *
 * The output carries a fingerprint of the data it was built from. The client
 * compares that against live Firestore data and only replays when they differ,
 * so a stale file degrades to today's behaviour rather than showing wrong Elo.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIREBASE_CONFIG } from "../js/core/config.js";
import { state } from "../js/core/state.js";
import {
  ensureRatingDataset,
  initializeRatingModes,
  RATING_MODES
} from "../js/elo/ratingModes.js";
import { RATING_MODEL_VERSION } from "../js/elo/elo.js";
import { applyOverridesToHistory } from "../js/core/matchRules.js";
import { ratingsFingerprint } from "../js/core/ratingsFingerprint.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = FIREBASE_CONFIG.projectId;
const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
  `/databases/(default)/documents`;

const PAGE_SIZE = 300;
const MAX_PAGES = 200;

// --- Firestore REST -------------------------------------------------------

// Firestore wraps every field in a type tag. This mirrors the decoding that
// scrape_matches.py already does for the players collection.
function decodeValue(value) {
  if (value == null) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return Date.parse(value.timestampValue);
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeValue);
  }
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  // Unknown scalar types (bytes, reference, geoPoint) are not used by this app.
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = decodeValue(value);
  }
  return out;
}

function documentId(doc) {
  return String(doc.name || "").split("/").pop();
}

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Firestore rate-limits reads, and this job pulls ~1,000 documents across
// several pages, so a 429 partway through is expected rather than exceptional.
// Retrying with backoff mirrors what scrape_matches.py does for the game API.
async function fetchWithRetry(url, label) {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;

    lastStatus = res.status;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) return res;

    const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
    console.warn(
      `  ${label}: HTTP ${res.status}, retrying in ${Math.round(wait / 1000)}s ` +
      `(attempt ${attempt}/${MAX_ATTEMPTS})`
    );
    await sleep(wait);
  }

  throw new Error(`${label}: gave up after HTTP ${lastStatus}`);
}

async function fetchCollection(name, { optional = false } = {}) {
  const docs = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${BASE_URL}/${name}?pageSize=${PAGE_SIZE}&key=${API_KEY}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetchWithRetry(url, name);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (optional) {
        console.warn(
          `  ${name}: unavailable (HTTP ${res.status}); continuing without it`
        );
        return null;
      }
      throw new Error(`Failed to read ${name}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }

    const body = await res.json();
    for (const doc of body.documents || []) {
      docs.push({ id: documentId(doc), ...decodeFields(doc.fields) });
    }

    pageToken = body.nextPageToken || "";
    if (!pageToken) break;
  }

  return docs;
}

// --- Sources --------------------------------------------------------------

async function loadFromFirestore() {
  console.log(`Reading Firestore project ${PROJECT_ID}...`);
  // Sequential, not parallel: concurrent page requests are what trips the rate
  // limiter on a database this size.
  const players = await fetchCollection("players");
  const history = await fetchCollection("history");
  // Reads on this collection may be denied until its security rule is added;
  // without it every match simply counts, which is the pre-override behaviour.
  const overrides = await fetchCollection("matchOverrides", { optional: true });

  console.log(
    `  players ${players.length} · history ${history.length} · overrides ${overrides ? overrides.length : "n/a"}`
  );
  return { players, history, overrides: overrides || [], source: "firestore" };
}

function loadFromLocalSnapshot() {
  const file = path.join(ROOT, "js", "data", "lotr-local-data.json");
  console.log(`Reading local snapshot ${path.relative(ROOT, file)}...`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const history = data.fullHistory?.length ? data.fullHistory : data.history || [];
  console.log(`  players ${data.players.length} · history ${history.length}`);
  return { players: data.players || [], history, overrides: [], source: "local-snapshot" };
}

// --- Build ----------------------------------------------------------------

// Legacy fields that normalizePlayerRating only reads when migrating an old
// record. Replayed players are already at the current model version with full
// civStats, so these are never consulted -- they are ~35% of the payload.
const LEGACY_FIELDS = ["civPct", "civElo", "civWins", "civLosses"];

function slimPlayer(player) {
  const copy = { ...player };
  for (const field of LEGACY_FIELDS) delete copy[field];
  return copy;
}

function buildRatings({ players, history, overrides, source }) {
  const overrideMap = new Map(
    (overrides || []).map(entry => [String(entry.id), entry])
  );
  const effectiveHistory = applyOverridesToHistory(history, overrideMap);

  // The same entry point the browser uses.
  initializeRatingModes(players, effectiveHistory);

  const modes = {};
  for (const modeId of Object.keys(RATING_MODES)) {
    const dataset = ensureRatingDataset(modeId);
    if (dataset?.length) modes[modeId] = dataset.map(slimPlayer);
  }

  return {
    generatedAt: Date.now(),
    // The client refuses a file built from the local snapshot: --local is for
    // testing, and serving those ratings would show a ladder built from stale,
    // partial history without any way to notice.
    source,
    ratingModelVersion: RATING_MODEL_VERSION,
    fingerprint: ratingsFingerprint(players, effectiveHistory, overrideMap),
    modes
  };
}

// --- Main -----------------------------------------------------------------

async function main(argv) {
  const useLocal = argv.includes("--local");
  const outIndex = argv.indexOf("--out");
  const outPath = path.resolve(
    ROOT,
    outIndex !== -1 && argv[outIndex + 1] ? argv[outIndex + 1] : "ratings.json"
  );

  const source = useLocal ? loadFromLocalSnapshot() : await loadFromFirestore();

  if (!source.players.length) {
    throw new Error("No players found; refusing to write an empty ratings file");
  }
  if (!source.history.length) {
    throw new Error("No history found; refusing to write an empty ratings file");
  }

  const started = Date.now();
  const payload = buildRatings(source);
  const modeNames = Object.keys(payload.modes);

  if (!modeNames.length) {
    throw new Error("No rating datasets were produced");
  }

  // Minified: this is a generated artifact nobody reads as a diff, and the file
  // is served to every visitor. Key order is stable, so an unchanged ladder
  // produces an unchanged file and the workflow commits nothing.
  const json = JSON.stringify(payload);
  fs.writeFileSync(outPath, json + "\n", "utf8");

  console.log(
    `Built ${modeNames.join(", ")} in ${Date.now() - started}ms · ` +
    `${Math.round(json.length / 1024)}KB -> ${path.relative(ROOT, outPath)}`
  );
  console.log(`  fingerprint ${JSON.stringify(payload.fingerprint)}`);
  return 0;
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error("build-ratings failed:", err.message);
    process.exit(1);
  }
);
