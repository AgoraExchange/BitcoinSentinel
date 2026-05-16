const API = "https://api.coingecko.com/api/v3";
const COINBASE_API = "https://api.exchange.coinbase.com";
const HISTORY_CSV = "Bitcoin_3_14_2026-5_15_2026_historical_data_coinmarketcap.csv";
const STORE_KEY = "bitcoin-sentinel-session-v2";
const NOTICE_KEY = "bitcoin-sentinel-notifications-v1";
const SETTINGS_KEY = "bitcoin-sentinel-settings-v1";

const $ = id => document.getElementById(id);
const el = {
  price: $("price"),
  change24h: $("change-24h"),
  spreadStatus: $("spread-status"),
  monitorState: $("monitor-state"),
  lastUpdated: $("last-updated"),
  signalTitle: $("signal-title"),
  signalCopy: $("signal-copy"),
  decisionCard: $("decision-card"),
  support: $("support"),
  resistance: $("resistance"),
  sampleCount: $("sample-count"),
  score: $("score"),
  scoreBar: $("score-bar"),
  buyScore: $("buy-score"),
  sellScore: $("sell-score"),
  buyScoreLarge: $("buy-score-large"),
  sellScoreLarge: $("sell-score-large"),
  buyReason: $("buy-reason"),
  sellReason: $("sell-reason"),
  rsi: $("rsi"),
  trend: $("trend"),
  curve: $("curve"),
  volatility: $("volatility"),
  confidence: $("confidence"),
  learnedRange: $("learned-range"),
  learnedSamples: $("learned-samples"),
  patternMatch: $("pattern-match"),
  historyEdge: $("history-edge"),
  historyStatus: $("history-status"),
  ruleList: $("rule-list"),
  timeline: $("timeline"),
  marketLog: $("market-log"),
  notificationList: $("notification-list"),
  buyTests: $("buy-tests"),
  sellTests: $("sell-tests"),
  scalpTarget: $("scalp-target"),
  scalpTarget2: $("scalp-target-2"),
  clearHistory: $("clear-history"),
  clearNotifications: $("clear-notifications"),
  refreshRate: $("refresh-rate"),
  threshold: $("threshold"),
  thresholdLabel: $("threshold-label"),
  alertsEnabled: $("alerts-enabled"),
  investmentAmount: $("investment-amount"),
  investmentPill: $("investment-pill"),
  profitTarget: $("profit-target"),
  profitTargetLabel: $("profit-target-label"),
  sourceMode: $("source-mode"),
  apiStatus: $("api-status"),
  recommendedBuy: $("recommended-buy"),
  recommendedSell: $("recommended-sell"),
  projectedProfit: $("projected-profit"),
  buyPlan: $("buy-plan"),
  sellPlan: $("sell-plan"),
  profitPlan: $("profit-plan"),
  high24h: $("high-24h"),
  low24h: $("low-24h"),
  high7d: $("high-7d"),
  low7d: $("low-7d"),
  toast: $("toast"),
  toastClose: $("toast-close"),
  toastType: $("toast-type"),
  toastTitle: $("toast-title"),
  toastBody: $("toast-body"),
  toastTime: $("toast-time"),
  chart: $("price-chart"),
  rangeButtons: $("range-buttons")
};

const defaultSettings = {
  investment: 100,
  profitTarget: 0.6,
  threshold: 72,
  refreshRate: 60000,
  alertsEnabled: true,
  sourceMode: "coingecko"
};

const state = {
  rangeDays: 1,
  timer: null,
  isFetching: false,
  wakeLock: null,
  wakeWanted: true,
  samples: restoreSamples(),
  historical: [],
  historicalCsv: [],
  historicalCsvMeta: { status: "Loading CSV history", rows: 0, start: null, end: null },
  settings: restoreSettings(),
  notices: restoreNotices(),
  lastNoticeSignature: "",
  lastStatusNotice: 0,
  activeNoticeKind: "",
  noticeTimer: null,
  lastMarket: null
};

const ctx = el.chart.getContext("2d");

function money(value, digits = 0) {
  if (!Number.isFinite(value)) return "$--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits });
}

function pct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function restoreSamples() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(item => Number.isFinite(item.price) && Number.isFinite(item.time)).slice(-1500) : [];
  } catch {
    return [];
  }
}

function persistSamples() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.samples.slice(-1500)));
}

function restoreNotices() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTICE_KEY) || "[]");
    return Array.isArray(saved) ? saved.slice(0, 120) : [];
  } catch {
    return [];
  }
}

function persistNotices() {
  localStorage.setItem(NOTICE_KEY, JSON.stringify(state.notices.slice(0, 120)));
}

function restoreSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function addSample(price) {
  const last = state.samples[state.samples.length - 1];
  if (!last || Math.abs(last.price - price) > 0.01 || Date.now() - last.time > 20000) {
    state.samples.push({ time: Date.now(), price });
    state.samples = state.samples.slice(-1500);
    persistSamples();
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ";" && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseHistoryCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(header => header.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const time = Date.parse(row.timestamp || row.timeClose || row.timeOpen);
    const close = Number(row.close);
    const high = Number(row.high);
    const low = Number(row.low);
    const open = Number(row.open);
    const volume = Number(row.volume);
    if (Number.isFinite(time) && Number.isFinite(close)) {
      rows.push({ time, price: close, open, high, low, close, volume, source: "csv" });
    }
  }
  return rows.sort((a, b) => a.time - b.time);
}

async function loadHistoricalCsv() {
  try {
    const res = await fetch(HISTORY_CSV, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV ${res.status}`);
    const rows = parseHistoryCsv(await res.text());
    if (!rows.length) throw new Error("CSV empty");
    state.historicalCsv = rows;
    state.historicalCsvMeta = {
      status: "CSV history loaded",
      rows: rows.length,
      start: rows[0].time,
      end: rows.at(-1).time
    };
    render(state.lastMarket);
  } catch (error) {
    state.historicalCsvMeta = { status: `CSV history unavailable: ${error.message}`, rows: 0, start: null, end: null };
    render(state.lastMarket);
  }
}

async function fetchCoinbaseCandles(days) {
  const granularity = days <= 1 ? 300 : days <= 7 ? 3600 : 21600;
  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const url = `${COINBASE_API}/products/BTC-USD/candles?granularity=${granularity}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const candles = await fetchJson(url);
  return candles.map(c => ({ time: c[0] * 1000, price: c[4] })).sort((a, b) => a.time - b.time);
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
    state.lastMarket = btc;
    render(btc);
    el.apiStatus.textContent = state.settings.sourceMode === "coingecko-coinbase" ? "CoinGecko primary, Coinbase fallback armed" : "CoinGecko public API connected";
    el.monitorState.textContent = "Live";
    el.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  } catch (error) {
    if (state.settings.sourceMode === "coingecko-coinbase") {
      try {
        state.historical = await fetchCoinbaseCandles(state.rangeDays);
        const latest = state.historical.at(-1)?.price;
        if (latest) addSample(latest);
        render();
        el.apiStatus.textContent = "Coinbase public candles fallback active";
        el.monitorState.textContent = "Fallback";
      } catch (fallbackError) {
        handleOffline(error);
      }
    } else {
      handleOffline(error);
    }
  } finally {
    state.isFetching = false;
  }
}

function handleOffline(error) {
  el.apiStatus.textContent = error.message;
  el.monitorState.textContent = "Offline";
  el.spreadStatus.textContent = "Using stored session data";
  render();
}

function pricesForAnalysis() {
  const merged = [...state.historicalCsv, ...state.historical, ...state.samples];
  const unique = new Map();
  merged.forEach(item => unique.set(Math.round(item.time / 1000), item));
  return [...unique.values()].sort((a, b) => a.time - b.time).slice(-2200);
}

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
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
  return 100 - (100 / (1 + gains / losses));
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length);
}

function rangeFor(points, ms) {
  const cutoff = Date.now() - ms;
  const values = points.filter(p => p.time >= cutoff).map(p => p.price);
  if (!values.length) return { high: NaN, low: NaN };
  return { high: Math.max(...values), low: Math.min(...values) };
}

function calcRangeStats(values) {
  const recent = values.slice(-180);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const current = values.at(-1);
  const span = Math.max(high - low, 1);
  return { low, high, span, position: ((current - low) / span) * 100, rangePct: (span / Math.max(current, 1)) * 100 };
}

function runBacktest(points, scalpTargetPct) {
  if (points.length < 40) return { buyWins: 0, buyTotal: 0, sellWins: 0, sellTotal: 0 };
  let buyWins = 0, buyTotal = 0, sellWins = 0, sellTotal = 0;
  for (let i = 24; i < points.length - 12; i++) {
    const window = points.slice(i - 24, i + 1).map(point => point.price);
    const low = Math.min(...window), high = Math.max(...window), span = Math.max(high - low, 1);
    const price = points[i].price;
    const pos = ((price - low) / span) * 100;
    const future = points.slice(i + 1, i + 13).map(point => point.price);
    if (pos <= 28) {
      buyTotal++;
      if (((Math.max(...future) - price) / price) * 100 >= scalpTargetPct) buyWins++;
    }
    if (pos >= 72) {
      sellTotal++;
      if (((price - Math.min(...future)) / price) * 100 >= scalpTargetPct) sellWins++;
    }
  }
  return { buyWins, buyTotal, sellWins, sellTotal };
}

function dailyCloses(points) {
  const byDay = new Map();
  points.forEach(point => {
    const key = new Date(point.time).toISOString().slice(0, 10);
    const existing = byDay.get(key);
    if (!existing || point.time > existing.time) byDay.set(key, { time: point.time, price: point.price });
  });
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

function patternSignal(points) {
  const days = dailyCloses(points);
  if (days.length < 40) {
    return { matches: 0, edgePct: 0, winRate: 0, confidence: 0, label: "Learning" };
  }
  const returns = [];
  for (let i = 1; i < days.length; i++) {
    returns.push(((days[i].price - days[i - 1].price) / days[i - 1].price) * 100);
  }
  const windowSize = Math.min(7, Math.max(4, Math.floor(returns.length / 45)));
  if (returns.length < windowSize + 10) {
    return { matches: 0, edgePct: 0, winRate: 0, confidence: 0, label: "Learning" };
  }
  const currentPattern = returns.slice(-windowSize);
  const candidates = [];
  const maxStart = returns.length - windowSize - 1;
  for (let start = 0; start < maxStart; start++) {
    const pattern = returns.slice(start, start + windowSize);
    const distance = Math.sqrt(pattern.reduce((sum, value, index) => sum + Math.pow(value - currentPattern[index], 2), 0) / windowSize);
    const next = returns[start + windowSize];
    if (Number.isFinite(next)) candidates.push({ distance, next });
  }
  const matches = candidates.sort((a, b) => a.distance - b.distance).slice(0, Math.min(18, Math.max(6, Math.floor(candidates.length * .12))));
  if (!matches.length) return { matches: 0, edgePct: 0, winRate: 0, confidence: 0, label: "No match" };
  const weighted = matches.reduce((sum, match) => sum + match.next / (match.distance + .35), 0);
  const weights = matches.reduce((sum, match) => sum + 1 / (match.distance + .35), 0);
  const edgePct = weighted / Math.max(weights, .001);
  const winRate = matches.filter(match => match.next > 0).length / matches.length;
  const avgDistance = matches.reduce((sum, match) => sum + match.distance, 0) / matches.length;
  const confidence = Math.round(clamp(42 + Math.min(matches.length, 18) * 2.1 - avgDistance * 3.5, 20, 82));
  const label = edgePct > .35 && winRate >= .56 ? "Bullish repeat" : edgePct < -.35 && winRate <= .44 ? "Bearish repeat" : "Mixed repeat";
  return { matches: matches.length, edgePct, winRate, confidence, label };
}

function planFor(price, analysis) {
  const investment = Math.max(1, Number(state.settings.investment) || 1);
  const profitTarget = Math.max(0.1, Number(state.settings.profitTarget) || 0.6);
  const modelTarget = Math.max(profitTarget, analysis.scalpTarget || profitTarget);
  const btcAmount = investment / Math.max(price || 1, 1);
  const sellTarget = (price || 0) * (1 + modelTarget / 100);
  const projectedProfit = investment * (modelTarget / 100);
  const suggestedBuy = analysis.status === "Buy Window" ? investment : Math.max(0, Math.round(investment * (analysis.buyScore / 100)));
  return { investment, profitTarget, modelTarget, btcAmount, sellTarget, projectedProfit, suggestedBuy };
}

function analyze() {
  const points = pricesForAnalysis();
  const values = points.map(point => point.price);
  const current = values.at(-1);
  const pattern = patternSignal(points);
  if (values.length < 18 || !current) {
    return {
      score: 45, buyScore: 45, sellScore: 45, status: "Warming up", tone: "wait",
      copy: "Keep the dashboard open so it can collect enough live samples for stronger timing calls.",
      rules: [{ title: "Need more samples", detail: `${values.length} price points loaded. More points improve momentum and curve reads.` }],
      support: values.length ? Math.min(...values) : NaN,
      resistance: values.length ? Math.max(...values) : NaN,
      rsi: null, trend: 0, curve: 0, volatility: 0, confidence: Math.min(25, Math.round(values.length * 1.3)),
      rangePosition: 50, learnedRangePct: 0, buyReason: "Collecting lows", sellReason: "Collecting highs",
      scalpTarget: Number(state.settings.profitTarget), backtest: runBacktest(points, Number(state.settings.profitTarget)), pattern
    };
  }

  const fast = ema(values, 8), slow = ema(values, 21);
  const fastNow = fast.at(-1), slowNow = slow.at(-1);
  const previousFast = fast.at(-5) || fast[0], previousSlow = slow.at(-5) || slow[0];
  const trendPct = ((fastNow - slowNow) / current) * 100;
  const curvePct = (((fastNow - previousFast) - (slowNow - previousSlow)) / current) * 100;
  const rsi = calcRsi(values);
  const recent = values.slice(-90);
  const support = Math.min(...recent), resistance = Math.max(...recent);
  const vol = (standardDeviation(recent) / current) * 100;
  const range = calcRangeStats(values);
  const distanceFromSupport = ((current - support) / Math.max(support, 1)) * 100;
  const distanceFromResistance = ((resistance - current) / Math.max(current, 1)) * 100;
  const confidence = Math.round(clamp(30 + Math.log2(values.length) * 8.5 + Math.min(state.samples.length, 360) / 9, 20, 97));
  const scalpTarget = Math.max(Number(state.settings.profitTarget), Math.min(2.4, Math.max(.18, vol * .48)));
  const backtest = runBacktest(points, scalpTarget);
  let buyScore = 50, sellScore = 50;
  const rules = [];

  if (rsi !== null && rsi < 32) { buyScore += 18; sellScore -= 10; rules.push({ title: "Oversold pressure", detail: `RSI ${rsi.toFixed(1)} suggests sellers may be stretched.` }); }
  else if (rsi !== null && rsi > 70) { sellScore += 18; buyScore -= 18; rules.push({ title: "Overheated", detail: `RSI ${rsi.toFixed(1)} makes a chase buy riskier.` }); }
  else rules.push({ title: "RSI balanced", detail: `RSI ${rsi ? rsi.toFixed(1) : "--"} is not at an extreme.` });

  if (distanceFromSupport < .35) { buyScore += 20; sellScore -= 8; rules.push({ title: "Near support", detail: `Only ${distanceFromSupport.toFixed(2)}% above recent support.` }); }
  else if (distanceFromResistance < .35) { sellScore += 18; buyScore -= 12; rules.push({ title: "Near resistance", detail: `Only ${distanceFromResistance.toFixed(2)}% below resistance.` }); }

  if (range.position <= 25) { buyScore += 16; rules.push({ title: "Learned low zone", detail: `BTC is in the bottom ${range.position.toFixed(0)}% of the learned range.` }); }
  else if (range.position >= 75) { sellScore += 16; rules.push({ title: "Learned high zone", detail: `BTC is in the top ${(100 - range.position).toFixed(0)}% of the learned range.` }); }

  if (trendPct > .04 && curvePct > 0) { buyScore += 14; sellScore -= 7; rules.push({ title: "Trend turning up", detail: "Fast path is above the slow path and curve is improving." }); }
  else if (trendPct < -.04 && curvePct < 0) { sellScore += 12; buyScore -= 8; rules.push({ title: "Trend fading", detail: "The live path is bending lower." }); }

  if (curvePct < -.015 && range.position > 60) sellScore += 10;
  if (curvePct > .015 && range.position < 40) buyScore += 10;
  if (pattern.matches >= 6 && pattern.confidence >= 35) {
    const patternWeight = Math.min(14, Math.abs(pattern.edgePct) * 3.8 + pattern.confidence / 12);
    if (pattern.edgePct > .18 && pattern.winRate >= .5) {
      buyScore += patternWeight;
      sellScore -= patternWeight * .45;
      rules.push({ title: "Historical repeat leans bullish", detail: `${pattern.matches} similar daily patterns averaged ${pct(pattern.edgePct)} next-day movement with ${Math.round(pattern.winRate * 100)}% upside follow-through.` });
    } else if (pattern.edgePct < -.18 && pattern.winRate <= .5) {
      sellScore += patternWeight;
      buyScore -= patternWeight * .45;
      rules.push({ title: "Historical repeat leans bearish", detail: `${pattern.matches} similar daily patterns averaged ${pct(pattern.edgePct)} next-day movement. Chasing a buy is weaker here.` });
    } else {
      rules.push({ title: "Historical repeat is mixed", detail: `${pattern.matches} similar daily patterns do not show a clean one-day edge yet.` });
    }
  }
  if (vol > 2.2) { buyScore -= 5; sellScore -= 5; rules.push({ title: "High chop", detail: `Volatility is ${vol.toFixed(2)}%. Reduce confidence or size.` }); }
  else if (vol > .35) { buyScore += 5; sellScore += 5; rules.push({ title: "Tradable movement", detail: `Volatility is ${vol.toFixed(2)}%, enough movement for small repeated swings.` }); }

  const buyHitRate = backtest.buyTotal ? backtest.buyWins / backtest.buyTotal : 0;
  const sellHitRate = backtest.sellTotal ? backtest.sellWins / backtest.sellTotal : 0;
  if (backtest.buyTotal >= 8 && buyHitRate >= .58) buyScore += Math.min(8, (buyHitRate - .5) * 30);
  if (backtest.sellTotal >= 8 && sellHitRate >= .58) sellScore += Math.min(8, (sellHitRate - .5) * 30);

  buyScore = Math.round(clamp(buyScore));
  sellScore = Math.round(clamp(sellScore));
  const score = Math.max(buyScore, sellScore);
  const threshold = Number(state.settings.threshold);
  let status = "Hold", tone = "wait", copy = "No clean edge yet. The model is waiting for either a better dip buy or a stronger take-profit zone.";
  if (buyScore >= threshold && buyScore >= sellScore + 5) {
    status = "Buy Window"; tone = "buy";
    copy = `BTC is low enough in its learned range with improving curve conditions. Watch for a ${scalpTarget.toFixed(2)}% move.`;
  } else if (sellScore >= threshold && sellScore > buyScore) {
    status = "Sell / Take Profit"; tone = "risk";
    copy = "BTC is near a learned high or momentum is cooling. This is a take-profit / avoid-chasing signal.";
  } else if (buyScore < 38 && sellScore < 45) {
    status = "No Trade"; tone = "wait";
    copy = "The read is messy. Sitting out is cleaner than forcing a tiny scalp.";
  }

  return {
    score, buyScore, sellScore, status, tone, copy, rules, support, resistance, rsi,
    trend: trendPct, curve: curvePct, volatility: vol, confidence: Math.round(clamp(confidence + pattern.confidence / 12, 20, 98)), rangePosition: range.position,
    learnedRangePct: range.rangePct, buyReason: range.position < 35 ? "Near learned lows" : curvePct > 0 ? "Curve improving" : "Waiting for dip",
    sellReason: range.position > 65 ? "Near learned highs" : curvePct < 0 ? "Curve fading" : "Waiting for rip",
    scalpTarget, backtest, pattern
  };
}

function render(market) {
  const analysis = analyze();
  const points = pricesForAnalysis();
  const latest = market?.current_price || points.at(-1)?.price;
  const plan = planFor(latest, analysis);
  const range24 = rangeFor(points, 86400000);
  const range7 = rangeFor(points, 7 * 86400000);

  el.price.textContent = money(latest);
  el.investmentPill.textContent = money(plan.investment);
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
  el.buyScore.textContent = el.buyScoreLarge.textContent = String(analysis.buyScore);
  el.sellScore.textContent = el.sellScoreLarge.textContent = String(analysis.sellScore);
  el.buyReason.textContent = analysis.buyReason;
  el.sellReason.textContent = analysis.sellReason;
  el.rsi.textContent = analysis.rsi === null ? "--" : analysis.rsi.toFixed(1);
  el.trend.textContent = `${analysis.trend >= 0 ? "+" : ""}${analysis.trend.toFixed(3)}%`;
  el.curve.textContent = `${analysis.curve >= 0 ? "+" : ""}${analysis.curve.toFixed(3)}%`;
  el.volatility.textContent = `${analysis.volatility.toFixed(2)}%`;
  el.confidence.textContent = `${analysis.confidence}%`;
  el.learnedRange.textContent = `${analysis.rangePosition.toFixed(0)}% pos`;
  el.learnedSamples.textContent = String(points.length);
  el.patternMatch.textContent = analysis.pattern.matches ? `${analysis.pattern.label}` : "Learning";
  el.historyEdge.textContent = analysis.pattern.matches ? `${pct(analysis.pattern.edgePct)} / ${Math.round(analysis.pattern.winRate * 100)}% up` : "--";
  el.historyStatus.textContent = historyStatusText();
  el.buyTests.textContent = formatBacktest(analysis.backtest.buyWins, analysis.backtest.buyTotal);
  el.sellTests.textContent = formatBacktest(analysis.backtest.sellWins, analysis.backtest.sellTotal);
  el.scalpTarget.textContent = el.scalpTarget2.textContent = `${analysis.scalpTarget.toFixed(2)}%`;
  el.signalTitle.textContent = analysis.status;
  el.signalCopy.textContent = analysis.copy;
  el.decisionCard.className = `decision-card glass ${analysis.tone}`;
  el.ruleList.innerHTML = analysis.rules.map(rule => `<div class="rule"><strong>${rule.title}</strong>${rule.detail}</div>`).join("");
  el.recommendedBuy.textContent = analysis.status === "Buy Window" ? money(plan.suggestedBuy) : "Wait";
  el.recommendedSell.textContent = money(plan.sellTarget);
  el.projectedProfit.textContent = money(plan.projectedProfit, 2);
  el.buyPlan.textContent = analysis.status === "Buy Window" ? `Approx ${plan.btcAmount.toFixed(8)} BTC at current price.` : `Suggested size unlocks only during a buy window.`;
  el.sellPlan.textContent = `Target after ${plan.modelTarget.toFixed(2)}% move from current BTC price.`;
  el.profitPlan.textContent = `Based on ${money(plan.investment)} investment and ${plan.modelTarget.toFixed(2)}% target.`;
  el.high24h.textContent = money(range24.high);
  el.low24h.textContent = money(range24.low);
  el.high7d.textContent = money(range7.high);
  el.low7d.textContent = money(range7.low);
  renderTimeline();
  renderMarketLog(points);
  renderNotifications();
  drawChart(points);
  maybeAlert(analysis, latest, plan);
}

function historyStatusText() {
  const meta = state.historicalCsvMeta;
  if (!meta.rows) return meta.status;
  const start = new Date(meta.start).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const end = new Date(meta.end).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${meta.rows} CSV closes loaded (${start} to ${end})`;
}

function formatBacktest(wins, total) {
  if (!total) return "--";
  return `${Math.round((wins / total) * 100)}% (${wins}/${total})`;
}

function renderTimeline() {
  const events = state.samples.slice(-12).reverse();
  el.timeline.innerHTML = events.length ? events.map((event, index) => {
    const prev = state.samples[state.samples.length - 2 - index];
    const move = prev ? ((event.price - prev.price) / prev.price) * 100 : 0;
    const stamp = new Date(event.time);
    return `<div class="event"><time>${stamp.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}<small>${stamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</small></time><div><strong>${money(event.price)}</strong><small>${prev ? `Movement ${pct(move)} from previous logged price` : "First logged session price"}</small></div><span class="delta">${prev ? pct(move) : "--"}</span></div>`;
  }).join("") : `<div class="rule"><strong>No session history yet</strong>Live observations will appear here as the dashboard watches BTC.</div>`;
}

function renderMarketLog(points) {
  const recent = points.slice(-24).reverse();
  el.marketLog.innerHTML = recent.length ? recent.map((point, index) => {
    const prev = points[points.length - 2 - index];
    const move = prev ? ((point.price - prev.price) / prev.price) * 100 : 0;
    const dir = move >= 0 ? "up" : "down";
    return `<div class="log-row ${dir}"><time>${new Date(point.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><div><strong>${money(point.price)}</strong><small>${dir === "up" ? "Rise" : "Dip"} from prior sample</small></div><span class="delta">${pct(move)}</span></div>`;
  }).join("") : `<div class="rule"><strong>No market log yet</strong>Waiting for live BTC samples.</div>`;
}

function renderNotifications() {
  el.notificationList.innerHTML = state.notices.length ? state.notices.map(n => `
    <div class="notice-row ${n.kind}">
      <time>${new Date(n.time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
      <div><strong>${n.title}</strong><small>${n.body}</small></div>
      <span class="delta">${n.kind.toUpperCase()}</span>
    </div>
  `).join("") : `<div class="rule"><strong>No notifications yet</strong>Buy, sell, and risk alerts will be archived here with timestamps.</div>`;
}

function drawChart(points) {
  const dpr = window.devicePixelRatio || 1;
  const rect = el.chart.getBoundingClientRect();
  el.chart.width = Math.max(320, Math.floor(rect.width * dpr));
  el.chart.height = Math.max(260, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height;
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 62, right: 20, top: 24, bottom: 38 };
  const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  ctx.strokeStyle = "rgba(144,247,255,.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  if (points.length < 2) {
    ctx.fillStyle = "#8ca8b6"; ctx.fillText("Waiting for chart data...", pad.left, height / 2); return;
  }
  const prices = points.map(point => point.price);
  const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(max - min, 1);
  const start = points[0].time, end = points.at(-1).time, timeSpan = Math.max(end - start, 1);
  const xy = point => ({ x: pad.left + ((point.time - start) / timeSpan) * plotW, y: pad.top + (1 - ((point.price - min) / span)) * plotH });
  const grad = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  grad.addColorStop(0, "rgba(77,244,223,.34)"); grad.addColorStop(1, "rgba(77,244,223,0)");
  ctx.beginPath();
  points.forEach((point, index) => { const pos = xy(point); if (index === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y); });
  ctx.lineTo(width - pad.right, height - pad.bottom); ctx.lineTo(pad.left, height - pad.bottom); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  points.forEach((point, index) => { const pos = xy(point); if (index === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y); });
  ctx.strokeStyle = "#4df4df"; ctx.lineWidth = 2.4; ctx.stroke();
  const fast = ema(prices, 8).map((price, i) => ({ time: points[i].time, price }));
  ctx.beginPath();
  fast.forEach((point, index) => { const pos = xy(point); if (index === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y); });
  ctx.strokeStyle = "#f7bd54"; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = "#8ca8b6"; ctx.font = "12px Inter, sans-serif"; ctx.fillText(money(max), 10, pad.top + 4); ctx.fillText(money(min), 10, height - pad.bottom);
}

function maybeAlert(analysis, price, plan) {
  if (!state.settings.alertsEnabled) return;
  const threshold = Number(state.settings.threshold);
  const now = Date.now();
  const sig = `${analysis.status}-${Math.floor((price || 0) / 50)}-${analysis.buyScore}-${analysis.sellScore}-${Math.round(plan.investment)}`;
  if (analysis.status === "Buy Window" && analysis.buyScore >= threshold && sig !== state.lastNoticeSignature) {
    state.lastNoticeSignature = sig;
    showNotice({
      kind: "buy",
      type: "Buy Window",
      title: "Buy BTC now",
      body: `BTC ${money(price)}. Suggested buy ${money(plan.suggestedBuy)} (${plan.btcAmount.toFixed(8)} BTC). Sell target ${money(plan.sellTarget)} for est. ${money(plan.projectedProfit, 2)} profit. Confidence ${analysis.confidence}%.`,
      sticky: true
    });
    return;
  }
  if (analysis.status === "Sell / Take Profit" && analysis.sellScore >= threshold && sig !== state.lastNoticeSignature) {
    state.lastNoticeSignature = sig;
    showNotice({
      kind: "sell",
      type: "Sell / Profit",
      title: "Sell or take profit",
      body: `BTC ${money(price)}. Model sees a sell score of ${analysis.sellScore}/100. If holding about ${money(plan.investment)}, protect roughly ${money(plan.projectedProfit, 2)} target profit.`,
      sticky: false
    });
    return;
  }
  if (state.activeNoticeKind === "buy" || now - state.lastStatusNotice < 8 * 60 * 1000) return;
  state.lastStatusNotice = now;
  showNotice({
    kind: "status",
    type: "Market Watch",
    title: analysis.status === "No Trade" ? "No clean trade" : "Not a buy window",
    body: `BTC ${money(price)}. Buy ${analysis.buyScore}/100, sell ${analysis.sellScore}/100, confidence ${analysis.confidence}%. Wait for a cleaner range edge.`,
    sticky: false
  });
}

function showNotice({ kind, type, title, body, sticky }) {
  if (kind === "buy") clearNotice();
  if (state.activeNoticeKind === "buy" && kind !== "buy") return;
  clearTimeout(state.noticeTimer);
  state.activeNoticeKind = kind;
  const notice = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, time: Date.now(), kind, type, title, body };
  state.notices.unshift(notice);
  state.notices = state.notices.slice(0, 120);
  persistNotices();
  renderNotifications();
  el.toast.className = `toast show ${kind}`;
  el.toastType.textContent = type;
  el.toastTitle.textContent = title;
  el.toastBody.textContent = body;
  el.toastTime.textContent = `Announced ${new Date(notice.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  if (!sticky) state.noticeTimer = setTimeout(clearNotice, 10000);
}

function clearNotice() {
  clearTimeout(state.noticeTimer);
  state.noticeTimer = null;
  state.activeNoticeKind = "";
  el.toast.classList.remove("show", "buy", "sell", "status");
}

function syncSettingsUI() {
  el.investmentAmount.value = String(state.settings.investment);
  el.profitTarget.value = String(state.settings.profitTarget);
  el.profitTargetLabel.textContent = `${Number(state.settings.profitTarget).toFixed(1)}%`;
  el.threshold.value = String(state.settings.threshold);
  el.thresholdLabel.textContent = String(state.settings.threshold);
  el.refreshRate.value = String(state.settings.refreshRate);
  el.alertsEnabled.checked = Boolean(state.settings.alertsEnabled);
  el.sourceMode.value = state.settings.sourceMode;
}

function resetTimer() {
  clearInterval(state.timer);
  state.timer = setInterval(refreshAll, Number(state.settings.refreshRate));
}

async function requestWakeLock() {
  if (!state.wakeWanted || !("wakeLock" in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
  } catch {
    state.wakeLock = null;
  }
}

function keepScreenAwake() {
  requestWakeLock();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestWakeLock(); });
  window.addEventListener("focus", requestWakeLock);
  window.addEventListener("pointerdown", requestWakeLock, { passive: true });
  window.addEventListener("touchstart", requestWakeLock, { passive: true });
}

function switchTab(tab) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === `page-${tab}`));
  document.querySelectorAll("[data-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  setTimeout(() => drawChart(pricesForAnalysis()), 40);
}

document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
el.rangeButtons.addEventListener("click", event => {
  const button = event.target.closest("button[data-days]");
  if (!button) return;
  state.rangeDays = Number(button.dataset.days);
  [...el.rangeButtons.children].forEach(child => child.classList.toggle("active", child === button));
  refreshAll();
});
el.refreshRate.addEventListener("change", () => { state.settings.refreshRate = Number(el.refreshRate.value); persistSettings(); resetTimer(); });
el.threshold.addEventListener("input", () => { state.settings.threshold = Number(el.threshold.value); persistSettings(); syncSettingsUI(); render(state.lastMarket); });
el.profitTarget.addEventListener("input", () => { state.settings.profitTarget = Number(el.profitTarget.value); persistSettings(); syncSettingsUI(); render(state.lastMarket); });
el.investmentAmount.addEventListener("input", () => { state.settings.investment = Math.max(1, Number(el.investmentAmount.value) || 1); persistSettings(); render(state.lastMarket); });
el.alertsEnabled.addEventListener("change", () => { state.settings.alertsEnabled = el.alertsEnabled.checked; persistSettings(); });
el.sourceMode.addEventListener("change", () => { state.settings.sourceMode = el.sourceMode.value; persistSettings(); refreshAll(); });
el.clearHistory.addEventListener("click", () => { state.samples = []; persistSamples(); render(state.lastMarket); });
el.clearNotifications.addEventListener("click", () => { state.notices = []; persistNotices(); renderNotifications(); clearNotice(); });
el.toastClose.addEventListener("click", clearNotice);
window.addEventListener("resize", () => drawChart(pricesForAnalysis()));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

syncSettingsUI();
keepScreenAwake();
renderNotifications();
loadHistoricalCsv();
refreshAll();
resetTimer();
