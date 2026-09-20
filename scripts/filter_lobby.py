#!/usr/bin/env python3
"""Reduce a Worlds Edge findAdvertisements payload to the LOTR lobbies.

Reads the raw API response and writes a small, deterministic lobby.json holding
only the lobbies whose name matches one of KEYWORDS, plus the aliases of the
players in them.

Determinism matters: this file is committed by a scheduled workflow, so any
field that changes between runs (a timestamp, an unrelated lobby count) would
produce a commit every few minutes. Everything here is sorted and nothing
volatile is included, so quiet periods produce no diff and therefore no commit.

Usage:  filter_lobby.py <raw-input.json> <output.json>
Exit 0 with the output untouched if the payload is not the expected shape.

KEYWORDS must stay in sync with LOBBY_KEYWORDS in js/core/matchRules.js.
"""

import json
import sys

KEYWORDS = ("lotr", "bfme", "hobbit", "bobbit")


def is_relevant(match):
    name = str(match.get("description") or "").lower()
    return any(keyword in name for keyword in KEYWORDS)


def slim_match(match, wanted_profiles):
    members = []
    for member in match.get("matchmembers") or []:
        pid = member.get("profile_id")
        if pid is None:
            continue
        wanted_profiles.add(int(pid))
        members.append({"profile_id": int(pid)})

    return {
        "id": match.get("id"),
        "description": match.get("description") or "",
        "mapname": match.get("mapname") or "",
        "maxplayers": match.get("maxplayers"),
        "matchmembers": sorted(members, key=lambda m: m["profile_id"]),
    }


def build_payload(raw):
    matches = raw.get("matches")
    if not isinstance(matches, list):
        return None

    wanted_profiles = set()
    slim = [slim_match(m, wanted_profiles) for m in matches if is_relevant(m)]
    slim.sort(key=lambda m: (m["id"] is None, m["id"] or 0))

    avatars = sorted(
        (
            {
                "profile_id": int(avatar["profile_id"]),
                "alias": avatar.get("alias") or "",
            }
            for avatar in (raw.get("avatars") or [])
            if avatar.get("profile_id") is not None
            and int(avatar["profile_id"]) in wanted_profiles
        ),
        key=lambda a: a["profile_id"],
    )

    return {"matches": slim, "avatars": avatars}


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2

    source, destination = argv[1], argv[2]

    with open(source, encoding="utf-8") as handle:
        raw = json.load(handle)

    total = len(raw.get("matches") or [])
    payload = build_payload(raw)
    if payload is None:
        print("::warning::Unexpected API shape; leaving the output untouched.")
        return 0

    with open(destination, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, sort_keys=True)
        handle.write("\n")

    print(f"OK: {len(payload['matches'])} relevant of {total} lobbies")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
