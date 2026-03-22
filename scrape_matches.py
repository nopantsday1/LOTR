import urllib.request, json, time, os, zlib, base64
from datetime import datetime

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids={pids}"
LOBBY_URL    = "https://aoe-api.worldsedgelink.com/community/leaderboard/getAvailableLobbies?title=age2&matchtype_id=0&maxplayers=8"
HEADERS      = {"User-Agent": "HobbitBalancer/1.0"}

API_DELAY   = 2.0
MAX_RETRIES = 4

# colorId in AoE2 custom scenarios = the player's slot/position in the lobby
# Slot 0-3 = Evil positions P1-P4, Slot 4-7 = Good positions P5-P8
# The number shown in-game next to each player IS their slot position (1-8)
# The API colorId is 0-indexed, so colorId 0 = slot 1 = P1, colorId 1 = slot 2 = P2, etc.
COLOR_TO_CIV = {0:'p1', 1:'p2', 2:'p3', 3:'p4', 4:'p5', 5:'p6', 6:'p7', 7:'p8'}

# ── Rate-limited fetch with exponential backoff ───────────────────────────────

def fetch_url(url, timeout=20):
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = API_DELAY * (4 ** attempt)
                print(f"  429 Rate limited — waiting {wait:.0f}s (attempt {attempt}/{MAX_RETRIES})")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = API_DELAY * attempt
            print(f"  Error: {e} — retrying in {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"Failed after {MAX_RETRIES} attempts: {url}")

# ── Decode slotinfo blob → list of slot dicts with colorId ───────────────────

def decode_slotinfo(b64):
    """Decode AoE2 slotinfo (base64+zlib) → slot list with colorId per player.
    Tries multiple decompression strategies since the format varies."""
    if not b64:
        return []
    try:
        raw = base64.b64decode(b64)
        # Try different decompression methods — format varies by API version
        decompressed = None
        for method in [
            lambda r: zlib.decompress(r, -zlib.MAX_WBITS),  # raw deflate (no header)
            lambda r: zlib.decompress(r),                    # zlib with header
            lambda r: zlib.decompress(r, 47),                # gzip
            lambda r: r,                                     # already plain JSON
        ]:
            try:
                decompressed = method(raw)
                break
            except Exception:
                continue

        if decompressed is None:
            return []

        text  = decompressed.decode('utf-8', errors='replace')
        start = text.find('[')
        if start == -1:
            return []
        slots = json.loads(text[start:])
        result = []
        for i, s in enumerate(slots):
            profile_id = (s.get('profileInfo', {}).get('id') or s.get('profileid') or 0)
            color_id   = s.get('colorId',   s.get('color_id',   i))
            team_id    = s.get('teamId',    s.get('team_id',   -1))
            slot_type  = s.get('slotType',  s.get('slot_type',  0))
            result.append({
                'slot_index':   i,
                'profile_id':   int(profile_id),
                'color_id':     int(color_id),
                'team_id':      int(team_id),
                'slot_type':    int(slot_type),
                'civ_position': COLOR_TO_CIV.get(int(color_id)),
            })
        return result
    except Exception as e:
        print(f"  slotinfo decode failed: {e}")
        return []

# ── Load players from Firestore ───────────────────────────────────────────────

print("Loading players from Firestore...")
docs = fetch_url(FIREBASE_URL, timeout=10).get("documents", [])

players = []
for doc in docs:
    f   = doc.get("fields", {})
    pid = (f.get("profileId", {}).get("integerValue") or
           f.get("profileId", {}).get("stringValue"))
    name = f.get("name", {}).get("stringValue", "Unknown")
    if pid:
        players.append({"name": name, "profileId": int(pid)})

print(f"Found {len(players)} players with profile IDs")
community_ids   = {str(p["profileId"]) for p in players}
community_names = {str(p["profileId"]): p["name"] for p in players}
all_pids        = [p["profileId"] for p in players]

# ── Load existing matches.json ────────────────────────────────────────────────

FORCE_RESCAN = os.environ.get("FORCE_RESCAN", "0") == "1"
match_map    = {}

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

# ── STEP 0: Scan live lobbies for colorId/slot data BEFORE games start ────────
# This is the key to correct civ assignment — the lobby has colorId per player
# which maps directly to their scenario position (P1-P8).
# We store this keyed by match_id so autoRecord can use it when the game ends.

print("\nStep 0: Scanning live lobbies for slot/color data...")
lobby_slot_map = {}  # match_id → {profile_id_str: civ_position}

try:
    time.sleep(API_DELAY)
    lobby_data = fetch_url(LOBBY_URL, timeout=15)
    # API may return matches at top level or nested
    lobbies = (lobby_data.get('matches') or
               lobby_data.get('matchGroups') or
               lobby_data.get('availableLobbies') or [])
    print(f"  Found {len(lobbies)} open lobbies")

    for lobby in lobbies:
        mid   = str(lobby.get('id') or lobby.get('match_id', ''))
        mtype = lobby.get('matchtype_id', -1)
        maxp  = lobby.get('maxplayers', 0)
        desc  = lobby.get('description', '')

        if mtype != 0 or maxp != 8:
            continue

        slots = decode_slotinfo(lobby.get('slotinfo', ''))
        if not slots:
            continue

        comm_slots = [s for s in slots if str(s['profile_id']) in community_ids]
        if len(comm_slots) < 2:
            continue

        print(f"  Community lobby found: {desc!r} ({len(comm_slots)} members, id={mid})")
        print(f"  All slots:")
        civ_map = {}
        for s in slots:
            pid = str(s['profile_id'])
            if not s['profile_id']:
                print(f"    slot {s['slot_index']} colorId={s['color_id']} → empty/AI")
                continue
            name = community_names.get(pid, f"Player {pid}")
            pos  = s['civ_position'] or f"color{s['color_id']}"
            print(f"    slot {s['slot_index']} colorId={s['color_id']} → {pos} → {name}")
            if s['civ_position']:
                civ_map[pid] = s['civ_position']

        if mid and civ_map:
            lobby_slot_map[mid] = civ_map

    print(f"  Captured civ data for {len(lobby_slot_map)} community lobbies")

except Exception as e:
    print(f"  Lobby scan failed (non-fatal): {e}")

time.sleep(API_DELAY)

# ── Helper: fetch match history ───────────────────────────────────────────────

def fetch_page(pid_list):
    url  = HISTORY_URL.format(pids=json.dumps(pid_list, separators=(',', ':')))
    data = fetch_url(url, timeout=20)
    return data.get("matchHistoryStats", [])

# ── Helper: process and store matches ─────────────────────────────────────────

def process(page, label=""):
    added = skipped_type = already_known = 0
    for m in page:
        mid   = str(m.get("id") or m.get("match_id"))
        mtype = m.get("matchtype_id", -1)
        maxp  = m.get("maxplayers", 0)
        ts    = m.get("completiontime") or m.get("startgametime") or 0
        desc  = m.get("description", "")

        date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "unknown"
        print(f"  [{date}] id={mid} type={mtype} maxp={maxp} desc={desc!r}")

        if mtype != 0 or maxp != 8:
            skipped_type += 1
            print(f"  → SKIP (not custom 8-player)")
            continue

        raw_results    = m.get("matchhistoryreportresults") or []
        raw_members    = m.get("matchhistorymember") or []
        results_by_pid = {str(r.get("profile_id", "")): r for r in raw_results}
        members_by_pid = {str(r.get("profile_id", "")): r for r in raw_members}
        all_pids_in_match = set(results_by_pid) | set(members_by_pid)

        # Try to get civ positions: first from the match's own slotinfo, then lobby cache
        slot_civ_map = {}
        match_slots = decode_slotinfo(m.get('slotinfo', ''))
        for s in match_slots:
            if s['profile_id'] and s['civ_position']:
                slot_civ_map[str(s['profile_id'])] = s['civ_position']

        if not slot_civ_map and mid in lobby_slot_map:
            slot_civ_map = lobby_slot_map[mid]
            print(f"  → Using pre-captured lobby civ data")

        members = []
        for pid in all_pids_in_match:
            rr = results_by_pid.get(pid, {})
            rm = members_by_pid.get(pid, {})
            members.append({
                "profile_id":   pid,
                "teamid":       rr.get("teamid",     rm.get("teamid",     -1)),
                "resulttype":   rr.get("resulttype", rm.get("resulttype",  0)),
                "race_id":      rr.get("race_id", -1),
                "civ_position": slot_civ_map.get(pid),  # 'p1'..'p8' or None
            })

        comm_count = sum(1 for x in members if x["profile_id"] in community_ids)
        civ_count  = sum(1 for x in members if x.get("civ_position"))
        print(f"  → custom 8p | {comm_count} community | {civ_count}/8 with civ position")

        if mid not in match_map:
            match_map[mid] = {
                "match_id":           mid,
                "completiontime":     ts,
                "startgametime":      m.get("startgametime", ts),
                "mapname":            m.get("mapname", ""),
                "description":        desc,
                "matchhistorymember": members,
            }
            added += 1
            print(f"  → ADDED")
        else:
            already_known += 1
            existing = {x["profile_id"] for x in match_map[mid]["matchhistorymember"]}
            for mem in members:
                if mem["profile_id"] not in existing:
                    match_map[mid]["matchhistorymember"].append(mem)
                    existing.add(mem["profile_id"])
                elif mem.get("civ_position"):
                    # Backfill civ_position if we now have it
                    for ex in match_map[mid]["matchhistorymember"]:
                        if ex["profile_id"] == mem["profile_id"] and not ex.get("civ_position"):
                            ex["civ_position"] = mem["civ_position"]
            print(f"  → already known (civ data updated)")

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

time.sleep(API_DELAY)

# ── Step 2: Individual queries ────────────────────────────────────────────────

print(f"\nStep 2: Individual queries (with {API_DELAY}s delay each)...")
for player in players:
    pid, name = player["profileId"], player["name"]
    print(f"\n  {name} ({pid}):")
    try:
        page = fetch_page([pid])
        print(f"  API returned {len(page)} matches:")
        process(page, name)
    except Exception as e:
        print(f"  FAILED: {e}")
    time.sleep(API_DELAY)

# ── Name lookup ───────────────────────────────────────────────────────────────

unknown_pids = {
    str(mem["profile_id"])
    for m in match_map.values()
    for mem in m["matchhistorymember"]
    if str(mem["profile_id"]) not in community_ids
}

unknown_names = {}
if unknown_pids:
    print(f"\nLooking up {len(unknown_pids)} unknown player names (best-effort, no retries)...")
    batch_list = list(unknown_pids)
    for i in range(0, len(batch_list), 20):
        batch = batch_list[i:i+20]
        try:
            url = (
                "https://aoe-api.worldsedgelink.com/community/leaderboard/"
                "getLeaderboardProfiles?title=age2"
                "&profile_ids=" + json.dumps([int(p) for p in batch], separators=(',', ':'))
            )
            url = url.strip()
            req  = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            for profile in (data.get("result", {}).get("profiles") or data.get("profiles") or []):
                p_id = str(profile.get("profile_id", ""))
                unknown_names[p_id] = (profile.get("alias") or
                                       profile.get("name") or
                                       f"Player {p_id}")
        except Exception as e:
            print(f"  Name lookup failed (skipping batch): {e}")
        time.sleep(1.0)  # shorter delay for name lookups — non-critical

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
for mid, m in sorted(filtered.items(), key=lambda x: x[1].get("completiontime", 0), reverse=True)[:10]:
    ts   = m.get("completiontime", 0)
    date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "?"
    comm = sum(1 for x in m["matchhistorymember"] if x.get("is_community"))
    civ  = sum(1 for x in m["matchhistorymember"] if x.get("civ_position"))
    print(f"  {date} | {mid} | {comm}/8 community | {civ}/8 civ | {m.get('description', '')!r}")

with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)

print(f"\n✓ Saved {len(filtered)} matches to matches.json")
