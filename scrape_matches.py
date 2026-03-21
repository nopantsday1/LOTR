import urllib.request, json, time, os

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids=[{pid}]&start_index={start}"
CUTOFF = int(time.time()) - 365*24*60*60  # 12 months

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
        print("FORCE_RESCAN=1: ignoring cache, reprocessing all matches")

# ── Fetch match history per player and build match_map ───────────────────────
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
                if ts > 0 and ts < CUTOFF:
                    hit_cutoff = True
                    break

                # Must be custom (type=0) and 8-player
                if m.get("matchtype_id", -1) != 0:
                    continue
                if m.get("maxplayers", 0) != 8:
                    continue

                mid = str(m.get("id") or m.get("match_id"))

                # matchhistoryreportresults has ALL 8 players with race_id
                # matchhistorymember is also all 8 but may lack race_id
                # Use whichever has more entries
                raw_results  = m.get("matchhistoryreportresults") or []
                raw_members  = m.get("matchhistorymember") or []
                members_raw  = raw_results if len(raw_results) >= len(raw_members) else raw_members

                members = []
                for mem in members_raw:
                    members.append({
                        "profile_id":  str(mem.get("profile_id", "")),
                        "teamid":      mem.get("teamid", -1),
                        "resulttype":  mem.get("resulttype", 0),
                    })

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
                    # Debug: show player count on first few new matches
                    if new_count <= 2:
                        comm_in_match = [x for x in members if x["profile_id"] in community_ids]
                        print(f"\n  NEW {mid} ({m.get('description')}): "
                              f"{len(members)} total players, "
                              f"{len(comm_in_match)} community, "
                              f"race_ids: {[x['race_id'] for x in members]}")
                else:
                    # Merge: add any players not already stored
                    existing = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
                    added = 0
                    for mem in members:
                        if mem["profile_id"] not in existing:
                            match_map[mid]["matchhistorymember"].append(mem)
                            existing.add(mem["profile_id"])
                            added += 1

            if hit_cutoff or len(page) < 10:
                break
            start += len(page)
            time.sleep(0.4)

        except Exception as e:
            print(f" [err:{e}]", end="", flush=True)
            time.sleep(2)
            break

    print(f"{new_count} new matches")
    time.sleep(0.8)

# ── Filter: keep matches with 4+ community players ───────────────────────────
filtered = {}
for mid, m in match_map.items():
    comm = [x for x in m["matchhistorymember"]
            if str(x["profile_id"]) in community_ids]
    if len(comm) >= 4:
        filtered[mid] = m

print(f"\nMatches with 4+ community members: {len(filtered)}")
for mid, m in list(sorted(filtered.items(), key=lambda x: x[1].get("completiontime",0), reverse=True))[:5]:
    ts    = m.get("completiontime", 0)
    age   = round((time.time()-ts)/86400)
    comm  = len([x for x in m["matchhistorymember"] if str(x["profile_id"]) in community_ids])
    total = len(m["matchhistorymember"])
    print(f"  [{age}d ago] {mid}: {comm} community / {total} total, desc={m.get('description')!r}")

# ── Save ──────────────────────────────────────────────────────────────────────
with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)
print(f"\n✓ Saved {len(filtered)} matches to matches.json")
