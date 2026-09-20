#!/usr/bin/env python3
"""Checks for scripts/filter_lobby.py.

The lobby filter's output is committed by a scheduled workflow, so two things
matter beyond "it picks the right lobbies": the output must be deterministic
(otherwise every run produces a commit) and it must contain no volatile field
such as a timestamp.

Run with:  python3 tests/lobby_filter_test.py
"""

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "filter_lobby.py")

FIXTURE = {
    "matches": [
        {
            "id": 2,
            "description": "bfme hobbit",
            "mapname": "my map",
            "maxplayers": 8,
            # Deliberately out of order, to prove members get sorted.
            "matchmembers": [{"profile_id": 20}, {"profile_id": 10}],
        },
        {
            "id": 1,
            "description": "HOBBIT LOTR",
            "mapname": "my map",
            "maxplayers": 8,
            "matchmembers": [{"profile_id": 30}],
        },
        {
            "id": 3,
            "description": "DIPLOMACY",
            "mapname": "my map",
            "maxplayers": 8,
            "matchmembers": [{"profile_id": 40}],
        },
    ],
    "avatars": [
        {"profile_id": 40, "alias": "excluded"},
        {"profile_id": 10, "alias": "alpha"},
        {"profile_id": 30, "alias": "gamma"},
        {"profile_id": 20, "alias": "beta"},
    ],
}


def run_filter(source, destination):
    subprocess.run(
        [sys.executable, SCRIPT, source, destination],
        check=True,
        capture_output=True,
    )
    with open(destination, encoding="utf-8") as handle:
        return handle.read()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "raw.json")
        with open(source, "w", encoding="utf-8") as handle:
            json.dump(FIXTURE, handle)

        first = run_filter(source, os.path.join(tmp, "a.json"))
        second = run_filter(source, os.path.join(tmp, "b.json"))

        # Determinism: identical input must produce byte-identical output, or the
        # workflow commits on every run.
        assert first == second, "filter output is not deterministic"

        payload = json.loads(first)

        ids = [m["id"] for m in payload["matches"]]
        assert ids == [1, 2], f"expected LOTR lobbies sorted by id, got {ids}"

        names = [m["description"] for m in payload["matches"]]
        assert all("DIPLOMACY" not in name for name in names), names

        members = payload["matches"][1]["matchmembers"]
        assert members == [{"profile_id": 10}, {"profile_id": 20}], members

        # Avatars must be pruned to only the players in the kept lobbies.
        avatar_ids = [a["profile_id"] for a in payload["avatars"]]
        assert avatar_ids == [10, 20, 30], avatar_ids
        assert 40 not in avatar_ids, "avatars must be pruned to kept lobbies"

        # No volatile fields, or the file churns.
        assert "updated" not in payload, "no volatile fields may be committed"

        # An unexpected payload shape must leave the destination untouched
        # rather than writing a broken file.
        bad = os.path.join(tmp, "bad.json")
        with open(bad, "w", encoding="utf-8") as handle:
            json.dump({"unexpected": True}, handle)
        untouched = os.path.join(tmp, "untouched.json")
        with open(untouched, "w", encoding="utf-8") as handle:
            handle.write("SENTINEL")
        subprocess.run(
            [sys.executable, SCRIPT, bad, untouched], check=True, capture_output=True
        )
        with open(untouched, encoding="utf-8") as handle:
            assert handle.read() == "SENTINEL", "bad input must not overwrite output"

        # An empty relevant set is still valid output.
        empty_src = os.path.join(tmp, "empty.json")
        with open(empty_src, "w", encoding="utf-8") as handle:
            json.dump({"matches": FIXTURE["matches"][2:], "avatars": []}, handle)
        empty = json.loads(run_filter(empty_src, os.path.join(tmp, "e.json")))
        assert empty == {"matches": [], "avatars": []}, empty

    print("lobby filter checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
