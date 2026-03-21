import urllib.request, json, time, os

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids=[{pid}]&start_index={start}"
THREE_MONTHS = int(time.time()) - 90*24*60*60

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

# ── DIAGNOSTIC: dump first 20 matches for first player to see real mapnames ──
print("\n=== DIAGNOSTIC: first 20 matches for first player ===")
probe = players[0]
url = HISTORY_URL.format(pid=probe["profileId"], start=0)
req = urllib.request.Request(url, headers=HEADERS)
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.loads(r.read())
page = data.get("matchHistoryStats", [])
print(f"Player: {probe['name']} ({probe['profileId']})")
print(f"Matches returned: {len(page)}")
for m in page[:20]:
    ts = m.get("completiontime") or 0
    age_days = round((time.time() - ts) / 86400)
    nresults = len(m.get("matchhistoryreportresults") or [])
    nmembers = len(m.get("matchhistorymember") or [])
    maxp = m.get("maxplayers", 0)
    mtype = m.get("matchtype_id", -1)
    mapname = m.get("mapname", "")
    desc = m.get("description", "")
    print(f"  [{age_days}d ago] id={m.get('id')} type={mtype} maxp={maxp} "
          f"results={nresults} members={nmembers} "
          f"map={mapname!r} desc={desc!r}")
print("=== END DIAGNOSTIC ===\n")

# ── Collect all unique mapnames/descriptions to find LOTR pattern ────────────
print("=== Scanning all players to find LOTR match patterns ===")
mapname_counts = {}
for player in players[:5]:  # check first 5 players
    pid = player["profileId"]
    try:
        url = HISTORY_URL.format(pid=pid, start=0)
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        for m in data.get("matchHistoryStats", []):
            key = f"map={m.get('mapname','')} maxp={m.get('maxplayers',0)} type={m.get('matchtype_id','')}"
            mapname_counts[key] = mapname_counts.get(key, 0) + 1
        time.sleep(0.5)
    except: pass

print("Most common match types seen:")
for k, v in sorted(mapname_counts.items(), key=lambda x: -x[1])[:20]:
    print(f"  {v:3d}x  {k}")
print()

# ── Load existing matches.json ────────────────────────────────────────────────
match_map = {}
if os.path.exists("matches.json"):
    try:
        with open("matches.json") as f:
            old = json.load(f)
        for m in old.get("matches", []):
            match_map[str(m["match_id"])] = m
        print(f"Loaded {len(match_map)} existing cached matches")
    except Exception as e:
        print(f"Could not read existing matches.json: {e}")

# ── Fetch and filter ─────────────────────────────────────────────────────────
# matchtype_id=0 = custom/unranked games
# maxplayers=8 = 8-player game (your LOTR scenario)
# We collect ALL 8-player custom games, then filter by community member count
for player in players:
    pid  = player["profileId"]
    name = player["name"]
    print(f"Fetching {name} ({pid})...", end=" ", flush=True)
    new_count = 0
    start = 0

    while True:
        try:
            url = HISTORY_URL.format(pid=pid, start=start)
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())

            page = data.get("matchHistoryStats", [])
            if not page:
                break

            hit_cutoff = False
            for m in page:
                ts = m.get("completiontime") or m.get("startgametime") or 0
                if ts < THREE_MONTHS:
                    hit_cutoff = True
                    break

                # Filter 1: must be a custom/unranked game (matchtype_id=0)
                if m.get("matchtype_id", -1) != 0:
                    continue

                # Filter 2: must be an 8-player game
                if m.get("maxplayers", 0) != 8:
                    continue

                # Both matchhistoryreportresults AND matchhistorymember checked
                members_raw = (m.get("matchhistoryreportresults") or
                               m.get("matchhistorymember") or [])

                members = []
                for mem in members_raw:
                    members.append({
                        "profile_id":      str(mem.get("profile_id", "")),
                        "teamid":          mem.get("teamid", -1),
                        "resulttype":      mem.get("resulttype", 0),
                        "civilization_id": mem.get("race_id") or mem.get("civilization_id") or -1,
                    })

                mid = str(m.get("id") or m.get("match_id"))
                if mid not in match_map:
                    match_map[mid] = {
                        "match_id":           mid,
                        "completiontime":     ts,
                        "startgametime":      m.get("startgametime", ts),
                        "mapname":            m.get("mapname", ""),
                        "description":        m.get("description", ""),
                        "matchhistorymember": members,
                    }
                    new_count += 1
                else:
                    existing_pids = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
                    for mem in members:
                        if mem["profile_id"] not in existing_pids:
                            match_map[mid]["matchhistorymember"].append(mem)
                            existing_pids.add(mem["profile_id"])

            if hit_cutoff or len(page) < 10:
                break
            start += len(page)
            time.sleep(0.4)

        except Exception as e:
            print(f"\n  error: {e}")
            break

    print(f"{new_count} new 8-player custom matches")
    time.sleep(0.8)

# ── Filter: only keep matches with 4+ community players ──────────────────────
filtered = {}
for mid, m in match_map.items():
    comm = [x for x in m["matchhistorymember"]
            if str(x["profile_id"]) in community_ids]
    if len(comm) >= 4:
        m["matchhistorymember"] = comm
        filtered[mid] = m

print(f"\nMatches with 4+ community members: {len(filtered)}")
for mid, m in list(filtered.items())[:5]:
    ts = m.get("completiontime", 0)
    age = round((time.time()-ts)/86400)
    print(f"  [{age}d ago] {mid}: {len(m['matchhistorymember'])} community players, "
          f"map={m.get('mapname')!r} desc={m.get('description')!r}")

# ── Save ──────────────────────────────────────────────────────────────────────
with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)
print(f"\n✓ Saved {len(filtered)} matches to matches.json")
