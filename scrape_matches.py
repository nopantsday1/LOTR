import requests, json, time, re, os
from bs4 import BeautifulSoup

FIREBASE_URL = "https://firestore.googleapis.com/v1/projects/lotr-9a2f2/databases/(default)/documents/players"
SCENARIO_KEYWORDS = ['hobbit', 'lotr', 'lord of the ring', 'bfme', 'the shire']
THREE_MONTHS = int(time.time()) - 90*24*60*60

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def parse_time_ago(text):
    now = int(time.time())
    m = re.search(r'(\d+)\s*(second|minute|hour|day|week|month|year)', text.lower())
    if not m:
        return now
    n, unit = int(m.group(1)), m.group(2)
    mult = {'second':1,'minute':60,'hour':3600,'day':86400,
            'week':604800,'month':2592000,'year':31536000}
    return now - n * mult.get(unit, 86400)

def scrape_matches_from_page(html):
    """
    Parse one aoe2insights match-list page.
    Returns (list_of_matches, stop_paging).
    stop_paging=True when a match older than 3 months is found.
    """
    soup = BeautifulSoup(html, 'lxml')
    results = []
    stop = False

    match_links = soup.find_all('a', href=re.compile(r'^/match/\d+/?$'))
    seen_mids = set()

    for link in match_links:
        mid_m = re.search(r'/match/(\d+)', link['href'])
        if not mid_m:
            continue
        mid = mid_m.group(1)
        if mid in seen_mids:
            continue
        seen_mids.add(mid)

        # Walk up to find the match container that has a map-name element
        container = link.parent
        for _ in range(8):
            if container is None:
                break
            map_div = container.find(class_=re.compile(r'map.?name', re.I))
            if map_div:
                map_text = map_div.get_text().lower()
                is_lotr = any(kw in map_text for kw in SCENARIO_KEYWORDS)

                # Check timestamp
                ts_el = container.find(
                    string=re.compile(r'\d+\s*(day|week|month|hour|minute|year)', re.I))
                ts = parse_time_ago(ts_el) if ts_el else int(time.time())
                if ts < THREE_MONTHS:
                    stop = True
                    break

                if not is_lotr:
                    break  # Not a LOTR game, move on

                # Extract players grouped by team
                members = []
                seen_pids = set()
                team_divs = container.find_all(class_=re.compile(r'\bteam\b', re.I))
                for team_div in team_divs:
                    cls = ' '.join(team_div.get('class', []))
                    team_num = -1
                    tm = re.search(r'team.?(\d)', cls)
                    if tm:
                        team_num = int(tm.group(1))
                    won = 'winner' in cls.lower()

                    for pl_link in team_div.find_all('a', href=re.compile(r'/user/\d+/')):
                        pid_m = re.search(r'/user/(\d+)/', pl_link['href'])
                        if not pid_m:
                            continue
                        pid = pid_m.group(1)
                        if pid in seen_pids:
                            continue
                        seen_pids.add(pid)
                        members.append({
                            'profile_id': pid,
                            'teamid': team_num,
                            'resulttype': 1 if won else 2,
                            'civilization_id': -1,
                        })

                if members:
                    results.append({
                        'match_id': mid,
                        'completiontime': ts,
                        'startgametime': ts,
                        'matchhistorymember': members,
                    })
                break
            container = container.parent

        if stop:
            break

    return results, stop

# ── Load players from Firestore ───────────────────────────────────────────────

try:
    r = requests.get(FIREBASE_URL, timeout=10)
    docs = r.json().get('documents', [])
    players = []
    for doc in docs:
        f = doc.get('fields', {})
        pid = (f.get('profileId', {}).get('integerValue') or
               f.get('profileId', {}).get('stringValue'))
        name = f.get('name', {}).get('stringValue', 'Unknown')
        if pid:
            players.append({'name': name, 'profileId': int(pid)})
    print(f"Loaded {len(players)} players with profile IDs")
except Exception as e:
    print(f"Failed to load players: {e}")
    raise SystemExit(1)

community_ids = {str(p['profileId']) for p in players}

# ── Load existing matches.json ────────────────────────────────────────────────

match_map = {}
if os.path.exists('matches.json'):
    try:
        with open('matches.json') as f:
            old = json.load(f)
        for m in old.get('matches', []):
            match_map[str(m['match_id'])] = m
        print(f"Loaded {len(match_map)} existing cached matches")
    except Exception as e:
        print(f"Could not read existing matches.json: {e}")

# ── Scrape each player's match history ───────────────────────────────────────

session = requests.Session()
session.headers.update(HEADERS)

for player in players:
    pid = player['profileId']
    name = player['name']
    new_for_player = 0
    print(f"\nScraping {name} ({pid})...")

    for page_num in range(1, 100):
        url = f'https://www.aoe2insights.com/user/{pid}/matches/?page={page_num}'
        try:
            r = session.get(url, timeout=20)
            if r.status_code == 404:
                print(f"  page {page_num}: 404, done")
                break
            if r.status_code != 200:
                print(f"  page {page_num}: HTTP {r.status_code}, skipping")
                break

            page_matches, stop = scrape_matches_from_page(r.text)

            for m in page_matches:
                mid = str(m['match_id'])
                # Only keep if has 4+ community members
                comm = [x for x in m['matchhistorymember']
                        if str(x['profile_id']) in community_ids]
                if len(comm) < 4:
                    continue
                if mid not in match_map:
                    m['matchhistorymember'] = comm
                    match_map[mid] = m
                    new_for_player += 1
                else:
                    # Merge any new community members we haven't seen
                    existing_pids = {str(x['profile_id'])
                                     for x in match_map[mid]['matchhistorymember']}
                    for mem in comm:
                        if str(mem['profile_id']) not in existing_pids:
                            match_map[mid]['matchhistorymember'].append(mem)
                            existing_pids.add(str(mem['profile_id']))

            print(f"  page {page_num}: {len(page_matches)} LOTR matches ({new_for_player} new total)")

            if stop or len(page_matches) == 0:
                break

            time.sleep(1.5)

        except Exception as e:
            print(f"  page {page_num}: error — {e}")
            break

    time.sleep(2)

# ── Save ──────────────────────────────────────────────────────────────────────

output = {'matches': list(match_map.values()), 'updated': int(time.time())}
with open('matches.json', 'w') as f:
    json.dump(output, f)

total = len(match_map)
print(f"\n✓ Saved {total} total LOTR matches to matches.json")