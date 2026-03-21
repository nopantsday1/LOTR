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
        print("FORCE_RESCAN=1: ignoring cache, reprocessing all matches")

# ── Helper: fetch one page of match history ───────────────────────────────────
def fetch_page(pid_list):
    url = HISTORY_URL.format(pids=json.dumps(pid_list))
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("matchHistoryStats", [])

# ── Helper: process matches and add to match_map ──────────────────────────────
def process(page):
    added = 0
    for m in page:
        # Only custom 8-player games
        if m.get("matchtype_id", -1) != 0:
            continue
        if m.get("maxplayers", 0) != 8:
            continue

        mid = str(m.get("id") or m.get("match_id"))
        ts  = m.get("completiontime") or m.get("startgametime") or 0

        # Use whichever member array is larger (both should have all 8)
        raw = m.get("matchhistoryreportresults") or []
        alt = m.get("matchhistorymember") or []
        members_raw = raw if len(raw) >= len(alt) else alt

        members = [
            {
                "profile_id": str(mem.get("profile_id", "")),
                "teamid":     mem.get("teamid", -1),
                "resulttype": mem.get("resulttype", 0),
            }
            for mem in members_raw
        ]

        if mid not in match_map:
            match_map[mid] = {
                "match_id":           mid,
                "completiontime":     ts,
                "startgametime":      m.get("startgametime", ts),
                "mapname":            m.get("mapname", ""),
                "description":        m.get("description", ""),
                "matchhistorymember": members,
            }
            added += 1
        else:
            # Merge any players not yet stored
            existing = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
            for mem in members:
                if mem["profile_id"] not in existing:
                    match_map[mid]["matchhistorymember"].append(mem)
                    existing.add(mem["profile_id"])
    return added

# ── Step 1: Bulk query with ALL players (catches recent community games) ───────
print(f"\nStep 1: Bulk query — all {len(all_pids)} profile IDs at once...")
try:
    page = fetch_page(all_pids)
    added = process(page)
    print(f"  {len(page)} matches returned, {added} new 8-player custom games")
except Exception as e:
    print(f"  Bulk query failed: {e}")
time.sleep(1)

# ── Step 2: Individual queries — each player fills in their own history ────────
print(f"\nStep 2: Individual queries...")
for player in players:
    pid  = player["profileId"]
    name = player["name"]
    print(f"  {name}...", end=" ", flush=True)
    try:
        page  = fetch_page([pid])
        added = process(page)
        print(f"{added} new")
    except Exception as e:
        print(f"[err: {e}]")
    time.sleep(0.5)

# ── Lookup names for unknown profile IDs ──────────────────────────────────────
unknown_pids = {
    str(mem["profile_id"])
    for m in match_map.values()
    for mem in m["matchhistorymember"]
    if str(mem["profile_id"]) not in community_ids
}

community_names = {str(p["profileId"]): p["name"] for p in players}
unknown_names   = {}

if unknown_pids:
    print(f"\nLooking up names for {len(unknown_pids)} unknown players...")
    for i in range(0, len(list(unknown_pids)), 20):
        batch = list(unknown_pids)[i:i+20]
        try:
            url = (f"https://aoe-api.worldsedgelink.com/community/leaderboard/"
                   f"getLeaderboardProfiles?title=age2&profile_ids={json.dumps([int(p) for p in batch])}")
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            for profile in (data.get("result", {}).get("profiles") or data.get("profiles") or []):
                p_id  = str(profile.get("profile_id", ""))
                pname = profile.get("alias") or profile.get("name") or f"Player {p_id}"
                unknown_names[p_id] = pname
            time.sleep(0.5)
        except Exception as e:
            print(f"  Name lookup failed: {e}")
    print(f"  Resolved {len(unknown_names)} names")

all_names = {**community_names, **unknown_names}

# Annotate members with names and community flag
for m in match_map.values():
    for mem in m["matchhistorymember"]:
        pid = str(mem["profile_id"])
        mem["name"]         = all_names.get(pid, f"Player {pid}")
        mem["is_community"] = pid in community_ids

# ── Filter: keep only matches with 4+ community players ───────────────────────
filtered = {
    mid: m
    for mid, m in match_map.items()
    if sum(1 for x in m["matchhistorymember"] if x.get("is_community")) >= 4
}

print(f"\nMatches with 4+ community members: {len(filtered)}")
for mid, m in sorted(filtered.items(), key=lambda x: x[1].get("completiontime", 0), reverse=True)[:10]:
    ts    = m.get("completiontime", 0)
    age   = round((time.time() - ts) / 86400, 1)
    comm  = sum(1 for x in m["matchhistorymember"] if x.get("is_community"))
    total = len(m["matchhistorymember"])
    print(f"  [{age}d ago] {mid}: {comm}/{total} community, desc={m.get('description')!r}")

# ── Save ───────────────────────────────────────────────────────────────────────
with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)
print(f"\n✓ Saved {len(filtered)} matches to matches.json")
