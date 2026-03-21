import urllib.request, json, time, os

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids={pids}"
HEADERS = {"User-Agent": "HobbitBalancer/1.0"}

# ── Load players from Firestore ───────────────────────────────────────────────
print("Loading players from Firestore...")
req = urllib.request.Request(FIREBASE_URL, headers=HEADERS)
with urllib.request.urlopen(req, timeout=10) as r:
    docs = json.loads(r.read()).get("documents", [])

players = []
for doc in docs:
    f = doc.get("fields", {})
    pid = (f.get("profileId", {}).get("integerValue") or
           f.get("profileId", {}).get("stringValue"))
    name = f.get("name", {}).get("stringValue", "Unknown")
    if pid:
        players.append({"name": name, "profileId": int(pid)})

print(f"Found {len(players)} players with profile IDs")
community_ids = {str(p["profileId"]) for p in players}
all_pids      = [p["profileId"] for p in players]

# ── Load existing matches.json ────────────────────────────────────────────────
FORCE_RESCAN = os.environ.get("FORCE_RESCAN", "0") == "1"
match_map = {}
if os.path.exists("matches.json") and not FORCE_RESCAN:
    try:
        with open("matches.json") as f:
            old = json.load(f)
        for m in old.get("matches", []):
            match_map[str(m["match_id"])] = m
        print(f"Loaded {len(match_map)} existing cached matches")
    except Exception as e:
        print(f"Could not read existing matches.json: {e}")
else:
    if FORCE_RESCAN:
        print("FORCE_RESCAN=1: ignoring cache")

# ── Helper: fetch match history ───────────────────────────────────────────────
def fetch_page(pid_list):
    url = HISTORY_URL.format(pids=json.dumps(pid_list))
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("matchHistoryStats", [])

# ── Helper: process and store matches ─────────────────────────────────────────
def process(page, label=""):
    added = skipped_type = skipped_players = already_known = 0
    for m in page:
        mid = str(m.get("id") or m.get("match_id"))
        mtype = m.get("matchtype_id", -1)
        maxp  = m.get("maxplayers", 0)
        ts    = m.get("completiontime") or m.get("startgametime") or 0
        desc  = m.get("description", "")

        # Debug: show every match we see
        from datetime import datetime
        date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "unknown"
        print(f"    [{date}] id={mid} type={mtype} maxp={maxp} desc={desc!r}")

        if mtype != 0 or maxp != 8:
            skipped_type += 1
            print(f"      → SKIP (not custom 8-player)")
            continue

        # matchhistoryreportresults.race_id = scenario-forced civ → determines station
        # matchhistorymember.civilization_id = player's personal civ → irrelevant
        raw_results = m.get("matchhistoryreportresults") or []
        raw_members = m.get("matchhistorymember") or []
        results_by_pid = {str(r.get("profile_id","")): r for r in raw_results}
        members_by_pid = {str(r.get("profile_id","")): r for r in raw_members}
        all_pids_in_match = set(results_by_pid) | set(members_by_pid)
        members = []
        for pid in all_pids_in_match:
            rr = results_by_pid.get(pid, {})
            rm = members_by_pid.get(pid, {})
            members.append({
                "profile_id": pid,
                "teamid":     rr.get("teamid", rm.get("teamid", -1)),
                "resulttype": rr.get("resulttype", rm.get("resulttype", 0)),
                "race_id":    rr.get("race_id", -1),
            })

        comm_count = sum(1 for x in members if x["profile_id"] in community_ids)
        print(f"      → custom 8p, {len(members)} members, {comm_count} community")

        if mid not in match_map:
            match_map[mid] = {
                "match_id": mid, "completiontime": ts,
                "startgametime": m.get("startgametime", ts),
                "mapname": m.get("mapname",""), "description": desc,
                "matchhistorymember": members,
            }
            added += 1
            print(f"      → ADDED")
        else:
            already_known += 1
            existing = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
            merged = 0
            for mem in members:
                if mem["profile_id"] not in existing:
                    match_map[mid]["matchhistorymember"].append(mem)
                    existing.add(mem["profile_id"])
                    merged += 1
            print(f"      → already known (merged {merged} new members)")

    print(f"  {label}: {added} added, {already_known} already known, {skipped_type} skipped")
    return added

# ── Step 1: Bulk query ────────────────────────────────────────────────────────
print(f"\nStep 1: Bulk query — {len(all_pids)} profile IDs...")
try:
    page = fetch_page(all_pids)
    print(f"  API returned {len(page)} matches:")
    process(page, "Bulk")
except Exception as e:
    print(f"  FAILED: {e}")
time.sleep(1)

# ── Step 2: Individual queries ────────────────────────────────────────────────
print(f"\nStep 2: Individual queries...")
for player in players:
    pid, name = player["profileId"], player["name"]
    print(f"\n  {name} ({pid}):")
    try:
        page = fetch_page([pid])
        print(f"  API returned {len(page)} matches:")
        process(page, name)
    except Exception as e:
        print(f"  FAILED: {e}")
    time.sleep(0.5)

# ── Name lookup ───────────────────────────────────────────────────────────────
unknown_pids = {
    str(mem["profile_id"])
    for m in match_map.values()
    for mem in m["matchhistorymember"]
    if str(mem["profile_id"]) not in community_ids
}
community_names = {str(p["profileId"]): p["name"] for p in players}
unknown_names = {}
if unknown_pids:
    print(f"\nLooking up {len(unknown_pids)} unknown player names...")
    for i in range(0, len(list(unknown_pids)), 20):
        batch = list(unknown_pids)[i:i+20]
        try:
            url = (f"https://aoe-api.worldsedgelink.com/community/leaderboard/"
                   f"getLeaderboardProfiles?title=age2&profile_ids={json.dumps([int(p) for p in batch])}")
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            for profile in (data.get("result",{}).get("profiles") or data.get("profiles") or []):
                p_id = str(profile.get("profile_id",""))
                unknown_names[p_id] = profile.get("alias") or profile.get("name") or f"Player {p_id}"
            time.sleep(0.5)
        except Exception as e:
            print(f"  Name lookup failed: {e}")

all_names = {**community_names, **unknown_names}
for m in match_map.values():
    for mem in m["matchhistorymember"]:
        pid = str(mem["profile_id"])
        mem["name"]         = all_names.get(pid, f"Player {pid}")
        mem["is_community"] = pid in community_ids

# ── Filter and save ───────────────────────────────────────────────────────────
filtered = {
    mid: m for mid, m in match_map.items()
    if sum(1 for x in m["matchhistorymember"] if x.get("is_community")) >= 4
}

print(f"\n{'='*50}")
print(f"RESULT: {len(filtered)} matches with 4+ community players")
for mid, m in sorted(filtered.items(), key=lambda x: x[1].get("completiontime",0), reverse=True)[:10]:
    ts   = m.get("completiontime", 0)
    from datetime import datetime
    date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "?"
    comm = sum(1 for x in m["matchhistorymember"] if x.get("is_community"))
    print(f"  {date} | {mid} | {comm}/8 community | {m.get('description','')!r}")

with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)
print(f"\n✓ Saved {len(filtered)} matches to matches.json")
