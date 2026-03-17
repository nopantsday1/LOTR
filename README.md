# ⚔ War of the Ring — Match Balancer

A community web app for balancing 4v4 matches in the **Lord of the Rings AoE scenario**, featuring 8 unique civilizations across Evil and Good factions.

## Features

- **Auto-balancer** — selects optimal team splits and civ assignments across all 70 possible combinations to minimize Elo gap
- **Civ proficiency system** — each player has a % rating per civilization (relative to their main Elo), which adjusts automatically after each recorded match
- **Real-time sync** — powered by Firebase Firestore, all 30 community members see the same live data
- **Admin panel** — password-protected management of players, ratings, and match history
- **Match history** — full log of every recorded game with team compositions and Elo gap
- **Leaderboard** — community standings sorted by main Elo

## Civilizations

| Side | Civilizations |
|------|--------------|
| ⚔ Evil | Goblin, Dol Guldur, Dol Guldur II, Azog's Host |
| ✦ Good | Elfs, Iron Hills, Northmen, Blue Mountains |

## How It Works

### Elo & Civ Proficiency
- Each player has a **main Elo** (1000–1800 range)
- Each player has a **proficiency %** per civ (40%–100%)
- **Effective Elo** = `mainElo × (civPct / 100)`
- After a match: winners gain **+2%**, losers lose **-1%** on their assigned civ

### Balancing Algorithm
1. All **C(8,4) = 70** possible team splits are evaluated
2. For each split, the best civ assignment is found for each team (all 24 permutations of 4 civs to 4 players)
3. The combination with the **minimum Elo gap** between teams is selected

## Setup

### 1. Firebase
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Create a **Firestore Database** in test mode
3. Register a Web app and copy the config
4. In `index.html`, replace the `FIREBASE_CONFIG` values with your own

### 2. Firestore Rules
In Firebase Console → Firestore → Rules, set:
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

### 3. GitHub Pages
1. Push `index.html` to a public GitHub repository
2. Go to **Settings → Pages → Deploy from branch → main / root**
3. Your site will be live at `https://YOUR-USERNAME.github.io/REPO-NAME/`

## Admin Access

Default password: `admin123`  
**Change this immediately** via Admin Panel → Change Password.

Admins can:
- Add, edit, and delete players
- Record match results
- Adjust Elo and civ proficiency ratings manually
- Export data as JSON backup
- Reset all data

## Tech Stack

- Vanilla HTML/CSS/JavaScript — no build step, no dependencies
- [Firebase Firestore](https://firebase.google.com/docs/firestore) for real-time database
- Hosted on GitHub Pages

## License

MIT — see `LICENSE` file.
