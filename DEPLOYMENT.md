# Deployment Checklist

This app uses Firebase project `lotr-9a2f2` on both localhost and deployed
hostnames. Add `?localSandbox=1` to any URL to use the read-only local snapshot
in `js/data/lotr-local-data.json` instead; all writes are blocked and logged.

## Before merging

1. Commit and push the feature branch.
2. Confirm the `Tests` workflow is green (rating + lobby-filter checks).
3. Open the feature deployment and verify Balance, Players, Leaderboard,
   History, Stats, Live, Profile and Admin.
4. Merge into `main` only after the feature deployment works.

## Admin access and Firestore security rules

Admin access is **Firebase Authentication**. There is no password anywhere in
this repository. Accounts live in Firebase Console → Security → Authentication → Users, so
only people with access to the project can create an admin, reset a password, or
revoke access.

The password is verified by Google and never reaches the browser. That is what
makes this different from the old check, which compared typed input against a
constant that shipped to every visitor and so could only ever gate the UI.

### One shared password

You do not need an account per admin. Create **one** account and share its
password, exactly like the old gate — the difference is that Firebase verifies
it server-side instead of the browser comparing it against a constant every
visitor can read.

`ADMIN_EMAIL` in `js/core/config.js` holds that account's address. When it is
set, the sign-in form asks for a password only; the address is filled in behind
the scenes. It is a username, not a secret: knowing it gains an attacker
nothing, because the password never reaches the browser and Firebase rate-limits
repeated failures.

The address does not have to be a real mailbox. If it is not, change the
password in Firebase Console → Security → Authentication → Users → ⋮ → Reset password,
which is where a shared password belongs anyway. The "email me a reset link"
button is hidden while a shared account is configured.

To move to per-person accounts later, set `ADMIN_EMAIL = ""` and the email field
reappears. Nothing else changes.

**Trade-offs of a shared password**, so they are a decision and not a surprise:

- No record of which admin made a change.
- Rotating it means telling everyone the new one.
- Someone leaving the group means rotating it.

For a ~30-player game night that is usually the right call. It is still a large
improvement on the old gate, which protected nothing at all.

### Rollout order (do not skip)

Publishing the rules before an admin account exists will lock you out of the
admin tools.

1. Deploy this code.
2. Firebase Console → **Security** → **Authentication**. If you have never used
   Authentication in this project, click **Get started** first; the tabs below
   only appear afterwards. (The console moved Authentication under **Security**;
   older guides show it as a top-level item.)
3. **Sign-in method** tab → enable **Email/Password** → Save.
4. **Users** tab → **Add user**. Use the address from `ADMIN_EMAIL` in
   `js/core/config.js` and pick the shared password. This one account is all you
   need — see **One shared password** above.
5. If sign-in reports that the origin is blocked, the API key carries HTTP
   referrer restrictions. Google Cloud Console → APIs & Services → Credentials →
   that key → Website restrictions → add your site.
6. Sign in at `/pages/admin.html` and confirm the tools appear.
7. **Only then** publish `docs/firestore.rules`.

### What the rules do

`docs/firestore.rules` holds the full ruleset, ready to paste.

| Collection | Read | Write |
|---|---|---|
| `players` | public | signed-in admin only |
| `matchOverrides` | public | signed-in admin only, shape-validated |
| `history` | public | anyone may **create**; only an admin may edit or delete |
| `predictionResponses` | public | anyone may create, nobody may edit |

`history` stays creatable by anyone because match import runs in every visitor's
browser with no sign-in. It is idempotent and keyed by the AoE2 match id, so the
worst an anonymous client can do is add a match — it can no longer edit or wipe
the ladder. A wrong match does not need deleting: exclude it from Elo in the
admin panel, which is reversible.

Reads stay public because `scrape_matches.py` and `scripts/build-ratings.mjs`
both read unauthenticated from CI.

Firebase test-mode rules expire about 30 days after creation. If writes start
failing on a roughly monthly cadence, check that first.

### What this does and does not fix

Signing in gates the **UI**. The **rules** gate the data. Until step 7 above is
done, anyone can still write these collections directly without signing in — the
sign-in form changes nothing on its own.

## Firebase Console checks

These cannot be set from the repository:

1. Select project `lotr-9a2f2`.
2. Confirm Firestore contains `players` and `history`. The optional
   `predictionResponses` and `matchOverrides` collections are created on first
   write; if the rules deny them, the app logs a warning and degrades rather
   than breaking.
3. Review the security rules as described above.
4. In Project settings, confirm the web app config matches `js/core/config.js`.

### Authorized domains — not needed here

Security → Authentication → **Settings** → Authorized domains governs OAuth
redirect sign-in and **email action links** (password-reset and email-link
sign-in). Plain email/password sign-in does not consult it, which is why this
setup works without touching it.

You only need it if you later enable Google sign-in, or want the
"email me a reset link" button to work — that button is hidden while a shared
account is configured, because a shared password is rotated in the Console.

If you do add domains, note that projects created after 28 April 2025 no longer
include `localhost` by default; add it manually for local work.

## Firestore indexes

`predictionResponses` is queried with `orderBy("createdAt", "desc")` and a limit.
Single-field ordering needs no composite index, but note that Firestore **omits
documents missing the ordered field** — any prediction written before
`createdAt` existed will not appear in the community accuracy figure.

## Live lobby lookup (optional)

By default the Live and Balance pages read the committed `lobby.json`, which
`fetch-lobby.yml` regenerates every ~5 minutes (GitHub drops scheduled runs, so
5-15 is normal). Clicking "check now" re-reads that file; it does not reach the
game API.

To make those buttons fetch what is open **right now**, deploy
`worker/lobby-proxy.js`.

### Why a Worker, and not a public CORS proxy

The browser cannot call the Worlds Edge API directly: it sends no
`Access-Control-Allow-Origin` header. Something server-side has to relay it.

The free public proxies no longer work, as of September 2026:

- `corsproxy.io` returns `{"error":"A valid API key is required"}` — it now
  needs a paid account.
- `api.allorigins.win` is down; it returns HTTP 520 even for `example.com`.
- `api.codetabs.com` returns HTTP 522 for this endpoint.

A Cloudflare Worker is the smallest thing that actually works, and it is free.

### Deploy

```bash
cd worker
npx wrangler deploy
```

Wrangler prints a URL like `https://lotr-lobby-proxy.<you>.workers.dev`. Put it
in `LIVE_LOBBY_PROXY` in `js/core/config.js`, commit, done. The site itself
stays on GitHub Pages — only this one API call goes through Cloudflare.

### Behaviour

- `LIVE_LOBBY_PROXY` empty → the committed file is used, exactly as before.
- Proxy set and reachable → live data, and the UI says `live`.
- Proxy set but unreachable, erroring, or slow (8s timeout) → falls back to the
  committed file and says how old it is. A failed proxy never breaks the page.

The Worker caches for 20 seconds, so mashing the button does not hammer the
game API. It hardcodes the upstream URL and accepts no caller-supplied URL, so
it cannot be abused as an open relay.

`KEYWORDS` in the Worker must stay in sync with `LOBBY_KEYWORDS` in
`js/core/matchRules.js`.

## Firestore read quota

The free Spark tier allows **50,000 document reads a day**. Before the
precomputed-ratings work a single page load cost ~1,275 reads (966 history + 89
players + 220 predictions), so about 39 page loads a day across the community
exhausted it -- after which Firestore returns HTTP 429 `RESOURCE_EXHAUSTED` and
the site simply stops loading data.

Balance, Players and Live now read only the 89 player documents and take ratings
from `ratings.json`. History, Stats, Profile, Predictions and Admin still read
the full history because they display individual matches.

Check usage in Firebase Console -> Firestore -> Usage. If you are close to the
limit, the next lever is moving Stats and Profile onto precomputed data too.

### If the site shows no data

Open the browser console. `RESOURCE_EXHAUSTED` or HTTP 429 means the daily read
quota is gone; it resets at midnight Pacific. Nothing is broken and no data is
lost.

## Build Ratings workflow

`build-ratings.yml` runs every 3 hours, reads players and history from Firestore
over the REST API, replays them with the real `js/elo/` modules, and commits
`ratings.json` when the ladder changed.

It reads `matchOverrides` too, but treats that collection as optional: until its
security rule is added the read is denied and the build continues with every
match counting, which is the pre-override behaviour.

Run it manually from the Actions tab after an admin Elo change, otherwise the
ladder on Balance and Players can lag by up to 3 hours.

## GitHub Pages

The repository uses relative URLs and includes `.nojekyll`, so it runs under
`https://nopantsday1.github.io/LOTR/`.

1. Settings → Pages.
2. Deploy from a branch.
3. Select `main` and `/ (root)`.
4. Save and wait for the deployment.

## Cloudflare

`wrangler.jsonc` serves the repository root as static assets, so a connected
Cloudflare Pages/Workers deployment keeps working from GitHub with no build
command.

## Scheduled workflows

| Workflow | Schedule | Output |
|---|---|---|
| `fetch-matches.yml` | every 3h | `matches.json` |
| `fetch-lobby.yml` | every 5 min | `lobby.json` |
| `rebuild.yml` | manual only | rebuilds `matches.json` |
| `test.yml` | push / PR | test suites |

GitHub drops scheduled runs under load, so observed intervals are longer than
configured. `*/5` is the documented floor; anything shorter is silently clamped.

`fetch-lobby.yml` writes no timestamp and filters to LOTR lobbies, so quiet
periods produce no diff and therefore no commit.

### If live detection stops working

`lobby.json` sat empty from March to September 2026 because the workflow
requested `count=200` from an endpoint capped at 100, got HTTP 400, and fell
through to writing an empty placeholder. If it breaks again, run the workflow
manually and read the `curl` step's output before anything else.

## Porting status

The modular admin panel now supports manual Elo, adding players, per-match Elo
overrides and data export. Still not ported from the original single-file app:

- Firebase Authentication UI
- Editing and deleting existing players
- Bulk Elo seeding and duplicate removal
- Manual match entry, editing and deletion
- Full reset

None of these block Firebase-backed balancing, history, profiles or
leaderboards.
