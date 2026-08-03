import { state } from "../core/state.js";
import { CIVS } from "../core/constants.js";
import { overallElo } from "../elo/elo.js";
import {
  buildBalancerBacktest,
  summarizeBalancerBacktest
} from "../elo/backtest.js";
import { fmtDuration } from "../utils/format.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function initStatsPage() {
  const overview = document.getElementById("statsOverview");
  const gamesPerDay = document.getElementById("gamesPerDay");
  const sideBalance = document.getElementById("sideBalance");
  const sideSampleSize = document.getElementById("sideSampleSize");
  const streaks = document.getElementById("playerStreaks");
  const records = document.getElementById("communityRecords");
  const stackers = document.getElementById("stackers");
  const reverseStackers = document.getElementById("reverseStackers");
  const funStats = document.getElementById("funStats");
  const balancerPrediction = document.getElementById("balancerPrediction");
  const communityPrediction = document.getElementById("communityPrediction");
  const backtestSampleSize = document.getElementById("backtestSampleSize");
  const correlationSummary = document.getElementById("durationCorrelationSummary");
  const correlationCanvas = document.getElementById("durationCorrelationCanvas");
  const higherEloWinSummary = document.getElementById("higherEloWinSummary");
  const higherEloWinCanvas = document.getElementById("higherEloWinCanvas");
  const rangeButtons = [...document.querySelectorAll("[data-range]")];
  if (!gamesPerDay) return;

  let selectedRange = "30";
  let cachedBacktest = null;
  let displayedBacktest = null;
  let cachedPlayers = null;
  let cachedHistory = null;

  function render() {
    const matches = getMatches();
    const completed = matches.filter(match => normalizeWinner(match));
    const history = state.fullHistory?.length ? state.fullHistory : state.history;
    const sampleSize = readSampleSize(
      backtestSampleSize || sideSampleSize
    );

    if (cachedPlayers !== state.players || cachedHistory !== history) {
      cachedBacktest = buildBalancerBacktest(state.players, history);
      cachedPlayers = state.players;
      cachedHistory = history;
    }
    displayedBacktest = selectRecentBacktest(
      cachedBacktest,
      sampleSize
    );

    if (overview) overview.innerHTML = renderOverview(matches, completed);
    gamesPerDay.innerHTML = renderActivity(matches, selectedRange);
    if (sideBalance) {
      sideBalance.innerHTML = renderSideBalance(completed, sampleSize);
    }
    if (streaks) streaks.innerHTML = renderStreaks(completed);
    if (records) records.innerHTML = renderRecords(completed);
    if (stackers) stackers.innerHTML = renderStackers(matches);
    if (reverseStackers) reverseStackers.innerHTML = renderReverseStackers(matches);
    if (funStats) funStats.innerHTML = renderFunFacts(matches, completed);
    if (balancerPrediction) {
      balancerPrediction.innerHTML = renderPredictionAccuracy(displayedBacktest);
    }
    if (communityPrediction) {
      communityPrediction.innerHTML = renderCommunityPredictionAccuracy(state.communityPredictions);
    }
    if (correlationSummary) {
      correlationSummary.innerHTML = renderCorrelationSummary(displayedBacktest);
    }
    if (correlationCanvas) {
      drawDurationCorrelation(correlationCanvas, displayedBacktest);
    }
    if (higherEloWinSummary) {
      higherEloWinSummary.innerHTML = renderHigherEloWinSummary(displayedBacktest);
    }
    if (higherEloWinCanvas) {
      drawHigherEloWinRate(higherEloWinCanvas, displayedBacktest);
    }
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

  sideSampleSize?.addEventListener("input", () => {
    syncSampleSize(sideSampleSize, backtestSampleSize);
    render();
  });
  backtestSampleSize?.addEventListener("input", () => {
    syncSampleSize(backtestSampleSize, sideSampleSize);
    render();
  });

  render();
  window.addEventListener("lotr:dataChanged", render);
  window.addEventListener("resize", () => {
    if (correlationCanvas && displayedBacktest) {
      drawDurationCorrelation(correlationCanvas, displayedBacktest);
    }
    if (higherEloWinCanvas && displayedBacktest) {
      drawHigherEloWinRate(higherEloWinCanvas, displayedBacktest);
    }
  });
  window.addEventListener("lotr:themeChanged", () => {
    if (correlationCanvas && displayedBacktest) {
      drawDurationCorrelation(correlationCanvas, displayedBacktest);
    }
    if (higherEloWinCanvas && displayedBacktest) {
      drawHigherEloWinRate(higherEloWinCanvas, displayedBacktest);
    }
  });
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

function renderSideBalance(matches, sampleSize) {
  if (!matches.length) return emptyState("No completed matches are available.");

  const sample = Number.isFinite(sampleSize) ? matches.slice(0, sampleSize) : matches;
  const analysis = analyzeSideStrength(sample);
  const { evilWins, goodWins, evilRate, goodRate } = analysis;
  const leader = evilWins === goodWins
    ? "The sides are perfectly tied."
    : `${evilWins > goodWins ? "Evil" : "Good"} leads by ${Math.abs(evilWins - goodWins)} games.`;
  const sampleLabel = Number.isFinite(sampleSize)
    ? `Latest ${sample.length} of ${matches.length} completed games`
    : `All ${matches.length} completed games`;

  return `
    <div class="side-balance-score">
      <div class="side-score evil">
        <strong>${evilWins}</strong>
        <span>Evil wins · ${evilRate}% WR</span>
        <small>${formatAnalysisNumber(analysis.evilAvgElo)} avg effective Elo</small>
      </div>
      <div class="side-score good">
        <strong>${goodWins}</strong>
        <span>Good wins · ${goodRate}% WR</span>
        <small>${formatAnalysisNumber(analysis.goodAvgElo)} avg effective Elo</small>
      </div>
    </div>
    <div class="side-balance-bar" aria-label="Evil ${evilRate} percent, Good ${goodRate} percent">
      <span class="evil" style="width:${evilRate}%"></span>
      <span class="good" style="width:${goodRate}%"></span>
    </div>
    <div class="side-analysis-grid">
      ${analysisTile("Sample", sampleLabel)}
      ${analysisTile("Average Elo edge", analysis.averageEdgeLabel)}
      ${analysisTile("Elo samples", `${analysis.eloMatchCount}/${sample.length}`)}
      ${analysisTile("Average gap", analysis.averageGapLabel)}
    </div>
    <p class="muted small">${leader}</p>
  `;
}

function readSampleSize(input) {
  const value = Number(input?.value);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : NaN;
}

function syncSampleSize(source, target) {
  if (source && target) target.value = source.value;
}

function selectRecentBacktest(backtest, sampleSize) {
  if (!backtest?.matches) return summarizeBalancerBacktest([]);
  if (!Number.isFinite(sampleSize)) return backtest;
  return summarizeBalancerBacktest(backtest.matches.slice(-sampleSize));
}

function analyzeSideStrength(matches) {
  const evilWins = matches.filter(match => normalizeWinner(match) === "evil").length;
  const goodWins = matches.filter(match => normalizeWinner(match) === "good").length;
  const total = Math.max(1, matches.length);
  const eloMatches = matches
    .map(match => ({
      match,
      winner: normalizeWinner(match),
      evilTotal: teamEloTotal(match, "evil"),
      goodTotal: teamEloTotal(match, "good")
    }))
    .filter(item => Number.isFinite(item.evilTotal) && Number.isFinite(item.goodTotal));

  const evilAvgElo = average(eloMatches.map(item => item.evilTotal));
  const goodAvgElo = average(eloMatches.map(item => item.goodTotal));
  const averageGap = average(eloMatches.map(item => Math.abs(item.evilTotal - item.goodTotal)));
  const edge = Number.isFinite(goodAvgElo) && Number.isFinite(evilAvgElo)
    ? goodAvgElo - evilAvgElo
    : NaN;
  return {
    evilWins,
    goodWins,
    evilRate: Math.round((evilWins / total) * 100),
    goodRate: Math.round((goodWins / total) * 100),
    evilAvgElo,
    goodAvgElo,
    eloMatchCount: eloMatches.length,
    averageEdgeLabel: formatAverageEdge(edge),
    averageGapLabel: Number.isFinite(averageGap) ? `${Math.round(averageGap)} Elo` : "N/A"
  };
}

function formatAverageEdge(edge) {
  if (!Number.isFinite(edge)) return "N/A";
  if (!edge) return "Even";
  return `${edge > 0 ? "Good" : "Evil"} +${Math.round(Math.abs(edge))} Elo`;
}

function formatAnalysisNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : "N/A";
}

function analysisTile(label, value) {
  return `
    <div class="side-analysis-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderPredictionAccuracy(backtest) {
  const prediction = backtest?.prediction;
  if (!prediction?.comparable) {
    return emptyState("Not enough complete matches for a prediction backtest.");
  }

  const accuracy = prediction.accuracy * 100;
  const weightedAccuracy = prediction.weightedAccuracy * 100;

  return `
    <p class="prediction-description">
      Before each match, the team with the higher combined Balancer Elo is
      predicted to win. Standard accuracy counts every game equally.
    </p>
    <div class="prediction-metrics">
      <div class="prediction-score">
        <strong>${accuracy.toFixed(1)}%</strong>
        <span>standard accuracy</span>
      </div>
      <div class="prediction-score weighted">
        <strong>${Number.isFinite(weightedAccuracy) ? `${weightedAccuracy.toFixed(1)}%` : "N/A"}</strong>
        <span>confidence-weighted</span>
      </div>
    </div>
    <div class="prediction-bar" aria-label="${accuracy.toFixed(1)} percent correct">
      <span class="correct" style="width:${accuracy}%"></span>
      <span class="incorrect" style="width:${100 - accuracy}%"></span>
    </div>
    <div class="prediction-counts">
      <span><strong class="positive">${prediction.correct}</strong> correct</span>
      <span><strong class="negative">${prediction.incorrect}</strong> incorrect</span>
      ${prediction.ties ? `<span>${prediction.ties} tied</span>` : ""}
    </div>
    <p class="muted small prediction-weight-note">
      Confidence-weighted accuracy gives almost-even games little influence
      and gives larger predicted Elo advantages more influence.
    </p>
    <p class="muted small">
      ${backtest.matches.length} most recent eligible ${backtest.matches.length === 1 ? "game" : "games"} analyzed.
    </p>
  `;
}

function renderCommunityPredictionAccuracy(responses) {
  const valid = (responses || []).filter(response => (
    (response.prediction === "evil" || response.prediction === "good") &&
    (response.winner === "evil" || response.winner === "good")
  ));
  if (!valid.length) {
    return `<div class="community-prediction-heading"><div><div class="eyebrow">Community picks</div><h3>Community Prediction Accuracy</h3></div></div>${emptyState("No community predictions have been submitted yet.")}`;
  }
  const correct = valid.filter(response => response.prediction === response.winner).length;
  const accuracy = (correct / valid.length) * 100;
  return `
    <div class="community-prediction-heading"><div><div class="eyebrow">Community picks</div><h3>Community Prediction Accuracy</h3></div><strong>${accuracy.toFixed(1)}%</strong></div>
    <p class="prediction-description">Every submitted answer from Match Oracle, across all visitors and devices.</p>
    <div class="prediction-bar" aria-label="Community prediction accuracy ${accuracy.toFixed(1)} percent">
      <span class="correct" style="width:${accuracy}%"></span><span class="incorrect" style="width:${100 - accuracy}%"></span>
    </div>
    <div class="prediction-counts"><span><strong class="positive">${correct}</strong> correct</span><span><strong class="negative">${valid.length - correct}</strong> incorrect</span><span>${valid.length} total picks</span></div>
  `;
}

function renderCorrelationSummary(backtest) {
  const duration = backtest?.duration;
  if (!Number.isFinite(duration?.correlation)) return "";

  const minutesPerHundred = duration.slopeSecondsPerElo * 100 / 60;

  return `
    <span>
      <small>Correlation</small>
      <strong>${formatSignedDecimal(duration.correlation, 2)}</strong>
    </span>
    <span>
      <small>Per 100 Elo</small>
      <strong>${formatSignedDecimal(minutesPerHundred, 1)} min</strong>
    </span>
  `;
}

function renderHigherEloWinSummary(backtest) {
  const prediction = backtest?.prediction;
  if (!prediction?.comparable) return "";

  return `
    <span>
      <small>Higher-Elo wins</small>
      <strong>${(prediction.accuracy * 100).toFixed(1)}%</strong>
    </span>
    <span>
      <small>Matches</small>
      <strong>${prediction.comparable}</strong>
    </span>
  `;
}

function drawHigherEloWinRate(canvas, backtest) {
  const width = Math.max(280, Math.round(canvas.clientWidth || 1100));
  const height = Math.max(240, Math.round(canvas.clientHeight || 360));
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const matches = (backtest?.matches || []).filter(match => match.predictedWinner);
  if (!matches.length) {
    ctx.fillStyle = themeColor("--muted", "#918d84");
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Not enough complete matches", width / 2, height / 2);
    return;
  }

  const padding = {
    top: 24,
    right: width < 600 ? 18 : 28,
    bottom: 52,
    left: width < 600 ? 48 : 62
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const gap95 = percentile(matches.map(match => match.eloGap), 0.95);
  const step = niceStep(Math.max(gap95, 100) / 6);
  const xMax = Math.max(step, Math.ceil(gap95 / step) * step);
  const bins = buildHigherEloBins(matches, step, xMax);
  const xAt = value => padding.left + (value / xMax) * plotWidth;
  const yAt = value => padding.top + (1 - value) * plotHeight;

  ctx.strokeStyle = themeColor("--chart-grid", "rgba(236,229,215,.1)");
  ctx.fillStyle = themeColor("--muted", "#918d84");
  ctx.lineWidth = 1;
  ctx.font = `${width < 600 ? 9 : 11}px system-ui`;
  for (let percent = 0; percent <= 100; percent += 25) {
    const y = yAt(percent / 100);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(`${percent}%`, padding.left - 9, y + 4);
  }
  for (let value = 0; value <= xMax; value += step) {
    const x = xAt(value);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.textAlign = value === 0 ? "left" : value === xMax ? "right" : "center";
    ctx.fillText(String(Math.round(value)), x, height - 25);
  }
  ctx.textAlign = "center";
  ctx.fillText("Pre-match Balancer Elo gap (higher team ahead)", padding.left + plotWidth / 2, height - 6);

  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = themeColor("--gold-bright", "#f0bd72");
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let value = 0; value <= xMax; value += xMax / 80) {
    const probability = 1 / (1 + Math.pow(10, -value / 1600));
    if (value === 0) ctx.moveTo(xAt(value), yAt(probability));
    else ctx.lineTo(xAt(value), yAt(probability));
  }
  ctx.stroke();
  ctx.restore();

  const observed = bins.filter(bin => bin.games);
  if (observed.length) {
    ctx.strokeStyle = themeColor("--good", "#5bb89d");
    ctx.lineWidth = 3;
    ctx.beginPath();
    observed.forEach((bin, index) => {
      const x = xAt(bin.center);
      const y = yAt(bin.winRate);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    for (const bin of observed) {
      const x = xAt(bin.center);
      const y = yAt(bin.winRate);
      ctx.fillStyle = themeColor("--good", "#5bb89d");
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = themeColor("--muted", "#918d84");
      ctx.font = `${width < 600 ? 8 : 9}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(`n=${bin.games}`, x, Math.min(height - padding.bottom - 4, y + 16));
    }
  }
}

function buildHigherEloBins(matches, step, xMax) {
  const bins = Array.from({ length: Math.max(1, Math.ceil(xMax / step)) }, (_, index) => ({
    center: (index + 0.5) * step,
    games: 0,
    wins: 0
  }));
  matches.forEach(match => {
    const index = Math.min(bins.length - 1, Math.floor(match.eloGap / step));
    bins[index].games++;
    if (match.correct) bins[index].wins++;
  });
  return bins.map(bin => ({
    ...bin,
    winRate: bin.games ? bin.wins / bin.games : NaN
  }));
}

function drawDurationCorrelation(canvas, backtest) {
  const width = Math.max(280, Math.round(canvas.clientWidth || 1100));
  const height = Math.max(240, Math.round(canvas.clientHeight || 360));
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const matches = backtest?.duration?.matches || [];

  ctx.clearRect(0, 0, width, height);

  if (matches.length < 2) {
    ctx.fillStyle = themeColor("--muted", "#918d84");
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Not enough complete matches", width / 2, height / 2);
    return;
  }

  const padding = {
    top: 24,
    right: width < 600 ? 18 : 28,
    bottom: 48,
    left: width < 600 ? 52 : 68
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const gap95 = percentile(matches.map(match => match.eloGap), 0.95);
  const duration95 = percentile(
    matches.map(match => match.durationSeconds),
    0.95
  );
  const xStep = niceStep(gap95 / 5);
  const xMax = Math.max(xStep, Math.ceil(gap95 / xStep) * xStep);
  const yStep = duration95 > 5400 ? 1800 : 900;
  const yMax = Math.max(yStep, Math.ceil(duration95 / yStep) * yStep);
  const xAt = value =>
    padding.left + (Math.min(value, xMax) / xMax) * plotWidth;
  const yAt = value =>
    padding.top + (1 - Math.min(value, yMax) / yMax) * plotHeight;

  ctx.strokeStyle = themeColor("--chart-grid", "rgba(236,229,215,.1)");
  ctx.fillStyle = themeColor("--muted", "#918d84");
  ctx.lineWidth = 1;
  ctx.font = `${width < 600 ? 9 : 11}px system-ui`;

  for (let value = 0; value <= xMax; value += xStep) {
    const x = xAt(value);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.textAlign = value === 0 ? "left" : value === xMax ? "right" : "center";
    ctx.fillText(String(Math.round(value)), x, height - 24);
  }

  for (let value = 0; value <= yMax; value += yStep) {
    const y = yAt(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(value / 60)}m`, padding.left - 10, y + 4);
  }

  ctx.fillStyle = themeColor("--muted", "#918d84");
  ctx.textAlign = "center";
  ctx.fillText(
    "Pre-match Balancer Elo gap",
    padding.left + plotWidth / 2,
    height - 6
  );

  const visibleMatches = matches.filter(match =>
    match.eloGap <= xMax && match.durationSeconds <= yMax
  );

  for (const match of visibleMatches) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = match.correct
      ? themeColor("--good", "#5bb89d")
      : themeColor("--evil", "#df7278");
    ctx.beginPath();
    ctx.arc(xAt(match.eloGap), yAt(match.durationSeconds), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const slope = backtest.duration.slopeSecondsPerElo;
  const intercept = backtest.duration.interceptSeconds;
  if (Number.isFinite(slope) && Number.isFinite(intercept)) {
    const startY = Math.max(0, Math.min(yMax, intercept));
    const endY = Math.max(0, Math.min(yMax, intercept + slope * xMax));
    ctx.strokeStyle = themeColor("--gold-bright", "#f0bd72");
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(startY));
    ctx.lineTo(xAt(xMax), yAt(endY));
    ctx.stroke();
  }
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return multiplier * magnitude;
}

function formatSignedDecimal(value, digits) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function themeColor(variable, fallback) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim() || fallback;
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
  const players = calculateStackers(matches);
  if (!players.length) return emptyState("No players have 10 comparable games yet.");

  return `
    ${renderStackerList(players.slice(0, 5), "stronger")}
    <p class="muted small">Share of games on the higher-rated pre-game side · minimum 10 games.</p>
  `;
}

function renderReverseStackers(matches) {
  const players = calculateStackers(matches);
  const reverseStackers = [...players]
    .sort((a, b) => (
      b.weakerRateValue - a.weakerRateValue ||
      b.comparableGames - a.comparableGames ||
      a.name.localeCompare(b.name)
    ))
    .slice(0, 5);

  if (!players.length) return emptyState("No players have 10 comparable games yet.");

  return `
    ${renderStackerList(reverseStackers, "weaker")}
    <p class="muted small">Share of games on the lower-rated pre-game side · minimum 10 games.</p>
  `;
}

function renderStackerList(players, side) {
  return `
    <div class="stats-list">
      ${players.map((player, index) => statRow(
        `${index + 1}. ${player.name}`,
        side === "stronger"
          ? `${player.strongerSideGames}/${player.comparableGames} · ${player.strongerRate}%`
          : `${player.weakerSideGames}/${player.comparableGames} · ${player.weakerRate}%`
      )).join("")}
    </div>
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
      weakerSideGames: player.comparableGames - player.strongerSideGames,
      strongerRateValue: player.strongerSideGames / player.comparableGames,
      weakerRateValue: (player.comparableGames - player.strongerSideGames) / player.comparableGames,
      strongerRate: Math.round((player.strongerSideGames / player.comparableGames) * 100),
      weakerRate: Math.round(((player.comparableGames - player.strongerSideGames) / player.comparableGames) * 100)
    }))
    .sort((a, b) => (
      b.strongerRateValue - a.strongerRateValue ||
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
  const storedTotal = Number(match?.[`${side}Total`]);
  if (Number.isFinite(storedTotal)) return storedTotal;

  const assignments = match?.[`${side}Assign`] || [];
  const ratings = assignments.map(assignment => Number(assignment?.effElo));
  if (!ratings.length || ratings.some(rating => !Number.isFinite(rating))) return NaN;
  return ratings.reduce((sum, rating) => sum + rating, 0);
}

function playerGames(player) {
  return Number(player?.gamesPlayed ?? (Number(player?.wins || 0) + Number(player?.losses || 0)));
}

function winRate(player) {
  const games = playerGames(player);
  return games ? Math.round((Number(player?.wins || 0) / games) * 100) : 0;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : NaN;
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
