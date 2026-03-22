import base64, json, os, time, zlib, urllib.request, urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids={pids}"
LOBBY_URL    = "https://aoe-api.worldsedgelink.com/community/leaderboard/getAvailableLobbies?title=age2&matchtype_id=0&maxplayers=8"
PROFILE_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getLeaderboardProfiles?title=age2&profile_ids={pids}"
HEADERS      = {"User-Agent": "HobbitBalancer/1.0"}

API_DELAY   = 2.0
MAX_RETRIES = 4

# ── Rate-limited fetch with exponential backoff ───────────────────────────────

def fetch_url(url: str, timeout: int = 20) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
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

# ── metaData blob decoder (from ScenarioPlayerIndex) ─────────────────────────

def decode_metadata_blob(meta_data: str) -> bytes:
    layer1 = base64.b64decode(meta_data)
    text1  = layer1.decode("utf-8", errors="replace")
    if text1.startswith('"') and text1.endswith('"'):
        text1 = json.loads(text1)
    return base64.b64decode(text1)

def read_le_int(blob: bytes, start: int) -> Optional[int]:
    if start + 4 > len(blob):
        return None
    return int.from_bytes(blob[start:start+4], "little")

def extract_metadata_value(meta_data: str, key: str) -> Optional[str]:
    try:
        blob = decode_metadata_blob(meta_data)
    except Exception:
        return None
    key_bytes = key.encode("utf-8")
    idx = blob.find(key_bytes)
    if idx == -1:
        return None
    value_len = read_le_int(blob, idx + len(key_bytes))
    if value_len is None:
        return None
    value_start = idx + len(key_bytes) + 4
    value_end   = value_start + value_len
    if value_end > len(blob):
        return None
    try:
        return blob[value_start:value_end].decode("utf-8", errors="replace")
    except Exception:
        return None

# ── slotinfo decoder → position_label (p1-p8) via ScenarioPlayerIndex ────────

def decode_slotinfo(b64: str) -> List[Dict[str, Any]]:
    if not b64:
        return []
    try:
        raw = base64.b64decode(b64)
        decompressed = None
        for method in (
            lambda r: zlib.decompress(r),           # zlib with header (most common)
            lambda r: zlib.decompress(r, 47),        # gzip
            lambda r: zlib.decompress(r, -zlib.MAX_WBITS),  # raw deflate
        ):
            try:
                decompressed = method(raw)
                break
            except Exception:
                continue
        if decompressed is None:
            return []
        text  = decompressed.decode("utf-8", errors="replace")
        start = text.find("[")
        end   = text.rfind("]")
        if start == -1 or end == -1 or end < start:
            return []
        slots = json.loads(text[start:end+1])
        result = []
        for i, s in enumerate(slots):
            pid        = s.get("profileInfo.id") or s.get("profileid") or s.get("profile_id")
            station_id = s.get("stationID")
            team_id    = s.get("teamID")
            race_id    = s.get("raceID")
            meta_data  = s.get("metaData") or ""

            # ScenarioPlayerIndex is the definitive position (0-indexed → p1-p8)
            scenario_player_index = None
            if meta_data:
                raw_val = extract_metadata_value(meta_data, "ScenarioPlayerIndex")
                if raw_val is not None and raw_val.strip().isdigit():
                    scenario_player_index = int(raw_val.strip())

            slot_number     = scenario_player_index + 1 if scenario_player_index is not None else None
            position_label  = f"p{slot_number}" if slot_number is not None else None

            result.append({
                "slot_index":            i,
                "profile_id":            str(pid) if pid is not None else None,
                "station_id":            station_id,
                "team_id":               team_id,
                "race_id":               race_id,
                "scenario_player_index": scenario_player_index,
                "slot_number":           slot_number,
                "position_label":        position_label,
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

# ── STEP 0: Scan live lobbies for slot data BEFORE games start ────────────────

print("\nStep 0: Scanning live lobbies for slot data...")
lobby_slot_map = {}  # match_id → {profile_id_str: position_label}

try:
    time.sleep(API_DELAY)
    lobby_data = fetch_url(LOBBY_URL, timeout=15)
    lobbies = (lobby_data.get("matches") or
               lobby_data.get("matchGroups") or
               lobby_data.get("availableLobbies") or [])
    print(f"  Found {len(lobbies)} open lobbies")

    for lobby in lobbies:
        mid   = str(lobby.get("id") or lobby.get("match_id", ""))
        mtype = lobby.get("matchtype_id", -1)
        maxp  = lobby.get("maxplayers", 0)
        desc  = lobby.get("description", "")
        if mtype != 0 or maxp != 8:
            continue
        slots = decode_slotinfo(lobby.get("slotinfo", ""))
        if not slots:
            continue
        comm_slots = [s for s in slots if s.get("profile_id") in community_ids]
        if len(comm_slots) < 2:
            continue

        print(f"  Community lobby: {desc!r} (id={mid})")
        civ_map = {}
        for s in slots:
            pid = s.get("profile_id")
            if not pid:
                print(f"    slot {s['slot_index']} ScenarioPlayerIndex={s['scenario_player_index']} → empty")
                continue
            name = community_names.get(pid, f"Player {pid}")
            pos  = s["position_label"] or f"slot{s['slot_index']}"
            print(f"    {name} → ScenarioPlayerIndex={s['scenario_player_index']} → {pos}")
            if s["position_label"]:
                civ_map[pid] = s["position_label"]
        if mid and civ_map:
            lobby_slot_map[mid] = civ_map

    print(f"  Captured position data for {len(lobby_slot_map)} community lobbies")
except Exception as e:
    print(f"  Lobby scan failed (non-fatal): {e}")

time.sleep(API_DELAY)

# ── Helper: fetch match history ───────────────────────────────────────────────

def fetch_page(pid_list):
    pids = json.dumps(pid_list, separators=(",", ":"))
    url  = HISTORY_URL.format(pids=urllib.parse.quote(pids, safe="[],:"))
    return fetch_url(url, timeout=20).get("matchHistoryStats", [])

# ── Helper: process and store matches ─────────────────────────────────────────

def process(page, label=""):
    added = skipped = already_known = 0
    for m in page:
        mid   = str(m.get("id") or m.get("match_id"))
        mtype = m.get("matchtype_id", -1)
        maxp  = m.get("maxplayers", 0)
        ts    = m.get("completiontime") or m.get("startgametime") or 0
        desc  = m.get("description", "")

        date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "unknown"
        print(f"  [{date}] id={mid} type={mtype} maxp={maxp} desc={desc!r}")

        if mtype != 0 or maxp != 8:
            skipped += 1
            print(f"  → SKIP")
            continue

        # Decode slotinfo for ScenarioPlayerIndex-based position
        slots        = decode_slotinfo(m.get("slotinfo", ""))
        slot_by_pid  = {s["profile_id"]: s for s in slots if s.get("profile_id")}

        # Fall back to pre-captured lobby data if slotinfo not in completed match
        slot_civ_map = {pid: s["position_label"] for pid, s in slot_by_pid.items() if s.get("position_label")}
        if not slot_civ_map and mid in lobby_slot_map:
            slot_civ_map = lobby_slot_map[mid]
            print(f"  → Using pre-captured lobby position data")

        raw_results    = m.get("matchhistoryreportresults") or []
        raw_members    = m.get("matchhistorymember") or []
        results_by_pid = {str(r.get("profile_id", "")): r for r in raw_results}
        members_by_pid = {str(r.get("profile_id", "")): r for r in raw_members}
        all_pids_in_match = set(results_by_pid) | set(members_by_pid) | set(slot_by_pid)

        members = []
        for pid in all_pids_in_match:
            rr = results_by_pid.get(pid, {})
            rm = members_by_pid.get(pid, {})
            members.append({
                "profile_id":   pid,
                "teamid":       rr.get("teamid",     rm.get("teamid",     -1)),
                "resulttype":   rr.get("resulttype", rm.get("resulttype",  0)),
                "race_id":      rr.get("race_id", -1),
                "civ_position": slot_civ_map.get(pid),
            })

        comm_count = sum(1 for x in members if x["profile_id"] in community_ids)
        civ_count  = sum(1 for x in members if x.get("civ_position"))
        print(f"  → {comm_count} community | {civ_count}/8 with position")

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
                    for ex in match_map[mid]["matchhistorymember"]:
                        if ex["profile_id"] == mem["profile_id"] and not ex.get("civ_position"):
                            ex["civ_position"] = mem["civ_position"]
            print(f"  → already known")

    print(f"  {label}: {added} added, {already_known} known, {skipped} skipped")
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

print(f"\nStep 2: Individual queries ({API_DELAY}s delay each)...")
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
    print(f"\nLooking up {len(unknown_pids)} unknown player names (best-effort)...")
    batch_list = list(unknown_pids)
    for i in range(0, len(batch_list), 20):
        batch = batch_list[i:i+20]
        try:
            pids = json.dumps([int(p) for p in batch], separators=(",", ":"))
            url  = PROFILE_URL.format(pids=urllib.parse.quote(pids, safe="[],:"))
            data = fetch_url(url, timeout=10)
            for profile in (data.get("result", {}).get("profiles") or data.get("profiles") or []):
                p_id = str(profile.get("profile_id", ""))
                unknown_names[p_id] = (profile.get("alias") or profile.get("name") or f"Player {p_id}")
        except Exception as e:
            print(f"  Name lookup failed (skipping): {e}")
        time.sleep(1.0)

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
    print(f"  {date} | {mid} | {comm}/8 community | {civ}/8 positions | {m.get('description','')!r}")

with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)

print(f"\n✓ Saved {len(filtered)} matches to matches.json")
