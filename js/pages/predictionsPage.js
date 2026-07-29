import { state } from "../core/state.js";
import { buildBalancerBacktest } from "../elo/backtest.js";
import { safeAddDoc } from "../data/firestore.js";
import { firestoreApi as fb } from "../data/firebase.js";
import { LOCAL_SANDBOX } from "../core/config.js";
import { toast } from "../ui/toast.js";

const ROUND_SIZE = 5;

export function initPredictionsPage() {
  const root = document.getElementById("predictionGame");
  if (!root) return;

  let round = [];
  let answers = [];
  let step = 0;
  let saved = false;
  let saving = false;

  function startRound() {
    const eligible = buildBalancerBacktest(
      state.players,
      state.fullHistory?.length ? state.fullHistory : state.history
    ).matches.filter(match => match.evilPlayers?.length === 4 && match.goodPlayers?.length === 4);
    round = shuffle(eligible).slice(0, ROUND_SIZE);
    answers = [];
    step = 0;
    saved = false;
    saving = false;
    render();
  }

  function render() {
    if (round.length < ROUND_SIZE) {
      root.innerHTML = `<section class="card prediction-game-empty"><h2>Not enough games yet</h2><p class="muted">Five completed games with complete team data are needed to start a round.</p></section>`;
      return;
    }
    if (step >= ROUND_SIZE) {
      root.innerHTML = renderResults(round, answers, saved);
      root.querySelector("[data-play-again]")?.addEventListener("click", startRound);
      return;
    }
    const match = round[step];
    root.innerHTML = `
      <section class="card prediction-game-card">
        <div class="prediction-game-head">
          <div><div class="eyebrow">Prediction round</div><h2>Game ${step + 1} of ${ROUND_SIZE}</h2></div>
          <span class="prediction-progress">${answers.filter(Boolean).length}/${ROUND_SIZE} chosen</span>
        </div>
        <p class="prediction-game-date muted small">Played ${formatMatchDate(match.match)}</p>
        <p class="prediction-game-prompt">Which team wins this match?</p>
        <div class="prediction-teams">
          ${renderTeam("evil", match.evilPlayers, match.evilTotal, false)}
          ${renderTeam("good", match.goodPlayers, match.goodTotal, false)}
        </div>
        <div class="prediction-actions">
          <button class="btn prediction-choice evil" data-choice="evil">Evil wins</button>
          <button class="btn prediction-choice good" data-choice="good">Good wins</button>
        </div>
      </section>`;
    root.querySelectorAll("[data-choice]").forEach(button => button.addEventListener("click", async () => {
      answers[step] = button.dataset.choice;
      step += 1;
      if (step === ROUND_SIZE) await saveResponses();
      render();
    }));
  }

  async function saveResponses() {
    if (saved || saving) return;
    if (LOCAL_SANDBOX) return;
    saving = true;
    const roundId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    try {
      await Promise.all(round.map((match, index) => safeAddDoc(
        fb.collection(state.db, "predictionResponses"),
        {
          roundId,
          matchId: matchKey(match.match),
          prediction: answers[index],
          winner: match.winner,
          correct: answers[index] === match.winner,
          createdAt: Date.now()
        }
      )));
      saved = true;
      if (!LOCAL_SANDBOX) toast("Your five predictions were added to the community results.");
    } catch (error) {
      console.error("Could not save prediction responses", error);
      toast("Results shown, but community responses could not be saved.", "err");
    } finally {
      saving = false;
    }
  }

  startRound();
  window.addEventListener("lotr:dataChanged", () => {
    if (!round.length) startRound();
  });
}

function renderTeam(side, players, total, revealElo = true) {
  return `<section class="prediction-team ${side}">
    <div class="prediction-team-title"><h3>${side === "evil" ? "Evil" : "Good"}</h3>${revealElo ? `<strong>${Math.round(total)} Elo</strong>` : ""}</div>
    ${players.map(player => `<div class="prediction-player ${revealElo ? "" : "concealed-elo"}"><span>${escapeHtml(player.name)}</span><small>${escapeHtml(player.civ)}</small>${revealElo ? `<strong>${Math.round(player.elo)}</strong>` : ""}</div>`).join("")}
  </section>`;
}

function renderResults(round, answers, saved) {
  const correct = round.filter((match, index) => match.winner === answers[index]).length;
  return `<section class="card prediction-results">
    <div class="eyebrow">Round complete</div><h2>${correct}/${ROUND_SIZE} correct</h2>
    <p class="muted">Your answers ${saved ? "have been submitted to" : "could not be submitted to"} the community accuracy total.</p>
    <div class="prediction-result-list">${round.map((match, index) => {
      const isCorrect = answers[index] === match.winner;
      const balancerCorrect = match.correct === true;
      const edge = Math.round(Math.abs(match.evilTotal - match.goodTotal));
      return `<article class="prediction-result ${isCorrect ? "correct" : "incorrect"}">
        <div><strong>Game ${index + 1}: ${isCorrect ? "Correct" : "Incorrect"}</strong><span>${formatMatchDate(match.match)} · You chose ${capitalize(answers[index])}; ${capitalize(match.winner)} won.</span></div>
        <div class="prediction-result-metrics"><span>Balancer: <strong>${capitalize(match.predictedWinner || "tie")}</strong> ${balancerCorrect ? "&#10003;" : "&#10005;"}</span><span>${edge} Elo gap</span></div>
        <div class="prediction-result-teams">${renderTeam("evil", match.evilPlayers, match.evilTotal)}${renderTeam("good", match.goodPlayers, match.goodTotal)}</div>
      </article>`;
    }).join("")}</div>
    <button class="btn primary" data-play-again>Play another round</button>
  </section>`;
}

function shuffle(items) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
function matchKey(match) { return String(match?.gameId || match?.matchId || match?.id || match?.timestamp || "unknown"); }
function capitalize(value) { const text = String(value || ""); return text ? text[0].toUpperCase() + text.slice(1) : "Unknown"; }
function formatMatchDate(match) {
  const raw = Number(match?.timestamp || Date.parse(match?.date || ""));
  if (!Number.isFinite(raw) || raw <= 0) return "Unknown date";
  return new Date(raw < 1e12 ? raw * 1000 : raw).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
