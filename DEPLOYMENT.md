# Deployment Checklist

This modular version uses Firebase project `lotr-9a2f2` by default on both
localhost and deployed hostnames.

Add `?localSandbox=1` to the URL to intentionally use the read-only local
`js/data/lotr-local-data.json` snapshot instead.

The deployed app reads the existing Firestore `players` and `history`
collections. Switching rating modes only changes browser state and does not
write the replayed ratings to Firestore.

## Before merging

1. Commit and push the feature branch.
2. Open the feature deployment and verify Balance, Players, Leaderboard,
   History, Stats, Live, and Profile pages.
3. Merge into `main` only after the feature deployment works.

## Firebase Console checks

These settings cannot be changed from the repository:

1. Open Firebase Console and select project `lotr-9a2f2`.
2. Confirm Firestore contains top-level `players` and `history` collections.
3. Review Firestore Security Rules. The site needs public read access unless
   authentication is ported, but production writes should remain denied.
4. In Project settings, confirm the registered web app config matches
   `js/core/config.js`.
5. If Firebase Authentication is restored later, add the deployed hostname to
   Authentication > Settings > Authorized domains.

## GitHub Pages

The repository now uses relative URLs and includes `.nojekyll`, so it can run
under `https://nopantsday1.github.io/LOTR/`.

In GitHub:

1. Open Settings > Pages.
2. Choose Deploy from a branch.
3. Select `main` and `/ (root)`.
4. Save and wait for the deployment to finish.

The existing scheduled workflows continue updating `lobby.json` and
`matches.json`.

## Cloudflare

`wrangler.jsonc` still serves the repository root as static assets. A connected
Cloudflare Pages/Workers deployment can therefore continue deploying from
GitHub without a build command.

## Known migration limitations

The current modular admin page is intentionally read-only. The following tools
from the original single-file application are not yet ported:

- Firebase Authentication UI
- Add/edit/delete players
- Bulk Elo seeding
- Duplicate removal
- Recalculate all Elo
- Match import
- Full reset

The Stats page also contains a reduced placeholder implementation. These gaps
do not prevent Firebase-backed balancing, history, profiles, or leaderboards
from loading, but they should be ported before replacing the original admin
workflow.
