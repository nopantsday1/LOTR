# LOTR modularized scaffold

This is a first-pass modular target for the current single-file `index.html`.

It does **not** attempt to perfectly rewrite every function from the original file.
Use it as the new file layout, then move code from the old `index.html` into the matching modules.

Important local-development idea:
- `js/core/config.js` has `LOCAL_SANDBOX`.
- `js/data/firestore.js` blocks writes on localhost by default.
- Elo logic belongs in `js/elo/elo.js`.

Run locally:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/
```

## Migration order

1. Move all CSS from old `<style>` into:
   - `css/base.css`
   - `css/layout.css`
   - `css/components.css`
   - `css/pages.css`

2. Move constants and Firebase config:
   - `js/core/config.js`
   - `js/core/constants.js`
   - `js/data/firebase.js`

3. Move global state:
   - `js/core/state.js`

4. Move pure Elo/math logic:
   - `js/elo/elo.js`

5. Move team balancing:
   - `js/balancer/assignments.js`
   - `js/balancer/splitTeams.js`

6. Move Firestore read/write logic:
   - `js/data/firestore.js`

7. Move page renderers:
   - `js/pages/balancePage.js`
   - `js/pages/historyPage.js`
   - `js/pages/playersPage.js`
   - `js/pages/leaderboardPage.js`
   - `js/pages/statsPage.js`
   - `js/pages/adminPage.js`
   - `js/pages/livePage.js`
   - `js/pages/profilePage.js`

8. Replace inline `onclick="..."` with `addEventListener(...)` inside each page module.
