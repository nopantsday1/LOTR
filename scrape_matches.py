import urllib.request, json, time, os

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HEADERS = {"User-Agent": "HobbitBalancer/1.0"}
CUTOFF = int(time.time()) - 365*24*60*60  # 12 months

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
all_pids = [p["profileId"] for p in players]

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

# ── Strategy: query ALL players at once, then each individually ──────────────
# Step 1: Query ALL profile IDs together — returns most recent matches
#         involving ANY community player (most efficient for recent games)
# Step 2: Query each player individually — fills in older matches
#         that the bulk query missed

def fetch_matches(pid_list, start=0):
    """Fetch match history for a list of profile IDs."""
    pids_str = json.dumps(pid_list)
    url = (f"https://aoe-api.worldsedgelink.com/community/leaderboard/"
           f"getRecentMatchHistory?title=age2&profile_ids={pids_str}&start_index={start}")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("matchHistoryStats", [])

def process_page(page):
    """Process a page of matches, adding new ones to match_map."""
    new_count = 0
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
        raw_results = m.get("matchhistoryreportresults") or []
        raw_members = m.get("matchhistorymember") or []
        members_raw = raw_results if len(raw_results) >= len(raw_members) else raw_members

        members = []
        for mem in members_raw:
            members.append({
                "profile_id": str(mem.get("profile_id", "")),
                "teamid":     mem.get("teamid", -1),
                "resulttype": mem.get("resulttype", 0),
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
        else:
            # Merge any missing players
            existing = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
            for mem in members:
                if mem["profile_id"] not in existing:
                    match_map[mid]["matchhistorymember"].append(mem)
                    existing.add(mem["profile_id"])
    return new_count, hit_cutoff

# ── Step 1: Bulk query — ALL players at once ──────────────────────────────────
print(f"\nStep 1: Bulk query with all {len(all_pids)} profile IDs...")
try:
    page = fetch_matches(all_pids)
    new, _ = process_page(page)
    print(f"  Bulk query: {len(page)} matches returned, {new} new 8-player custom matches")
except Exception as e:
    print(f"  Bulk query failed: {e}")
time.sleep(1)

# ── Step 2: Individual queries — each player separately ──────────────────────
print(f"\nStep 2: Individual queries for each player...")
for player in players:
    pid  = player["profileId"]
    name = player["name"]
    print(f"  {name} ({pid})...", end=" ", flush=True)
    total_new = 0
    start = 0

    while True:
        try:
            page = fetch_matches([pid], start=start)
            if not page:
                break
            new, hit_cutoff = process_page(page)
            total_new += new
            if hit_cutoff or len(page) < 10:
                break
            start += len(page)
            time.sleep(0.3)
        except Exception as e:
            print(f"[err] ", end="", flush=True)
            break

    print(f"{total_new} new")
    time.sleep(0.5)

# ── Lookup names for unknown profile IDs ─────────────────────────────────────
# Collect all profile IDs that appear in matches but aren't in our community
unknown_pids = set()
for m in match_map.values():
    for mem in m["matchhistorymember"]:
        if str(mem["profile_id"]) not in community_ids:
            unknown_pids.add(str(mem["profile_id"]))

# Add community names we already know
community_names = {str(p["profileId"]): p["name"] for p in players}

# Fetch names for unknowns in batches of 20
unknown_names = {}
unknown_list = list(unknown_pids)
print(f"\nLooking up names for {len(unknown_list)} unknown players...")
for i in range(0, len(unknown_list), 20):
    batch = unknown_list[i:i+20]
    try:
        url = (f"https://aoe-api.worldsedgelink.com/community/leaderboard/"
               f"getLeaderboardProfiles?title=age2&profile_ids={json.dumps([int(p) for p in batch])}")
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        for profile in data.get("result", {}).get("profiles", []) or data.get("profiles", []) or []:
            pid = str(profile.get("profile_id", ""))
            name = profile.get("alias") or profile.get("name") or f"Player {pid}"
            unknown_names[pid] = name
        time.sleep(0.5)
    except Exception as e:
        print(f"  Name lookup batch {i//20+1} failed: {e}")

print(f"  Found names for {len(unknown_names)} unknown players")

# Merge all names
all_names = {**community_names, **unknown_names}

# Add names to all members in match_map
for m in match_map.values():
    for mem in m["matchhistorymember"]:
        pid = str(mem["profile_id"])
        mem["name"] = all_names.get(pid, f"Player {pid}")
        mem["is_community"] = pid in community_ids

# ── Filter: 4+ community players ─────────────────────────────────────────────
filtered = {}
for mid, m in match_map.items():
    comm = [x for x in m["matchhistorymember"] if x.get("is_community")]
    if len(comm) >= 4:
        filtered[mid] = m

print(f"\nMatches with 4+ community members: {len(filtered)}")
for mid, m in list(sorted(filtered.items(), key=lambda x: x[1].get("completiontime", 0), reverse=True))[:8]:
    ts    = m.get("completiontime", 0)
    age   = round((time.time()-ts)/86400)
    comm  = len([x for x in m["matchhistorymember"] if str(x["profile_id"]) in community_ids])
    total = len(m["matchhistorymember"])
    print(f"  [{age}d ago] {mid}: {comm} community / {total} total, desc={m.get('description')!r}")

# ── Save ──────────────────────────────────────────────────────────────────────
with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)
print(f"\n✓ Saved {len(filtered)} matches to matches.json")
