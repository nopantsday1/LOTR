# 🧙 The Hobbit — Match Balancer

A community web app for balancing 4v4 matches in **The Hobbit AoE2 scenario**,
featuring 8 unique civilizations across Evil and Good factions. Built for a
community of ~30 players.

Live at <https://nopantsday1.github.io/LOTR/>.

## Architecture in one page

There is no application server. Three pieces do all the work:

| Piece | Role |
|---|---|
| **Static site** (GitHub Pages / Cloudflare) | Vanilla ES modules, no build step, no dependencies. Multi-page: each file in `pages/` is a full page load. |
| **Firebase Firestore** | Shared state: the `players`, `history`, `predictionResponses` and `matchOverrides` collections, read live by every visitor. |
| **GitHub Actions** | The server-side half. Scheduled jobs scrape the AoE2 API and commit static JSON (`matches.json`, `lobby.json`), because the browser cannot call that API directly. |

**Ratings are derived, not stored.** Every page load replays the whole match
history from seed values to compute current Elo. There is no stored rating to
drift or corrupt, and the same history always produces the same ladder. This is
the single most important thing to understand before changing anything in
`js/elo/`.

### Admin access

Admin access is **Firebase Authentication**, using a single shared account: one
common password for every admin, as before. The difference is that Firebase
verifies it server-side, so the password never reaches the browser and is not in
this repository.

`ADMIN_EMAIL` in `js/core/config.js` names that account, so the sign-in form
asks for a password only. The password itself is changed in Firebase Console →
Security → Authentication → Users, meaning only people with project access can rotate it or
revoke access. Set `ADMIN_EMAIL = ""` for per-person accounts instead.

The Auth SDK is imported dynamically from `js/data/auth.js` and loads only on
the Admin page, so the other eight pages do not pay for it.

**Signing in gates the UI; Firestore rules gate the data.** Publish
`docs/firestore.rules` to require a signed-in admin for writes — until then,
anyone can still write to the database directly. `DEPLOYMENT.md` has the rollout
order, which matters: publishing the rules before creating an admin account
locks you out.

## Features

- **Auto-balancer** — evaluates all 70 team splits and all 24 civ permutations
  per team to minimise the effective-Elo gap
- **Shuffle mode** — a random split when perfect balance is not the point
- **Civ proficiency** — per-civ strength derived from each player's record,
  feeding an effective Elo per civ
- **Favourite & avoid civs** — nudges the balancer's assignment choice
- **Open-lobby detection** — `lobby.json` lists LOTR/BFME/Hobbit lobbies that
  are *waiting to start*. The Live page highlights any with 2+ community
  members; the Balance page has a **Select from lobby** button that ticks them
  straight into the picker. Both state how old the feed is. By default that is
  the committed file, regenerated every ~5-15 minutes; deploy the optional
  `worker/lobby-proxy.js` and the buttons fetch live instead (see DEPLOYMENT.md)
- **Automatic match import** — new games in `matches.json` are recorded with
  idempotent writes keyed by match ID
- **Rating modes** — "Original" replays from community seeds; "Base" holds main
  Elo fixed. A dormant "1000 Rating" mode is exported for a flat start
- **Match Oracle** — predict past games and compare yourself to the balancer
- **Admin tools** — manual Elo, roster additions, per-match Elo overrides, data
  export (see below)
- **Match history, leaderboard, per-player profiles and stats**

## Which games count

A game must clear two independent bars.

**1. Import gates** (`js/core/matchRules.js`) — a feed match is imported only if:

- the lobby name contains `LOTR`, `BFME`, `HOBBIT` or `BOBBIT` (case-insensitive).
  `BOBBIT` is a community misspelling that names real games.
- it has 8+ players, 4+ of whom are known community members
- it ran for at least 10 minutes
- the feed reported a winner and resolvable teams

**2. Rating eligibility** — an imported match still won't count if an admin has
excluded it.

Both are overridable from the admin panel, with one honest limitation: a game
the feed reported **no winner or no teams** for cannot be included, because
there is nothing to record.

The keyword filter runs in the browser, not in `scrape_matches.py`. That is
deliberate: keeping rejected games in `matches.json` is what makes it possible
to re-include one the keyword rule got wrong. The keyword list lives in
`js/core/matchRules.js` and is duplicated in `scripts/filter_lobby.py` — change
both together.

## Admin panel

Sign in with your Firebase admin account (see **Admin access** above).

1. **Add a player** — **Find players from recent games** lists everyone who has
   played a LOTR game but is not on the roster, most frequent first, with their
   profile ID, appearance count, last-seen date and a lobby they played in. One
   click fills the form, so a profile ID never has to be hunted down on
   [aoe2companion.com](https://aoe2companion.com). Rejects duplicate names and
   profile IDs. A player without a profile ID will not have their games
   auto-imported.
2. **Change a player's Elo** — gated behind three steps (open the editor, enter
   a value, confirm), because an override changes the ladder and team balancing
   for everyone. You type the Elo the player should **have**; since ratings are
   derived from match history, the difference is stored as a correction and
   future results move on from there. Reversible with *Remove existing
   override*.
3. **Exclude games from Elo** — drops a recorded game from the rating replay.
   It stays in Firestore and stays listed on History, flagged. Reversible.
   **Players** on each row expands the teams, civs and Elo deltas. Rendered on
   demand: 40 rows of rosters is a lot of DOM, and the deltas need a full
   rating replay.
4. **Re-include discarded games** — lists what the importer skipped and why, and
   lets you override the soft gates. **Players** here shows the lobby roster
   with each name tagged community or guest, which is what you want before
   deciding to include a game.
5. **Export all data** — JSON backup of players, history and overrides.

## Civilizations

Listed in player position order (P1–P8):

| Position | Civilization | Side |
|----------|-------------|------|
| P1 | Dol Guldur | ⚔ Evil |
| P2 | Dol Guldur | ⚔ Evil |
| P3 | Azog's Host | ⚔ Evil |
| P4 | Goblin | ⚔ Evil |
| P5 | Blue Mountains | ✦ Good |
| P6 | Northmen | ✦ Good |
| P7 | Elves | ✦ Good |
| P8 | Iron Hills | ✦ Good |

## Layout

```
index.html            redirect to pages/balance.html
pages/                one HTML file per page
js/core/              config, constants, shared state, match rules, input parsing
js/data/              Firebase init, subscriptions, writes, overrides, local data
js/elo/               rating model, replay, backtest  ← the careful part
js/balancer/          team splits and civ assignment
js/services/          match import, admin writes, export, AoE2 helpers
js/pages/             one module per page
tests/                rating-sanity.mjs, lobby_filter_test.py
scripts/filter_lobby.py   reduces the lobby API payload to LOTR lobbies
worker/lobby-proxy.js     optional Cloudflare Worker for live lobby lookup
scrape_matches.py     builds matches.json (run by Actions)
```

## Development

No build step and no install. Serve the repo root over HTTP — ES modules are
blocked by CORS on `file://`, so opening the HTML directly will not work.

From the repository root:

```bash
py -m http.server 8000
```

On macOS and Linux use `python3 -m http.server 8000`. On Windows `python3` is
usually the Microsoft Store stub, which prints an install message and exits —
use `py` (or `python`) instead. Any static server works; `npx serve` is fine too.

Note that `http.server` sends no cache headers, so the browser will happily run
stale ES modules after an edit. Hard-reload (Ctrl+Shift+R) after changing JS, or
serve with a no-store server if you are iterating.

Then open <http://localhost:8000/>. `index.html` redirects to
`pages/balance.html`.

> **This connects to the live Firebase project by default**, so local edits can
> write to real community data. Append `?localSandbox=1` to any page URL to work
> against the committed read-only snapshot in `js/data/lotr-local-data.json`
> instead — every write is blocked and logged:
>
> <http://localhost:8000/pages/balance.html?localSandbox=1>

## Precomputed ratings (and the read quota)

Ratings are derived by replaying every match, which is identical work for every
visitor. `scripts/build-ratings.mjs` does it once in CI and commits
`ratings.json`; `.github/workflows/build-ratings.yml` runs it every 3 hours.

The script imports the real modules from `js/elo/`. That is deliberate: a second
implementation of the Elo model would drift out of sync and corrupt the ladder.

**This is a quota decision as much as a speed one.** The free Firestore tier
allows 50,000 document reads a day. A full page load used to read ~1,275 of them
(966 history + 89 players + 220 predictions), so roughly 39 page loads a day
across the whole community exhausted the quota and the site stopped loading.

Pages are now split by what they actually need:

| Pages | Reads | Ratings from |
|---|---|---|
| Balance, Players, Live | 89 player docs | `ratings.json` |
| History, Stats, Profile, Predictions, Admin | ~1,275 docs | live replay |

`ratings.json` carries a fingerprint of the data it was built from
(`js/core/ratingsFingerprint.js`). On the history pages the client compares it
against live Firestore data and only adopts the precomputed datasets when they
match exactly; any difference falls back to replaying. A stale, missing or
model-mismatched file therefore costs nothing but the work that would have
happened anyway -- it can never show wrong ratings.

After changing anything in `js/elo/`, bump `RATING_MODEL_VERSION` so existing
`ratings.json` files are rejected, and rerun the workflow.

If ratings look stale, run **Build Ratings** manually from the Actions tab.

## Performance notes

This is a multi-page app, so every tab click is a full page load that refetches
data and recomputes ratings. Four things keep that affordable:

- **Chunked lists** (`js/ui/lazyList.js`) render a screenful at a time. All ~966
  match cards at once cost ~60,000 DOM nodes and ~4.2s of layout; a chunk is
  ~1,300 nodes and effectively free.
- **Page modules load dynamically** in `app.js`. Importing all eight statically
  made every page download and parse the others (~2s of module loading).
- **Rating datasets are built on demand.** Each is a full replay of every match;
  only `original` is eager, because the rest of the app reads it as the player
  identity source.
- **Firestore uses a persistent IndexedDB cache**, so a repeat page load serves
  documents locally instead of waiting on the network.

`rebuildInactivityState` indexes each match’s player keys once rather than
rescanning assignments per player-match pair. That loop runs players × matches
(~86,000 iterations) and was the single most expensive step in the replay.

Two rules when touching these pages:

- Use event delegation on the list container. Rows appended later will not have
  listeners bound at render time.
- Keep the Elo replay out of the search path. It walks the whole history and
  costs ~0.8s, so it is computed per dataset, not per keystroke.

## Tests

```bash
node tests/rating-sanity.mjs
python3 tests/lobby_filter_test.py
```

Both run in CI on every push and pull request (`.github/workflows/test.yml`).
They import only modules with no Firebase dependency, so they need no
credentials. If you change anything in `js/elo/`, run them — the rating replay
has no other safety net.

## Scheduled jobs

| Workflow | Schedule | Output |
|---|---|---|
| `fetch-matches.yml` | every 3h | `matches.json` |
| `fetch-lobby.yml` | every 5 min | `lobby.json` |
| `rebuild.yml` | manual | rebuilds `matches.json` from scratch |
| `test.yml` | push / PR | runs the test suites |

GitHub's scheduled runs are best-effort and get dropped under load, so treat
these intervals as upper bounds rather than guarantees.

`fetch-lobby.yml` filters to LOTR lobbies and writes no timestamp, so its output
is byte-identical between runs when nothing relevant is happening — quiet
periods produce no commit at all.

## Tech Stack

- Vanilla HTML/CSS/JavaScript ES modules — no build step, no dependencies
- [Firebase Firestore](https://firebase.google.com/docs/firestore) for shared state
- [Worlds Edge AoE2 API](https://aoe-api.worldsedgelink.com) via GitHub Actions
  (it sends no CORS headers, so the browser cannot call it directly)
- Hosted on GitHub Pages; `wrangler.jsonc` also allows a Cloudflare deployment

## License

MIT — see `LICENSE`.
