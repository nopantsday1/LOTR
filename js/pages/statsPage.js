import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import { overallElo } from "../elo/elo.js";
import { fmtDuration } from "../utils/format.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function initStatsPage() {
  const overview = document.getElementById("statsOverview");
  const gamesPerDay = document.getElementById("gamesPerDay");
  const sideBalance = document.getElementById("sideBalance");
  const streaks = document.getElementById("playerStreaks");
  const records = document.getElementById("communityRecords");
  const stackers = document.getElementById("stackers");
  const funStats = document.getElementById("funStats");
  const rangeButtons = [...document.querySelectorAll("[data-range]")];
  if (!gamesPerDay) return;

  let selectedRange = "30";

  function render() {
    const matches = getMatches();
    const completed = matches.filter(match => normalizeWinner(match));

    if (overview) overview.innerHTML = renderOverview(matches, completed);
    gamesPerDay.innerHTML = renderActivity(matches, selectedRange);
    if (sideBalance) sideBalance.innerHTML = renderSideBalance(completed);
    if (streaks) streaks.innerHTML = renderStreaks(completed);
    if (records) records.innerHTML = renderRecords(completed);
    if (stackers) stackers.innerHTML = renderStackers(matches);
    if (funStats) funStats.innerHTML = renderFunFacts(matches, completed);

    rangeButtons.forEach(button => {
      button.classList.toggle("primary", button.dataset.range === selectedRange);
    });
  }

  rangeButtons.forEach(button => {
    button.addEventListener("click", () => {
      selectedRange = button.dataset.range || "30";
      render();
    });
  });

  render();
  window.addEventListener("lotr:dataChanged", render);
}

function renderOverview(matches, completed) {
  const timestamps = matches.map(matchTimestamp).filter(Number.isFinite);
  const first = timestamps.length ? Math.min(...timestamps) : null;
  const last = timestamps.length ? Math.max(...timestamps) : null;
  const spanDays = first && last ? Math.max(1, Math.round((last - first) / DAY_MS) + 1) : 0;
  const weeklyAverage = spanDays ? (matches.length / spanDays) * 7 : 0;
  const activePlayers = new Set(matches.flatMap(matchParticipants).map(playerKey).filter(Boolean)).size;

  return [
    statTile("Recorded games", matches.length, `${completed.length} with a winner`),
    statTile("Community players", activePlayers || state.players.length, `${state.players.length} rated profiles`),
    statTile("Weekly pace", formatDecimal(weeklyAverage), spanDays ? `Across ${spanDays} recorded days` : "No dated games"),
    statTile("Latest game", last ? formatDate(last) : "N/A", last ? formatRelativeDate(last) : "Waiting for history")
  ].join("");
}

function renderActivity(matches, selectedRange) {
  const datedMatches = matches
    .map(match => ({ match, timestamp: matchTimestamp(match) }))
    .filter(item => Number.isFinite(item.timestamp));

  if (!datedMatches.length) return emptyState("No dated matches are available.");

  const newest = Math.max(...datedMatches.map(item => item.timestamp));
  const oldest = Math.min(...datedMatches.map(item => item.timestamp));
  const days = selectedRange === "all"
    ? Math.max(1, Math.ceil((newest - oldest) / DAY_MS) + 1)
    : Number(selectedRange);
  const end = startOfDay(newest);
  const start = end - ((days - 1) * DAY_MS);
  const counts = new Map();

  datedMatches.forEach(({ timestamp }) => {
    const day = startOfDay(timestamp);
    if (day < start || day > end) return;
    counts.set(day, (counts.get(day) || 0) + 1);
  });

  const buckets = [];
  for (let day = start; day <= end; day += DAY_MS) {
    buckets.push({ day, count: counts.get(day) || 0 });
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const activeDays = buckets.filter(bucket => bucket.count).length;
  const visibleBuckets = buckets.length > 90
    ? combineBuckets(buckets, Math.ceil(buckets.length / 60))
    : buckets;
  const visibleMax = Math.max(1, ...visibleBuckets.map(bucket => bucket.count));

  return `
    <div class="activity-summary muted small">
      ${total} games · ${activeDays} active ${activeDays === 1 ? "day" : "days"}
    </div>
    <div class="activity-chart" style="--activity-columns:${visibleBuckets.length}">
      ${visibleBuckets.map(bucket => `
        <div class="activity-day ${!bucket.label && isWeekend(bucket.day) ? "weekend" : ""}">
          <div
            class="activity-bar ${bucket.count ? "has-games" : ""}"
            style="--bar-height:${Math.max(bucket.count ? 8 : 2, (bucket.count / visibleMax) * 100)}%"
            title="${escapeHtml(bucket.label || formatDate(bucket.day))}: ${bucket.count} games"
          ><span>${bucket.count || ""}</span></div>
          <span class="activity-day-label" aria-hidden="true">
            ${bucket.label ? "" : weekdayInitial(bucket.day)}
          </span>
        </div>
      `).join("")}
    </div>
    <div class="activity-axis muted small">
      <span>${formatDate(start)}</span>
      <span>${formatDate(end)}</span>
    </div>
  `;
}

function renderSideBalance(matches) {
  if (!matches.length) return emptyState("No completed matches are available.");

  const evilWins = matches.filter(match => normalizeWinner(match) === "evil").length;
  const goodWins = matches.filter(match => normalizeWinner(match) === "good").length;
  const evilRate = Math.round((evilWins / matches.length) * 100);
  const goodRate = 100 - evilRate;
  const leader = evilWins === goodWins
    ? "The sides are perfectly tied."
    : `${evilWins > goodWins ? "Evil" : "Good"} leads by ${Math.abs(evilWins - goodWins)} games.`;

  return `
    <div class="side-balance-score">
      <div class="side-score evil"><strong>${evilWins}</strong><span>Evil wins · ${evilRate}%</span></div>
      <div class="side-score good"><strong>${goodWins}</strong><span>Good wins · ${goodRate}%</span></div>
    </div>
    <div class="side-balance-bar" aria-label="Evil ${evilRate} percent, Good ${goodRate} percent">
      <span class="evil" style="width:${evilRate}%"></span>
      <span class="good" style="width:${goodRate}%"></span>
    </div>
    <p class="muted small">${leader}</p>
  `;
}

function renderStreaks(matches) {
  const streakData = calculateStreaks(matches);
  if (!streakData.length) return emptyState("Not enough player results for streaks.");

  const current = streakData
    .filter(item => item.currentLength > 1)
    .sort((a, b) => b.currentLength - a.currentLength)
    .slice(0, 4);
  const longest = streakData
    .sort((a, b) => b.bestLength - a.bestLength)
    .slice(0, 4);

  return `
    <div class="stats-subheading">Current streaks</div>
    <div class="stats-list">
      ${current.length ? current.map(item => statRow(
        item.name,
        `${item.currentLength}${item.currentResult === "win" ? "W" : "L"}`,
        item.currentResult === "win" ? "positive" : "negative"
      )).join("") : `<p class="muted small">No active streak longer than one game.</p>`}
    </div>
    <div class="stats-subheading">Longest streaks</div>
    <div class="stats-list">
      ${longest.map(item => statRow(
        item.name,
        `${item.bestLength}${item.bestResult === "win" ? "W" : "L"}`,
        item.bestResult === "win" ? "positive" : "negative"
      )).join("")}
    </div>
  `;
}

function renderRecords(matches) {
  if (!state.players.length) return emptyState("No player records are available.");

  const byGames = [...state.players].sort((a, b) => playerGames(b) - playerGames(a))[0];
  const byWins = [...state.players].sort((a, b) => Number(b.wins || 0) - Number(a.wins || 0))[0];
  const eligibleWinRates = state.players
    .filter(player => playerGames(player) >= 10)
    .sort((a, b) => winRate(b) - winRate(a));
  const bestWinRate = eligibleWinRates[0];
  const highestRated = [...state.players].sort((a, b) => overallElo(b) - overallElo(a))[0];

  return `
    <div class="stats-list">
      ${recordRow("Most experienced", byGames, `${playerGames(byGames)} games`)}
      ${recordRow("Most victories", byWins, `${Number(byWins?.wins || 0)} wins`)}
      ${recordRow("Best win rate", bestWinRate, bestWinRate ? `${winRate(bestWinRate)}% · min. 10 games` : "N/A")}
      ${recordRow("Highest rated", highestRated, highestRated ? `${overallElo(highestRated)} Elo` : "N/A")}
    </div>
  `;
}

function renderStackers(matches) {
  const players = calculateStackers(matches).slice(0, 5);
  if (!players.length) return emptyState("No players have 10 comparable games yet.");

  return `
    <div class="stats-list">
      ${players.map((player, index) => statRow(
        `${index + 1}. ${player.name}`,
        `${player.strongerSideGames}/${player.comparableGames} · ${player.rate}%`
      )).join("")}
    </div>
    <p class="muted small">Share of games on the higher-rated side in the active rating mode · minimum 10 games.</p>
  `;
}

function renderFunFacts(matches, completed) {
  if (!matches.length) return emptyState("Record some matches to unlock fun facts.");

  const dated = matches.filter(match => Number.isFinite(matchTimestamp(match)));
  const durations = matches
    .map(match => ({ match, seconds: matchDuration(match) }))
    .filter(item => item.seconds > 0);
  const days = new Map();

  dated.forEach(match => {
    const timestamp = matchTimestamp(match);
    const key = startOfDay(timestamp);
    days.set(key, (days.get(key) || 0) + 1);
  });

  const busiestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const longest = durations.sort((a, b) => b.seconds - a.seconds)[0];
  const teammatePair = mostFrequentPair(matches, false);
  const rivalPair = mostFrequentPair(completed, true);

  return `
    <div class="fun-facts">
      ${factCard("Dynamic duo", teammatePair
        ? `${teammatePair.names.join(" + ")} shared a team ${teammatePair.count} times`
        : "Teammate data is unavailable")}
      ${factCard("Familiar foes", rivalPair
        ? `${rivalPair.names.join(" vs ")} faced each other ${rivalPair.count} times`
        : "Opponent data is unavailable")}
      ${factCard("Busiest day", busiestDay
        ? `${formatDate(busiestDay[0])} had ${busiestDay[1]} games`
        : "Date data is unavailable")}
      ${factCard("Longest battle", longest
        ? `${fmtDuration(longest.seconds)}`
        : "Duration data is unavailable")}
    </div>
  `;
}

function calculateStackers(matches) {
  const players = new Map();

  matches.forEach(match => {
    const evilTotal = teamEloTotal(match, "evil");
    const goodTotal = teamEloTotal(match, "good");
    if (!Number.isFinite(evilTotal) || !Number.isFinite(goodTotal) || evilTotal === goodTotal) return;

    const strongerSide = evilTotal > goodTotal ? "evil" : "good";

    for (const assignment of matchParticipants(match)) {
      const key = playerKey(assignment);
      const name = assignmentName(assignment);
      const side = assignmentSide(match, assignment);
      if (!key || !name || !side) continue;

      const item = players.get(key) || {
        name,
        strongerSideGames: 0,
        comparableGames: 0
      };
      item.comparableGames++;
      if (side === strongerSide) item.strongerSideGames++;
      players.set(key, item);
    }
  });

  return [...players.values()]
    .filter(player => player.comparableGames >= 10)
    .map(player => ({
      ...player,
      rate: Math.round((player.strongerSideGames / player.comparableGames) * 100)
    }))
    .sort((a, b) => (
      (b.strongerSideGames / b.comparableGames) - (a.strongerSideGames / a.comparableGames) ||
      b.comparableGames - a.comparableGames ||
      a.name.localeCompare(b.name)
    ));
}

function calculateStreaks(matches) {
  const players = new Map();
  const chronological = [...matches].sort((a, b) => matchTimestamp(a) - matchTimestamp(b));

  chronological.forEach(match => {
    const winner = normalizeWinner(match);
    for (const assignment of matchParticipants(match)) {
      const name = assignmentName(assignment);
      const key = playerKey(assignment);
      const side = assignmentSide(match, assignment);
      if (!name || !key || !side) continue;

      const result = side === winner ? "win" : "loss";
      const item = players.get(key) || {
        name,
        currentResult: "",
        currentLength: 0,
        bestResult: "",
        bestLength: 0
      };

      item.currentLength = item.currentResult === result ? item.currentLength + 1 : 1;
      item.currentResult = result;
      if (item.currentLength > item.bestLength) {
        item.bestLength = item.currentLength;
        item.bestResult = result;
      }
      players.set(key, item);
    }
  });

  return [...players.values()];
}

function mostFrequentPair(matches, opponents) {
  const pairs = new Map();

  matches.forEach(match => {
    const evil = uniquePlayers(match.evilAssign || []);
    const good = uniquePlayers(match.goodAssign || []);
    const pairings = opponents
      ? evil.flatMap(left => good.map(right => [left, right]))
      : [...combinations(evil), ...combinations(good)];

    pairings.forEach(([left, right]) => {
      const ordered = [left, right].sort((a, b) => a.key.localeCompare(b.key));
      const key = `${ordered[0].key}|${ordered[1].key}`;
      const item = pairs.get(key) || {
        names: ordered.map(player => player.name),
        count: 0
      };
      item.count++;
      pairs.set(key, item);
    });
  });

  return [...pairs.values()].sort((a, b) => (
    b.count - a.count ||
    a.names.join("").localeCompare(b.names.join(""))
  ))[0] || null;
}

function uniquePlayers(assignments) {
  const players = new Map();
  assignments.forEach(assignment => {
    const key = playerKey(assignment);
    const name = assignmentName(assignment);
    if (key && name) players.set(key, { key, name });
  });
  return [...players.values()];
}

function combinations(players) {
  const pairs = [];
  for (let left = 0; left < players.length; left++) {
    for (let right = left + 1; right < players.length; right++) {
      pairs.push([players[left], players[right]]);
    }
  }
  return pairs;
}

function getMatches() {
  return (state.fullHistory?.length ? state.fullHistory : state.history)
    .slice()
    .sort((a, b) => matchTimestamp(b) - matchTimestamp(a));
}

function matchParticipants(match) {
  return [...(match.evilAssign || []), ...(match.goodAssign || [])];
}

function assignmentSide(match, assignment) {
  if ((match.evilAssign || []).includes(assignment)) return "evil";
  if ((match.goodAssign || []).includes(assignment)) return "good";
  return "";
}

function assignmentName(assignment) {
  return String(assignment?.name || assignment?.playerName || "").trim();
}

function playerKey(assignment) {
  return String(assignment?.profileId || assignmentName(assignment)).trim().toLocaleLowerCase();
}

function assignmentPosition(assignment) {
  const value = String(
    assignment?.civId || assignment?.civ || assignment?.civName || ""
  ).toLocaleLowerCase();
  return CIVS.find(civ => value === civ.id || value.includes(civ.id))?.id || "";
}

function normalizeWinner(match) {
  const value = String(match?.winner || match?.result || "").toLocaleLowerCase();
  if (value.includes("evil")) return "evil";
  if (value.includes("good")) return "good";
  return "";
}

function matchTimestamp(match) {
  const value = Number(match?.timestamp || Date.parse(match?.date || ""));
  if (!Number.isFinite(value) || value <= 0) return NaN;
  return value < 1e12 ? value * 1000 : value;
}

function matchDuration(match) {
  const raw = Number(match?.durationSeconds ?? match?.duration);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 100000 ? Math.round(raw / 1000) : Math.round(raw);
}

function teamEloTotal(match, side) {
  const assignments = match?.[`${side}Assign`] || [];
  const ratings = assignments.map(assignment => assignmentElo(assignment));
  if (!ratings.length || ratings.some(rating => !Number.isFinite(rating))) return NaN;
  return ratings.reduce((sum, rating) => sum + rating, 0);
}

function assignmentElo(assignment) {
  const profileId = String(assignment?.profileId || "");
  const name = assignmentName(assignment);
  const player = state.players.find(candidate => (
    (profileId && String(candidate.profileId || "") === profileId) ||
    (name && String(candidate.name || "") === name)
  ));

  if (player) return overallElo(player);
  return Number(assignment?.effElo);
}

function playerGames(player) {
  return Number(player?.gamesPlayed ?? (Number(player?.wins || 0) + Number(player?.losses || 0)));
}

function winRate(player) {
  const games = playerGames(player);
  return games ? Math.round((Number(player?.wins || 0) / games) * 100) : 0;
}

function combineBuckets(buckets, size) {
  const combined = [];
  for (let index = 0; index < buckets.length; index += size) {
    const group = buckets.slice(index, index + size);
    combined.push({
      day: group[0].day,
      label: `${formatDate(group[0].day)} - ${formatDate(group[group.length - 1].day)}`,
      count: group.reduce((sum, bucket) => sum + bucket.count, 0)
    });
  }
  return combined;
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function weekdayInitial(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: "narrow" });
}

function isWeekend(timestamp) {
  const day = new Date(timestamp).getDay();
  return day === 0 || day === 6;
}

function statTile(label, value, detail) {
  return `
    <article class="stat-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function statRow(label, value, tone = "") {
  return `
    <div class="stats-list-row">
      <span>${escapeHtml(label)}</span>
      <strong class="${tone}">${escapeHtml(value)}</strong>
    </div>
  `;
}

function recordRow(label, player, detail) {
  const name = player?.name || "N/A";
  const link = player?.id
    ? `<a class="player-link" href="./profile.html?playerId=${encodeURIComponent(player.id)}">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  return `
    <div class="record-row">
      <span class="muted small">${escapeHtml(label)}</span>
      <strong>${link}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function factCard(label, text) {
  return `
    <div class="fact-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(text)}</strong>
    </div>
  `;
}

function emptyState(message) {
  return `<p class="stats-empty muted">${escapeHtml(message)}</p>`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatRelativeDate(timestamp) {
  const days = Math.max(0, Math.round((Date.now() - timestamp) / DAY_MS));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function formatDecimal(value) {
  return Number(value || 0).toFixed(value >= 10 ? 0 : 1);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}
