"""
rebuild_matches.py
Fetches ALL community matches, decodes ScenarioPlayerIndex from metaData,
and writes a corrected matches.json ready for the Hobbit Balancer.
Run once to fix historical data, then deploy the result.
"""
import base64, json, os, time, zlib, urllib.request, urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
HISTORY_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getRecentMatchHistory?title=age2&profile_ids={pids}"
PROFILE_URL  = "https://aoe-api.worldsedgelink.com/community/leaderboard/getLeaderboardProfiles?title=age2&profile_ids={pids}"
HEADERS      = {"User-Agent": "HobbitBalancer/1.0"}
API_DELAY    = 2.0
MAX_RETRIES  = 4

# ── Fetch with retry ──────────────────────────────────────────────────────────

def fetch_url(url: str, timeout: int = 20) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = API_DELAY * (4 ** attempt)
                print(f"  429 — waiting {wait:.0f}s")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            time.sleep(API_DELAY * attempt)
    raise RuntimeError(f"Failed: {url}")

# ── metaData ScenarioPlayerIndex decoder ─────────────────────────────────────

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
        blob      = decode_metadata_blob(meta_data)
        key_bytes = key.encode("utf-8")
        idx       = blob.find(key_bytes)
        if idx == -1:
            return None
        value_len = read_le_int(blob, idx + len(key_bytes))
        if value_len is None:
            return None
        value_start = idx + len(key_bytes) + 4
        value_end   = value_start + value_len
        if value_end > len(blob):
            return None
        return blob[value_start:value_end].decode("utf-8", errors="replace")
    except Exception:
        return None

# ── slotinfo decoder ──────────────────────────────────────────────────────────

def decode_slotinfo(b64: str) -> List[Dict[str, Any]]:
    if not b64:
        return []
    try:
        raw = base64.b64decode(b64)
        decompressed = None
        for method in (
            lambda r: zlib.decompress(r),
            lambda r: zlib.decompress(r, 47),
            lambda r: zlib.decompress(r, -zlib.MAX_WBITS),
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
        if start == -1 or end == -1:
            return []
        slots = json.loads(text[start:end+1])
        result = []
        for i, s in enumerate(slots):
            pid       = s.get("profileInfo.id") or s.get("profileid") or s.get("profile_id")
            meta_data = s.get("metaData") or ""
            scenario_player_index = None
            if meta_data:
                raw_val = extract_metadata_value(meta_data, "ScenarioPlayerIndex")
                if raw_val is not None and raw_val.strip().isdigit():
                    scenario_player_index = int(raw_val.strip())
            slot_number    = scenario_player_index + 1 if scenario_player_index is not None else None
            position_label = f"p{slot_number}" if slot_number is not None else None
            result.append({
                "profile_id":     str(pid) if pid is not None else None,
                "slot_number":    slot_number,
                "position_label": position_label,
            })
        return result
    except Exception as e:
        print(f"  slotinfo decode failed: {e}")
        return []

# ── Load players ──────────────────────────────────────────────────────────────

print("Loading players from Firestore...")
docs    = fetch_url(FIREBASE_URL, timeout=10).get("documents", [])
players = []
for doc in docs:
    f   = doc.get("fields", {})
    pid = (f.get("profileId", {}).get("integerValue") or
           f.get("profileId", {}).get("stringValue"))
    name = f.get("name", {}).get("stringValue", "Unknown")
    if pid:
        players.append({"name": name, "profileId": int(pid)})

print(f"Found {len(players)} players")
community_ids   = {str(p["profileId"]) for p in players}
community_names = {str(p["profileId"]): p["name"] for p in players}
all_pids        = [p["profileId"] for p in players]

# ── Fetch all matches ─────────────────────────────────────────────────────────

match_map: Dict[str, Any] = {}

def fetch_and_store(pid_list, label):
    pids = json.dumps(pid_list, separators=(",", ":"))
    url  = HISTORY_URL.format(pids=urllib.parse.quote(pids, safe="[],:"))
    page = fetch_url(url, timeout=20).get("matchHistoryStats", [])
    added = 0
    for m in page:
        mid   = str(m.get("id") or m.get("match_id"))
        mtype = m.get("matchtype_id", -1)
        maxp  = m.get("maxplayers", 0)
        if mtype != 0 or maxp != 8:
            continue
        if mid in match_map:
            # Backfill slotinfo if we now have it
            slots       = decode_slotinfo(m.get("slotinfo", ""))
            slot_by_pid = {s["profile_id"]: s for s in slots if s.get("profile_id")}
            for mem in match_map[mid]["matchhistorymember"]:
                if not mem.get("civ_position") and mem["profile_id"] in slot_by_pid:
                    mem["civ_position"] = slot_by_pid[mem["profile_id"]]["position_label"]
            continue

        ts   = m.get("completiontime") or m.get("startgametime") or 0
        desc = m.get("description", "")
        date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "unknown"

        # Decode positions
        slots        = decode_slotinfo(m.get("slotinfo", ""))
        slot_by_pid  = {s["profile_id"]: s for s in slots if s.get("profile_id")}
        slot_civ_map = {pid: s["position_label"] for pid, s in slot_by_pid.items() if s.get("position_label")}

        raw_results    = m.get("matchhistoryreportresults") or []
        raw_members    = m.get("matchhistorymember") or []
        results_by_pid = {str(r.get("profile_id", "")): r for r in raw_results}
        members_by_pid = {str(r.get("profile_id", "")): r for r in raw_members}
        all_pids_in   = set(results_by_pid) | set(members_by_pid) | set(slot_by_pid)

        members = []
        for pid in all_pids_in:
            rr = results_by_pid.get(pid, {})
            rm = members_by_pid.get(pid, {})
            members.append({
                "profile_id":   pid,
                "teamid":       rr.get("teamid",     rm.get("teamid",     -1)),
                "resulttype":   rr.get("resulttype", rm.get("resulttype",  0)),
                "race_id":      rr.get("race_id", -1),
                "civ_position": slot_civ_map.get(pid),
            })

        comm = sum(1 for x in members if x["profile_id"] in community_ids)
        civs = sum(1 for x in members if x.get("civ_position"))

        if len(members) < 8:
            print(f"  [{date}] {mid} | SKIP — only {len(members)} players (dropped match)")
            continue

        # Skip very short games (under 10 minutes)
        completion = m.get("completiontime")
        start_t    = m.get("startgametime")
        duration   = (completion - start_t) if (completion and start_t) else None
        if duration is not None and duration < 600:
            print(f"  [{date}] {mid} | SKIP — duration {duration}s < 10 min (dropped)")
            continue

        # Skip duplicate lineups — same community players within 30 min of another match
        match_comm  = {str(x["profile_id"]) for x in members if str(x["profile_id"]) in community_ids}
        match_start = m.get("startgametime") or m.get("completiontime") or 0
        is_dup = False
        for ex in match_map.values():
            ex_start = ex.get("startgametime") or ex.get("completiontime") or 0
            if abs(match_start - ex_start) > 1800:
                continue
            ex_comm = {str(x["profile_id"]) for x in ex["matchhistorymember"] if str(x["profile_id"]) in community_ids}
            if len(ex_comm) < 4:
                continue
            if len(match_comm & ex_comm) >= len(match_comm) * 0.75:
                is_dup = True
                break
        if is_dup:
            print(f"  [{date}] {mid} | SKIP — duplicate lineup within 30 min")
            continue

        print(f"  [{date}] {mid} | {comm} community | {civs}/8 positions | {desc!r}")

        match_map[mid] = {
            "match_id":           mid,
            "completiontime":     ts,
            "startgametime":      m.get("startgametime", ts),
            "mapname":            m.get("mapname", ""),
            "description":        desc,
            "matchhistorymember": members,
        }
        added += 1
    print(f"  {label}: {added} new matches")

print(f"\nBulk query — {len(all_pids)} players...")
fetch_and_store(all_pids, "Bulk")
time.sleep(API_DELAY)

print(f"\nIndividual queries...")
for p in players:
    print(f"  {p['name']} ({p['profileId']}):")
    try:
        fetch_and_store([p["profileId"]], p["name"])
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

unknown_names: Dict[str, str] = {}
if unknown_pids:
    print(f"\nLooking up {len(unknown_pids)} unknown names...")
    for i in range(0, len(list(unknown_pids)), 20):
        batch = list(unknown_pids)[i:i+20]
        try:
            pids = json.dumps([int(p) for p in batch], separators=(",", ":"))
            url  = PROFILE_URL.format(pids=urllib.parse.quote(pids, safe="[],:"))
            data = fetch_url(url, timeout=10)
            for profile in (data.get("result", {}).get("profiles") or data.get("profiles") or []):
                p_id = str(profile.get("profile_id", ""))
                unknown_names[p_id] = profile.get("alias") or profile.get("name") or f"Player {p_id}"
        except Exception as e:
            print(f"  Failed: {e}")
        time.sleep(1.0)

all_names = {**community_names, **unknown_names}
for m in match_map.values():
    for mem in m["matchhistorymember"]:
        pid             = str(mem["profile_id"])
        mem["name"]         = all_names.get(pid, f"Player {pid}")
        mem["is_community"] = pid in community_ids

# ── Filter and save ───────────────────────────────────────────────────────────

filtered = {
    mid: m for mid, m in match_map.items()
    if sum(1 for x in m["matchhistorymember"] if x.get("is_community")) >= 4
}

print(f"\n{'='*50}")
print(f"RESULT: {len(filtered)} matches with 4+ community players")
has_civ = sum(1 for m in filtered.values()
              if any(x.get("civ_position") for x in m["matchhistorymember"]))
print(f"  {has_civ} matches with ScenarioPlayerIndex position data")
print(f"  {len(filtered)-has_civ} matches without position data (lobby not captured)")

for mid, m in sorted(filtered.items(), key=lambda x: x[1].get("completiontime", 0), reverse=True)[:10]:
    ts   = m.get("completiontime", 0)
    date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "?"
    comm = sum(1 for x in m["matchhistorymember"] if x.get("is_community"))
    civ  = sum(1 for x in m["matchhistorymember"] if x.get("civ_position"))
    print(f"  {date} | {mid} | {comm}/8 | {civ}/8 pos | {m.get('description','')!r}")

with open("matches.json", "w") as f:
    json.dump({"matches": list(filtered.values()), "updated": int(time.time())}, f)

print(f"\n✓ Saved {len(filtered)} matches to matches.json")
