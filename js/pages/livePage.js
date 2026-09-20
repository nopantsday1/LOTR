import { state } from "../core/state.js";
import { buildProfileMap, resolveLobbies } from "../services/aoeApi.js";
import {
  describeElapsed,
  describeWaiting,
  lobbyFirstSeen,
  trackLobbies
} from "../services/lobbyTracker.js";
import {
  describeLobbyAge,
  fetchLiveLobbies,
  fetchMatchesJson
} from "../services/matchesService.js";
import { toast } from "../ui/toast.js";

// With the Worker proxy configured this is a live call, so poll often enough to
// notice a lobby starting. Without it this re-reads a committed file that only
// changes every few hours, and the status line says so.
const POLL_INTERVAL_MS = 30 * 1000;

// How many recognised community members make a lobby "ours".
const MIN_COMMUNITY_IN_LOBBY = 2;

let pollTimer = null;
let lastRender = null;

export function initLivePage() {
  const button = document.getElementById("livePollNowBtn");
  if (!button) return;

  button.addEventListener("click", () => poll(true));

  // Re-render when player identities arrive, so names resolve on first load.
  window.addEventListener("lotr:dataChanged", () => {
    if (lastRender) render(lastRender.data, lastRender.finished);
  });

  poll(false);
  if (!pollTimer) {
    pollTimer = window.setInterval(() => poll(false), POLL_INTERVAL_MS);
  }
}

async function poll(manual) {
  const button = document.getElementById("livePollNowBtn");
  const status = document.getElementById("liveStatus");
  if (button) button.disabled = true;

  try {
    // matches.json is a static file, so this costs no Firestore reads. It is
    // only used to retire a tracked game once it has actually finished.
    const [data, finished] = await Promise.all([
      fetchLiveLobbies(),
      finishedGameIds().catch(() => new Set())
    ]);

    lastRender = { data, finished };
    const { waiting, inProgress } = render(data, finished);

    if (status) {
      const parts = [
        `${waiting} waiting`,
        `${inProgress} in progress`,
        `feed ${describeLobbyAge(data.lastModified, data.isLive)}`
      ];
      status.textContent = parts.join(" · ");
    }
  } catch (error) {
    console.error(error);
    if (status) {
      status.textContent =
        `Could not read the lobby feed. Last tried: ${new Date().toLocaleTimeString()}`;
    }
    if (manual) toast("Failed to check live match data", "err");
  } finally {
    if (button) button.disabled = false;
  }
}

// Match ids already recorded, so a finished game stops being reported as live.
async function finishedGameIds() {
  const data = await fetchMatchesJson();
  return new Set(
    (data.matches || [])
      .map(match => String(match.match_id || match.id || ""))
      .filter(Boolean)
  );
}

function render(data, finished) {
  const players = state.playerDatasets.original?.length
    ? state.playerDatasets.original
    : state.players || [];
  const { lobbies, community } = resolveLobbies(
    data,
    players,
    MIN_COMMUNITY_IN_LOBBY
  );

  // The Worker watches on a schedule, so it sees games start whether or not
  // anyone has this page open. Its answer wins. The browser-side tracker is
  // only a fallback for when no Worker is configured, where it can at best
  // notice a lobby vanish while someone happens to be watching.
  const local = trackLobbies(community, finished);
  const inProgress = Array.isArray(data.inProgress)
    ? fromWorker(data.inProgress, players, finished)
    : local.inProgress;

  renderInProgress(inProgress, Array.isArray(data.inProgress));
  renderWaiting(community);

  const idle = document.getElementById("liveIdle");
  if (idle) {
    const nothing = !community.length && !inProgress.length;
    idle.hidden = !nothing;
    const detail = idle.querySelector("[data-live-detail]");
    if (detail && nothing) {
      detail.textContent = lobbies.length
        ? `${lobbies.length} LOTR lobb${lobbies.length === 1 ? "y is" : "ies are"} open, but no ${MIN_COMMUNITY_IN_LOBBY}+ community members are in one.`
        : "No LOTR, BFME, or Hobbit lobbies are open right now.";
    }
  }

  return { waiting: community.length, inProgress: inProgress.length };
}

// The Worker reports raw profile ids because it knows nothing about the
// roster; resolving them here is what decides whether a game is a community
// game at all.
function fromWorker(games, players, finished) {
  const byProfile = buildProfileMap(players);

  return games
    .filter(game => !finished.has(String(game.id)))
    .map(game => {
      const roster = (game.members || []).map(profileId => {
        const player = byProfile[Number(profileId)] || null;
        return {
          name: player?.name || game.aliases?.[profileId] || `Player ${profileId}`,
          isCommunity: Boolean(player),
          playerId: player?.id || null
        };
      });
      const communityCount = roster.filter(member => member.isCommunity).length;

      return {
        id: game.id,
        description: game.description,
        roster,
        communityCount,
        memberCount: roster.length,
        startedAt: game.startedAt,
        elapsedMs: game.elapsedMs
      };
    })
    .filter(game => game.communityCount >= MIN_COMMUNITY_IN_LOBBY)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function renderInProgress(games, workerBacked) {
  const section = document.getElementById("liveInProgress");
  const list = document.getElementById("liveInProgressList");
  const meta = document.getElementById("liveInProgressMeta");
  if (!section || !list) return;

  section.hidden = !games.length;
  if (!games.length) return;

  if (meta) {
    meta.textContent = workerBacked
      ? "detected when the lobby closed"
      : "only games that started while this page was open";
  }

  list.innerHTML = games.map(game => `
    <article class="card live-game live-game-running">
      <div class="live-game-head">
        <div>
          <div class="eyebrow danger-text">Playing</div>
          <h3>${escapeHtml(game.description || "LOTR game")}</h3>
        </div>
        <div class="live-game-timer">
          <strong>${escapeHtml(describeElapsed(game.elapsedMs))}</strong>
          <span class="muted small">elapsed</span>
        </div>
      </div>
      <p class="muted small">
        ${game.communityCount} community · ${game.memberCount} players ·
        started around ${escapeHtml(new Date(game.startedAt).toLocaleTimeString())}
      </p>
      ${rosterList(game.roster)}
    </article>
  `).join("");
}

function renderWaiting(lobbies) {
  const section = document.getElementById("liveWaiting");
  const list = document.getElementById("liveWaitingList");
  const meta = document.getElementById("liveWaitingMeta");
  if (!section || !list) return;

  section.hidden = !lobbies.length;
  if (!lobbies.length) return;

  if (meta) {
    meta.textContent = `${lobbies.length} lobb${lobbies.length === 1 ? "y" : "ies"} with community players`;
  }

  list.innerHTML = lobbies.map(lobby => {
    const ids = lobby.communityMembers
      .map(member => member.player?.id)
      .filter(Boolean)
      .slice(0, 8);
    const waitedFor = describeWaiting(lobbyFirstSeen(lobby.id));
    const slots = lobby.maxplayers
      ? `${lobby.memberCount}/${lobby.maxplayers} slots`
      : `${lobby.memberCount} players`;

    return `
      <article class="card live-game">
        <div class="live-game-head">
          <div>
            <div class="eyebrow">Lobby open</div>
            <h3>${escapeHtml(lobby.description || "LOTR lobby")}</h3>
          </div>
          ${ids.length >= 2 ? `
            <a class="btn primary" href="./balance.html?players=${encodeURIComponent(ids.join(","))}">
              Balance these players
            </a>` : ""}
        </div>
        <p class="muted small">
          ${escapeHtml(slots)} · ${lobby.communityMembers.length} community
          ${waitedFor ? ` · ${escapeHtml(waitedFor)}` : ""}
        </p>
        ${rosterList(lobby.members)}
      </article>
    `;
  }).join("");
}

function rosterList(members) {
  const rows = (members || [])
    .slice()
    .sort((a, b) => Number(b.isCommunity) - Number(a.isCommunity))
    .map(member => {
      const name = escapeHtml(member.name);
      const label = member.playerId || member.player?.id
        ? `<a class="player-link" href="./profile.html?playerId=${encodeURIComponent(member.playerId || member.player.id)}">${name}</a>`
        : name;
      return `
        <div class="assignment-row">
          <span>${label}</span>
          <small class="muted">${member.isCommunity ? "community" : "guest"}</small>
        </div>
      `;
    })
    .join("");

  return `<div class="live-roster">${rows || `<p class="muted small">No players listed.</p>`}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
