# 🧙 The Hobbit — Match Balancer

A community web app for balancing 4v4 matches in **The Hobbit AoE scenario**, featuring 8 unique civilizations across Evil and Good factions. Built for a community of ~30 players.

## Features

- **Auto-balancer** — evaluates all 70 possible team splits and all 24 civ permutations per team to find the combination with the minimum Elo gap
- **Shuffle mode** — generates a random team split for variety when perfect balance isn't the priority
- **Player swap** — move players between teams after generating, with live Elo recalculation
- **Civ proficiency system** — each player has a % rating per civ (relative to their main Elo), auto-adjusted after every recorded match (+2% win, −1% loss)
- **Favourite & avoid civs** — players can mark preferred and avoided civs; the balancer factors these in during assignment
- **Live match detection** — polls the AoE2 API every 30 seconds to detect when community members are in a lobby together and auto-activates a live dashboard
- **Auto result recording** — when a match ends, the API result is fetched automatically and the match is recorded without manual input
- **Conflict resolution** — if a manual result was already recorded and the API reports a different winner, an admin prompt appears to correct the discrepancy and reverse any wrong rating changes
- **Real-time sync** — powered by Firebase Firestore; all community members see the same data live
- **Match history** — full log of every game with team compositions, Elo gap, and source (auto/live/manual); supports edit and delete
- **Admin panel** — password-protected; manages players, ratings, history, and data exports
- **Leaderboard** — community standings sorted by main Elo with W/L records

## Civilizations

Civs are listed in player position order (P1–P8):

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

## How It Works

### Elo & Civ Proficiency
- Each player has a **main Elo** (1000–1800 scale)
- Each player has a **proficiency %** per civ (40%–100%), set manually by an admin and adjusted over time by match results
- **Effective Elo** = `mainElo × (civPct / 100)`
- After a match: winners get **+2%** on their assigned civ, losers get **−1%**, clamped to [40%, 100%]

### Favourite & Avoid
- Marking a civ as **favourite** adds a +15% bonus to effective Elo during balancing, making that civ more likely to be assigned
- Marking a civ as **avoid** applies a −40% penalty, making the balancer strongly skip that assignment

### Balancing Algorithm
1. All **C(8,4) = 70** possible team splits are evaluated
2. For each split, the best civ assignment is found for each team (all 24 permutations of 4 civs to 4 players), including fav/avoid bonuses
3. The combination with the **minimum Elo gap** between teams is selected
4. **Shuffle** picks a random split instead, for unpredictable games

### Live Match Detection
1. Each player stores their AoE2 **profile ID** (find it at [aoe2companion.com](https://aoe2companion.com) by searching their username)
2. The site polls the Worlds Edge lobby API every 30 seconds
3. When 4+ community members are detected in the same lobby, the live dashboard activates automatically
4. Civ selections can be confirmed manually via dropdowns on the dashboard
5. When the match ends, the API is polled for the result — if found, it is recorded automatically
6. If a manual result was already entered and the API disagrees, a conflict modal prompts the admin to choose the correct winner; the wrong entry is deleted and ratings are reversed

## Setup

### 1. Firebase
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Create a **Firestore Database** — choose **Start in test mode**
3. Register a Web app and copy the config object
4. In `index.html`, find the `FIREBASE_CONFIG` block and replace the placeholder values with your own

### 2. Firestore Rules
In Firebase Console → Firestore Database → Rules, paste:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
Click **Publish**. Note: Firebase test mode rules expire after 30 days — set a reminder to re-publish before expiry.

### 3. GitHub Pages
1. Rename `lotr-balance.html` to `index.html`
2. Push `index.html`, `README.md`, `LICENSE`, and `.gitignore` to a public GitHub repository
3. Go to **Settings → Pages → Deploy from branch → main / (root)**
4. Your site will be live at `https://YOUR-USERNAME.github.io/REPO-NAME/`

## Admin Access

Default password: `admin123`
**Change this immediately** via Admin Panel → Change Password.

Admins can:
- Add, edit, and delete players (including AoE2 profile IDs for live detection)
- Manually record, edit, or delete match results
- Add historical matches manually
- Adjust Elo and civ proficiency ratings directly
- Resolve result conflicts between manual entries and API data
- Export all data as a JSON backup
- Reset all data to defaults

Any write action requires the admin password. Read access (balancer, history, leaderboard) is open to everyone.

## Tech Stack

- Vanilla HTML/CSS/JavaScript — single file, no build step, no dependencies
- [Firebase Firestore](https://firebase.google.com/docs/firestore) for real-time shared database
- [Worlds Edge AoE2 API](https://aoe-api.worldsedgelink.com) for live lobby and match result detection
- [corsproxy.io](https://corsproxy.io) as a CORS proxy for browser-to-API calls
- Hosted on GitHub Pages

## License

MIT — see `LICENSE` file.
