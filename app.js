const API = "https://api.coingecko.com/api/v3";
const STORE_KEY = "bitcoin-sentinel-session-v1";

const el = {
  price: document.getElementById("price"),
  change24h: document.getElementById("change-24h"),
  spreadStatus: document.getElementById("spread-status"),
  monitorState: document.getElementById("monitor-state"),
  lastUpdated: document.getElementById("last-updated"),
  signalTitle: document.getElementById("signal-title"),
  signalCopy: document.getElementById("signal-copy"),
  decisionCard: document.getElementById("decision-card"),
  support: document.getElementById("support"),
  resistance: document.getElementById("resistance"),
  sampleCount: document.getElementById("sample-count"),
  score: document.getElementById("score"),
  scoreBar: document.getElementById("score-bar"),
  buyScore: document.getElementById("buy-score"),
  sellScore: document.getElementById("sell-score"),
  buyReason: document.getElementById("buy-reason"),
  sellReason: document.getElementById("sell-reason"),
  rsi: document.getElementById("rsi"),
  trend: document.getElementById("trend"),
  curve: document.getElementById("curve"),
  volatility: document.getElementById("volatility"),
  confidence: document.getElementById("confidence"),
  learnedRange: document.getElementById("learned-range"),
  ruleList: document.getElementById("rule-list"),
  timeline: document.getElementById("timeline"),
  buyTests: document.getElementById("buy-tests"),
  sellTests: document.getElementById("sell-tests"),
  scalpTarget: document.getElementById("scalp-target"),
  clearHistory: document.getElementById("clear-history"),
  refreshRate: document.getElementById("refresh-rate"),
  threshold: document.getElementById("threshold"),
  thresholdLabel: document.getElementById("threshold-label"),
  alertsEnabled: document.getElementById("alerts-enabled"),
  apiStatus: document.getElementById("api-status"),
  toast: document.getElementById("toast"),
  toastClose: document.getElementById("toast-close"),
  toastType: document.getElementById("toast-type"),
  toastTitle: document.getElementById("toast-title"),
  toastBody: document.getElementById("toast-body"),
  toastTime: document.getElementById("toast-time"),
  chart: document.getElementById("price-chart"),
  rangeButtons: document.getElementById("range-buttons")
};

const state = {
  rangeDays: 1,
  timer: null,
  isFetching: false,
  wakeLock: null,
  wakeWanted: true,
  samples: restoreSamples(),
  historical: [],
  lastSignal: "",
  lastStatusNotice: 0,
  activeNoticeKind: "",
  noticeTimer: null
};

const ctx = el.chart.getContext("2d");

async function requestWakeLock() {
  if (!state.wakeWanted || !("wakeLock" in navigator)) {
    if (!("wakeLock" in navigator)) el.monitorState.textContent = el.monitorState.textContent === "Starting" ? "Wake best-effort" : el.monitorState.textContent;
    return;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

function keepScreenAwake() {
  requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });
  window.addEventListener("focus", requestWakeLock);
  window.addEventListener("pointerdown", requestWakeLock, { passive: true });
  window.addEventListener("touchstart", requestWakeLock, { passive: true });
}

function money(value) {
  if (!Number.isFinite(value)) return "$--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function restoreSamples() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(item => Number.isFinite(item.price) && Number.isFinite(item.time)).slice(-720) : [];
  } catch {
    return [];
  }
}

function persistSamples() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.samples.slice(-720)));
}

function addSample(price) {
  const last = state.samples[state.samples.length - 1];
  if (!last || Math.abs(last.price - price) > 0.01 || Date.now() - last.time > 20000) {
    state.samples.push({ time: Date.now(), price });
    state.samples = state.samples.slice(-720);
    persistSamples();
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function refreshAll() {
  if (state.isFetching) return;
  state.isFetching = true;
  el.monitorState.textContent = "Scanning";
  try {
    const [market, chart] = await Promise.all([
      fetchJson(`${API}/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=24h`),
      fetchJson(`${API}/coins/bitcoin/market_chart?vs_currency=usd&days=${state.rangeDays}`)
    ]);

    const btc = market[0];
    state.historical = (chart.prices || []).map(([time, price]) => ({ time, price }));
    addSample(Number(btc.current_price));
    render(btc);
    el.apiStatus.textContent = "Connected";
    el.monitorState.textContent = "Live";
    el.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  } catch (error) {
    el.apiStatus.textContent = error.message;
    el.monitorState.textContent = "Offline";
    el.spreadStatus.textContent = "Using stored session data";
    render();
  } finally {
    state.isFetching = false;
  }
}

function pricesForAnalysis() {
  const merged = [...state.historical, ...state.samples];
  const unique = new Map();
  merged.forEach(item => unique.set(Math.round(item.time / 1000), item));
  return [...unique.values()].sort((a, b) => a.time - b.time).slice(-500);
}

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function calcRsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function calcRangeStats(values) {
  const recent = values.slice(-160);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const current = values.at(-1);
  const span = Math.max(high - low, 1);
  const position = ((current - low) / span) * 100;
  const rangePct = (span / Math.max(current, 1)) * 100;
  return { low, high, span, position, rangePct };
}

function runBacktest(points, scalpTargetPct) {
  if (points.length < 40) {
    return { buyWins: 0, buyTotal: 0, sellWins: 0, sellTotal: 0 };
  }

  let buyWins = 0;
  let buyTotal = 0;
  let sellWins = 0;
  let sellTotal = 0;
  const lookback = 24;
  const forward = 12;

  for (let i = lookback; i < points.length - forward; i++) {
    const window = points.slice(i - lookback, i + 1).map(point => point.price);
    const low = Math.min(...window);
    const high = Math.max(...window);
    const span = Math.max(high - low, 1);
    const price = points[i].price;
    const pos = ((price - low) / span) * 100;
    const future = points.slice(i + 1, i + 1 + forward).map(point => point.price);
    const futureHigh = Math.max(...future);
    const futureLow = Math.min(...future);

    if (pos <= 28) {
      buyTotal++;
      if (((futureHigh - price) / price) * 100 >= scalpTargetPct) buyWins++;
    }
    if (pos >= 72) {
      sellTotal++;
      if (((price - futureLow) / price) * 100 >= scalpTargetPct) sellWins++;
    }
  }

  return { buyWins, buyTotal, sellWins, sellTotal };
}

function analyze() {
  const points = pricesForAnalysis();
  const values = points.map(point => point.price);
  const current = values.at(-1);
  if (values.length < 18) {
    const support = values.length ? Math.min(...values) : NaN;
    const resistance = values.length ? Math.max(...values) : NaN;
    return {
      score: 45,
      buyScore: 45,
      sellScore: 45,
      status: "Warming up",
      tone: "wait",
      copy: "Keep the dashboard open so it can collect enough live samples for stronger timing calls.",
      rules: [{ title: "Need more samples", detail: `${values.length} price points loaded. More points improve momentum and curve reads.` }],
      support,
      resistance,
      rsi: null,
      trend: 0,
      curve: 0,
      volatility: 0,
      confidence: Math.min(25, Math.round(values.length * 1.3)),
      rangePosition: 50,
      learnedRangePct: 0,
      buyReason: "Collecting lows",
      sellReason: "Collecting highs",
      scalpTarget: 0,
      backtest: runBacktest(points, .15)
    };
  }

  const fast = ema(values, 8);
  const slow = ema(values, 21);
  const fastNow = fast.at(-1);
  const slowNow = slow.at(-1);
  const previousFast = fast.at(-5) || fast[0];
  const previousSlow = slow.at(-5) || slow[0];
  const trendPct = ((fastNow - slowNow) / current) * 100;
  const curvePct = (((fastNow - previousFast) - (slowNow - previousSlow)) / current) * 100;
  const rsi = calcRsi(values);
  const recent = values.slice(-80);
  const support = Math.min(...recent);
  const resistance = Math.max(...recent);
  const vol = (standardDeviation(recent) / current) * 100;
  const range = calcRangeStats(values);
  const distanceFromSupport = ((current - support) / Math.max(support, 1)) * 100;
  const distanceFromResistance = ((resistance - current) / Math.max(current, 1)) * 100;
  const confidence = Math.round(clamp(28 + Math.log2(values.length) * 9 + Math.min(state.samples.length, 240) / 8, 20, 96));
  const scalpTarget = Math.max(.12, Math.min(.85, vol * .42));
  const backtest = runBacktest(points, scalpTarget);

  let buyScore = 50;
  let sellScore = 50;
  const rules = [];

  if (rsi !== null && rsi < 32) {
    buyScore += 18;
    sellScore -= 10;
    rules.push({ title: "Oversold pressure", detail: `RSI ${rsi.toFixed(1)} suggests sellers may be stretched.` });
  } else if (rsi !== null && rsi > 70) {
    sellScore += 18;
    buyScore -= 18;
    rules.push({ title: "Overheated", detail: `RSI ${rsi.toFixed(1)} means a chase buy is riskier right now.` });
  } else {
    rules.push({ title: "RSI balanced", detail: `RSI ${rsi ? rsi.toFixed(1) : "--"} is not at an extreme.` });
  }

  if (distanceFromSupport < .35) {
    buyScore += 20;
    sellScore -= 8;
    rules.push({ title: "Near support", detail: `Price is only ${distanceFromSupport.toFixed(2)}% above recent support.` });
  } else if (distanceFromResistance < .35) {
    sellScore += 18;
    buyScore -= 12;
    rules.push({ title: "Near resistance", detail: `Only ${distanceFromResistance.toFixed(2)}% below resistance; upside may be crowded.` });
  }

  if (range.position <= 25) {
    buyScore += 16;
    rules.push({ title: "Learned low zone", detail: `BTC is in the bottom ${range.position.toFixed(0)}% of the learned range.` });
  } else if (range.position >= 75) {
    sellScore += 16;
    rules.push({ title: "Learned high zone", detail: `BTC is in the top ${(100 - range.position).toFixed(0)}% of the learned range.` });
  }

  if (trendPct > .04 && curvePct > 0) {
    buyScore += 14;
    sellScore -= 7;
    rules.push({ title: "Trend turning up", detail: "Fast path is above the slow path and curve is improving." });
  } else if (trendPct < -.04 && curvePct < 0) {
    sellScore += 12;
    buyScore -= 8;
    rules.push({ title: "Trend still fading", detail: "The live path is still bending down, so patience is cleaner." });
  }

  if (curvePct < -.015 && range.position > 60) sellScore += 10;
  if (curvePct > .015 && range.position < 40) buyScore += 10;

  if (vol > 2.2) {
    buyScore -= 5;
    sellScore -= 5;
    rules.push({ title: "High chop", detail: `Volatility is ${vol.toFixed(2)}%, so size and timing matter more.` });
  } else if (vol > .35) {
    buyScore += 5;
    sellScore += 5;
    rules.push({ title: "Tradable movement", detail: `Volatility is ${vol.toFixed(2)}%, enough movement for small repeated swings.` });
  }

  buyScore = Math.round(clamp(buyScore));
  sellScore = Math.round(clamp(sellScore));
  const score = Math.max(buyScore, sellScore);
  const threshold = Number(el.threshold.value);
  let status = "Hold";
  let tone = "wait";
  let copy = "No clean edge yet. The model is waiting for either a better dip buy or a stronger take-profit zone.";
  if (buyScore >= threshold && buyScore >= sellScore + 5) {
    status = "Buy Window";
    tone = "buy";
    copy = `BTC is low enough in its learned range with improving conditions. Target small moves around ${scalpTarget.toFixed(2)}% unless momentum expands.`;
  } else if (sellScore >= threshold && sellScore > buyScore) {
    status = "Sell / Take Profit";
    tone = "risk";
    copy = `BTC is near a learned high or momentum is cooling. This is a take-profit / avoid-chasing signal.`;
  } else if (buyScore < 38 && sellScore < 45) {
    status = "No Trade";
    tone = "wait";
    copy = "The read is messy. Sitting out is cleaner than forcing a tiny scalp.";
  }

  return {
    score,
    buyScore,
    sellScore,
    status,
    tone,
    copy,
    rules,
    support,
    resistance,
    rsi,
    trend: trendPct,
    curve: curvePct,
    volatility: vol,
    confidence,
    rangePosition: range.position,
    learnedRangePct: range.rangePct,
    buyReason: range.position < 35 ? "Near learned lows" : curvePct > 0 ? "Curve improving" : "Waiting for dip",
    sellReason: range.position > 65 ? "Near learned highs" : curvePct < 0 ? "Curve fading" : "Waiting for rip",
    scalpTarget,
    backtest
  };
}

function render(market) {
  const analysis = analyze();
  const points = pricesForAnalysis();
  const latest = market?.current_price || points.at(-1)?.price;

  el.price.textContent = money(latest);
  if (market) {
    const change = Number(market.price_change_percentage_24h);
    el.change24h.textContent = `24h ${pct(change)}`;
    el.change24h.className = `chip ${change >= 0 ? "good" : "bad"}`;
    el.spreadStatus.textContent = `Vol ${money(market.total_volume)}`;
  }

  el.support.textContent = money(analysis.support);
  el.resistance.textContent = money(analysis.resistance);
  el.sampleCount.textContent = String(points.length);
  el.score.textContent = String(analysis.score);
  el.scoreBar.style.width = `${analysis.score}%`;
  document.documentElement.style.setProperty("--score-deg", `${analysis.score * 3.6}deg`);
  el.buyScore.textContent = String(analysis.buyScore);
  el.sellScore.textContent = String(analysis.sellScore);
  el.buyReason.textContent = analysis.buyReason;
  el.sellReason.textContent = analysis.sellReason;
  el.rsi.textContent = analysis.rsi === null ? "--" : analysis.rsi.toFixed(1);
  el.trend.textContent = `${analysis.trend >= 0 ? "+" : ""}${analysis.trend.toFixed(3)}%`;
  el.curve.textContent = `${analysis.curve >= 0 ? "+" : ""}${analysis.curve.toFixed(3)}%`;
  el.volatility.textContent = `${analysis.volatility.toFixed(2)}%`;
  el.confidence.textContent = `${analysis.confidence}%`;
  el.learnedRange.textContent = `${analysis.rangePosition.toFixed(0)}% pos`;
  el.buyTests.textContent = formatBacktest(analysis.backtest.buyWins, analysis.backtest.buyTotal);
  el.sellTests.textContent = formatBacktest(analysis.backtest.sellWins, analysis.backtest.sellTotal);
  el.scalpTarget.textContent = `${analysis.scalpTarget.toFixed(2)}%`;
  el.signalTitle.textContent = analysis.status;
  el.signalCopy.textContent = analysis.copy;
  el.decisionCard.className = `decision-card ${analysis.tone}`;
  el.ruleList.innerHTML = analysis.rules.map(rule => `<div class="rule"><strong>${rule.title}</strong>${rule.detail}</div>`).join("");
  renderTimeline();
  drawChart(points);
  maybeAlert(analysis, latest);
}

function formatBacktest(wins, total) {
  if (!total) return "--";
  return `${Math.round((wins / total) * 100)}% (${wins}/${total})`;
}

function renderTimeline() {
  const events = state.samples.slice(-10).reverse();
  if (!events.length) {
    el.timeline.innerHTML = `<div class="rule"><strong>No session history yet</strong>Live observations will appear here as the dashboard watches BTC.</div>`;
    return;
  }
  el.timeline.innerHTML = events.map((event, index) => {
    const prev = state.samples[state.samples.length - 2 - index];
    const move = prev ? ((event.price - prev.price) / prev.price) * 100 : 0;
    return `<div class="event"><time>${new Date(event.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><p>${money(event.price)} ${prev ? `(${pct(move)})` : ""}</p></div>`;
  }).join("");
}

function drawChart(points) {
  const dpr = window.devicePixelRatio || 1;
  const rect = el.chart.getBoundingClientRect();
  el.chart.width = Math.max(320, Math.floor(rect.width * dpr));
  el.chart.height = Math.max(260, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 62, right: 20, top: 24, bottom: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.strokeStyle = "rgba(144,247,255,.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  if (points.length < 2) {
    ctx.fillStyle = "#8ca8b6";
    ctx.fillText("Waiting for chart data...", pad.left, height / 2);
    return;
  }

  const prices = points.map(point => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1);
  const start = points[0].time;
  const end = points.at(-1).time;
  const timeSpan = Math.max(end - start, 1);
  const xy = point => ({
    x: pad.left + ((point.time - start) / timeSpan) * plotW,
    y: pad.top + (1 - ((point.price - min) / span)) * plotH
  });

  const grad = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  grad.addColorStop(0, "rgba(77,244,223,.34)");
  grad.addColorStop(1, "rgba(77,244,223,0)");
  ctx.beginPath();
  points.forEach((point, index) => {
    const pos = xy(point);
    if (index === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    const pos = xy(point);
    if (index === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.strokeStyle = "#4df4df";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  const fast = ema(prices, 8).map((price, i) => ({ time: points[i].time, price }));
  ctx.beginPath();
  fast.forEach((point, index) => {
    const pos = xy(point);
    if (index === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.strokeStyle = "#f7bd54";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = "#8ca8b6";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(money(max), 10, pad.top + 4);
  ctx.fillText(money(min), 10, height - pad.bottom);
}

function maybeAlert(analysis, price) {
  const threshold = Number(el.threshold.value);
  const enabled = el.alertsEnabled.checked;
  if (!enabled) return;
  const now = Date.now();
  const signature = `${analysis.status}-${Math.floor((price || 0) / 50)}-${analysis.buyScore}-${analysis.sellScore}`;

  if (analysis.status === "Buy Window" && analysis.buyScore >= threshold && signature !== state.lastSignal) {
    state.lastSignal = signature;
    showNotice({
      kind: "buy",
      type: "Buy Window",
      title: "Buy BTC right now",
      body: `BTC is near ${money(price)}. Buy score ${analysis.buyScore}/100, sell score ${analysis.sellScore}/100, confidence ${analysis.confidence}%. Support ${money(analysis.support)}, resistance ${money(analysis.resistance)}, scalp target ${analysis.scalpTarget.toFixed(2)}%.`,
      sticky: true
    });
    return;
  }

  if (state.activeNoticeKind === "buy" || now - state.lastStatusNotice < 10 * 60 * 1000) return;
  state.lastStatusNotice = now;

  let title = "BTC status update";
  let type = "Market Watch";
  let body = `BTC is near ${money(price)}. Current signal is ${analysis.status}. Buy ${analysis.buyScore}/100, sell ${analysis.sellScore}/100, confidence ${analysis.confidence}%.`;

  if (analysis.status === "Sell / Take Profit") {
    type = "Risk / Sell";
    title = "Take profit or avoid chasing";
    body = `BTC is near ${money(price)} and the model sees a higher sell score. Buy ${analysis.buyScore}/100, sell ${analysis.sellScore}/100.`;
  } else if (analysis.status === "No Trade" || analysis.status === "Hold") {
    type = "No Buy";
    title = "Not a good buy window";
    body = `BTC is near ${money(price)}. The model is waiting for a cleaner dip or stronger curve recovery. Buy ${analysis.buyScore}/100, sell ${analysis.sellScore}/100.`;
  } else if (analysis.status === "Warming up") {
    type = "Learning";
    title = "Still learning the range";
    body = "Keep the dashboard open so it can collect more highs, lows, and curve samples before stronger calls.";
  }

  showNotice({ kind: "status", type, title, body, sticky: false });
}

function showNotice({ kind, type, title, body, sticky }) {
  if (kind === "buy") clearNotice();
  if (state.activeNoticeKind === "buy" && kind !== "buy") return;

  clearTimeout(state.noticeTimer);
  state.activeNoticeKind = kind;
  el.toast.className = `toast show ${kind}`;
  el.toastType.textContent = type;
  el.toastTitle.textContent = title;
  el.toastBody.textContent = body;
  el.toastTime.textContent = `Announced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;

  if (!sticky) {
    state.noticeTimer = setTimeout(clearNotice, 10000);
  }
}

function clearNotice() {
  clearTimeout(state.noticeTimer);
  state.noticeTimer = null;
  state.activeNoticeKind = "";
  el.toast.classList.remove("show", "buy", "status");
}

function resetTimer() {
  clearInterval(state.timer);
  state.timer = setInterval(refreshAll, Number(el.refreshRate.value));
}

el.rangeButtons.addEventListener("click", event => {
  const button = event.target.closest("button[data-days]");
  if (!button) return;
  state.rangeDays = Number(button.dataset.days);
  [...el.rangeButtons.children].forEach(child => child.classList.toggle("active", child === button));
  refreshAll();
});

el.refreshRate.addEventListener("change", resetTimer);
el.threshold.addEventListener("input", () => {
  el.thresholdLabel.textContent = el.threshold.value;
  render();
});
el.clearHistory.addEventListener("click", () => {
  state.samples = [];
  persistSamples();
  render();
});
el.toastClose.addEventListener("click", clearNotice);
window.addEventListener("resize", () => drawChart(pricesForAnalysis()));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

el.thresholdLabel.textContent = el.threshold.value;
keepScreenAwake();
refreshAll();
resetTimer();
