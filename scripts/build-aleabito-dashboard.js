#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "reports");

const summaryPath = path.join(reportsDir, "aleabito-stock-mentions-cumulative.csv");
const dailyPath = path.join(reportsDir, "aleabito-stock-mentions-daily.csv");
const eventsPath = path.join(reportsDir, "aleabito-mentions-events.csv");
const metaPath = path.join(reportsDir, "aleabito-mentions.meta.json");
const researchMapPath = path.join(reportsDir, "aleabito-research-map.json");
const priceCachePath = path.join(reportsDir, "aleabito-price-cache.json");
const outputPath = path.join(reportsDir, "aleabito-60d-dashboard.html");
const digestsDir = path.join(reportsDir, "aleabito-digests");

const refreshPrices = process.argv.includes("--refresh-prices");
const noPrices = process.argv.includes("--no-prices");
const maxPriceAgeMs = 6 * 60 * 60 * 1000;
const priceDeepCachePath = path.join(reportsDir, "aleabito-price-deep-cache.json");
const fundamentalsCachePath = path.join(reportsDir, "aleabito-fundamentals-cache.json");
const refreshDeep = process.argv.includes("--refresh-deep");
const skip3mo = process.argv.includes("--skip-3mo");
const refreshFundamentals = process.argv.includes("--refresh-fundamentals");
const maxDeepAgeMs = 12 * 60 * 60 * 1000;
const maxFundAgeMs = 24 * 60 * 60 * 1000;
const MEANINGFUL_MIN_MENTIONS = 5;
const MEANINGFUL_TOPN = 220;
const EMBED_POINTS = 63;
const BENCH_SYMBOLS = { SPY: "SPY", SMH: "SMH" };
const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const YAHOO_SYMBOL_ALIASES = {
  SIVE: "SIVE.ST",
  SOI: "SOI.PA",
  XFAB: "XFAB.PA",
  IQE: "IQE.L",
  RPI: "RPI.L",
  LPK: "LPK.DE",
  "HPS.A": "HPS-A.TO",
  "HSP.A": "HPS-A.TO",
  "LPK.DE": "LPK.DE",
  "EQR.AX": "EQR.AX",
  "EOS.AX": "EOS.AX",
  "EOS.ASX": "EOS.AX",
  "5802.T": "5802.T",
  "6503.T": "6503.T",
  "P4O.DE": "P4O.DE",
  ALRIB: "ALRIB.PA",
  AIXA: "AIXA.DE",
  SIVEF: "SIVEF",
  TOWA: "6315.T",
  CATL: "300750.SZ",
  KLA: "KLAC",
  QLCM: "QCOM",
  LCRX: "LRCX",
  AXT: "AXTI",
  AMSL: "ASML",
  BOA: "BAC",
  CITI: "C",
  MVL: "MRVL",
  LPKK: "LPK.DE",
  UHR: "UHR.SW",
  ABB: "ABBN.SW",
  ETH: "ETH-USD",
  BTC: "BTC-USD",
  "6324": "6324.T",
  "6451": "6451.T",
  "6315": "6315.T",
  "6830": "6830.T",
  "3363": "3363.T",
  "3105": "3105.T",
  "3081": "3081.T",
  "4977": "4977.T",
  "5801": "5801.T",
  "8147": "8147.T",
};

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(readText(filePath));
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((candidate) => candidate.some((cell) => cell !== ""));
  return body.map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = cells[index] ?? "";
    });
    return record;
  });
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const a = new Date(`${left}T00:00:00Z`).getTime();
  const b = new Date(`${right}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, length = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function summarizeSourceText(text, ticker) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const lower = source.toLowerCase();
  const tags = [];

  if (lower.includes("cpo") || lower.includes("photon") || lower.includes("optical") || lower.includes("laser")) {
    tags.push("CPO / photonics / optical");
  }
  if (lower.includes("800 vdc") || lower.includes("800vdc") || lower.includes("power semi") || lower.includes("sic")) {
    tags.push("800VDC / power semis");
  }
  if (lower.includes("chips act") || lower.includes("funding") || lower.includes("supply chain")) {
    tags.push("CHIPS Act / Western supply chain");
  }
  if (lower.includes("tam") || lower.includes("asp") || lower.includes("p/b") || lower.includes("valuation")) {
    tags.push("TAM / ASP / valuation");
  }
  if (lower.includes("short") || lower.includes("fud") || lower.includes("scam") || lower.includes("risk")) {
    tags.push("risk / market narrative");
  }

  const cleanTicker = ticker ? `$${ticker}` : "该 ticker";
  const theme = tags.length ? tags.slice(0, 2).join("，") : "市场观点 / 研究线索";
  const action = lower.includes("long") || lower.includes("position")
    ? "Serenity 在这条来源里把它作为持仓或 long idea 相关线索讨论"
    : "Serenity 在这条来源里把它作为研究线索提及";
  const caveat = tags.length
    ? "需要结合英文原文确认上下文和证据强度。"
    : "原文语境较短，建议展开英文原文查看完整表达。";

  return `${action}，重点围绕 ${cleanTicker} 与 ${theme}。${caveat}`;
}

function getYahooCandidates(ticker) {
  const candidates = [];
  const alias = YAHOO_SYMBOL_ALIASES[ticker];
  if (alias) candidates.push(alias);

  if (/^\d{4}$/.test(ticker) && !alias) {
    candidates.push(`${ticker}.T`);
  }

  if (ticker.includes(".")) {
    candidates.push(ticker.replace(".", "-"));
    candidates.push(ticker);
  } else {
    candidates.push(ticker);
  }

  return [...new Set(candidates)];
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d&includePrePost=false&events=history`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 aleabito-dashboard/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;
  if (error) throw new Error(error.description || error.code || "Yahoo chart error");
  if (!result?.timestamp?.length) throw new Error("No chart timestamps");

  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = result.timestamp
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: closes[index] == null ? null : Number(closes[index]),
    }))
    .filter((point) => Number.isFinite(point.close));

  if (points.length < 2) throw new Error("Not enough close data");

  const first = points[0].close;
  const last = points[points.length - 1].close;
  const high = Math.max(...points.map((point) => point.close));
  const low = Math.min(...points.map((point) => point.close));

  return {
    status: "ok",
    symbol: result.meta?.symbol || symbol,
    currency: result.meta?.currency || "",
    exchange: result.meta?.exchangeName || result.meta?.fullExchangeName || "",
    last_close: last,
    change_pct: first ? ((last - first) / first) * 100 : null,
    range_high: high,
    range_low: low,
    points,
    fetched_at: new Date().toISOString(),
  };
}

async function fetchPriceForTicker(ticker) {
  let lastError = "";
  for (const symbol of getYahooCandidates(ticker)) {
    try {
      return await fetchYahooChart(symbol);
    } catch (error) {
      lastError = `${symbol}: ${error.message}`;
    }
  }
  return {
    status: "missing",
    symbol: getYahooCandidates(ticker)[0] || ticker,
    currency: "",
    exchange: "",
    last_close: null,
    change_pct: null,
    range_high: null,
    range_low: null,
    points: [],
    error: lastError,
    fetched_at: new Date().toISOString(),
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
function numOrNull(x) { return typeof x === "number" && Number.isFinite(x) ? x : null; }
function rawOrNull(x) { if (x && typeof x.raw === "number" && Number.isFinite(x.raw)) return x.raw; return typeof x === "number" && Number.isFinite(x) ? x : null; }

async function yahooFetch(url, extraHeaders) {
  const headers = Object.assign({ accept: "application/json", "user-agent": YAHOO_UA }, extraHeaders || {});
  for (let attempt = 0; attempt < 4; attempt++) {
    let resp;
    try { resp = await fetch(url, { headers }); }
    catch (e) { if (attempt === 3) return { status: 0, text: "", error: e.message }; await sleepMs(800 * (attempt + 1)); continue; }
    if (resp.status === 429) {
      if (attempt === 3) return { status: 429, text: "" };
      await sleepMs(2000 * Math.pow(2, attempt) + Math.floor(Math.random() * 600));
      continue;
    }
    let text = "";
    try { text = await resp.text(); } catch (e) {}
    return { status: resp.status, text };
  }
  return { status: 429, text: "" };
}

async function fetchYahooChartDeep(symbol) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=2y&interval=1d&includePrePost=false";
  const r = await yahooFetch(url);
  if (r.status === 429) return { status: "rate_limited", symbol };
  if (r.status !== 200) return { status: "missing", symbol, error: "HTTP " + r.status };
  let payload; try { payload = JSON.parse(r.text); } catch (e) { return { status: "missing", symbol, error: "parse" }; }
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result || !result.timestamp || !result.timestamp.length) return { status: "missing", symbol, error: "no data" };
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = q.close || [], vols = q.volume || [];
  const daily = result.timestamp.map((t, i) => ({
    d: new Date(t * 1000).toISOString().slice(0, 10),
    c: closes[i] == null ? null : Number(closes[i]),
    v: vols[i] == null ? null : Number(vols[i]),
  })).filter((p) => Number.isFinite(p.c));
  if (daily.length < 2) return { status: "missing", symbol, error: "thin" };
  const meta = result.meta || {};
  return { status: "ok", symbol: meta.symbol || symbol, currency: meta.currency || "", exchange: meta.exchangeName || meta.fullExchangeName || "", daily, fetched_at: new Date().toISOString() };
}

async function fetchDeepForTicker(ticker) {
  let lastError = "";
  for (const symbol of getYahooCandidates(ticker)) {
    const res = await fetchYahooChartDeep(symbol);
    if (res.status === "ok") return res;
    if (res.status === "rate_limited") return res;
    lastError = symbol + ": " + (res.error || "?");
  }
  return { status: "missing", symbol: getYahooCandidates(ticker)[0] || ticker, error: lastError };
}

async function acquireYahooCrumb() {
  try {
    const r1 = await fetch("https://fc.yahoo.com/", { headers: { "user-agent": YAHOO_UA } });
    const sc = r1.headers.get("set-cookie");
    const cookie = sc ? sc.split(/,(?=\s*[A-Za-z0-9_]+=)/).map((c) => c.split(";")[0].trim()).join("; ") : null;
    if (!cookie) return null;
    await sleepMs(300);
    const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { accept: "text/plain", "user-agent": YAHOO_UA, cookie } });
    if (r2.status !== 200) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 40 || crumb.indexOf("<") >= 0 || crumb === "Too Many Requests") return null;
    return { cookie, crumb };
  } catch (e) { return null; }
}

async function fetchFundamentalsQS(symbol, auth) {
  if (!auth) return null;
  const mods = "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents";
  const url = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(symbol) + "?modules=" + mods + "&crumb=" + encodeURIComponent(auth.crumb);
  const r = await yahooFetch(url, { cookie: auth.cookie });
  if (r.status === 429) return { status: "rate_limited" };
  if (r.status !== 200) return null;
  let j; try { j = JSON.parse(r.text); } catch (e) { return null; }
  const res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!res) return null;
  const ks = res.defaultKeyStatistics || {}, sd = res.summaryDetail || {}, pr = res.price || {}, fd = res.financialData || {}, ce = res.calendarEvents || {};
  const earn = ce.earnings && ce.earnings.earningsDate;
  let nextEarnings = null;
  if (Array.isArray(earn) && earn.length) nextEarnings = earn[0].fmt || (earn[0].raw ? new Date(earn[0].raw * 1000).toISOString().slice(0, 10) : null);
  return {
    status: "ok", source: "quoteSummary",
    marketCap: rawOrNull(pr.marketCap), sharesOutstanding: rawOrNull(ks.sharesOutstanding), floatShares: rawOrNull(ks.floatShares),
    sharesShort: rawOrNull(ks.sharesShort), shortRatio: rawOrNull(ks.shortRatio), shortPercentFloat: rawOrNull(ks.shortPercentOfFloat),
    trailingPE: rawOrNull(sd.trailingPE), forwardPE: rawOrNull(sd.forwardPE), priceToSales: rawOrNull(sd.priceToSalesTrailing12Months),
    beta: rawOrNull(sd.beta), profitMargin: rawOrNull(fd.profitMargins), nextEarnings,
  };
}

async function fetchQuoteBatch(symbols, auth) {
  let url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + symbols.map(encodeURIComponent).join(",");
  if (auth) url += "&crumb=" + encodeURIComponent(auth.crumb);
  const r = await yahooFetch(url, auth ? { cookie: auth.cookie } : {});
  if (r.status === 429) return { status: "rate_limited" };
  if (r.status !== 200) return null;
  let j; try { j = JSON.parse(r.text); } catch (e) { return null; }
  const res = j && j.quoteResponse && j.quoteResponse.result;
  if (!Array.isArray(res)) return null;
  const bySymbol = {};
  for (const q of res) {
    bySymbol[q.symbol] = {
      status: "ok", source: "quote",
      marketCap: numOrNull(q.marketCap), sharesOutstanding: numOrNull(q.sharesOutstanding), floatShares: null,
      sharesShort: numOrNull(q.sharesShort), shortRatio: null, shortPercentFloat: null,
      trailingPE: numOrNull(q.trailingPE), forwardPE: numOrNull(q.forwardPE), priceToSales: null,
      beta: null, profitMargin: null, nextEarnings: null,
    };
  }
  return { status: "ok", bySymbol };
}

function avgDollarVolFromDaily(daily, n) {
  if (!daily || !daily.length) return null;
  const tail = daily.slice(-(n || 30));
  const vals = tail.filter((p) => Number.isFinite(p.c) && Number.isFinite(p.v)).map((p) => p.c * p.v);
  if (!vals.length) return null;
  return vals.reduce((s, x) => s + x, 0) / vals.length;
}

function buildSparkPath(values, width, height, pad = 3) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function inferQualityFlag(ticker, row) {
  if (/^\d{4}$/.test(ticker)) return "numeric";
  if (row.mentioned_posts <= 2) return "thin";
  if (row.reply_mentions > row.post_mentions + row.quote_mentions && row.mentioned_posts < 10) return "reply-heavy";
  return "normal";
}

function priorityRank(priority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

function getWindowCount(series, latestDate, days, offsetDays = 0) {
  const startDelta = offsetDays + days - 1;
  return series.reduce((sum, point) => {
    const delta = daysBetween(point.date, latestDate);
    if (delta >= offsetDays && delta <= startDelta) return sum + point.mentioned_posts;
    return sum;
  }, 0);
}

function getWindowRaw(series, latestDate, days, offsetDays = 0) {
  const startDelta = offsetDays + days - 1;
  return series.reduce((sum, point) => {
    const delta = daysBetween(point.date, latestDate);
    if (delta >= offsetDays && delta <= startDelta) return sum + point.raw_occurrences;
    return sum;
  }, 0);
}

function computeMaxDrawdown(points) {
  let peak = -Infinity;
  let maxDrawdown = 0;
  points.forEach((point) => {
    if (!Number.isFinite(point.close)) return;
    peak = Math.max(peak, point.close);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, ((point.close - peak) / peak) * 100);
    }
  });
  return maxDrawdown;
}

const DIGEST_LABELS = [
  ["view", /^她的观点[:：]\s*(.*)$/],
  ["beginner", /^小白解释[:：]\s*(.*)$/],
  ["firstPrinciples", /^第一性原理[:：]\s*(.*)$/],
  ["buffett", /^Buffett\s*直接判断[:：]\s*(.*)$/],
  ["conclusion", /^当前结论[:：]\s*(.*)$/],
  ["links", /^关键链接[:：]\s*(.*)$/],
];

function parseDigest(text, fallbackDate) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const title = (lines[0] || "").trim();
  const metaLine = (lines[1] || "").trim();
  const rangeMatch = metaLine.match(/(\d{4}-\d{2}-\d{2})\s*到\s*(\d{4}-\d{2}-\d{2})/);
  const rangeStart = rangeMatch ? rangeMatch[1] : "";
  const rangeEnd = rangeMatch ? rangeMatch[2] : "";
  const dedupMatch = metaLine.match(/去重后\s*([\d,]+)\s*条/);
  const dedupCount = dedupMatch ? Number(dedupMatch[1].replace(/,/g, "")) : null;
  const sourceMatch = metaLine.match(/来源[:：]\s*([^。.]+)/);
  const source = sourceMatch ? sourceMatch[1].trim() : "";
  const date = rangeEnd || fallbackDate || "";

  const summary = [];
  const totalAnalysis = [];
  const themes = [];
  let disclaimer = "";
  let section = "preamble";
  let theme = null;
  let field = null;

  const appendField = (line) => {
    if (!theme) return;
    if (field === "links") {
      const urls = line.match(/https?:\/\/\S+/g);
      if (urls) theme.links.push(...urls);
    } else if (field) {
      theme.fields[field] = theme.fields[field] ? theme.fields[field] + "\n" + line : line;
    } else {
      theme.body = theme.body ? theme.body + "\n" + line : line;
    }
  };

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/不构成投资建议/.test(line) && !/^\d+\.\s/.test(line)) {
      disclaimer = line;
      section = "done";
      continue;
    }
    let m;
    if ((m = line.match(/^今天她重点看什么[:：]\s*(.*)$/))) {
      section = "summary";
      theme = null;
      field = null;
      if (m[1]) summary.push(m[1]);
      continue;
    }
    if ((m = line.match(/^总分析[:：]\s*(.*)$/))) {
      section = "total";
      theme = null;
      field = null;
      if (m[1]) totalAnalysis.push(m[1]);
      continue;
    }
    if ((m = line.match(/^(\d+)\.\s+(.*)$/))) {
      section = "theme";
      theme = { n: Number(m[1]), title: m[2].trim(), fields: {}, links: [], body: "" };
      themes.push(theme);
      field = null;
      continue;
    }
    if (section === "theme") {
      let matched = false;
      for (const [key, re] of DIGEST_LABELS) {
        if ((m = line.match(re))) {
          field = key;
          if (key === "links") {
            const urls = (m[1] || "").match(/https?:\/\/\S+/g);
            if (urls) theme.links.push(...urls);
          } else {
            theme.fields[key] = m[1] || "";
          }
          matched = true;
          break;
        }
      }
      if (!matched) appendField(line);
      continue;
    }
    if (section === "summary") summary.push(line);
    else if (section === "total") totalAnalysis.push(line);
  }

  return {
    date,
    title,
    rangeStart,
    rangeEnd,
    dedupCount,
    source,
    summary: summary.join("\n").trim(),
    themes: themes.map((t) => ({
      n: t.n,
      title: t.title,
      view: (t.fields.view || "").trim(),
      beginner: (t.fields.beginner || "").trim(),
      firstPrinciples: (t.fields.firstPrinciples || "").trim(),
      buffett: (t.fields.buffett || "").trim(),
      conclusion: (t.fields.conclusion || "").trim(),
      links: t.links,
      body: (t.body || "").trim(),
    })),
    totalAnalysis: totalAnalysis.join("\n").trim(),
    disclaimer,
  };
}

function readDigests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(md|markdown|txt)$/i.test(name))
    .map((name) => {
      const fallbackDate = (name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
      const parsed = parseDigest(readText(path.join(dir, name)), fallbackDate);
      parsed.file = name;
      return parsed;
    })
    .filter((digest) => digest.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function main() {
  const summaryRows = parseCsv(readText(summaryPath));
  const dailyRows = parseCsv(readText(dailyPath));
  const eventRows = parseCsv(readText(eventsPath));
  const meta = readJson(metaPath, {});
  const researchMap = readJson(researchMapPath, { tickers: [] });

  const researchByTicker = new Map((researchMap.tickers || []).map((entry) => [entry.ticker, entry]));
  const latestDate = dailyRows.reduce((latest, row) => (row.date > latest ? row.date : latest), "");
  const earliestDate = dailyRows.reduce((earliest, row) => (!earliest || row.date < earliest ? row.date : earliest), "");
  const allDates = [...new Set(dailyRows.map((row) => row.date))].sort();

  const dailyByTicker = new Map();
  dailyRows.forEach((row) => {
    const ticker = row.ticker;
    if (!dailyByTicker.has(ticker)) dailyByTicker.set(ticker, []);
    dailyByTicker.get(ticker).push({
      date: row.date,
      mentioned_posts: toNumber(row.mentioned_posts),
      raw_occurrences: toNumber(row.raw_occurrences),
      post_mentions: toNumber(row.post_mentions),
      quote_mentions: toNumber(row.quote_mentions),
      reply_mentions: toNumber(row.reply_mentions),
    });
  });
  dailyByTicker.forEach((series) => series.sort((a, b) => a.date.localeCompare(b.date)));

  const examplesByTicker = new Map();
  eventRows
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .forEach((event) => {
      const tickers = String(event.tickers || "")
        .split("|")
        .map((ticker) => ticker.trim())
        .filter(Boolean);
      tickers.forEach((ticker) => {
        if (!examplesByTicker.has(ticker)) examplesByTicker.set(ticker, []);
        const examples = examplesByTicker.get(ticker);
        if (examples.length < 5) {
          examples.push({
            created_at: event.created_at,
            kind: event.kind,
            url: event.source_url,
            text: truncate(event.text, 360),
            source_text: event.text,
            cn_summary: summarizeSourceText(event.text, ticker),
          });
        }
      });
    });

  const summary = summaryRows.map((row) => {
    const ticker = row.ticker;
    const series = dailyByTicker.get(ticker) || [];
    const last7 = getWindowCount(series, latestDate, 7);
    const prev7 = getWindowCount(series, latestDate, 7, 7);
    const last14 = getWindowCount(series, latestDate, 14);
    const last30 = getWindowCount(series, latestDate, 30);
    const rawLast7 = getWindowRaw(series, latestDate, 7);
    const mentioned = toNumber(row.mentioned_posts);
    const raw = toNumber(row.raw_occurrences);
    const postMentions = toNumber(row.post_mentions);
    const quoteMentions = toNumber(row.quote_mentions);
    const replyMentions = toNumber(row.reply_mentions);
    const originalWeight = mentioned ? (postMentions + quoteMentions) / mentioned : 0;
    const velocity = last7 - prev7;
    const velocityPct = prev7 ? (velocity / prev7) * 100 : last7 > 0 ? 100 : 0;
    const daysSinceLast = row.last_seen ? daysBetween(dateOnly(row.last_seen), latestDate) : null;
    const research = researchByTicker.get(ticker);

    return {
      rank: toNumber(row.rank),
      ticker,
      mentioned_posts: mentioned,
      raw_occurrences: raw,
      post_mentions: postMentions,
      quote_mentions: quoteMentions,
      reply_mentions: replyMentions,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      names: row.names || "",
      primary_theme: row.primary_theme || research?.theme || "Other / unclassified",
      research_priority: row.research_priority || research?.research_priority || "unverified",
      example_url: row.example_url,
      composition: {
        posts: postMentions,
        replies: replyMentions,
        quotes: quoteMentions,
        total: mentioned,
      },
      interaction: {
        xPosts: postMentions,
        yInteractions: replyMentions + quoteMentions,
        bubbleSize: Math.sqrt(Math.max(mentioned, 1)),
      },
      last7,
      prev7,
      last14,
      last30,
      rawLast7,
      velocity,
      velocityPct,
      daysSinceLast,
      originalWeight,
      qualityFlag: inferQualityFlag(ticker, { mentioned_posts: mentioned, post_mentions: postMentions, quote_mentions: quoteMentions, reply_mentions: replyMentions }),
      mentionSeries: series,
      examples: examplesByTicker.get(ticker) || [],
    };
  });

  const scoreMax = {
    mentioned: Math.max(...summary.map((row) => Math.log1p(row.mentioned_posts)), 1),
    raw: Math.max(...summary.map((row) => Math.log1p(row.raw_occurrences)), 1),
    last30: Math.max(...summary.map((row) => Math.log1p(row.last30)), 1),
    last7: Math.max(...summary.map((row) => Math.log1p(row.last7)), 1),
    velocity: Math.max(...summary.map((row) => Math.max(0, row.velocity)), 1),
  };

  summary.forEach((row) => {
    const mentionedScore = (Math.log1p(row.mentioned_posts) / scoreMax.mentioned) * 55;
    const rawScore = (Math.log1p(row.raw_occurrences) / scoreMax.raw) * 15;
    const monthScore = (Math.log1p(row.last30) / scoreMax.last30) * 12;
    const weekScore = (Math.log1p(row.last7) / scoreMax.last7) * 8;
    const velocityScore = (Math.max(0, row.velocity) / scoreMax.velocity) * 4;
    const originalScore = row.originalWeight * 4;
    const priorityScore = priorityRank(row.research_priority) * 0.7;
    row.serenity_score = Math.round((mentionedScore + rawScore + monthScore + weekScore + velocityScore + originalScore + priorityScore) * 10) / 10;
  });

  summary.sort((a, b) => b.serenity_score - a.serenity_score || a.rank - b.rank);
  summary.forEach((row, index) => {
    row.serenity_rank = index + 1;
  });

  const cache = readJson(priceCachePath, { generated_at: null, provider: "Yahoo Finance chart API", prices: {} });
  cache.provider = "Yahoo Finance chart API";
  cache.prices ||= {};

  if (!noPrices && !skip3mo) {
    const tickers = summary.map((row) => row.ticker);
    const toFetch = tickers.filter((ticker) => {
      const cached = cache.prices[ticker];
      if (refreshPrices || !cached?.fetched_at) return true;
      return Date.now() - new Date(cached.fetched_at).getTime() > maxPriceAgeMs;
    });

    if (toFetch.length) {
      console.error(`Fetching price charts for ${toFetch.length} tickers...`);
      await mapLimit(toFetch, 6, async (ticker, index) => {
        const result = await fetchPriceForTicker(ticker);
        const prev = cache.prices[ticker];
        if (result.status === "ok" || !(prev && prev.status === "ok")) cache.prices[ticker] = result;
        if ((index + 1) % 25 === 0 || index === toFetch.length - 1) {
          console.error(`Price fetch progress: ${index + 1}/${toFetch.length}`);
        }
      });
      cache.generated_at = new Date().toISOString();
      fs.writeFileSync(priceCachePath, `${JSON.stringify(cache, null, 2)}\n`);
    }
  }

  summary.forEach((row) => {
    const price = cache.prices[row.ticker] || { status: "missing", points: [] };
    row.price = {
      status: price.status,
      symbol: price.symbol || row.ticker,
      currency: price.currency || "",
      exchange: price.exchange || "",
      last_close: price.last_close,
      change_pct: price.change_pct,
      range_high: price.range_high,
      range_low: price.range_low,
      max_drawdown_pct: price.points?.length ? computeMaxDrawdown(price.points) : null,
      sparkPath: price.points?.length ? buildSparkPath(price.points.map((point) => point.close), 110, 34) : "",
      points: price.points || [],
      error: price.error || "",
      fetched_at: price.fetched_at || null,
    };
  });

  // ---- Stage 1: deep (2y) price + benchmarks + fundamentals (build-time analytics foundation) ----
  const meaningfulSet = new Set(
    summary.filter((r) => (r.mentioned_posts >= MEANINGFUL_MIN_MENTIONS || r.serenity_rank <= MEANINGFUL_TOPN) && r.price && r.price.status === "ok").map((r) => r.ticker)
  );
  const symbolByTicker = {};
  summary.forEach((r) => { symbolByTicker[r.ticker] = (r.price && r.price.symbol) || getYahooCandidates(r.ticker)[0] || r.ticker; });
  const benchSymbols = Object.values(BENCH_SYMBOLS);
  const fetchState = { rl: 0, blocked: false };

  const deepCache = readJson(priceDeepCachePath, { generated_at: null, provider: "Yahoo Finance chart API (2y)", series: {} });
  deepCache.series = deepCache.series || {};
  if (!noPrices) {
    const deepTargets = [...meaningfulSet, ...benchSymbols].filter((key) => {
      const cached = deepCache.series[key];
      if (refreshDeep || !cached || !cached.fetched_at) return true;
      return Date.now() - new Date(cached.fetched_at).getTime() > maxDeepAgeMs;
    });
    if (deepTargets.length) {
      console.error("Fetching deep (2y) price for " + deepTargets.length + " targets...");
      let done = 0;
      await mapLimit(deepTargets, 3, async (key) => {
        if (fetchState.blocked) return;
        const isBench = benchSymbols.includes(key);
        const res = isBench ? await fetchYahooChartDeep(key) : await fetchDeepForTicker(key);
        if (res.status === "rate_limited") { fetchState.rl++; if (fetchState.rl >= 8) { fetchState.blocked = true; console.error("Yahoo rate-limited; pausing deep fetch (resume next run with --refresh-deep)"); } return; }
        if (res.status === "ok") { fetchState.rl = 0; deepCache.series[key] = { symbol: res.symbol, currency: res.currency, exchange: res.exchange, daily: res.daily, fetched_at: res.fetched_at }; }
        else if (!deepCache.series[key]) { deepCache.series[key] = { symbol: res.symbol || key, status: "missing", daily: [], fetched_at: new Date().toISOString() }; }
        done++;
        if (done % 25 === 0) { deepCache.generated_at = new Date().toISOString(); fs.writeFileSync(priceDeepCachePath, JSON.stringify(deepCache) + "\n"); console.error("deep " + done + "/" + deepTargets.length); }
      });
      deepCache.generated_at = new Date().toISOString();
      fs.writeFileSync(priceDeepCachePath, JSON.stringify(deepCache) + "\n");
    }
  }

  const deepByTicker = new Map();
  summary.forEach((r) => { const s = deepCache.series[r.ticker]; if (s && s.daily && s.daily.length) deepByTicker.set(r.ticker, s.daily); });
  const benchDeep = {};
  const benchmarksData = {};
  for (const [name, sym] of Object.entries(BENCH_SYMBOLS)) {
    const s = deepCache.series[sym];
    const m = new Map();
    if (s && s.daily) s.daily.forEach((p) => { if (Number.isFinite(p.c)) m.set(p.d, p.c); });
    benchDeep[name] = m;
    if (s && s.daily && s.daily.length) benchmarksData[name] = { symbol: sym, points: s.daily.slice(-EMBED_POINTS).map((p) => ({ date: p.d, close: p.c })) };
  }

  const fundCache = readJson(fundamentalsCachePath, { generated_at: null, source: null, fundamentals: {} });
  fundCache.fundamentals = fundCache.fundamentals || {};
  if (!noPrices && !fetchState.blocked) {
    const fundTargets = [...meaningfulSet].filter((t) => {
      const c = fundCache.fundamentals[t];
      if (refreshFundamentals || !c || !c.fetched_at) return true;
      return Date.now() - new Date(c.fetched_at).getTime() > maxFundAgeMs;
    });
    if (fundTargets.length) {
      console.error("Fetching fundamentals for " + fundTargets.length + " tickers...");
      const auth = await acquireYahooCrumb();
      console.error("fundamentals mode: " + (auth ? "quoteSummary (crumb ok)" : "quote-fallback (no crumb)"));
      let fdone = 0;
      if (auth) {
        await mapLimit(fundTargets, 3, async (t) => {
          if (fetchState.blocked) return;
          const res = await fetchFundamentalsQS(symbolByTicker[t], auth);
          if (res && res.status === "rate_limited") { fetchState.rl++; if (fetchState.rl >= 8) fetchState.blocked = true; return; }
          if (res && res.status === "ok") { fetchState.rl = 0; fundCache.fundamentals[t] = Object.assign({}, res, { fetched_at: new Date().toISOString() }); }
          fdone++;
          if (fdone % 25 === 0) { fundCache.generated_at = new Date().toISOString(); fs.writeFileSync(fundamentalsCachePath, JSON.stringify(fundCache) + "\n"); }
        });
        fundCache.source = "quoteSummary";
      } else {
        for (let i = 0; i < fundTargets.length && !fetchState.blocked; i += 50) {
          const batch = fundTargets.slice(i, i + 50);
          const res = await fetchQuoteBatch(batch.map((t) => symbolByTicker[t]), null);
          if (res && res.status === "rate_limited") { fetchState.rl++; if (fetchState.rl >= 8) fetchState.blocked = true; break; }
          if (res && res.bySymbol) batch.forEach((t) => { const d = res.bySymbol[symbolByTicker[t]]; if (d) fundCache.fundamentals[t] = Object.assign({}, d, { fetched_at: new Date().toISOString() }); });
          await sleepMs(600);
        }
        fundCache.source = fundCache.source || "quote";
      }
      fundCache.generated_at = new Date().toISOString();
      fs.writeFileSync(fundamentalsCachePath, JSON.stringify(fundCache) + "\n");
    }
  }

  summary.forEach((r) => {
    const f = fundCache.fundamentals[r.ticker] || null;
    const adv = avgDollarVolFromDaily(deepByTicker.get(r.ticker), 30);
    const foreignListed = !!(r.price && r.price.currency && r.price.currency !== "USD");
    if (f || adv != null || foreignListed) {
      r.fundamentals = Object.assign(
        { marketCap: null, sharesOutstanding: null, floatShares: null, sharesShort: null, shortRatio: null, shortPercentFloat: null, trailingPE: null, forwardPE: null, priceToSales: null, beta: null, profitMargin: null, nextEarnings: null, source: null },
        f || {},
        { avgDollarVol: adv, foreignListed }
      );
    } else {
      r.fundamentals = null;
    }
  });
  // (deepByTicker + benchDeep held in scope for Stage 2/4/5 build-time metrics)
  const trackRecordAgg = computeTrackRecord(summary, deepCache, meaningfulSet);
  const spyDeepDaily = (deepCache.series.SPY && deepCache.series.SPY.daily) || null;
  const smhDeepDaily = (deepCache.series.SMH && deepCache.series.SMH.daily) || null;
  summary.forEach((r) => {
    if (!meaningfulSet.has(r.ticker)) return;
    const daily = deepByTicker.get(r.ticker); if (!daily) return;
    const mbd = {}; (r.mentionSeries || []).forEach((p) => { mbd[p.date] = (mbd[p.date] || 0) + (p.mentioned_posts || 0); });
    r.marketStats = computeMarketStats(daily, spyDeepDaily, smhDeepDaily, mbd);
  });
  summary.forEach((r) => {
    const series = dailyByTicker.get(r.ticker) || [];
    const w14_7 = getWindowCount(series, latestDate, 7, 14);
    const prevVel = r.prev7 - w14_7;
    r.momentum = { accel: r.velocity - prevVel, ageDays: r.first_seen ? daysBetween(dateOnly(r.first_seen), latestDate) : null, recencyDays: r.daysSinceLast };
  });
  const themeAgg = new Map();
  summary.forEach((r) => {
    const t = r.primary_theme || "Other / unclassified";
    const cur = themeAgg.get(t) || { theme: t, mentions: 0, recent7: 0, prior7: 0 };
    cur.mentions += r.mentioned_posts; cur.recent7 += r.last7; cur.prior7 += r.prev7;
    themeAgg.set(t, cur);
  });
  const themeConcentration = [...themeAgg.values()].map((x) => Object.assign({}, x, { delta: x.recent7 - x.prior7 })).sort((a, b) => b.mentions - a.mentions);
  const clusters = computeClusters(summary, deepByTicker);

  const themeStats = new Map();
  summary.forEach((row) => {
    const theme = row.primary_theme || "Other / unclassified";
    const current = themeStats.get(theme) || { theme, tickers: 0, mentions: 0, last7: 0, score: 0 };
    current.tickers += 1;
    current.mentions += row.mentioned_posts;
    current.last7 += row.last7;
    current.score += row.serenity_score;
    themeStats.set(theme, current);
  });

  const priceSuccess = summary.filter((row) => row.price.status === "ok").length;
  const topMovers = summary
    .filter((row) => row.price.status === "ok" && Number.isFinite(row.price.change_pct))
    .sort((a, b) => Math.abs(b.price.change_pct) - Math.abs(a.price.change_pct))
    .slice(0, 12)
    .map((row) => ({
      ticker: row.ticker,
      symbol: row.price.symbol,
      change_pct: row.price.change_pct,
      sparkPath: row.price.sparkPath,
    }));

  const digests = readDigests(digestsDir);

  const dashboardData = {
    generatedAt: new Date().toISOString(),
    dataWindow: {
      earliestDate,
      latestDate,
      events: meta.stats?.total_events || eventRows.length,
      tickers: summary.length,
      localTimezone: meta.timezone || "America/Los_Angeles",
    },
    sourceFiles: {
      summary: path.basename(summaryPath),
      daily: path.basename(dailyPath),
      events: path.basename(eventsPath),
      meta: path.basename(metaPath),
      researchMap: fs.existsSync(researchMapPath) ? path.basename(researchMapPath) : null,
      priceCache: fs.existsSync(priceCachePath) ? path.basename(priceCachePath) : null,
      digests: digests.length ? path.basename(digestsDir) + "/" : null,
    },
    priceProvider: {
      name: "Yahoo Finance chart API",
      fetchedAt: cache.generated_at,
      success: priceSuccess,
      total: summary.length,
    },
    allDates,
    digests,
    themeStats: [...themeStats.values()].sort((a, b) => b.mentions - a.mentions),
    topMovers,
    benchmarks: benchmarksData,
    trackRecord: trackRecordAgg,
    themeConcentration,
    clusters,
    rows: summary,
  };

  const html = buildHtmlV2(dashboardData);
  if (html.length > 14 * 1024 * 1024) console.error("WARN: dashboard HTML is " + (html.length / 1048576).toFixed(1) + "MB — check for embedded deep series (bloat guard)");
  fs.writeFileSync(outputPath, html);

  console.log(JSON.stringify({
    status: "ok",
    output: outputPath,
    tickers: summary.length,
    events: eventRows.length,
    price_success: priceSuccess,
    price_missing: summary.length - priceSuccess,
    price_cache: priceCachePath,
  }, null, 2));
}

function pearsonB(a, b) {
  const n = Math.min(a.length, b.length); if (n < 5) return 0;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  if (da === 0 || db === 0) return 0; return num / Math.sqrt(da * db);
}
function logRetSeries(daily) {
  const out = [];
  for (let i = 1; i < daily.length; i++) { if (daily[i - 1].c > 0 && daily[i].c > 0) out.push({ d: daily[i].d, r: Math.log(daily[i].c / daily[i - 1].c) }); }
  return out;
}
function computeMarketStats(daily, spyDaily, smhDaily, mentionByDate) {
  if (!daily || daily.length < 30 || !spyDaily || !spyDaily.length) return null;
  const tr = logRetSeries(daily);
  const spyMap = new Map(); for (const x of logRetSeries(spyDaily)) spyMap.set(x.d, x.r);
  const smhMap = new Map(); if (smhDaily) for (const x of logRetSeries(smhDaily)) smhMap.set(x.d, x.r);
  const dts = [], ri = [], rspy = [], rsmh = [];
  for (const x of tr) { const s = spyMap.get(x.d); if (s != null) { dts.push(x.d); ri.push(x.r); rspy.push(s); rsmh.push(smhMap.has(x.d) ? smhMap.get(x.d) : null); } }
  const n = ri.length; if (n < 20) return null;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mi = mean(ri), msp = mean(rspy);
  let cov = 0, varS = 0; for (let i = 0; i < n; i++) { cov += (ri[i] - mi) * (rspy[i] - msp); varS += (rspy[i] - msp) * (rspy[i] - msp); }
  if (varS <= 0) return null;
  const beta = cov / varS, alpha = mi - beta * msp, alphaAnnual = alpha * 252;
  let betaSMH = null;
  if (rsmh.every((x) => x != null)) {
    const msmh = mean(rsmh); let covS = 0, vS = 0; for (let i = 0; i < n; i++) { covS += (ri[i] - mi) * (rsmh[i] - msmh); vS += (rsmh[i] - msmh) * (rsmh[i] - msmh); }
    if (vS > 0) betaSMH = covS / vS;
  }
  const tail = Math.min(63, n); let cumI = 0, cumS = 0; for (let i = n - tail; i < n; i++) { cumI += ri[i]; cumS += rspy[i]; }
  const relStr = (Math.exp(cumI) - 1) - (Math.exp(cumS) - 1);
  const resid = ri.map((r, i) => r - (alpha + beta * rspy[i]));
  const m = dts.map((d) => (mentionByDate && mentionByDate[d]) || 0);
  let adjContemp = null, adjBest = null, adjSig = null, adjN = 0;
  if (m.reduce((s, x) => s + x, 0) > 0) {
    adjN = n; adjSig = 1.96 / Math.sqrt(n); const ccf = [];
    for (let k = -7; k <= 7; k++) {
      const xs = [], ys = [];
      for (let t = 0; t < n; t++) { const tk = t + k; if (tk >= 0 && tk < n) { xs.push(m[t]); ys.push(resid[tk]); } }
      const rr = xs.length >= 5 ? pearsonB(xs, ys) : 0;
      ccf.push({ lag: k, r: rr, sig: Math.abs(rr) > adjSig });
    }
    adjContemp = ccf[7].r; adjBest = ccf[0]; for (const c of ccf) if (Math.abs(c.r) > Math.abs(adjBest.r)) adjBest = c;
  }
  return { beta, alpha, alphaAnnual, betaSMH, relStr, n, adjContemp, adjBest, adjSig, adjN };
}
function median(arr) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function benchCloseOn(daily, date) {
  let lo = 0, hi = daily.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (daily[mid].d <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? daily[ans].c : null;
}
function computeTrackRecord(rows, deepCache, meaningfulSet) {
  const spy = (deepCache.series.SPY && deepCache.series.SPY.daily) || [];
  const recs = [];
  rows.forEach((r) => {
    if (!meaningfulSet.has(r.ticker)) return;
    const s = deepCache.series[r.ticker]; const daily = s && s.daily;
    if (!daily || daily.length < 2 || !r.first_seen) return;
    const fs = dateOnly(r.first_seen);
    let ei = -1; for (let i = 0; i < daily.length; i++) { if (daily[i].d > fs) { ei = i; break; } }
    if (ei < 0 || ei >= daily.length - 1) return;
    const entry = daily[ei], exit = daily[daily.length - 1];
    if (!(entry.c > 0) || !(exit.c > 0)) return;
    const fwdRet = exit.c / entry.c - 1;
    const i1 = ei + 21, i3 = ei + 63;
    const fwd1m = (i1 < daily.length && daily[i1].c > 0) ? daily[i1].c / entry.c - 1 : null;
    const fwd3m = (i3 < daily.length && daily[i3].c > 0) ? daily[i3].c / entry.c - 1 : null;
    let spyRet = null;
    if (spy.length) { const a = benchCloseOn(spy, entry.d), b = benchCloseOn(spy, exit.d); if (a > 0 && b > 0) spyRet = b / a - 1; }
    const excess = spyRet == null ? null : fwdRet - spyRet;
    r.trackRecord = { entryDate: entry.d, fwdRet, fwd1m, fwd3m, spyRet, excess, holdDays: daily.length - 1 - ei };
    recs.push(r.trackRecord);
  });
  const meaningfulCount = meaningfulSet.size;
  const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  if (!recs.length) return { n: 0, coverage: 0, winRate: null, meanFwd: null, medianFwd: null, meanExcess: null, medianExcess: null, basketRet: null, basketExcess: null, meaningfulCount };
  const fwd = recs.map((x) => x.fwdRet);
  const exc = recs.filter((x) => x.excess != null).map((x) => x.excess);
  const wins = fwd.filter((x) => x > 0).length;
  return { n: recs.length, coverage: meaningfulCount ? recs.length / meaningfulCount : 0, winRate: wins / recs.length, meanFwd: mean(fwd), medianFwd: median(fwd), meanExcess: mean(exc), medianExcess: median(exc), basketRet: mean(fwd), basketExcess: mean(exc), meaningfulCount };
}

function computeClusters(rows, deepByTicker) {
  const cand = rows.filter((r) => deepByTicker.has(r.ticker)).slice(0, 40);
  if (cand.length < 2) return [];
  const retMap = {};
  cand.forEach((r) => { const m = new Map(); for (const x of logRetSeries(deepByTicker.get(r.ticker))) m.set(x.d, x.r); retMap[r.ticker] = m; });
  const adj = {}; cand.forEach((r) => { adj[r.ticker] = []; });
  const pairCorr = {};
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i].ticker, b = cand[j].ticker, ma = retMap[a], mb = retMap[b];
    const xs = [], ys = []; ma.forEach((v, d) => { if (mb.has(d)) { xs.push(v); ys.push(mb.get(d)); } });
    if (xs.length >= 60) { const r = pearsonB(xs, ys); if (Math.abs(r) >= 0.6) { adj[a].push(b); adj[b].push(a); pairCorr[a + "|" + b] = r; pairCorr[b + "|" + a] = r; } }
  }
  const themeOf = {}; cand.forEach((r) => { themeOf[r.ticker] = r.primary_theme || "Other"; });
  const seen = new Set(), clusters = [];
  cand.forEach((r) => {
    if (seen.has(r.ticker)) return;
    const stack = [r.ticker], comp = [];
    while (stack.length) { const t = stack.pop(); if (seen.has(t)) continue; seen.add(t); comp.push(t); adj[t].forEach((nb) => { if (!seen.has(nb)) stack.push(nb); }); }
    if (comp.length >= 2) {
      let sum = 0, cnt = 0; for (let i = 0; i < comp.length; i++) for (let j = i + 1; j < comp.length; j++) { const k = pairCorr[comp[i] + "|" + comp[j]]; if (k != null) { sum += Math.abs(k); cnt++; } }
      const tc = {}; comp.forEach((t) => { tc[themeOf[t]] = (tc[themeOf[t]] || 0) + 1; });
      let label = "?", best = -1; for (const k in tc) if (tc[k] > best) { best = tc[k]; label = k; }
      clusters.push({ members: comp.sort(), avgCorr: cnt ? sum / cnt : 0, label });
    }
  });
  return clusters.sort((a, b) => b.members.length - a.members.length);
}
function buildHtmlV2(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Serenity 500 · AleaBito Research Dashboard</title>
  <style>
    :root {
      --bg: #090d1a;
      --panel: #111827;
      --panel-2: #151b2e;
      --panel-3: #0d1324;
      --ink: #edf3ff;
      --muted: #9aa7c9;
      --subtle: #828eb0;
      --line: #1e2740;
      --line-2: #2a3450;
      --cyan: #67d9f4;
      --cyan-soft: rgba(103, 217, 244, 0.16);
      --purple: #8274f6;
      --purple-soft: rgba(130, 116, 246, 0.18);
      --pink: #ee79b8;
      --pink-soft: rgba(238, 121, 184, 0.16);
      --green: #70d69b;
      --red: #ff7d7d;
      --amber: #f6c85f;
      --radius: 22px;
      --radius-sm: 10px;
      --shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }

    html { color-scheme: dark; }
    :root[data-theme="light"] { color-scheme: light; }
    :root[data-theme="light"] {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-2: #f7f9fc;
      --panel-3: #eef2f8;
      --ink: #0f1b2d;
      --muted: #51607d;
      --subtle: #71809e;
      --line: #e3e9f2;
      --line-2: #d3dbe8;
      --cyan: #1899bd;
      --cyan-soft: rgba(24, 153, 189, 0.12);
      --purple: #6c5ce0;
      --purple-soft: rgba(108, 92, 224, 0.14);
      --pink: #d6489a;
      --pink-soft: rgba(214, 72, 154, 0.14);
      --green: #1f9d57;
      --red: #e0484d;
      --amber: #b9810f;
      --shadow: 0 12px 30px rgba(15, 23, 42, 0.1);
    }
    :root[data-theme="light"] body {
      background:
        radial-gradient(circle at 12% -8%, rgba(24, 153, 189, 0.1), transparent 32%),
        radial-gradient(circle at 80% 0%, rgba(108, 92, 224, 0.06), transparent 30%),
        linear-gradient(180deg, #f4f7fb 0%, #eef2f8 44%, #f4f7fb 100%);
    }
    :root[data-theme="light"] .pill,
    :root[data-theme="light"] .control,
    :root[data-theme="light"] .window-dates input[type="date"],
    :root[data-theme="light"] .window-preset,
    :root[data-theme="light"] .mini-metric,
    :root[data-theme="light"] .mover,
    :root[data-theme="light"] .sample,
    :root[data-theme="light"] .fund-cell,
    :root[data-theme="light"] .track-kpi,
    :root[data-theme="light"] .focus-track,
    :root[data-theme="light"] .stats-panel,
    :root[data-theme="light"] .corr-readout,
    :root[data-theme="light"] .mb { background: #ffffff; }
    :root[data-theme="light"] .table-wrap,
    :root[data-theme="light"] .line-chart,
    :root[data-theme="light"] .combo-chart { background: #fbfcfe; }
    :root[data-theme="light"] .tooltip { background: rgba(255, 255, 255, 0.98); }
    :root[data-theme="light"] th { background: #eef2f8; }
    :root[data-theme="light"] th,
    :root[data-theme="light"] td { border-bottom-color: rgba(15, 23, 42, 0.08); }
    :root[data-theme="light"] .bubble-label,
    :root[data-theme="light"] .bar-value,
    :root[data-theme="light"] .mention-text,
    :root[data-theme="light"] .section-label,
    :root[data-theme="light"] .sample-summary,
    :root[data-theme="light"] .priority-pill { color: #25324c; fill: #25324c; }
    :root[data-theme="light"] .rank { color: #8593ad; }
    :root[data-theme="light"] .chart-axis { stroke: #c3ccdb; }
    :root[data-theme="light"] .grid-line { stroke: rgba(15, 23, 42, 0.08); }
    :root[data-theme="light"] .cross-line,
    :root[data-theme="light"] .cc-line { stroke: #1f3350; }
    :root[data-theme="light"] .cross-dot,
    :root[data-theme="light"] .cc-dot { fill: #1f3350; }
    :root[data-theme="light"] .combo-base { stroke: rgba(15, 23, 42, 0.14); }
    :root[data-theme="light"] .bar-bg,
    :root[data-theme="light"] .mention-bar { fill: rgba(15, 23, 42, 0.06); background: rgba(15, 23, 42, 0.06); }
    :root[data-theme="light"] .bar-row-active .bar-bg { fill: rgba(15, 23, 42, 0.14); }
    :root[data-theme="light"] .bubble { stroke: rgba(15, 23, 42, 0.14); }
    :root[data-theme="light"] .priority-pill,
    :root[data-theme="light"] .detail-status,
    :root[data-theme="light"] .search-clear,
    :root[data-theme="light"] .legend-btn.active { background: rgba(15, 23, 42, 0.05); }
    :root[data-theme="light"] .search-clear:hover { background: rgba(15, 23, 42, 0.1); }
    :root[data-theme="light"] .window-dates input { color-scheme: light; }
    :root[data-theme="light"] tbody tr.active,
    :root[data-theme="light"] tbody tr:focus-visible { background: rgba(24, 153, 189, 0.1); }

    .seg-toggle { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--panel-3); }
    .seg-btn { appearance: none; cursor: pointer; border: 0; background: transparent; color: var(--muted); padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1; transition: color 0.16s ease, background 0.16s ease; }
    .seg-btn:hover { color: var(--ink); }
    .seg-btn.active { color: #06121b; background: var(--cyan); }

    * { box-sizing: border-box; }

    html {
      background: var(--bg);
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 12% -8%, rgba(103, 217, 244, 0.17), transparent 32%),
        radial-gradient(circle at 80% 0%, rgba(238, 121, 184, 0.13), transparent 30%),
        linear-gradient(180deg, #090d1a 0%, #0b1020 44%, #090d1a 100%);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      letter-spacing: 0;
    }

    button, input, select {
      font: inherit;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .shell {
      width: min(1880px, calc(100vw - 36px));
      margin: 0 auto;
      padding: 28px 0 52px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 28px;
      align-items: end;
      padding: 18px 8px 22px;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.09em;
    }

    .accent {
      width: 6px;
      height: 30px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--cyan), var(--cyan-soft));
      box-shadow: 0 0 22px rgba(103, 217, 244, 0.5);
    }

    h1 {
      margin: 12px 0 10px;
      font-size: clamp(40px, 6vw, 82px);
      line-height: 0.92;
      font-weight: 950;
      letter-spacing: 0;
    }

    .hero-copy {
      max-width: 880px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
    }

    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      max-width: 640px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.78);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--cyan);
      box-shadow: 0 0 14px var(--cyan);
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(150px, 1fr));
      gap: 14px;
      margin: 0 0 18px;
    }

    .kpi {
      min-height: 112px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0)),
        var(--panel);
      box-shadow: var(--shadow);
    }

    .kpi-label {
      color: var(--subtle);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .kpi-value {
      margin-top: 11px;
      font-size: 30px;
      line-height: 1;
      font-weight: 950;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .kpi-note {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.38fr) 12px minmax(372px, 0.62fr);
      gap: 18px;
      align-items: start;
    }

    .main-stack,
    .side-stack {
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-width: 0;
    }

    .chart-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.16fr) minmax(360px, 0.84fr);
      gap: 18px;
    }

    .card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0)),
        var(--panel);
      box-shadow: var(--shadow);
    }

    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.04), transparent 24%),
        radial-gradient(circle at 100% 0%, rgba(103,217,244,0.07), transparent 34%);
    }

    .card-head {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      min-height: 72px;
      padding: 24px 26px 12px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 13px;
      min-width: 0;
    }

    h2 {
      margin: 0;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 950;
      letter-spacing: 0;
    }

    .card-sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .legend {
      position: relative;
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
    }

    .legend-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
      cursor: pointer;
    }

    .legend-btn:hover,
    .legend-btn.active {
      color: var(--ink);
      background: rgba(255,255,255,0.055);
      border-color: var(--line);
    }

    .swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      box-shadow: 0 0 16px currentColor;
    }

    .c-posts { color: var(--cyan); fill: var(--cyan); background: var(--cyan); }
    .c-replies { color: var(--purple); fill: var(--purple); background: var(--purple); }
    .c-quotes { color: var(--pink); fill: var(--pink); background: var(--pink); }

    .chart-body {
      position: relative;
      z-index: 1;
      padding: 10px 26px 26px;
    }

    .big-chart {
      width: 100%;
      display: block;
      overflow: visible;
    }

    .chart-axis {
      stroke: #293553;
      stroke-width: 1;
    }

    .grid-line {
      stroke: rgba(78, 91, 130, 0.32);
      stroke-width: 1;
    }

    .axis-label,
    .tick-label {
      fill: var(--muted);
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 700;
    }

    .bar-label,
    .bubble-label {
      fill: #dce5f8;
      font-family: var(--mono);
      font-size: 14px;
      font-weight: 900;
    }

    .bar-value {
      fill: #dce5f8;
      font-size: 13px;
      font-weight: 900;
    }

    .bar-bg {
      fill: rgba(255,255,255,0.08);
    }

    .bar-seg {
      cursor: pointer;
      transition: opacity 0.16s ease, filter 0.16s ease;
    }

    .bar-row-active .bar-bg {
      fill: rgba(255,255,255,0.18);
    }

    .bar-row-active .bar-seg {
      filter: drop-shadow(0 0 12px currentColor);
    }

    .bubble {
      cursor: pointer;
      opacity: 0.82;
      stroke: rgba(255,255,255,0.25);
      stroke-width: 1;
      transition: opacity 0.2s ease, filter 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      transform-box: fill-box;
      transform-origin: center;
    }

    .bubble.active {
      opacity: 1;
      filter: drop-shadow(0 0 16px currentColor);
      transform: scale(1.06);
    }

    .bubble:hover {
      opacity: 1;
      filter: drop-shadow(0 0 22px currentColor);
      transform: scale(1.12);
    }

    #bubbleChart:has(.bubble:hover) .bubble:not(:hover) {
      opacity: 0.3;
      filter: saturate(0.7);
    }

    .donut-center {
      fill: var(--panel);
    }

    .donut-seg {
      cursor: pointer;
      stroke: var(--panel);
      stroke-width: 6;
      transform-box: view-box;
      transform-origin: 260px 215px;
      transition: opacity 0.2s ease, filter 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .donut-seg:hover {
      filter: drop-shadow(0 0 20px currentColor) brightness(1.14);
      transform: scale(1.04);
    }

    #donutChart:has(.donut-seg:hover) .donut-seg:not(:hover) {
      opacity: 0.4;
    }

    .donut-label {
      fill: var(--ink);
      font-size: 16px;
      font-weight: 900;
    }

    .donut-small {
      fill: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .controls {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(220px, 1.1fr) repeat(5, minmax(120px, 0.7fr));
      gap: 10px;
      padding: 0 26px 18px;
    }

    .control {
      width: 100%;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 11px;
      background: rgba(15, 21, 38, 0.86);
      color: var(--ink);
      padding: 0 13px;
      outline: none;
      min-width: 0;
    }

    .control::placeholder {
      color: var(--subtle);
    }

    .control:focus {
      border-color: rgba(103, 217, 244, 0.72);
      box-shadow: 0 0 0 3px rgba(103, 217, 244, 0.12);
    }

    .control-button {
      cursor: pointer;
      font-weight: 900;
      color: var(--cyan);
    }

    .control-button:hover {
      border-color: rgba(103, 217, 244, 0.72);
      background: rgba(103, 217, 244, 0.1);
    }

    .table-wrap {
      position: relative;
      z-index: 1;
      overflow: auto;
      max-height: 720px;
      margin: 0 26px 26px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(12, 17, 32, 0.72);
    }

    table {
      width: 100%;
      min-width: 1320px;
      border-collapse: collapse;
      font-size: 13px;
    }

    th, td {
      padding: 12px 12px;
      border-bottom: 1px solid rgba(61, 74, 111, 0.45);
      text-align: left;
      vertical-align: middle;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 3;
      background: #172036;
      color: var(--subtle);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      cursor: pointer;
      user-select: none;
    }

    tbody tr {
      cursor: pointer;
      transition: background 0.14s ease, box-shadow 0.14s ease;
    }

    tbody tr:hover,
    tbody tr.active {
      background: rgba(103, 217, 244, 0.065);
      box-shadow: inset 3px 0 0 var(--cyan);
    }

    .rank {
      color: #69769c;
      font-family: var(--mono);
      font-weight: 900;
    }

    .ticker {
      color: var(--cyan);
      font-family: var(--mono);
      font-weight: 950;
      letter-spacing: 0.03em;
    }

    .muted {
      color: var(--muted);
    }

    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .score-pill,
    .theme-pill,
    .priority-pill {
      display: inline-flex;
      align-items: center;
      max-width: 260px;
      height: 26px;
      padding: 0 9px;
      border-radius: 999px;
      background: rgba(255,255,255,0.07);
      color: #cdd7ef;
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .priority-high { color: var(--cyan); background: var(--cyan-soft); }
    .priority-medium { color: var(--amber); background: rgba(246, 200, 95, 0.13); }
    .priority-low, .priority-unverified { color: var(--muted); background: rgba(255,255,255,0.06); }

    .mention-bar {
      position: relative;
      height: 28px;
      min-width: 120px;
      border-radius: 5px;
      overflow: hidden;
      background: rgba(255,255,255,0.05);
    }

    .mention-fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(103,217,244,0.34), rgba(130,116,246,0.28));
    }

    .mention-text {
      position: relative;
      z-index: 1;
      display: flex;
      height: 100%;
      align-items: center;
      padding-left: 10px;
      color: #e8efff;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }

    .delta-up { color: var(--green); font-weight: 950; }
    .delta-down { color: var(--red); font-weight: 950; }
    .delta-flat { color: var(--muted); font-weight: 850; }

    .price-spark {
      width: 128px;
      height: 38px;
      display: block;
      overflow: visible;
      cursor: crosshair;
    }

    .spark-bg {
      stroke: rgba(103, 217, 244, 0.16);
      stroke-width: 1;
    }

    .spark-line {
      fill: none;
      stroke: var(--cyan);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .spark-red {
      stroke: var(--red);
    }

    .spark-crosshair {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.14s ease;
    }

    .spark-crosshair.is-on {
      opacity: 1;
    }

    .detail-body {
      position: relative;
      z-index: 1;
      padding: 0 24px 24px;
    }

    .detail-title {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding-top: 4px;
    }

    .detail-ticker {
      color: var(--cyan);
      font-family: var(--mono);
      font-size: 44px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: 0.02em;
    }

    .score-badge {
      min-width: 86px;
      min-height: 54px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(103, 217, 244, 0.35);
      border-radius: 14px;
      background: rgba(103, 217, 244, 0.12);
      color: var(--cyan);
      font-family: var(--mono);
      font-size: 20px;
      font-weight: 950;
      font-variant-numeric: tabular-nums;
    }

    .detail-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 18px 0;
    }

    .mini-metric {
      min-height: 74px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(15, 21, 38, 0.76);
    }

    .mini-label {
      color: var(--subtle);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .mini-value {
      margin-top: 8px;
      color: var(--ink);
      font-family: var(--mono);
      font-size: 18px;
      font-weight: 950;
      font-variant-numeric: tabular-nums;
    }

    .section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 20px 0 10px;
      color: #dfe8fa;
      font-size: 13px;
      font-weight: 950;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .line-chart {
      width: 100%;
      height: 190px;
      display: block;
      overflow: visible;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(12, 17, 32, 0.72);
      cursor: crosshair;
    }

    .crosshair {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.14s ease;
    }

    .crosshair.is-on {
      opacity: 1;
    }

    .crosshair.is-on .cross-line,
    .spark-crosshair.is-on .cross-line {
      transition: x1 0.12s ease-out, x2 0.12s ease-out;
    }

    .crosshair.is-on .cross-dot,
    .spark-crosshair.is-on .cross-dot {
      transition: cx 0.12s ease-out, cy 0.12s ease-out;
    }

    .combo-chart { width: 100%; height: 210px; display: block; overflow: visible; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(180deg, rgba(18,24,42,0.55), rgba(12,17,32,0.8)); cursor: crosshair; }
    .combo-base { stroke: rgba(255,255,255,0.06); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .combo-bar { fill: var(--cyan); opacity: 0.14; }
    .combo-bar.spike { fill: var(--purple); opacity: 0.4; }
    .combo-line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .combo-lbl { fill: var(--subtle); font-family: var(--mono); font-size: 11px; }
    .combo-lbl-price { font-family: var(--mono); font-size: 13px; font-weight: 800; }
    .combo-cross { opacity: 0; pointer-events: none; transition: opacity 0.14s ease; }
    .combo-cross.is-on { opacity: 1; }
    .combo-cross.is-on .cc-line { transition: x1 0.12s ease-out, x2 0.12s ease-out; }
    .combo-cross.is-on .cc-dot { transition: cx 0.12s ease-out, cy 0.12s ease-out; }
    .corr-readout { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 2px 0 12px; padding: 9px 13px; border: 1px solid var(--line); border-radius: 12px; background: rgba(13,18,33,0.6); font-size: 12px; }
    .corr-readout .corr-k { font-weight: 800; color: var(--ink); }
    .corr-readout .corr-v { font-family: var(--mono); }
    .corr-readout .corr-lead { color: var(--muted); }
    .corr-readout .corr-note { flex-basis: 100%; color: var(--subtle); font-size: 11px; }
    .corr-strong .corr-v { color: var(--green); }
    .corr-mid .corr-v { color: var(--cyan); }
    .corr-weak .corr-v { color: var(--muted); }
    .corr-muted { color: var(--muted); }
    .combo-hdr { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0 2px 6px; font-family: var(--mono); font-size: 11px; color: var(--subtle); text-transform: none; letter-spacing: 0; font-weight: 600; }
    .combo-hdr-px { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .combo-ftr { display: flex; justify-content: space-between; margin: 6px 2px 0; font-family: var(--mono); font-size: 11px; color: var(--subtle); }

    .fund-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 2px 0 14px; }
    .fund-cell { background: rgba(13,18,33,0.5); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
    .fc-l { font-size: 10px; color: var(--subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fc-v { font-family: var(--mono); font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .foreign-pill { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(246,200,95,0.16); color: var(--amber); }
    .conc-card { padding: 16px 22px 18px; margin: 0 0 18px; }
    .conc-bar { display: flex; height: 18px; border-radius: 7px; overflow: hidden; margin: 4px 0 10px; gap: 1px; }
    .conc-seg { min-width: 2px; }
    .conc-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 11px; }
    .conc-lg { display: inline-flex; align-items: center; gap: 5px; }
    .conc-lg i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
    .cluster { margin: 7px 0; font-size: 12px; }
    .cluster-label { font-family: var(--mono); color: var(--muted); margin-right: 6px; }
    .cluster-mem { font-family: var(--mono); font-size: 11px; font-weight: 700; padding: 2px 8px; margin: 2px 3px 2px 0; border-radius: 7px; background: var(--panel-3); border: 1px solid var(--line); color: var(--ink); cursor: pointer; }
    .cluster-mem:hover { background: var(--cyan); color: #06121b; }
    .conc-note { font-size: 11px; margin-top: 8px; }
    .mb-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
    .mb { font-family: var(--mono); font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: rgba(13,18,33,0.6); border: 1px solid var(--line); }
    .track-card { padding: 16px 22px 18px; margin: 0 0 18px; }
    .track-empty { display: flex; flex-direction: column; gap: 4px; }
    .track-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .track-title { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
    .track-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .track-kpi { background: rgba(13,18,33,0.55); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
    .tk-v { font-family: var(--mono); font-size: 23px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .tk-l { font-size: 11px; color: var(--muted); margin-top: 4px; }
    .track-note { font-size: 11px; color: var(--subtle); margin-top: 11px; line-height: 1.55; }
    .focus-track { display: inline-flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; background: rgba(13,18,33,0.6); border: 1px solid var(--line); margin: 0 0 10px; }
    @media (max-width: 720px) { .track-kpis { grid-template-columns: repeat(2, 1fr); } }
    .focus-card { padding: 18px 22px 20px; margin: 0 0 18px; }
    .focus-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
    .focus-id { display: flex; flex-direction: column; gap: 2px; }
    .focus-ticker { font-size: 26px; font-weight: 900; letter-spacing: -0.01em; }
    .focus-name { font-size: 12px; }
    .focus-px { font-family: var(--mono); font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .focus-chg { font-size: 14px; }
    .combo-chart--lg { height: 360px; }
    .combo-bench { fill: none; stroke: var(--purple); stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.7; vector-effect: non-scaling-stroke; }
    .combo-legend { font-size: 10px; color: var(--purple); margin-left: 8px; font-weight: 700; }
    .stats-market { font-family: var(--mono); font-size: 11.5px; color: var(--ink); margin-top: 8px; line-height: 1.6; }
    .stats-adj { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
    .stats-panel { margin-top: 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: rgba(13,18,33,0.55); }
    .stats-verdict { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 700; color: var(--ink); }
    .stats-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
    .stat-sig .stats-dot { background: var(--green); box-shadow: 0 0 10px var(--green); }
    .stat-mid .stats-dot { background: var(--amber); }
    .stat-weak .stats-dot { background: var(--subtle); }
    .stats-ccf { margin: 12px 0 8px; }
    .stats-ccf-cap { display: flex; justify-content: space-between; font-size: 11px; color: var(--subtle); margin-bottom: 4px; font-family: var(--mono); }
    .ccf-chart { width: 100%; height: 132px; display: block; }
    .ccf-tick { fill: var(--subtle); font-family: var(--mono); font-size: 10px; }
    .ccf-axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--subtle); margin-top: 2px; }
    .stats-tech { font-family: var(--mono); font-size: 11.5px; color: var(--muted); line-height: 1.7; margin-top: 6px; }
    .stats-note { font-size: 11px; color: var(--subtle); margin-top: 6px; line-height: 1.55; }
    .stats-na { color: var(--muted); font-size: 12px; }
    .grid-splitter { align-self: stretch; min-height: 200px; width: 12px; cursor: col-resize; border-radius: 6px; background: transparent; position: relative; }
    .grid-splitter::before { content: ""; position: absolute; left: 5px; top: 50%; transform: translateY(-50%); width: 2px; height: 42px; border-radius: 2px; background: var(--line-2); transition: background 0.16s ease, height 0.16s ease; }
    .grid-splitter:hover::before { background: var(--cyan); height: 64px; }

    .empty {
      display: grid;
      min-height: 130px;
      place-items: center;
      border: 1px dashed var(--line-2);
      border-radius: 16px;
      color: var(--muted);
      text-align: center;
      padding: 20px;
      line-height: 1.45;
    }

    .sample-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sample {
      border: 1px solid var(--line);
      border-radius: 15px;
      background: rgba(15, 21, 38, 0.75);
      padding: 12px;
    }

    .sample-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--subtle);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 850;
      margin-bottom: 8px;
    }

    .sample-summary {
      color: #dce6f8;
      font-size: 13px;
      line-height: 1.55;
    }

    details {
      margin-top: 9px;
    }

    summary {
      color: var(--cyan);
      cursor: pointer;
      font-size: 12px;
      font-weight: 900;
    }

    .source-text {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .movers {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 0 24px 24px;
    }

    .mover {
      min-width: 0;
      padding: 11px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(15, 21, 38, 0.76);
    }

    .mover-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 950;
    }

    .footer-note {
      margin-top: 18px;
      padding: 0 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.65;
    }

    .tooltip {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 1000;
      min-width: 190px;
      max-width: 320px;
      padding: 10px 12px;
      border: 1px solid var(--line-2);
      border-radius: 12px;
      background: rgba(10, 15, 29, 0.96);
      color: var(--ink);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      font-size: 12px;
      line-height: 1.45;
      backdrop-filter: blur(12px);
      opacity: 0;
      visibility: hidden;
      transform: translate3d(var(--tx, 0px), var(--ty, 0px), 0) scale(0.96);
      transform-origin: top left;
      will-change: transform, opacity;
      transition: opacity 0.16s ease, transform 0.13s cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0.16s;
    }

    .tooltip.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translate3d(var(--tx, 0px), var(--ty, 0px), 0) scale(1);
      transition: opacity 0.16s ease, transform 0.13s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .tooltip strong {
      color: var(--cyan);
      font-family: var(--mono);
      font-size: 14px;
    }

    .tooltip .muted {
      color: var(--muted);
    }

    @media (max-width: 1280px) {
      .dashboard-grid,
      .chart-grid,
      .hero {
        grid-template-columns: 1fr !important;
      }
      .grid-splitter { display: none; }
      .meta-strip {
        justify-content: flex-start;
      }
      .kpi-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    .anim-ready .reveal {
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.55s ease var(--reveal-delay, 0ms), transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-delay, 0ms);
      will-change: opacity, transform;
    }

    .anim-ready .reveal.reveal-in {
      opacity: 1;
      transform: none;
    }

    .bars-animate .bar-row-g {
      animation: rowReveal 0.5s ease backwards;
      animation-delay: calc(var(--ri, 0) * 24ms);
    }

    @keyframes rowReveal {
      from { opacity: 0; transform: translateX(-18px); }
      to { opacity: 1; transform: none; }
    }

    .bubbles-animate .bubble {
      animation: bubbleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
      animation-delay: calc(var(--i, 0) * 14ms);
    }

    @keyframes bubbleIn {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 0.82; }
    }

    .donut-animate {
      transform-box: fill-box;
      transform-origin: center;
      animation: donutIn 0.6s ease backwards;
    }

    @keyframes donutIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }

    .kpi {
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }

    .kpi:hover {
      border-color: var(--line-2);
      box-shadow: var(--shadow), 0 0 0 1px rgba(103, 217, 244, 0.18), 0 0 26px rgba(103, 217, 244, 0.1);
    }

    .card {
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .card:hover {
      border-color: var(--line-2);
    }

    th[data-sort]::after {
      content: "↕";
      margin-left: 5px;
      font-size: 10px;
      opacity: 0.35;
    }

    th.sort-asc::after { content: "▲"; opacity: 1; color: var(--cyan); }
    th.sort-desc::after { content: "▼"; opacity: 1; color: var(--cyan); }
    th.sort-asc, th.sort-desc { color: var(--ink); }

    .search-wrap {
      position: relative;
      width: 100%;
      min-width: 0;
    }

    .search-input {
      width: 100%;
      padding-right: 36px;
    }

    .search-clear {
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--muted);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }

    .search-clear:hover {
      background: rgba(255, 255, 255, 0.16);
      color: var(--ink);
    }

    .empty-row td {
      padding: 0;
      border-bottom: none;
    }

    .empty-row .empty {
      margin: 18px;
    }

    .detail-status {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.04em;
      background: rgba(255, 255, 255, 0.07);
      color: var(--muted);
      vertical-align: middle;
    }

    .detail-status.pinned {
      background: var(--cyan-soft);
      color: var(--cyan);
    }

    .legend-btn:focus-visible,
    .control:focus-visible,
    .search-clear:focus-visible,
    th[data-sort]:focus-visible,
    summary:focus-visible,
    tbody tr:focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
    }

    tbody tr:focus-visible {
      background: rgba(103, 217, 244, 0.08);
      box-shadow: inset 3px 0 0 var(--cyan);
    }

    .bar-row-g:focus-visible { outline: none; }
    .bar-row-g:focus-visible .bar-bg {
      stroke: var(--cyan);
      stroke-width: 1.5;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
      .reveal { opacity: 1 !important; transform: none !important; }
    }

    @media (max-width: 760px) {
      .shell {
        width: min(100vw - 20px, 1880px);
        padding-top: 18px;
      }
      h1 {
        font-size: 42px;
      }
      .kpi-grid,
      .detail-metrics,
      .movers,
      .controls {
        grid-template-columns: 1fr;
      }
      .card-head {
        display: block;
        padding: 20px 18px 10px;
      }
      .legend {
        justify-content: flex-start;
        margin-top: 12px;
      }
      .chart-body,
      .detail-body {
        padding-left: 18px;
        padding-right: 18px;
      }
      .table-wrap {
        margin-left: 18px;
        margin-right: 18px;
      }
      .window-bar { align-items: stretch; }
      .window-label { margin-left: 0; }
      .brief-themes { grid-template-columns: 1fr; }
    }
    /* === date-window bar === */
    .window-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin: 22px 0 4px;
      padding: 14px 18px;
      background: linear-gradient(180deg, var(--panel-2), var(--panel-3));
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .window-bar-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 650;
      letter-spacing: 0.02em;
      color: var(--ink);
    }
    .window-bar-title .accent {
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--cyan); box-shadow: 0 0 12px var(--cyan);
    }
    .window-presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .window-preset {
      appearance: none; cursor: pointer;
      border: 1px solid var(--line-2);
      background: rgba(15, 21, 38, 0.7);
      color: var(--muted);
      padding: 7px 13px; border-radius: 999px;
      font-size: 13px; font-weight: 600;
      transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
    }
    .window-preset:hover { color: var(--ink); border-color: var(--cyan); }
    .window-preset.active {
      color: #06121b; background: var(--cyan);
      border-color: var(--cyan); box-shadow: 0 0 16px var(--cyan-soft);
    }
    .window-dates { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .window-dates input[type="date"] {
      background: rgba(15, 21, 38, 0.86);
      border: 1px solid var(--line-2);
      color: var(--ink);
      border-radius: var(--radius-sm);
      padding: 8px 10px; font-size: 13px;
      color-scheme: dark;
    }
    .window-dates input[type="date"]:focus { outline: none; border-color: var(--cyan); }
    .window-dates .sep { color: var(--subtle); }
    .window-reset {
      appearance: none; cursor: pointer;
      border: 1px solid var(--line-2);
      background: transparent; color: var(--muted);
      padding: 7px 12px; border-radius: 999px; font-size: 13px;
      transition: color 0.16s ease, border-color 0.16s ease;
    }
    .window-reset:hover { color: var(--ink); border-color: var(--cyan); }
    .window-label {
      margin-left: auto; color: var(--cyan);
      font-family: var(--mono); font-size: 12.5px;
      white-space: nowrap;
    }
    /* === daily research brief === */
    .brief-card { margin: 22px 0; }
    .brief-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
      padding: 22px 22px 6px;
    }
    .brief-date { max-width: 170px; }
    .brief-summary {
      margin: 8px 22px 4px;
      padding: 16px 18px;
      background: var(--cyan-soft);
      border: 1px solid rgba(103, 217, 244, 0.3);
      border-radius: var(--radius-sm);
    }
    .brief-summary-label {
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--cyan); margin-bottom: 6px; font-weight: 700;
    }
    .brief-summary-text { color: var(--ink); line-height: 1.75; }
    .brief-themes {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 12px; padding: 14px 22px 6px;
    }
    .brief-theme {
      background: var(--panel-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .brief-theme[open] { border-color: var(--line-2); }
    .brief-theme > summary {
      cursor: pointer; list-style: none;
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px; font-weight: 650; color: var(--ink);
    }
    .brief-theme > summary::-webkit-details-marker { display: none; }
    .brief-theme > summary:hover { background: rgba(103, 217, 244, 0.06); }
    .brief-theme-n {
      flex: none; width: 24px; height: 24px; border-radius: 7px;
      display: grid; place-items: center;
      background: var(--cyan-soft); color: var(--cyan);
      font-family: var(--mono); font-size: 13px; font-weight: 700;
    }
    .brief-theme-title { flex: 1; }
    .brief-theme-body { padding: 4px 16px 16px; }
    .brief-field { margin-top: 12px; }
    .brief-field-label {
      font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--purple); font-weight: 700; margin-bottom: 4px;
    }
    .brief-field-text { color: var(--muted); line-height: 1.7; font-size: 14px; }
    .brief-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .brief-link {
      font-size: 12px; color: var(--cyan); text-decoration: none;
      border: 1px solid var(--line-2); border-radius: 999px;
      padding: 4px 11px; transition: background 0.16s ease, border-color 0.16s ease;
    }
    .brief-link:hover { border-color: var(--cyan); background: var(--cyan-soft); }
    .brief-chip {
      appearance: none; cursor: pointer;
      font-family: var(--mono); font-size: 0.92em; font-weight: 700;
      color: var(--cyan); background: var(--cyan-soft);
      border: 1px solid rgba(103, 217, 244, 0.32);
      border-radius: 6px; padding: 0 5px; margin: 0 1px;
      transition: background 0.14s ease, color 0.14s ease;
    }
    .brief-chip:hover { background: var(--cyan); color: #06121b; }
    .brief-total {
      margin: 10px 22px 6px; padding: 16px 18px;
      background: var(--panel-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }
    .brief-disclaimer {
      margin: 6px 22px 20px; color: var(--subtle);
      font-size: 12.5px; font-style: italic;
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero reveal">
      <div>
        <div class="eyebrow"><span class="accent"></span>AleaBito Equity Intelligence</div>
        <h1>Serenity 500</h1>
        <div class="hero-copy" data-i18n="hero_copy">基于 @aleabitoreddit 自建号以来全部提及数据生成的研究地图。排名代表注意力、提及结构、近期动量和研究优先级，不代表买卖建议。</div>
      </div>
      <div class="meta-strip" id="metaStrip"></div>
    </section>

    <section class="window-bar reveal" aria-label="时间窗口选择" data-i18n-aria="aria_win_section">
      <div class="window-bar-title"><span class="accent"></span><span data-i18n="win_title">时间窗口</span></div>
      <div class="window-presets" role="group" aria-label="预设时间窗口" data-i18n-aria="aria_win_presets">
        <button type="button" class="window-preset" data-days="7">7D</button>
        <button type="button" class="window-preset" data-days="14">14D</button>
        <button type="button" class="window-preset" data-days="30">30D</button>
        <button type="button" class="window-preset" data-days="90">90D</button>
        <button type="button" class="window-preset" data-days="180">180D</button>
        <button type="button" class="window-preset" data-days="all" data-i18n="win_all">全部</button>
      </div>
      <div class="window-dates">
        <input type="date" id="winStart" aria-label="开始日期" data-i18n-aria="aria_date_start">
        <span class="sep">→</span>
        <input type="date" id="winEnd" aria-label="结束日期" data-i18n-aria="aria_date_end">
        <button type="button" class="window-reset" id="winReset" data-i18n="reset">重置</button>
      </div>
      <div class="seg-toggle theme-toggle" role="group" aria-label="主题 / Theme">
        <button type="button" class="seg-btn" data-theme-val="light">浅 Light</button>
        <button type="button" class="seg-btn" data-theme-val="dark">深 Dark</button>
      </div>
      <div class="seg-toggle lang-toggle" role="group" aria-label="语言 / Language">
        <button type="button" class="seg-btn" data-lang-val="zh">中</button>
        <button type="button" class="seg-btn" data-lang-val="en">EN</button>
      </div>
      <div class="window-label" id="winLabel"></div>
    </section>

    <section class="kpi-grid" id="kpiGrid"></section>

    <section class="card reveal track-card" id="trackCard" data-testid="track-card"><div id="trackBody"></div></section>

    <section class="card reveal brief-card" id="briefCard" data-testid="brief-card">
      <div id="briefBody"></div>
    </section>

    <section class="card reveal conc-card" id="concCard" data-testid="conc-card"><div id="concBody"></div></section>

    <section class="card reveal focus-card" id="focusCard" data-testid="focus-card"><div id="focusBody"></div></section>
    <section class="dashboard-grid">
      <div class="main-stack">
        <section class="card reveal" data-testid="composition-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2 data-i18n="card_comp_title">Top 30 Ticker · 提及构成分解</h2></div>
              <div class="card-sub" data-i18n="card_comp_sub">横向堆叠条显示主帖、回复和引用的构成。图例可点击开关。</div>
            </div>
            <div class="legend" id="seriesLegend"></div>
          </div>
          <div class="chart-body">
            <svg class="big-chart" id="topCompositionChart" viewBox="0 0 1180 1080" role="img" aria-label="Top 30 ticker mention composition"></svg>
          </div>
        </section>

        <section class="chart-grid">
          <div class="card reveal" data-testid="bubble-card">
            <div class="card-head">
              <div>
                <div class="title-row"><span class="accent"></span><h2 data-i18n="card_bubble_title">提及结构 · 主帖 vs 互动</h2></div>
                <div class="card-sub" data-i18n="card_bubble_sub">气泡大小 = 原始提及次数，展示哪些 ticker 是主动 thesis，哪些更多来自互动讨论。</div>
              </div>
              <span class="pill">Top 50</span>
            </div>
            <div class="chart-body">
              <svg class="big-chart" id="bubbleChart" viewBox="0 0 760 560" role="img" aria-label="Post and interaction bubble chart"></svg>
            </div>
          </div>

          <div class="card reveal" data-testid="donut-card">
            <div class="card-head">
              <div>
                <div class="title-row"><span class="accent"></span><h2 data-i18n="card_donut_title">提及类型分布</h2></div>
                <div class="card-sub" data-i18n="card_donut_sub">全样本聚合：主帖、回复、引用的占比。</div>
              </div>
            </div>
            <div class="chart-body">
              <svg class="big-chart" id="donutChart" viewBox="0 0 520 520" role="img" aria-label="Mention type distribution donut chart"></svg>
            </div>
          </div>
        </section>

        <section class="card reveal" data-testid="data-table-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2><span data-i18n="tbl_full">完整数据</span> · <span id="tableTickerCount"></span> <span data-i18n="tbl_tickers">个 Ticker</span></h2></div>
              <div class="card-sub" data-i18n="card_table_sub">搜索、排序和筛选会联动详情面板。鼠标悬停或点击行可快速查看单个 ticker。</div>
            </div>
            <span class="pill"><span class="dot"></span><span id="resultCount"></span></span>
          </div>
          <div class="controls">
            <div class="search-wrap"><input class="control search-input" id="searchBox" placeholder="搜索 ticker / theme / priority" aria-label="搜索 ticker、theme 或 priority" data-i18n-ph="search_ph" data-i18n-aria="aria_search"><button class="search-clear" id="searchClear" type="button" aria-label="清除搜索" data-i18n-aria="aria_search_clear" style="display:none">×</button></div>
            <select class="control" id="themeFilter"></select>
            <select class="control" id="priorityFilter">
              <option value="all" data-i18n="f_all_priority">所有优先级</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="unverified">Unverified</option>
            </select>
            <select class="control" id="priceFilter">
              <option value="all" data-i18n="f_all_price">所有价格状态</option>
              <option value="ok" data-i18n="f_price_ok">有价格图</option>
              <option value="missing" data-i18n="f_price_missing">暂无价格图</option>
              <option value="up" data-i18n="f_price_up">3M 上涨</option>
              <option value="down" data-i18n="f_price_down">3M 下跌</option>
            </select>
            <select class="control" id="limitSelect">
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="all">全部</option>
            </select>
            <button class="control control-button" id="resetFilters" type="button" data-i18n="reset_filters">重置筛选</button>
          </div>
          <div class="table-wrap">
            <table aria-label="Ticker 完整数据表" data-i18n-aria="aria_table">
              <thead>
                <tr>
                  <th scope="col" data-sort="serenity_rank">#</th>
                  <th scope="col" data-sort="ticker">Ticker</th>
                  <th scope="col" data-sort="mentioned_posts" data-i18n="th_posts">提及帖子</th>
                  <th scope="col" data-sort="raw_occurrences" data-i18n="th_raw">原始次数</th>
                  <th scope="col" data-sort="post_mentions" data-i18n="th_post">主帖</th>
                  <th scope="col" data-sort="reply_mentions" data-i18n="th_reply">回复</th>
                  <th scope="col" data-sort="quote_mentions" data-i18n="th_quote">引用</th>
                  <th scope="col" data-sort="primary_theme" data-i18n="th_theme">主题</th>
                  <th scope="col" data-sort="last7">7D</th>
                  <th scope="col" data-sort="price.change_pct">3M Price</th>
                  <th scope="col" data-i18n="th_spark">价格趋势</th>
                  <th scope="col" data-sort="last_seen" data-i18n="th_last">最后提及</th>
                </tr>
              </thead>
              <tbody id="rankBody"></tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="grid-splitter" id="gridSplitter" role="separator" aria-orientation="vertical" title="拖动调整宽度" data-i18n-title="splitter_title"></div>
      <aside class="side-stack">
        <section class="card reveal" data-testid="stock-detail-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2 data-i18n="card_detail_title">Stock Detail</h2></div>
              <div class="card-sub" data-i18n="card_detail_sub">提及趋势、价格趋势、中文来源摘要和英文原文。</div>
            </div>
          </div>
          <div class="detail-body" id="detailBody"></div>
        </section>

        <section class="card reveal" data-testid="movers-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2 data-i18n="card_movers_title">Price Movers</h2></div>
              <div class="card-sub" data-i18n="card_movers_sub">按 3 个月价格变化绝对值排序。</div>
            </div>
          </div>
          <div class="movers" id="movers"></div>
        </section>
      </aside>
    </section>

    <div class="footer-note" id="footerNote"></div>
  </main>
  <div class="tooltip" id="chartTooltip"></div>

  <script>
    const DASHBOARD_DATA = ${json};
    var I18N = {
      zh: {
        hero_copy: '基于 @aleabitoreddit 自建号以来全部提及数据生成的研究地图。排名代表注意力、提及结构、近期动量和研究优先级，不代表买卖建议。',
        win_title: '时间窗口', win_all: '全部', reset: '重置', reset_filters: '重置筛选',
        aria_win_section: '时间窗口选择', aria_win_presets: '预设时间窗口', aria_date_start: '开始日期', aria_date_end: '结束日期', lang_aria: '语言 / Language',
        card_comp_title: 'Top 30 Ticker · 提及构成分解', card_comp_sub: '横向堆叠条显示主帖、回复和引用的构成。图例可点击开关。',
        card_bubble_title: '提及结构 · 主帖 vs 互动', card_bubble_sub: '气泡大小 = 原始提及次数，展示哪些 ticker 是主动 thesis，哪些更多来自互动讨论。',
        card_donut_title: '提及类型分布', card_donut_sub: '全样本聚合：主帖、回复、引用的占比。',
        tbl_full: '完整数据', tbl_tickers: '个 Ticker', card_table_sub: '搜索、排序和筛选会联动详情面板。鼠标悬停或点击行可快速查看单个 ticker。',
        card_detail_title: '个股详情 Stock Detail', card_detail_sub: '提及趋势、价格趋势、中文来源摘要和英文原文。',
        card_movers_title: '价格异动 Price Movers', card_movers_sub: '按 3 个月价格变化绝对值排序。',
        f_all_priority: '所有优先级', f_all_price: '所有价格状态', f_price_ok: '有价格图', f_price_missing: '暂无价格图', f_price_up: '3M 上涨', f_price_down: '3M 下跌',
        search_ph: '搜索 ticker / theme / priority', aria_search: '搜索 ticker、theme 或 priority', aria_search_clear: '清除搜索', aria_table: 'Ticker 完整数据表', splitter_title: '拖动调整宽度',
        th_posts: '提及帖子', th_raw: '原始次数', th_post: '主帖', th_reply: '回复', th_quote: '引用', th_theme: '主题', th_spark: '价格趋势',
        kpi_universe_sub: '可排序研究标的', kpi_mentions_unit: ' 天 ticker mention posts', kpi_priority_sub: 'skill 标记的高优先级线索', kpi_price_sub: 'Yahoo chart 拉取成功',
        bf_view: '她的观点', bf_beginner: '小白解释', bf_fp: '第一性原理', bf_buffett: 'Buffett 判断', bf_conclusion: '当前结论', bf_links: '关键链接', bf_title: '每日研究简报', bf_focus: '今天她重点看什么', bf_total: '总分析', bf_range: '范围', bf_dedup: '去重', bf_items: '条', bf_source: '来源', aria_brief_date: '选择简报日期', f_all_theme: '所有主题',
        foot_src: '数据源：', foot_price: '。价格趋势来自 ', foot_disc: '。高提及度只代表研究地图信号，不构成投资建议。',
        stats_na: '提及 × 股价模型：重叠的价格/提及数据不足（需 ≥12 个交易日），暂无法建模。',
        dir_pos: '正相关', dir_neg: '负相关',
        v_granger_a: '提及对其后收益有统计显著的领先关系，方向为', v_granger_b: '（格兰杰检验通过，证据较强）',
        v_leads_a: '提及领先收益约 ', v_leads_b: ' 天，呈', v_leads_c_strong: '（提及增多→其后收益偏强；相关显著但格兰杰未达显著，证据偏弱）', v_leads_c_weak: '（提及增多→其后收益偏弱；相关显著但格兰杰未达显著，证据偏弱）',
        v_react_a: '收益领先提及约 ', v_react_b: ' 天，呈', v_react_c: '——更像她对价格已动的反应，而非预测',
        v_sync_a: '提及与当日收益同步', v_sync_b: '（无明显领先或滞后）',
        v_none_a: '在此样本下未发现提及与收益的统计显著关系（最强信号为', v_none_b: '，仍在噪声带内）',
        tech_g: '格兰杰 提及→收益 F=', tech_rev: ' · 收益→提及 p=', tech_sp: ' · 同步 Spearman ρ=', tech_ccf: ' · CCF 峰值 lag=',
        stats_caveat_a: '样本 n=', stats_caveat_b: ' 个交易日 · 小样本 + 多重比较；格兰杰为"预测性先后"而非真正因果 · 仅描述，不构成投资建议',
        ccf_cap: '互相关 CCF：提及 → 收益（滞后/领先天数）', ccf_band: '虚线=95%显著带 ±', ccf_left: '← 收益领先提及（她在反应）', ccf_right: '提及领先收益（她在预测）→',
        mkt_adj_a: '剔除大盘后（残差·完整窗口）：同步 ρ=', mkt_adj_sig: ' ✓ 仍显著', mkt_adj_ns: ' · 噪声内', mkt_alpha: ' · α(年化)=', mkt_rel: ' · 63D相对强弱=',
        fund_label: '基本面与流动性 · Fundamentals', fund_src_full: 'Yahoo 完整', fund_src_quote: 'Yahoo 简表', fund_src_part: '部分数据', fund_foreign: ' · 海外上市', foreign_short: '海外',
        fd_mktcap: '市值 Mkt Cap', fd_adv: '日均成交额 ADV', fd_short: '做空 / 流通 Short%', fd_d2c: '回补天数 D2C', fd_pe: '市盈率 P/E', fd_fpe: '预期 Fwd P/E', fd_ps: '市销率 P/S', fd_margin: '净利率 Margin', fd_earn: '下次财报 Earnings', fd_days_after: ' 天后', fd_days_before: ' 天前',
        mom_accel: '加速 ', mom_age: '入档 ', mom_recency: '最近提及 ', mom_ago: 'd前',
        conc_title: '主题集中度 · Concentration', conc_sub: '她的注意力分布 + 7D 轮动 ▲▼', conc_cluster: '相关性集群 · 同一押注', conc_cluster_sub: '日收益相关性 ≥ 0.6', conc_note: '提示集中度风险（这些其实是同一条供应链押注），非统计因果。',
        track_title: '跟随战绩 · Track Record', track_empty: '待价格历史回填后计算：自她首次提及（次日入场）起算的前向收益、胜率与超额 SPY。', track_head_sub: '自她首次提及（次日收盘入场）起算 · 不随上方时间窗变化', track_win: '胜率 / Win rate', track_excess: '中位超额 vs SPY', track_basket: '等权篮子回报', track_median: '中位个股回报', track_note_a: '基于 ', track_note_b: ' 只有价格覆盖的标的 · 入场=首次提及次日收盘 · 未做幸存者偏差校正 · 仅描述历史，不构成投资建议', track_badge_a: '自首次提及 ', track_badge_b: '超额 SPY ',
        empty_focus: '悬停或点击任意标的查看其价格 × 提及焦点图', empty_price: '暂无价格数据', empty_price_sub: '该标的价格无法解析，无法绘制提及×价格叠加图。', empty_chart: '暂无可绘制数据', empty_chart_sub: '价格数据可能缺失或 Yahoo symbol 无法解析。', empty_samples: '暂无来源样本', empty_data: '暂无数据', empty_noprice: '暂无价格',
        det_preview: '预览中 · 点击锁定', det_locked: '已锁定', det_samples: '最新来源样本', det_samples_sub: '中文摘要 + 英文原文', det_src_hint: '这条来源需要结合英文原文判断语境。', det_view_en: '查看英文原文', det_open_src: '打开来源', det_attempted: '暂无价格数据 · attempted ',
        combo_hdr: '价格走势 · 柱 = 当日提及量',
        th_last: '最后提及'
      },
      en: {
        hero_copy: 'A research map built from every cashtag mention since @aleabitoreddit started posting. Rank reflects attention, mention structure, recent momentum and research priority — not buy/sell advice.',
        win_title: 'Time Window', win_all: 'All', reset: 'Reset', reset_filters: 'Reset filters',
        aria_win_section: 'Time window selection', aria_win_presets: 'Preset time windows', aria_date_start: 'Start date', aria_date_end: 'End date', lang_aria: '语言 / Language',
        card_comp_title: 'Top 30 Tickers · Mention Composition', card_comp_sub: 'Stacked bars show the post / reply / quote composition. Click the legend to toggle series.',
        card_bubble_title: 'Mention Structure · Posts vs Interaction', card_bubble_sub: 'Bubble size = raw mentions; shows which tickers are active theses vs interaction-driven chatter.',
        card_donut_title: 'Mention Type Distribution', card_donut_sub: 'Whole-sample aggregate: share of posts, replies and quotes.',
        tbl_full: 'Full Data', tbl_tickers: 'tickers', card_table_sub: 'Search, sort and filter drive the detail panel. Hover or click a row to inspect a single ticker.',
        card_detail_title: 'Stock Detail', card_detail_sub: 'Mention trend, price trend, Chinese source summaries and English originals.',
        card_movers_title: 'Price Movers', card_movers_sub: 'Sorted by absolute 3-month price change.',
        f_all_priority: 'All priorities', f_all_price: 'All price status', f_price_ok: 'Has price', f_price_missing: 'No price', f_price_up: '3M up', f_price_down: '3M down',
        search_ph: 'Search ticker / theme / priority', aria_search: 'Search ticker, theme or priority', aria_search_clear: 'Clear search', aria_table: 'Full ticker data table', splitter_title: 'Drag to resize',
        th_posts: 'Posts', th_raw: 'Raw', th_post: 'Post', th_reply: 'Reply', th_quote: 'Quote', th_theme: 'Theme', th_spark: 'Price trend',
        kpi_universe_sub: 'Sortable research names', kpi_mentions_unit: 'd ticker mention posts', kpi_priority_sub: 'Skill-flagged high-priority leads', kpi_price_sub: 'Yahoo charts fetched',
        bf_view: 'Her view', bf_beginner: 'In plain terms', bf_fp: 'First principles', bf_buffett: 'Buffett lens', bf_conclusion: 'Current take', bf_links: 'Key link', bf_title: 'Daily Research Brief', bf_focus: 'Today’s focus', bf_total: 'Synthesis', bf_range: 'Range', bf_dedup: 'Deduped', bf_items: 'items', bf_source: 'Source', aria_brief_date: 'Select brief date', f_all_theme: 'All themes',
        foot_src: 'Sources: ', foot_price: '. Price trends from ', foot_disc: '. High mention counts are research-map signals only — not investment advice.',
        stats_na: 'Mention × Price model: not enough overlapping price/mention data (need ≥12 trading days) to model yet.',
        dir_pos: 'positive', dir_neg: 'negative',
        v_granger_a: 'Mentions significantly lead subsequent returns; direction: ', v_granger_b: ' (Granger test passes — stronger evidence)',
        v_leads_a: 'Mentions lead returns by ~', v_leads_b: ' days, ', v_leads_c_strong: ' (more mentions → stronger subsequent returns; correlation significant but Granger n.s. — weaker evidence)', v_leads_c_weak: ' (more mentions → weaker subsequent returns; correlation significant but Granger n.s. — weaker evidence)',
        v_react_a: 'Returns lead mentions by ~', v_react_b: ' days, ', v_react_c: ' — looks more like her reacting to a move than predicting it',
        v_sync_a: 'Mentions move with same-day returns, ', v_sync_b: ' (no clear lead or lag)',
        v_none_a: 'No statistically significant mention↔return relationship in this sample (strongest signal ', v_none_b: ', still within the noise band)',
        tech_g: 'Granger mentions→returns F=', tech_rev: ' · returns→mentions p=', tech_sp: ' · contemp. Spearman ρ=', tech_ccf: ' · CCF peak lag=',
        stats_caveat_a: 'Sample n=', stats_caveat_b: ' trading days · small sample + multiple comparisons; Granger = predictive precedence, not true causation · descriptive only, not advice',
        ccf_cap: 'Cross-correlation: mentions → returns (lag/lead days)', ccf_band: 'dashed = 95% band ±', ccf_left: '← returns lead mentions (reacting)', ccf_right: 'mentions lead returns (predicting) →',
        mkt_adj_a: 'Market-adjusted (residual · full window): contemp. ρ=', mkt_adj_sig: ' ✓ still significant', mkt_adj_ns: ' · within noise', mkt_alpha: ' · α(ann.)=', mkt_rel: ' · 63D rel. strength=',
        fund_label: 'Fundamentals & Liquidity', fund_src_full: 'Yahoo full', fund_src_quote: 'Yahoo quote', fund_src_part: 'partial', fund_foreign: ' · foreign-listed', foreign_short: 'Intl',
        fd_mktcap: 'Mkt Cap', fd_adv: 'Avg $ Vol', fd_short: 'Short % Float', fd_d2c: 'Days to Cover', fd_pe: 'P/E', fd_fpe: 'Fwd P/E', fd_ps: 'P/S', fd_margin: 'Profit Margin', fd_earn: 'Next Earnings', fd_days_after: 'd away', fd_days_before: 'd ago',
        mom_accel: 'Accel ', mom_age: 'Age ', mom_recency: 'Last seen ', mom_ago: 'd ago',
        conc_title: 'Theme Concentration', conc_sub: 'Her attention split + 7D rotation ▲▼', conc_cluster: 'Correlated cluster · same bet', conc_cluster_sub: 'daily-return correlation ≥ 0.6', conc_note: 'Flags concentration risk (these are really one supply-chain bet) — not statistical causation.',
        track_title: 'Track Record', track_empty: 'Computed after the price-history backfill: forward return, win rate and excess vs SPY from her first mention (next-day entry).', track_head_sub: 'From her first mention (next-day close entry) · does not change with the window above', track_win: 'Win rate', track_excess: 'Median excess vs SPY', track_basket: 'Equal-weight basket', track_median: 'Median single-name', track_note_a: 'Based on ', track_note_b: ' priced names · entry = next close after first mention · not survivorship-adjusted · descriptive history, not advice', track_badge_a: 'Since first mention ', track_badge_b: 'excess SPY ',
        empty_focus: 'Hover or click any ticker to see its price × mention focus chart', empty_price: 'No price data', empty_price_sub: 'Price for this ticker could not be resolved; cannot draw the mention × price overlay.', empty_chart: 'Nothing to plot', empty_chart_sub: 'Price data may be missing or the Yahoo symbol could not be resolved.', empty_samples: 'No source samples', empty_data: 'No data', empty_noprice: 'No price',
        det_preview: 'Previewing · click to pin', det_locked: 'Pinned', det_samples: 'Latest source samples', det_samples_sub: 'Chinese summary + English original', det_src_hint: 'This source needs the English original for context.', det_view_en: 'View English original', det_open_src: 'Open source', det_attempted: 'No price data · attempted ',
        combo_hdr: 'Price trend · bars = daily mentions',
        th_last: 'Last seen'
      }
    };
    function t(k) { var d = I18N[state.lang] || I18N.zh; return (d[k] != null) ? d[k] : (I18N.zh[k] != null ? I18N.zh[k] : k); }
    const SERIES = [
      { key: "posts", label: "主帖 Posts", color: "#67d9f4", className: "c-posts" },
      { key: "replies", label: "回复 Replies", color: "#8274f6", className: "c-replies" },
      { key: "quotes", label: "引用 Quotes", color: "#ee79b8", className: "c-quotes" },
    ];
    const state = {
      lang: 'zh',
      sortKey: "serenity_rank",
      sortDir: "asc",
      pinnedTicker: DASHBOARD_DATA.rows[0] ? DASHBOARD_DATA.rows[0].ticker : null,
      hoverTicker: null,
      visibleSeries: { posts: true, replies: true, quotes: true },
      windowStart: null,
      windowEnd: null,
    };

    // Pristine full-range snapshots so the date-window picker can recompute from source.
    DASHBOARD_DATA.baseRows = DASHBOARD_DATA.rows;
    DASHBOARD_DATA.baseTopMovers = DASHBOARD_DATA.topMovers;
    DASHBOARD_DATA.baseThemeStats = DASHBOARD_DATA.themeStats;
    const WINDOW_MIN = DASHBOARD_DATA.dataWindow.earliestDate;
    const WINDOW_MAX = DASHBOARD_DATA.dataWindow.latestDate;
    state.windowStart = WINDOW_MIN;
    state.windowEnd = WINDOW_MAX;

    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let firstPaint = true;

    const $ = (id) => document.getElementById(id);
    const tooltip = $("chartTooltip");

    function activeTicker() {
      return state.hoverTicker || state.pinnedTicker;
    }

    function debounce(fn, wait) {
      let timer = null;
      return function () {
        const args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(null, args); }, wait);
      };
    }

    function countUp(el, target, duration) {
      if (reducedMotion) { el.textContent = formatNumber(target); return; }
      const start = performance.now();
      let done = false;
      function finish() { if (!done) { done = true; el.textContent = formatNumber(target); } }
      function tick(now) {
        if (done) return;
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = formatNumber(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
        else done = true;
      }
      requestAnimationFrame(tick);
      // Guarantee the final value even if rAF is throttled (e.g. background tab), so KPIs never stay stuck mid-animation.
      setTimeout(finish, duration + 250);
    }

    function html(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function formatNumber(value, digits = 0) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value));
    }

    function formatPct(value, digits = 1) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
      const sign = Number(value) > 0 ? "+" : "";
      return sign + formatNumber(value, digits) + "%";
    }

    function getValue(row, key) {
      return key.split(".").reduce((acc, part) => acc == null ? undefined : acc[part], row);
    }

    function deltaClass(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num === 0) return "delta-flat";
      return num > 0 ? "delta-up" : "delta-down";
    }

    function priorityClass(priority) {
      return "priority-" + (priority || "unverified");
    }

    function moveTooltip(event) {
      const pad = 18;
      const rect = tooltip.getBoundingClientRect();
      let x = event.clientX + pad;
      let y = event.clientY + pad;
      if (x + rect.width > window.innerWidth - 10) x = event.clientX - rect.width - pad;
      if (y + rect.height > window.innerHeight - 10) y = event.clientY - rect.height - pad;
      tooltip.style.setProperty("--tx", Math.max(10, x) + "px");
      tooltip.style.setProperty("--ty", Math.max(10, y) + "px");
    }

    function showTooltip(event, content) {
      tooltip.innerHTML = content;
      if (tooltip.classList.contains("is-visible")) {
        moveTooltip(event);
      } else {
        tooltip.style.transition = "none";
        moveTooltip(event);
        void tooltip.offsetWidth;
        tooltip.style.transition = "";
        tooltip.classList.add("is-visible");
      }
    }

    function hideTooltip() {
      tooltip.classList.remove("is-visible");
    }

    function rowByTicker(ticker) {
      return DASHBOARD_DATA.rows.find((row) => row.ticker === ticker);
    }

    function setHoverTicker(ticker) {
      if (!ticker || state.hoverTicker === ticker) return;
      state.hoverTicker = ticker;
      updateActiveHighlights();
      renderDetail();
    }

    function clearHoverTicker() {
      if (!state.hoverTicker) return;
      state.hoverTicker = null;
      updateActiveHighlights();
      renderDetail();
    }

    function setPinnedTicker(ticker) {
      if (!ticker) return;
      state.pinnedTicker = ticker;
      state.hoverTicker = null;
      updateActiveHighlights();
      renderDetail();
    }

    function visibleCompositionTotal(row) {
      return SERIES.reduce((sum, item) => state.visibleSeries[item.key] ? sum + row.composition[item.key] : sum, 0);
    }

    function makeLinePath(values, width, height, pad) {
      const finite = values.filter((value) => Number.isFinite(value));
      if (finite.length < 2) return "";
      const min = Math.min.apply(null, finite);
      const max = Math.max.apply(null, finite);
      const span = max - min || 1;
      return values.map((value, index) => {
        const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        return (index === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
      }).join(" ");
    }

    function priceSpark(row) {
      const points = row.price.points || [];
      if (!points.length) {
        return '<span class="muted">暂无价格</span>';
      }
      const width = 128;
      const height = 38;
      const path = makeLinePath(points.map((point) => Number(point.close)), width, height, 4);
      const lineClass = Number(row.price.change_pct) < 0 ? "spark-line spark-red" : "spark-line";
      return '<span class="spark-wrap"><svg class="price-spark js-price-chart" data-ticker="' + row.ticker + '" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<path class="spark-bg" d="M4,' + (height / 2) + ' L' + (width - 4) + ',' + (height / 2) + '"></path>' +
        '<path class="' + lineClass + '" d="' + path + '"></path>' +
        '<g class="spark-crosshair"><line class="cross-line" y1="2" y2="' + (height - 2) + '" stroke="#edf3ff" stroke-width="1" opacity="0.55"></line><circle class="cross-dot" r="3" fill="#edf3ff"></circle></g>' +
        '</svg></span>';
    }

    function arcPath(cx, cy, r, startAngle, endAngle) {
      const start = {
        x: cx + r * Math.cos(startAngle),
        y: cy + r * Math.sin(startAngle),
      };
      const end = {
        x: cx + r * Math.cos(endAngle),
        y: cy + r * Math.sin(endAngle),
      };
      const large = endAngle - startAngle > Math.PI ? 1 : 0;
      return "M " + start.x + " " + start.y + " A " + r + " " + r + " 0 " + large + " 1 " + end.x + " " + end.y + " L " + cx + " " + cy + " Z";
    }

    // ===== date-window engine (YYYY-MM-DD strings sort chronologically) =====
    function toDateNum(str) {
      const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(str || "");
      return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
    }
    function daysBetweenStr(a, b) {
      return Math.round((toDateNum(b) - toDateNum(a)) / 86400000);
    }
    function addDaysStr(str, delta) {
      const n = toDateNum(str);
      if (Number.isNaN(n)) return str;
      return new Date(n + delta * 86400000).toISOString().slice(0, 10);
    }
    function clampDate(str) {
      if (str < WINDOW_MIN) return WINDOW_MIN;
      if (str > WINDOW_MAX) return WINDOW_MAX;
      return str;
    }
    function isFullWindow() {
      return state.windowStart === WINDOW_MIN && state.windowEnd === WINDOW_MAX;
    }
    function windowDays() {
      return Math.max(1, daysBetweenStr(state.windowStart, state.windowEnd) + 1);
    }
    function priorityRankClient(priority) {
      if (priority === "high") return 3;
      if (priority === "medium") return 2;
      if (priority === "low") return 1;
      return 0;
    }
    function winSum(series, endDate, days, offset) {
      const lo = offset || 0;
      const hi = lo + days - 1;
      return series.reduce((acc, p) => {
        const d = daysBetweenStr(p.date, endDate);
        if (d < lo || d > hi) return acc;
        acc.posts += p.mentioned_posts;
        acc.raw += p.raw_occurrences;
        return acc;
      }, { posts: 0, raw: 0 });
    }
    function maxDrawdownClient(points) {
      let peak = -Infinity, dd = 0;
      points.forEach((p) => {
        const c = Number(p.close);
        if (!Number.isFinite(c)) return;
        peak = Math.max(peak, c);
        if (peak > 0) dd = Math.min(dd, ((c - peak) / peak) * 100);
      });
      return dd;
    }
    function windowPrice(base, start, end) {
      const pts = (base.points || []).filter((p) => p.date >= start && p.date <= end);
      if (pts.length < 2) {
        return Object.assign({}, base, {
          points: pts,
          change_pct: null,
          range_high: null,
          range_low: null,
          max_drawdown_pct: null,
          windowLimited: true,
        });
      }
      const closes = pts.map((p) => Number(p.close)).filter(Number.isFinite);
      const first = Number(pts[0].close);
      const last = Number(pts[pts.length - 1].close);
      return Object.assign({}, base, {
        points: pts,
        last_close: last,
        change_pct: first ? ((last - first) / first) * 100 : null,
        range_high: closes.length ? Math.max.apply(null, closes) : null,
        range_low: closes.length ? Math.min.apply(null, closes) : null,
        max_drawdown_pct: maxDrawdownClient(pts),
        windowLimited: false,
      });
    }
    function windowRow(base, start, end) {
      const series = (base.mentionSeries || []).filter((p) => p.date >= start && p.date <= end);
      let mentioned = 0, raw = 0, postM = 0, quoteM = 0, replyM = 0;
      series.forEach((p) => {
        mentioned += p.mentioned_posts;
        raw += p.raw_occurrences;
        postM += p.post_mentions;
        quoteM += p.quote_mentions;
        replyM += p.reply_mentions;
      });
      if (!mentioned) return null;
      const originalWeight = mentioned ? (postM + quoteM) / mentioned : 0;
      const w7 = winSum(series, end, 7);
      const p7 = winSum(series, end, 7, 7);
      const w14 = winSum(series, end, 14);
      const w30 = winSum(series, end, 30);
      const last7 = w7.posts;
      const prev7 = p7.posts;
      const velocity = last7 - prev7;
      const lastSeen = series.length ? series[series.length - 1].date : base.last_seen;
      const examples = (base.examples || []).filter((ex) => {
        const d = (ex.created_at || "").slice(0, 10);
        return d >= start && d <= end;
      });
      return {
        rank: base.rank,
        ticker: base.ticker,
        mentioned_posts: mentioned,
        raw_occurrences: raw,
        post_mentions: postM,
        quote_mentions: quoteM,
        reply_mentions: replyM,
        first_seen: series.length ? series[0].date : base.first_seen,
        last_seen: lastSeen,
        names: base.names,
        primary_theme: base.primary_theme,
        research_priority: base.research_priority,
        example_url: base.example_url,
        composition: { posts: postM, replies: replyM, quotes: quoteM, total: mentioned },
        interaction: { xPosts: postM, yInteractions: replyM + quoteM, bubbleSize: Math.sqrt(Math.max(mentioned, 1)) },
        last7,
        prev7,
        last14: w14.posts,
        last30: w30.posts,
        rawLast7: w7.raw,
        velocity,
        velocityPct: prev7 ? (velocity / prev7) * 100 : last7 > 0 ? 100 : 0,
        daysSinceLast: lastSeen ? daysBetweenStr(lastSeen, end) : null,
        originalWeight,
        qualityFlag: base.qualityFlag,
        mentionSeries: series,
        examples,
        fundamentals: base.fundamentals,
        trackRecord: base.trackRecord,
        marketStats: base.marketStats,
        momentum: base.momentum,
        price: windowPrice(base.price, start, end),
      };
    }
    function recomputeWindow(start, end) {
      if (start === WINDOW_MIN && end === WINDOW_MAX) {
        DASHBOARD_DATA.rows = DASHBOARD_DATA.baseRows;
        DASHBOARD_DATA.topMovers = DASHBOARD_DATA.baseTopMovers;
        DASHBOARD_DATA.themeStats = DASHBOARD_DATA.baseThemeStats;
        return;
      }
      const rows = [];
      DASHBOARD_DATA.baseRows.forEach((base) => {
        const r = windowRow(base, start, end);
        if (r) rows.push(r);
      });
      const max = { mentioned: 1, raw: 1, last30: 1, last7: 1, velocity: 1 };
      rows.forEach((r) => {
        max.mentioned = Math.max(max.mentioned, Math.log1p(r.mentioned_posts));
        max.raw = Math.max(max.raw, Math.log1p(r.raw_occurrences));
        max.last30 = Math.max(max.last30, Math.log1p(r.last30));
        max.last7 = Math.max(max.last7, Math.log1p(r.last7));
        max.velocity = Math.max(max.velocity, Math.max(0, r.velocity));
      });
      rows.forEach((r) => {
        const score = (Math.log1p(r.mentioned_posts) / max.mentioned) * 55
          + (Math.log1p(r.raw_occurrences) / max.raw) * 15
          + (Math.log1p(r.last30) / max.last30) * 12
          + (Math.log1p(r.last7) / max.last7) * 8
          + (Math.max(0, r.velocity) / max.velocity) * 4
          + r.originalWeight * 4
          + priorityRankClient(r.research_priority) * 0.7;
        r.serenity_score = Math.round(score * 10) / 10;
      });
      rows.sort((a, b) => b.serenity_score - a.serenity_score || a.rank - b.rank);
      rows.forEach((r, i) => { r.serenity_rank = i + 1; });
      const themeMap = new Map();
      rows.forEach((r) => {
        const theme = r.primary_theme || "Other / unclassified";
        const cur = themeMap.get(theme) || { theme, tickers: 0, mentions: 0, last7: 0, score: 0 };
        cur.tickers += 1;
        cur.mentions += r.mentioned_posts;
        cur.last7 += r.last7;
        cur.score += r.serenity_score;
        themeMap.set(theme, cur);
      });
      DASHBOARD_DATA.themeStats = [...themeMap.values()].sort((a, b) => b.mentions - a.mentions);
      DASHBOARD_DATA.topMovers = rows
        .filter((r) => r.price.status === "ok" && Number.isFinite(r.price.change_pct))
        .sort((a, b) => Math.abs(b.price.change_pct) - Math.abs(a.price.change_pct))
        .slice(0, 12)
        .map((r) => ({ ticker: r.ticker, symbol: r.price.symbol, change_pct: r.price.change_pct, sparkPath: r.price.sparkPath || "" }));
      DASHBOARD_DATA.rows = rows;
    }
    function applyWindow(start, end) {
      start = clampDate(start || state.windowStart);
      end = clampDate(end || state.windowEnd);
      if (toDateNum(start) > toDateNum(end)) { const t = start; start = end; end = t; }
      state.windowStart = start;
      state.windowEnd = end;
      recomputeWindow(start, end);
      if (!rowByTicker(state.pinnedTicker)) {
        state.pinnedTicker = DASHBOARD_DATA.rows[0] ? DASHBOARD_DATA.rows[0].ticker : null;
      }
      state.hoverTicker = null;
      syncWindowBar();
      renderKpis();
      renderFilters();
      renderAll();
    }
    function syncWindowBar() {
      const s = $("winStart"), e = $("winEnd"), label = $("winLabel");
      if (s) s.value = state.windowStart;
      if (e) e.value = state.windowEnd;
      if (label) {
        label.textContent = (isFullWindow() ? "全部 " : "窗口 ") + windowDays() + " 天 · " + state.windowStart + " → " + state.windowEnd;
      }
      document.querySelectorAll(".window-preset").forEach((btn) => {
        const days = btn.dataset.days;
        const active = days === "all"
          ? isFullWindow()
          : !isFullWindow() && state.windowEnd === WINDOW_MAX && windowDays() === Number(days);
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    function initWindowBar() {
      const s = $("winStart"), e = $("winEnd");
      if (s) { s.min = WINDOW_MIN; s.max = WINDOW_MAX; s.value = state.windowStart; }
      if (e) { e.min = WINDOW_MIN; e.max = WINDOW_MAX; e.value = state.windowEnd; }
      document.querySelectorAll(".window-preset").forEach((btn) => {
        btn.addEventListener("click", () => {
          const days = btn.dataset.days;
          if (days === "all") { applyWindow(WINDOW_MIN, WINDOW_MAX); return; }
          applyWindow(addDaysStr(WINDOW_MAX, -(Number(days) - 1)), WINDOW_MAX);
        });
      });
      if (s) s.addEventListener("change", () => applyWindow(s.value, e ? e.value : state.windowEnd));
      if (e) e.addEventListener("change", () => applyWindow(s ? s.value : state.windowStart, e.value));
      const reset = $("winReset");
      if (reset) reset.addEventListener("click", () => applyWindow(WINDOW_MIN, WINDOW_MAX));
      syncWindowBar();
    }

    // ===== daily research brief =====
    function knownTickerSet() {
      if (!DASHBOARD_DATA._knownTickers) {
        DASHBOARD_DATA._knownTickers = new Set(DASHBOARD_DATA.baseRows.map((r) => r.ticker));
      }
      return DASHBOARD_DATA._knownTickers;
    }
    function linkifyTickers(text) {
      const known = knownTickerSet();
      return html(text).replace(/\\$([A-Z][A-Z0-9.\\-]{0,9})/g, (whole, sym) =>
        known.has(sym) ? '<button type="button" class="brief-chip" data-ticker="' + sym + '">$' + sym + '</button>' : whole
      );
    }
    function briefText(value) {
      return linkifyTickers(value).replace(/\\n/g, "<br>");
    }
    function briefField(label, value) {
      if (!value) return "";
      return '<div class="brief-field"><div class="brief-field-label">' + html(label) + '</div><div class="brief-field-text">' + briefText(value) + '</div></div>';
    }
    function renderBriefs() {
      const host = $("briefBody");
      if (!host) return;
      const digests = DASHBOARD_DATA.digests || [];
      if (!digests.length) {
        $("briefCard").style.display = "none";
        return;
      }
      const sel = $("briefDateSelect");
      const activeDate = sel && sel.value ? sel.value : digests[0].date;
      const digest = digests.find((d) => d.date === activeDate) || digests[0];
      var T = t;
      const themeCards = digest.themes.map((t) => {
        const inner = t.body
          ? '<div class="brief-field-text">' + briefText(t.body) + '</div>'
          : briefField(T('bf_view'), t.view)
            + briefField(T('bf_beginner'), t.beginner)
            + briefField(T('bf_fp'), t.firstPrinciples)
            + briefField(T('bf_buffett'), t.buffett)
            + briefField(T('bf_conclusion'), t.conclusion);
        const links = (t.links || []).length
          ? '<div class="brief-links">' + t.links.map((u, i) => '<a class="brief-link" href="' + html(u) + '" target="_blank" rel="noopener noreferrer">' + T('bf_links') + ' ' + (i + 1) + '</a>').join("") + '</div>'
          : "";
        return '<details class="brief-theme"' + (t.n === 1 ? " open" : "") + '><summary><span class="brief-theme-n">' + t.n + '</span><span class="brief-theme-title">' + linkifyTickers(t.title) + '</span></summary><div class="brief-theme-body">' + inner + links + '</div></details>';
      }).join("");
      const picker = digests.length > 1
        ? '<select class="control brief-date" id="briefDateSelect" aria-label="' + t('aria_brief_date') + '">' + digests.map((d) => '<option value="' + html(d.date) + '"' + (d.date === digest.date ? " selected" : "") + '>' + html(d.date) + '</option>').join("") + '</select>'
        : '<span class="pill"><span class="dot"></span>' + html(digest.date) + '</span>';
      const metaBits = [
        digest.rangeStart && digest.rangeEnd ? t('bf_range') + ' ' + html(digest.rangeStart) + ' → ' + html(digest.rangeEnd) : '',
        digest.dedupCount != null ? t('bf_dedup') + ' ' + formatNumber(digest.dedupCount) + ' ' + t('bf_items') : '',
        digest.source ? t('bf_source') + ' ' + html(digest.source) : '',
      ].filter(Boolean).join(' · ');
      host.innerHTML =
        '<div class="brief-head">' +
          '<div><div class="title-row"><span class="accent"></span><h2>' + t('bf_title') + '</h2></div>' +
          '<div class="card-sub">' + html(digest.title) + (metaBits ? ' · ' + metaBits : '') + '</div></div>' +
          picker +
        '</div>' +
        (digest.summary ? '<div class="brief-summary"><div class="brief-summary-label">' + t('bf_focus') + '</div><div class="brief-summary-text">' + briefText(digest.summary) + '</div></div>' : '') +
        '<div class="brief-themes">' + themeCards + '</div>' +
        (digest.totalAnalysis ? '<div class="brief-total"><div class="brief-field-label">' + t('bf_total') + '</div><div class="brief-field-text">' + briefText(digest.totalAnalysis) + '</div></div>' : '') +
        (digest.disclaimer ? '<div class="brief-disclaimer">' + html(digest.disclaimer) + '</div>' : '');
      host.querySelectorAll(".brief-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ticker = btn.dataset.ticker;
          if (!rowByTicker(ticker)) applyWindow(WINDOW_MIN, WINDOW_MAX);
          setPinnedTicker(ticker);
          const detail = document.querySelector('[data-testid="stock-detail-card"]');
          if (detail && detail.scrollIntoView) detail.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
        });
      });
      const newSel = $("briefDateSelect");
      if (newSel) newSel.addEventListener("change", renderBriefs);
    }

    function renderMeta() {
      const win = DASHBOARD_DATA.dataWindow;
      const price = DASHBOARD_DATA.priceProvider;
      $("metaStrip").innerHTML = [
        '<span class="pill"><span class="dot"></span>' + win.earliestDate + ' → ' + win.latestDate + '</span>',
        '<span class="pill">' + formatNumber(win.events) + ' events</span>',
        '<span class="pill">' + formatNumber(win.tickers) + ' tickers</span>',
        '<span class="pill">' + price.success + '/' + price.total + ' price charts</span>',
      ].join("");
      $("footerNote").innerHTML = t('foot_src') + DASHBOARD_DATA.sourceFiles.summary + "、" + DASHBOARD_DATA.sourceFiles.daily + "、" + DASHBOARD_DATA.sourceFiles.events + t('foot_price') + DASHBOARD_DATA.priceProvider.name + t('foot_disc');
    }

    function renderKpis() {
      const rows = DASHBOARD_DATA.rows;
      const totalMentions = rows.reduce((sum, row) => sum + row.mentioned_posts, 0);
      const high = rows.filter((row) => row.research_priority === "high").length;
      const topTheme = DASHBOARD_DATA.themeStats[0];
      const hot = rows.slice().sort((a, b) => b.last7 - a.last7)[0];
      const priceOk = rows.filter((row) => row.price.status === "ok").length;
      const comp = rows.reduce((acc, row) => {
        acc.posts += row.post_mentions;
        acc.replies += row.reply_mentions;
        acc.quotes += row.quote_mentions;
        return acc;
      }, { posts: 0, replies: 0, quotes: 0 });
      const kpis = [
        ["Universe", formatNumber(rows.length), t('kpi_universe_sub'), rows.length],
        ["Mentions", formatNumber(totalMentions), windowDays() + t('kpi_mentions_unit'), totalMentions],
        ["High Priority", formatNumber(high), t('kpi_priority_sub'), high],
        ["Top Theme", topTheme ? topTheme.theme : "—", topTheme ? formatNumber(topTheme.mentions) + " mentions" : "—", null],
        ["Hot 7D", hot ? hot.ticker : "—", hot ? formatNumber(hot.last7) + " mentions" : "—", null],
        ["Price Coverage", priceOk + "/" + rows.length, t('kpi_price_sub'), null],
      ];
      $("kpiGrid").innerHTML = kpis.map((item, index) => {
        const counts = item[3] != null && !reducedMotion;
        const valueAttr = counts ? ' data-count="' + item[3] + '"' : '';
        const valueText = counts ? "0" : html(item[1]);
        return '<div class="kpi reveal' + (firstPaint ? '' : ' reveal-in') + '" style="--reveal-delay:' + (index * 45) + 'ms"><div class="kpi-label">' + html(item[0]) + '</div><div class="kpi-value"' + valueAttr + '>' + valueText + '</div><div class="kpi-note">' + html(item[2]) + '</div></div>';
      }).join("");
      $("kpiGrid").querySelectorAll(".kpi-value[data-count]").forEach((el) => {
        countUp(el, Number(el.dataset.count), 1100);
      });
      DASHBOARD_DATA.compositionTotals = comp;
    }

    function renderFilters() {
      const themes = ["all"].concat(DASHBOARD_DATA.themeStats.map((item) => item.theme));
      $("themeFilter").innerHTML = themes.map((theme) => '<option value="' + html(theme) + '">' + (theme === "all" ? t('f_all_theme') : html(theme)) + '</option>').join("");
      $("tableTickerCount").textContent = formatNumber(DASHBOARD_DATA.rows.length);
    }

    function renderLegend() {
      $("seriesLegend").innerHTML = SERIES.map((item) =>
        '<button class="legend-btn ' + (state.visibleSeries[item.key] ? "active" : "") + '" data-series="' + item.key + '" aria-pressed="' + (state.visibleSeries[item.key] ? "true" : "false") + '"><span class="swatch ' + item.className + '"></span>' + item.label + '</button>'
      ).join("");
      document.querySelectorAll(".legend-btn").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.series;
          const enabledCount = Object.values(state.visibleSeries).filter(Boolean).length;
          if (state.visibleSeries[key] && enabledCount === 1) return;
          state.visibleSeries[key] = !state.visibleSeries[key];
          button.classList.toggle("active", state.visibleSeries[key]);
          button.setAttribute("aria-pressed", state.visibleSeries[key] ? "true" : "false");
          renderCompositionChart();
        });
      });
    }

    function filteredRows() {
      const query = $("searchBox").value.trim().toUpperCase();
      const theme = $("themeFilter").value;
      const priority = $("priorityFilter").value;
      const price = $("priceFilter").value;
      const limitValue = $("limitSelect").value;
      let rows = DASHBOARD_DATA.rows.filter((row) => {
        const haystack = [row.ticker, row.primary_theme, row.research_priority].join(" ").toUpperCase();
        if (query && !haystack.includes(query)) return false;
        if (theme !== "all" && row.primary_theme !== theme) return false;
        if (priority !== "all" && row.research_priority !== priority) return false;
        if (price === "ok" && row.price.status !== "ok") return false;
        if (price === "missing" && row.price.status === "ok") return false;
        if (price === "up" && !(Number(row.price.change_pct) > 0)) return false;
        if (price === "down" && !(Number(row.price.change_pct) < 0)) return false;
        return true;
      });
      rows = rows.sort((a, b) => {
        const av = getValue(a, state.sortKey);
        const bv = getValue(b, state.sortKey);
        const dir = state.sortDir === "asc" ? 1 : -1;
        if (typeof av === "string" || typeof bv === "string") return String(av || "").localeCompare(String(bv || "")) * dir;
        return ((Number(av == null ? -Infinity : av) || 0) - (Number(bv == null ? -Infinity : bv) || 0)) * dir;
      });
      if (limitValue !== "all") rows = rows.slice(0, Number(limitValue));
      return rows;
    }

    function renderCompositionChart() {
      const svg = $("topCompositionChart");
      const rows = DASHBOARD_DATA.rows.slice().sort((a, b) => b.mentioned_posts - a.mentioned_posts).slice(0, 30);
      const max = Math.max.apply(null, rows.map((row) => Math.max(visibleCompositionTotal(row), 1)));
      const width = 1180;
      const rowH = 22;
      const gap = 11;
      const left = 78;
      const right = 80;
      const top = 34;
      const chartW = width - left - right;
      const axisY = top + rows.length * (rowH + gap) + 16;
      const chartHeight = axisY + 52;
      const active = activeTicker();
      svg.setAttribute("viewBox", "0 0 " + width + " " + chartHeight);
      svg.classList.toggle("bars-animate", firstPaint && !reducedMotion);
      const ticks = [0, 100, 200, 300, 400];
      let out = "";
      ticks.forEach((tick) => {
        const x = left + (tick / Math.max(400, max)) * chartW;
        out += '<line class="grid-line" x1="' + x + '" y1="20" x2="' + x + '" y2="' + axisY + '"></line>';
        out += '<text class="tick-label" x="' + x + '" y="' + (axisY + 25) + '" text-anchor="middle">' + tick + '</text>';
      });
      rows.forEach((row, index) => {
        const y = top + index * (rowH + gap);
        let x = left;
        let totalW = 0;
        SERIES.forEach((series) => {
          if (state.visibleSeries[series.key]) totalW += (row.composition[series.key] / Math.max(400, max)) * chartW;
        });
        const activeClass = row.ticker === active ? " bar-row-active" : "";
        const clipId = "barclip-" + index;
        out += '<g class="bar-row-g' + activeClass + '" data-ticker="' + row.ticker + '" tabindex="0" role="button" aria-label="' + row.ticker + ', ' + row.mentioned_posts + ' mentions" style="--ri:' + index + '">';
        out += '<text class="bar-label" x="' + (left - 10) + '" y="' + (y + 15) + '" text-anchor="end">' + row.ticker + '</text>';
        out += '<rect class="bar-bg" x="' + left + '" y="' + y + '" width="' + chartW + '" height="' + rowH + '" rx="5"></rect>';
        out += '<clipPath id="' + clipId + '"><rect x="' + left + '" y="' + y + '" width="' + Math.max(totalW, 0.01) + '" height="' + rowH + '" rx="5"></rect></clipPath>';
        out += '<g class="bar-fill" clip-path="url(#' + clipId + ')">';
        SERIES.forEach((series) => {
          if (!state.visibleSeries[series.key]) return;
          const value = row.composition[series.key];
          const w = (value / Math.max(400, max)) * chartW;
          if (w <= 0) return;
          out += '<rect class="bar-seg" data-ticker="' + row.ticker + '" data-kind="' + series.key + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + rowH + '" fill="' + series.color + '"></rect>';
          x += w;
        });
        out += '</g>';
        out += '<text class="bar-value" x="' + (x + 8) + '" y="' + (y + 15) + '">' + row.mentioned_posts + '</text>';
        out += '</g>';
      });
      svg.innerHTML = out;
      svg.querySelectorAll(".bar-row-g").forEach((group) => {
        group.addEventListener("mouseenter", () => setHoverTicker(group.dataset.ticker));
        group.addEventListener("click", () => setPinnedTicker(group.dataset.ticker));
        group.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPinnedTicker(group.dataset.ticker); }
        });
      });
      svg.querySelectorAll(".bar-seg").forEach((seg) => {
        seg.addEventListener("mousemove", (event) => {
          const row = rowByTicker(seg.dataset.ticker);
          const series = SERIES.find((item) => item.key === seg.dataset.kind);
          showTooltip(event, '<strong>' + row.ticker + '</strong><br><span class="muted">' + series.label + '</span><br>' + formatNumber(row.composition[series.key]) + ' mentions');
        });
        seg.addEventListener("mouseleave", hideTooltip);
      });
    }

    function renderBubbleChart() {
      const svg = $("bubbleChart");
      const rows = DASHBOARD_DATA.rows.slice(0, 50);
      const width = 760;
      const height = 560;
      const left = 78;
      const right = 46;
      const top = 34;
      const bottom = 68;
      const chartW = width - left - right;
      const chartH = height - top - bottom;
      const maxX = Math.max.apply(null, rows.map((row) => row.interaction.xPosts)) || 1;
      const maxY = Math.max.apply(null, rows.map((row) => row.interaction.yInteractions)) || 1;
      const maxBubble = Math.max.apply(null, rows.map((row) => row.interaction.bubbleSize)) || 1;
      let out = "";
      for (let i = 0; i <= 5; i += 1) {
        const x = left + (i / 5) * chartW;
        const y = top + (i / 5) * chartH;
        out += '<line class="grid-line" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + chartH) + '"></line>';
        out += '<line class="grid-line" x1="' + left + '" y1="' + y + '" x2="' + (left + chartW) + '" y2="' + y + '"></line>';
      }
      out += '<line class="chart-axis" x1="' + left + '" y1="' + (top + chartH) + '" x2="' + (left + chartW) + '" y2="' + (top + chartH) + '"></line>';
      out += '<line class="chart-axis" x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + chartH) + '"></line>';
      out += '<text class="axis-label" x="' + (left + chartW / 2) + '" y="' + (height - 18) + '" text-anchor="middle">主帖 Posts</text>';
      out += '<text class="axis-label" transform="translate(22 ' + (top + chartH / 2) + ') rotate(-90)" text-anchor="middle">互动量 Replies + Quotes</text>';
      const active = activeTicker();
      rows.forEach((row, index) => {
        const x = left + (row.interaction.xPosts / maxX) * chartW;
        const y = top + chartH - (row.interaction.yInteractions / maxY) * chartH;
        const r = 6 + (row.interaction.bubbleSize / maxBubble) * 42;
        const color = SERIES[index % SERIES.length].color;
        const activeClass = row.ticker === active ? " active" : "";
        out += '<circle class="bubble' + activeClass + '" data-ticker="' + row.ticker + '" cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '" style="color:' + color + ';--i:' + index + '"></circle>';
        if (r >= 24 || row.ticker === active) {
          out += '<text class="bubble-label" x="' + (x + r * 0.18) + '" y="' + (y - r - 7) + '">' + row.ticker + '</text>';
        }
      });
      svg.innerHTML = out;
      svg.classList.toggle("bubbles-animate", firstPaint && !reducedMotion);
      svg.querySelectorAll(".bubble").forEach((bubble) => {
        bubble.addEventListener("mouseenter", () => setHoverTicker(bubble.dataset.ticker));
        bubble.addEventListener("mousemove", (event) => {
          const row = rowByTicker(bubble.dataset.ticker);
          showTooltip(event, '<strong>' + row.ticker + '</strong><br>主帖 Posts: ' + row.post_mentions + '<br>互动 Replies + Quotes: ' + (row.reply_mentions + row.quote_mentions) + '<br>总提及: ' + row.mentioned_posts);
        });
        bubble.addEventListener("mouseleave", hideTooltip);
        bubble.addEventListener("click", () => setPinnedTicker(bubble.dataset.ticker));
      });
    }

    function renderDonutChart() {
      const svg = $("donutChart");
      const totals = DASHBOARD_DATA.compositionTotals || { posts: 0, replies: 0, quotes: 0 };
      const values = SERIES.map((series) => ({ ...series, value: totals[series.key] || 0 }));
      const sum = values.reduce((acc, item) => acc + item.value, 0) || 1;
      let angle = -Math.PI / 2;
      let out = "";
      values.forEach((item) => {
        const next = angle + (item.value / sum) * Math.PI * 2;
        out += '<path class="donut-seg" data-kind="' + item.key + '" d="' + arcPath(260, 215, 150, angle, next) + '" fill="' + item.color + '" style="color:' + item.color + '"></path>';
        const mid = (angle + next) / 2;
        const lx = 260 + Math.cos(mid) * 205;
        const ly = 215 + Math.sin(mid) * 205;
        out += '<text class="donut-label" x="' + lx + '" y="' + ly + '" text-anchor="middle">' + item.label.split(" ")[0] + '</text>';
        out += '<text class="donut-small" x="' + lx + '" y="' + (ly + 23) + '" text-anchor="middle">' + formatPct(item.value / sum * 100, 1) + '</text>';
        angle = next;
      });
      out += '<circle class="donut-center" cx="260" cy="215" r="88"></circle>';
      out += '<text class="donut-label" x="260" y="207" text-anchor="middle">全样本</text><text class="donut-small" x="260" y="232" text-anchor="middle">' + formatNumber(sum) + ' mentions</text>';
      out += '<g transform="translate(92 468)">' + values.map((item, index) => '<rect x="' + (index * 120) + '" y="0" width="13" height="13" rx="4" fill="' + item.color + '"></rect><text class="donut-small" x="' + (index * 120 + 20) + '" y="12">' + item.label + '</text>').join("") + '</g>';
      svg.innerHTML = out;
      svg.classList.toggle("donut-animate", firstPaint && !reducedMotion);
      svg.querySelectorAll(".donut-seg").forEach((seg) => {
        seg.addEventListener("mousemove", (event) => {
          const item = values.find((candidate) => candidate.key === seg.dataset.kind);
          showTooltip(event, '<strong>' + item.label + '</strong><br>' + formatNumber(item.value) + ' mentions<br>' + formatPct(item.value / sum * 100, 2));
        });
        seg.addEventListener("mouseleave", hideTooltip);
      });
    }

    function renderTable() {
      const rows = filteredRows();
      const maxMentions = Math.max.apply(null, DASHBOARD_DATA.rows.map((row) => row.mentioned_posts)) || 1;
      const active = activeTicker();
      $("resultCount").textContent = "显示 " + rows.length + " / " + DASHBOARD_DATA.rows.length + " 条";
      if (!rows.length) {
        $("rankBody").innerHTML = '<tr class="empty-row"><td colspan="12"><div class="empty">没有匹配的 ticker<br><span class="muted">试试放宽筛选条件，或点击"重置筛选"。</span></div></td></tr>';
        updateSortHeaders();
        return;
      }
      $("rankBody").innerHTML = rows.map((row) => {
        const activeClass = row.ticker === active ? "active" : "";
        const priceClass = deltaClass(row.price.change_pct);
        const lastSeen = row.last_seen ? row.last_seen.slice(0, 10) : "—";
        const mentionWidth = Math.max(5, row.mentioned_posts / maxMentions * 100);
        return '<tr class="' + activeClass + '" data-ticker="' + row.ticker + '" tabindex="0" aria-label="' + row.ticker + '">' +
          '<td class="rank">' + row.serenity_rank + '</td>' +
          '<td><div class="ticker">' + row.ticker + '</div><div class="muted">' + html(row.price.symbol || row.ticker) + '</div></td>' +
          '<td><div class="mention-bar"><div class="mention-fill" style="width:' + mentionWidth + '%"></div><div class="mention-text">' + formatNumber(row.mentioned_posts) + '</div></div></td>' +
          '<td class="num">' + formatNumber(row.raw_occurrences) + '</td>' +
          '<td class="num c-posts">' + formatNumber(row.post_mentions) + '</td>' +
          '<td class="num c-replies">' + formatNumber(row.reply_mentions) + '</td>' +
          '<td class="num c-quotes">' + formatNumber(row.quote_mentions) + '</td>' +
          '<td><span class="theme-pill ' + priorityClass(row.research_priority) + '">' + html(row.primary_theme) + '</span></td>' +
          '<td class="num">' + formatNumber(row.last7) + '</td>' +
          '<td class="num ' + priceClass + '">' + formatPct(row.price.change_pct) + '</td>' +
          '<td>' + priceSpark(row) + '</td>' +
          '<td class="num muted">' + lastSeen + '</td>' +
        '</tr>';
      }).join("");
      document.querySelectorAll("#rankBody tr[data-ticker]").forEach((tr) => {
        tr.addEventListener("mouseenter", () => setHoverTicker(tr.dataset.ticker));
        tr.addEventListener("focus", () => setHoverTicker(tr.dataset.ticker));
        tr.addEventListener("click", () => setPinnedTicker(tr.dataset.ticker));
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setPinnedTicker(tr.dataset.ticker);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const target = event.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
            if (target && target.dataset.ticker) target.focus();
          }
        });
      });
      attachPriceTooltipHandlers($("rankBody"));
      updateSortHeaders();
    }

    function updateActiveHighlights() {
      const active = activeTicker();
      document.querySelectorAll("#rankBody tr").forEach((tr) => {
        tr.classList.toggle("active", tr.dataset.ticker === active);
      });
      const comp = $("topCompositionChart");
      if (comp) comp.querySelectorAll(".bar-row-g").forEach((group) => {
        group.classList.toggle("bar-row-active", group.dataset.ticker === active);
      });
      const bubbles = $("bubbleChart");
      if (bubbles) bubbles.querySelectorAll(".bubble").forEach((bubble) => {
        bubble.classList.toggle("active", bubble.dataset.ticker === active);
      });
    }

    function updateSortHeaders() {
      document.querySelectorAll("th[data-sort]").forEach((th) => {
        const isActive = th.dataset.sort === state.sortKey;
        th.classList.toggle("sort-asc", isActive && state.sortDir === "asc");
        th.classList.toggle("sort-desc", isActive && state.sortDir === "desc");
        th.setAttribute("aria-sort", isActive ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      });
    }

    function pearson(a, b) {
      const n = Math.min(a.length, b.length);
      if (n < 5) return 0;
      let sa = 0, sb = 0;
      for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
      const ma = sa / n, mb = sb / n;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
      if (da === 0 || db === 0) return 0;
      return num / Math.sqrt(da * db);
    }
    function mentionPriceStats(row) {
      const pts = (row.price && row.price.points) || [];
      if (pts.length < 6) return null;
      const mMap = {};
      for (const p of (row.mentionSeries || [])) mMap[p.date] = (mMap[p.date] || 0) + (p.mentioned_posts || 0);
      const dates = pts.map((p) => p.date);
      const price = pts.map((p) => Number(p.close) || 0);
      const ment = dates.map((d) => mMap[d] || 0);
      if (ment.reduce((s, x) => s + x, 0) === 0) return null;
      const ret = [];
      for (let i = 1; i < price.length; i++) ret.push(price[i - 1] ? (price[i] - price[i - 1]) / price[i - 1] : 0);
      const mentForRet = ment.slice(1);
      const rLevel = pearson(ment, price);
      let bestLag = 0, bestR = 0;
      for (let k = 0; k <= 5; k++) {
        const m = mentForRet.slice(0, mentForRet.length - k);
        const r = ret.slice(k);
        const rr = pearson(m, r);
        if (Math.abs(rr) > Math.abs(bestR)) { bestR = rr; bestLag = k; }
      }
      return { n: pts.length, rLevel: rLevel, bestLag: bestLag, bestR: bestR };
    }
    function comboReadout(row) {
      const s = mentionPriceStats(row);
      if (!s) return '<div class="corr-readout corr-muted">提及 × 股价：重叠的价格/提及数据不足，暂无法计算关联。</div>';
      const absL = Math.abs(s.rLevel);
      const cls = absL >= 0.5 ? 'corr-strong' : absL >= 0.3 ? 'corr-mid' : 'corr-weak';
      const word = absL >= 0.5 ? '强' : absL >= 0.3 ? '中等' : '弱/不明显';
      const dir = s.rLevel > 0.08 ? '正相关' : s.rLevel < -0.08 ? '负相关' : '无明显方向';
      const lead = (s.bestLag > 0 && Math.abs(s.bestR) >= 0.25)
        ? '提及似领先股价约 ' + s.bestLag + ' 天 (r=' + s.bestR.toFixed(2) + ')'
        : (Math.abs(s.bestR) >= 0.25 ? '提及与股价大致同步 (r=' + s.bestR.toFixed(2) + ')' : '未见明显领先/滞后关系');
      return '<div class="corr-readout ' + cls + '">' +
        '<span class="corr-k">提及 × 股价</span>' +
        '<span class="corr-v">同步 r=' + s.rLevel.toFixed(2) + ' · ' + dir + '（' + word + '）</span>' +
        '<span class="corr-lead">' + lead + '</span>' +
        '<span class="corr-note">基于近 ' + s.n + ' 个交易日的价格×提及重叠；仅描述历史共振，非预测、非投资建议</span>' +
        '</div>';
    }
    function smoothPath(coords) {
      if (coords.length < 2) return '';
      if (coords.length === 2) return 'M' + coords[0][0].toFixed(1) + ' ' + coords[0][1].toFixed(1) + ' L' + coords[1][0].toFixed(1) + ' ' + coords[1][1].toFixed(1);
      let d = 'M' + coords[0][0].toFixed(1) + ' ' + coords[0][1].toFixed(1);
      for (let i = 0; i < coords.length - 1; i++) {
        const p0 = coords[i - 1] || coords[i], p1 = coords[i], p2 = coords[i + 1], p3 = coords[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
      }
      return d;
    }
    let __comboSeq = 0;
    function combinedChart(row, big) {
      const pts = (row.price && row.price.points) || [];
      if (pts.length < 2) return '<div class="empty">' + t('empty_price') + '<br><span class="muted">' + t('empty_price_sub') + '</span></div>';
      const W = 560, H = big ? 300 : 210, padX = 14, padTop = 26, padBot = 30;
      const dates = pts.map((p) => p.date);
      const price = pts.map((p) => Number(p.close) || 0);
      const mMap = {};
      for (const p of (row.mentionSeries || [])) mMap[p.date] = (mMap[p.date] || 0) + (p.mentioned_posts || 0);
      const ment = dates.map((d) => mMap[d] || 0);
      var bench = null, hasBench = false;
      var BM = DASHBOARD_DATA.benchmarks;
      if (BM && BM.SPY && BM.SPY.points && BM.SPY.points.length) {
        var bmap = {}; BM.SPY.points.forEach(function (bp) { bmap[bp.date] = bp.close; });
        var bbase = null; for (var bi = 0; bi < dates.length; bi++) { if (bmap[dates[bi]] != null) { bbase = bmap[dates[bi]]; break; } }
        if (bbase && price[0] > 0) { bench = dates.map(function (d) { var c = bmap[d]; return c != null ? price[0] * (c / bbase) : null; }); hasBench = bench.some(function (v) { return v != null; }); }
      }
      var allV = price.slice(); if (hasBench) bench.forEach(function (v) { if (v != null) allV.push(v); });
      const pMin = Math.min.apply(null, allV), pMax = Math.max.apply(null, allV), pSpan = (pMax - pMin) || 1;
      const mMax = Math.max.apply(null, ment) || 1;
      const n = pts.length, stepX = (W - padX * 2) / Math.max(n - 1, 1);
      const yOf = (v) => padTop + (1 - (v - pMin) / pSpan) * (H - padTop - padBot);
      const coords = price.map((v, i) => [padX + i * stepX, yOf(v)]);
      const up = price[n - 1] >= price[0];
      const stroke = up ? 'var(--green)' : 'var(--red)';
      const fid = 'cg' + (++__comboSeq);
      const line = smoothPath(coords);
      const area = line + ' L' + coords[n - 1][0].toFixed(1) + ' ' + (H - padBot) + ' L' + coords[0][0].toFixed(1) + ' ' + (H - padBot) + ' Z';
      var benchPath = '';
      if (hasBench) { var bcoords = []; for (var bj = 0; bj < bench.length; bj++) if (bench[bj] != null) bcoords.push([padX + bj * stepX, yOf(bench[bj])]); if (bcoords.length >= 2) benchPath = '<path class="combo-bench" d="' + smoothPath(bcoords) + '"></path>'; }
      const barW = Math.max(1.2, Math.min(7, stepX * 0.55)), barMaxH = (H - padTop - padBot) * 0.42;
      let bars = '';
      for (let i = 0; i < n; i++) {
        if (!ment[i]) continue;
        const bh = (ment[i] / mMax) * barMaxH, bx = padX + i * stepX - barW / 2, by = (H - padBot) - bh;
        bars += '<rect class="combo-bar' + (ment[i] >= 0.7 * mMax ? ' spike' : '') + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1"></rect>';
      }
      return '<div class="combo-wrap">' +
        '<div class="combo-hdr"><span>' + t('combo_hdr') + (hasBench ? ' <span class="combo-legend">— SPY</span>' : '') + '</span><span class="combo-hdr-px" style="color:' + stroke + '">' + formatNumber(price[n - 1], 2) + ' ' + html(row.price.currency || '') + ' · ' + formatPct(row.price.change_pct) + '</span></div>' +
        '<svg class="combo-chart js-combo-chart' + (big ? ' combo-chart--lg' : '') + '" data-ticker="' + row.ticker + '" data-h="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + row.ticker + ' 价格与提及叠加图">' +
        '<defs><linearGradient id="' + fid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + stroke + '" stop-opacity="0.32"></stop><stop offset="82%" stop-color="' + stroke + '" stop-opacity="0.02"></stop></linearGradient></defs>' +
        '<line class="combo-base" x1="' + padX + '" y1="' + (H - padBot) + '" x2="' + (W - padX) + '" y2="' + (H - padBot) + '"></line>' +
        bars +
        '<path d="' + area + '" fill="url(#' + fid + ')"></path>' +
        benchPath +
        '<path class="combo-line" d="' + line + '" stroke="' + stroke + '"></path>' +
        '<g class="combo-cross"><line class="cc-line" y1="' + padTop + '" y2="' + (H - padBot) + '" stroke="#edf3ff" stroke-width="1" opacity="0.5"></line><circle class="cc-dot" r="3.5" fill="#edf3ff"></circle></g>' +
        '</svg>' +
        '<div class="combo-ftr"><span>' + dates[0] + '</span><span>' + dates[n - 1] + '</span></div>' +
        '</div>';
    }
    function attachComboHandlers() {
      document.querySelectorAll('.js-combo-chart').forEach((svg) => {
        svg.addEventListener('mousemove', (event) => {
          const row = rowByTicker(svg.dataset.ticker);
          if (!row) return;
          const pts = (row.price && row.price.points) || [];
          if (pts.length < 2) return;
          const mMap = {};
          for (const p of (row.mentionSeries || [])) mMap[p.date] = (mMap[p.date] || 0) + (p.mentioned_posts || 0);
          const W = 560, H = Number(svg.dataset.h) || 210, padX = 14, padTop = 26, padBot = 30;
          const price = pts.map((p) => Number(p.close) || 0);
          const pMin = Math.min.apply(null, price), pMax = Math.max.apply(null, price), pSpan = (pMax - pMin) || 1;
          const rect = svg.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const idx = Math.round(ratio * (pts.length - 1));
          const p = pts[idx];
          const stepX = (W - padX * 2) / Math.max(pts.length - 1, 1);
          const x = padX + idx * stepX;
          const y = padTop + (1 - ((Number(p.close) || 0) - pMin) / pSpan) * (H - padTop - padBot);
          const cross = svg.querySelector('.combo-cross');
          if (cross) {
            cross.querySelector('.cc-line').setAttribute('x1', x);
            cross.querySelector('.cc-line').setAttribute('x2', x);
            cross.querySelector('.cc-dot').setAttribute('cx', x);
            cross.querySelector('.cc-dot').setAttribute('cy', y);
            cross.classList.add('is-on');
          }
          showTooltip(event, '<strong>' + row.ticker + '</strong><br><span class="muted">' + p.date + '</span><br>价格 ' + formatNumber(p.close, 2) + ' ' + html(row.price.currency || '') + '<br>当日提及 ' + formatNumber(mMap[p.date] || 0));
        });
        svg.addEventListener('mouseleave', () => {
          const cross = svg.querySelector('.combo-cross');
          if (cross) cross.classList.remove('is-on');
          hideTooltip();
        });
      });
    }
    function rankArr(arr) {
      const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
      const r = new Array(arr.length);
      let i = 0;
      while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
      return r;
    }
    function spearman(a, b) { return pearson(rankArr(a), rankArr(b)); }
    function solveOLS(X, y) {
      const n = X.length, p = X[0].length;
      const A = [], bv = [];
      for (let i = 0; i < p; i++) { A.push(new Array(p).fill(0)); bv.push(0); }
      for (let r = 0; r < n; r++) { for (let i = 0; i < p; i++) { bv[i] += X[r][i] * y[r]; for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j]; } }
      const M = A.map((row, i) => row.concat(bv[i]));
      for (let col = 0; col < p; col++) {
        let piv = col; for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        if (Math.abs(M[piv][col]) < 1e-12) return null;
        const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
        const d = M[col][col];
        for (let j = col; j <= p; j++) M[col][j] /= d;
        for (let r = 0; r < p; r++) { if (r === col) continue; const f = M[r][col]; for (let j = col; j <= p; j++) M[r][j] -= f * M[col][j]; }
      }
      const beta = M.map((row) => row[p]);
      let rss = 0; for (let r = 0; r < n; r++) { let pred = 0; for (let i = 0; i < p; i++) pred += X[r][i] * beta[i]; const e = y[r] - pred; rss += e * e; }
      return { beta: beta, rss: rss };
    }
    function lgamma(z) {
      const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
      z -= 1; let x = 0.99999999999980993; for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
      const t = z + g.length - 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
    }
    function betacf(x, a, b) {
      const FPMIN = 1e-30; const qab = a + b, qap = a + 1, qam = a - 1;
      let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
      for (let mm = 1; mm < 200; mm++) {
        const m2 = 2 * mm;
        let aa = mm * (b - mm) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
        aa = -(a + mm) * (qab + mm) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del;
        if (Math.abs(del - 1) < 3e-7) break;
      }
      return h;
    }
    function betai(a, b, x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
      if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
      return 1 - bt * betacf(1 - x, b, a) / b;
    }
    function fSurvival(F, d1, d2) { if (!(F > 0)) return 1; return betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * F)); }
    function grangerTest(cause, effect, p) {
      const T = effect.length;
      if (T < 3 * p + 5) return null;
      const yv = [], Xr = [], Xu = [];
      for (let t = p; t < T; t++) {
        yv.push(effect[t]);
        const rowR = [1]; for (let j = 1; j <= p; j++) rowR.push(effect[t - j]);
        const rowU = rowR.slice(); for (let j = 1; j <= p; j++) rowU.push(cause[t - j]);
        Xr.push(rowR); Xu.push(rowU);
      }
      const R = solveOLS(Xr, yv), U = solveOLS(Xu, yv);
      if (!R || !U || U.rss <= 0) return null;
      const N = yv.length, dfu = N - (2 * p + 1);
      if (dfu <= 0) return null;
      const F = ((R.rss - U.rss) / p) / (U.rss / dfu);
      return { F: F, df1: p, df2: dfu, p: fSurvival(F, p, dfu) };
    }
    function mentionPriceModel(row) {
      const pts = (row.price && row.price.points) || [];
      if (pts.length < 12) return null;
      const mMap = {};
      for (const q of (row.mentionSeries || [])) mMap[q.date] = (mMap[q.date] || 0) + (q.mentioned_posts || 0);
      const dates = pts.map((p) => p.date);
      const price = pts.map((p) => Number(p.close) || 0);
      const mentAll = dates.map((d) => mMap[d] || 0);
      if (mentAll.reduce((s, x) => s + x, 0) === 0) return null;
      const r = [], m = [];
      for (let i = 1; i < price.length; i++) { if (price[i - 1] > 0 && price[i] > 0) { r.push(Math.log(price[i] / price[i - 1])); m.push(mentAll[i]); } }
      const n = r.length; if (n < 10) return null;
      const sig = 1.96 / Math.sqrt(n);
      const K = 7, ccf = [];
      for (let k = -K; k <= K; k++) {
        const xs = [], ys = [];
        for (let t = 0; t < n; t++) { const tk = t + k; if (tk >= 0 && tk < n) { xs.push(m[t]); ys.push(r[tk]); } }
        const rr = xs.length >= 5 ? pearson(xs, ys) : 0;
        ccf.push({ lag: k, r: rr, sig: Math.abs(rr) > sig });
      }
      let best = ccf[K]; for (const c of ccf) if (Math.abs(c.r) > Math.abs(best.r)) best = c;
      return { n: n, sig: sig, ccf: ccf, contemporaneous: ccf[K].r, spearman: spearman(m, r), grangerFwd: grangerTest(m, r, 3), grangerRev: grangerTest(r, m, 3), best: best };
    }
    function ccfChart(model) {
      const W = 480, H = 132, padX = 26, padTop = 12, padBot = 26;
      const ccf = model.ccf, n = ccf.length;
      let maxAbs = model.sig * 1.25;
      for (const c of ccf) maxAbs = Math.max(maxAbs, Math.abs(c.r));
      maxAbs = Math.max(maxAbs, 0.2);
      const zeroY = padTop + (H - padTop - padBot) / 2;
      const yOf = (v) => zeroY - (v / maxAbs) * ((H - padTop - padBot) / 2);
      const slot = (W - padX * 2) / n, bw = slot * 0.62;
      let bars = '';
      for (let i = 0; i < n; i++) {
        const c = ccf[i];
        const x = padX + slot * i + (slot - bw) / 2;
        const y = yOf(c.r), y0 = zeroY;
        const top = Math.min(y, y0), hh = Math.max(1, Math.abs(y - y0));
        const col = c.lag === 0 ? 'var(--cyan)' : (c.r >= 0 ? 'var(--green)' : 'var(--red)');
        const op = c.sig ? '0.95' : '0.4';
        bars += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5" fill="' + col + '" opacity="' + op + '"></rect>';
        if (c.lag % 7 === 0) bars += '<text class="ccf-tick" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + (c.lag > 0 ? '+' : '') + c.lag + '</text>';
      }
      const sigPos = yOf(model.sig), sigNeg = yOf(-model.sig);
      return '<svg class="ccf-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="提及对收益的互相关函数">' +
        '<line x1="' + padX + '" y1="' + zeroY + '" x2="' + (W - padX) + '" y2="' + zeroY + '" stroke="rgba(125,140,170,0.42)" stroke-width="1"></line>' +
        '<line x1="' + padX + '" y1="' + sigPos.toFixed(1) + '" x2="' + (W - padX) + '" y2="' + sigPos.toFixed(1) + '" stroke="var(--amber)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"></line>' +
        '<line x1="' + padX + '" y1="' + sigNeg.toFixed(1) + '" x2="' + (W - padX) + '" y2="' + sigNeg.toFixed(1) + '" stroke="var(--amber)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"></line>' +
        bars +
        '</svg>';
    }
    function statsPanel(model, row) {
      var ms = row && row.marketStats;
      var fr2 = function (v) { return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2); };
      var marketLine = '';
      var fpct = function (x) { return x == null ? '—' : formatPct(x * 100); };
      if (ms) {
        marketLine = '<div class="stats-market">β·SPY=' + fr2(ms.beta) + (ms.betaSMH != null ? ' · β·SMH=' + fr2(ms.betaSMH) : '') + t('mkt_alpha') + fpct(ms.alphaAnnual) + t('mkt_rel') + fpct(ms.relStr) + '</div>';
        if (ms.adjBest) marketLine += '<div class="stats-adj">' + t('mkt_adj_a') + fr2(ms.adjContemp) + ' · 峰值 lag=' + (ms.adjBest.lag > 0 ? '+' : '') + ms.adjBest.lag + ' r=' + fr2(ms.adjBest.r) + (ms.adjBest.sig ? t('mkt_adj_sig') : t('mkt_adj_ns')) + '</div>';
      }
      if (!model) return '<div class="stats-panel">' + marketLine + '<div class="stats-na">' + t('stats_na') + '</div></div>';
      const fr = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
      const fp = (v) => v < 0.001 ? '<0.001' : v.toFixed(3);
      const gf = model.grangerFwd, gr = model.grangerRev;
      const gp = gf ? gf.p : 1;
      const best = model.best;
      const dir = best.r >= 0 ? t('dir_pos') : t('dir_neg');
      let verdict, vcls;
      if (gf && gp < 0.05) { verdict = t('v_granger_a') + dir + t('v_granger_b'); vcls = 'stat-sig'; }
      else if (best.sig && best.lag > 0) { verdict = t('v_leads_a') + best.lag + t('v_leads_b') + dir + (best.r >= 0 ? t('v_leads_c_strong') : t('v_leads_c_weak')); vcls = 'stat-mid'; }
      else if (best.sig && best.lag < 0) { verdict = t('v_react_a') + (-best.lag) + t('v_react_b') + dir + t('v_react_c'); vcls = 'stat-mid'; }
      else if (best.sig) { verdict = t('v_sync_a') + dir + t('v_sync_b'); vcls = 'stat-mid'; }
      else { verdict = t('v_none_a') + dir + ' r=' + best.r.toFixed(2) + t('v_none_b'); vcls = 'stat-weak'; }
      const tech = t('tech_g') + (gf ? gf.F.toFixed(2) : '—') + ' p=' + (gf ? fp(gf.p) : '—') + (gf && gf.p < 0.05 ? ' ✓' : ' (ns)') +
        t('tech_rev') + (gr ? fp(gr.p) : '—') +
        t('tech_sp') + fr(model.spearman) +
        t('tech_ccf') + (best.lag > 0 ? '+' : '') + best.lag + ' r=' + fr(best.r) + (best.sig ? ' ✓' : ' (ns)');
      return '<div class="stats-panel ' + vcls + '">' +
        '<div class="stats-verdict"><span class="stats-dot"></span>' + verdict + '</div>' +
        marketLine +
        '<div class="stats-ccf"><div class="stats-ccf-cap"><span>' + t('ccf_cap') + '</span><span class="muted">' + t('ccf_band') + model.sig.toFixed(2) + '</span></div>' + ccfChart(model) +
        '<div class="ccf-axis"><span>' + t('ccf_left') + '</span><span>' + t('ccf_right') + '</span></div></div>' +
        '<div class="stats-tech">' + tech + '</div>' +
        '<div class="stats-note">' + t('stats_caveat_a') + model.n + t('stats_caveat_b') + '</div>' +
        '</div>';
    }
    function compactNum(v) {
      if (v == null || !isFinite(v)) return '—';
      var a = Math.abs(v);
      if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return String(Math.round(v));
    }
    function fundCell(label, value, cls) { return '<div class="fund-cell"><div class="fc-l">' + label + '</div><div class="fc-v ' + (cls || '') + '">' + value + '</div></div>'; }
    function fundGrid(f) {
      if (!f) return '';
      var num2 = function (v) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(2); };
      var pct = function (v) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%'; };
      var earn = '—';
      if (f.nextEarnings) {
        var t = new Date(f.nextEarnings + 'T00:00:00Z').getTime();
        var dd = isFinite(t) ? Math.round((t - Date.now()) / 86400000) : null;
        earn = f.nextEarnings + (dd == null ? '' : ' (' + (dd >= 0 ? dd + t('fd_days_after') : (-dd) + t('fd_days_before')) + ')');
      }
      var srcLabel = f.source === 'quoteSummary' ? t('fund_src_full') : (f.source === 'quote' ? t('fund_src_quote') : t('fund_src_part'));
      var cells = '';
      cells += fundCell(t('fd_mktcap'), f.marketCap != null ? compactNum(f.marketCap) : '—');
      cells += fundCell(t('fd_adv'), f.avgDollarVol != null ? '$' + compactNum(f.avgDollarVol) : '—');
      cells += fundCell(t('fd_short'), pct(f.shortPercentFloat));
      cells += fundCell(t('fd_d2c'), f.shortRatio != null ? Number(f.shortRatio).toFixed(1) + 'd' : '—');
      cells += fundCell(t('fd_pe'), num2(f.trailingPE));
      cells += fundCell(t('fd_fpe'), num2(f.forwardPE));
      cells += fundCell(t('fd_ps'), num2(f.priceToSales));
      cells += fundCell('Beta', num2(f.beta));
      cells += fundCell(t('fd_margin'), pct(f.profitMargin), deltaClass(f.profitMargin));
      cells += fundCell(t('fd_earn'), earn);
      return '<div class="section-label"><span>' + t('fund_label') + '</span><span class="muted">' + srcLabel + (f.foreignListed ? t('fund_foreign') : '') + '</span></div><div class="fund-grid">' + cells + '</div>';
    }
    function momentumBadges(row) {
      var m = row.momentum;
      if (!m) return '';
      var parts = [];
      if (m.accel != null && m.accel !== 0) parts.push('<span class="mb ' + deltaClass(m.accel) + '">' + t('mom_accel') + (m.accel > 0 ? '+' : '') + m.accel + '</span>');
      if (m.ageDays != null) parts.push('<span class="mb">' + t('mom_age') + m.ageDays + 'd</span>');
      if (m.recencyDays != null) parts.push('<span class="mb ' + (m.recencyDays <= 2 ? 'delta-up' : (m.recencyDays > 14 ? 'delta-down' : '')) + '">' + t('mom_recency') + m.recencyDays + t('mom_ago') + '</span>');
      return parts.length ? '<div class="mb-row">' + parts.join('') + '</div>' : '';
    }
    var CONC_COLORS = ['var(--cyan)', 'var(--purple)', 'var(--green)', 'var(--amber)', 'var(--pink)', 'var(--subtle)'];
    function renderConcentration() {
      var el = $("concBody");
      if (!el) return;
      var tc = DASHBOARD_DATA.themeConcentration || [];
      var clusters = DASHBOARD_DATA.clusters || [];
      if (!tc.length) { el.innerHTML = ''; return; }
      var top = tc.slice(0, 6);
      var total = tc.reduce(function (s, t) { return s + t.mentions; }, 0) || 1;
      var bar = top.map(function (t, i) { var w = t.mentions / total * 100; return '<div class="conc-seg" style="width:' + w.toFixed(1) + '%;background:' + CONC_COLORS[i % 6] + '" title="' + html(t.theme) + ' ' + w.toFixed(0) + '%"></div>'; }).join('');
      var legend = top.map(function (t, i) { var d = t.delta > 0 ? '▲' : (t.delta < 0 ? '▼' : '·'); return '<span class="conc-lg"><i style="background:' + CONC_COLORS[i % 6] + '"></i>' + html(t.theme) + ' ' + (t.mentions / total * 100).toFixed(0) + '% <span class="' + (t.delta > 0 ? 'delta-up' : (t.delta < 0 ? 'delta-down' : 'muted')) + '">' + d + '</span></span>'; }).join('');
      var clusterHtml = '';
      if (clusters.length) {
        clusterHtml = '<div class="section-label" style="margin-top:14px"><span>' + t('conc_cluster') + '</span><span class="muted">' + t('conc_cluster_sub') + '</span></div>' +
          clusters.map(function (c) { return '<div class="cluster"><span class="cluster-label">' + html(c.label) + ' · ρ̄=' + c.avgCorr.toFixed(2) + '</span> ' + c.members.map(function (m) { return '<button type="button" class="cluster-mem" data-ticker="' + m + '">' + m + '</button>'; }).join('') + '</div>'; }).join('') +
          '<div class="muted conc-note">' + t('conc_note') + '</div>';
      }
      el.innerHTML = '<div class="section-label"><span>' + t('conc_title') + '</span><span class="muted">' + t('conc_sub') + '</span></div><div class="conc-bar">' + bar + '</div><div class="conc-legend">' + legend + '</div>' + clusterHtml;
      el.querySelectorAll('.cluster-mem').forEach(function (b) { b.addEventListener('click', function () { setPinnedTicker(b.dataset.ticker); }); });
    }
    function getStored(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function setStored(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function applyTheme(tm) {
      document.documentElement.setAttribute('data-theme', tm);
      document.querySelectorAll('.theme-toggle .seg-btn').forEach(function (b) {
        var on = b.getAttribute('data-theme-val') === tm;
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    function initTheme() {
      var saved = getStored('aleabito.theme');
      var tm = (saved === 'light' || saved === 'dark') ? saved : 'dark';
      applyTheme(tm);
      document.querySelectorAll('.theme-toggle .seg-btn').forEach(function (b) {
        b.addEventListener('click', function () { var v = b.getAttribute('data-theme-val'); applyTheme(v); setStored('aleabito.theme', v); });
      });
    }
    function applyLang() {
      var d = I18N[state.lang] || I18N.zh;
      document.querySelectorAll('[data-i18n]').forEach(function (el) { var k = el.getAttribute('data-i18n'); if (d[k] != null) el.textContent = d[k]; });
      document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { var k = el.getAttribute('data-i18n-ph'); if (d[k] != null) el.setAttribute('placeholder', d[k]); });
      document.querySelectorAll('[data-i18n-title]').forEach(function (el) { var k = el.getAttribute('data-i18n-title'); if (d[k] != null) el.setAttribute('title', d[k]); });
      document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { var k = el.getAttribute('data-i18n-aria'); if (d[k] != null) el.setAttribute('aria-label', d[k]); });
    }
    function syncLangToggle() {
      document.querySelectorAll('.lang-toggle .seg-btn').forEach(function (b) {
        var on = b.getAttribute('data-lang-val') === state.lang;
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    function setLang(l) {
      state.lang = l;
      document.documentElement.setAttribute('data-lang', l);
      document.documentElement.setAttribute('lang', l === 'en' ? 'en' : 'zh-CN');
      setStored('aleabito.lang', l);
      applyLang(); syncLangToggle();
      renderMeta(); renderKpis(); renderFilters(); renderBriefs(); renderAll();
    }
    function initLang() {
      var saved = getStored('aleabito.lang');
      var l = (saved === 'en' || saved === 'zh') ? saved : 'zh';
      state.lang = l;
      document.documentElement.setAttribute('data-lang', l);
      document.documentElement.setAttribute('lang', l === 'en' ? 'en' : 'zh-CN');
      syncLangToggle();
      document.querySelectorAll('.lang-toggle .seg-btn').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang-val')); }); });
    }
    function renderTrackRecord() {
      var el = $("trackBody");
      if (!el) return;
      var tr = DASHBOARD_DATA.trackRecord;
      if (!tr || !tr.n) { el.innerHTML = '<div class="track-empty"><span class="track-title">' + t('track_title') + '</span><span class="muted">' + t('track_empty') + '</span></div>'; return; }
      var p = function (v) { return v == null ? '—' : formatPct(v * 100); };
      el.innerHTML =
        '<div class="track-head"><span class="track-title">' + t('track_title') + '</span><span class="muted">' + t('track_head_sub') + '</span></div>' +
        '<div class="track-kpis">' +
          '<div class="track-kpi"><div class="tk-v ' + (tr.winRate >= 0.5 ? 'delta-up' : 'delta-down') + '">' + Math.round(tr.winRate * 100) + '%</div><div class="tk-l">' + t('track_win') + '</div></div>' +
          '<div class="track-kpi"><div class="tk-v ' + deltaClass(tr.medianExcess) + '">' + p(tr.medianExcess) + '</div><div class="tk-l">' + t('track_excess') + '</div></div>' +
          '<div class="track-kpi"><div class="tk-v ' + deltaClass(tr.basketRet) + '">' + p(tr.basketRet) + '</div><div class="tk-l">' + t('track_basket') + '</div></div>' +
          '<div class="track-kpi"><div class="tk-v ' + deltaClass(tr.medianFwd) + '">' + p(tr.medianFwd) + '</div><div class="tk-l">' + t('track_median') + '</div></div>' +
        '</div>' +
        '<div class="track-note">' + t('track_note_a') + tr.n + ' / ' + tr.meaningfulCount + t('track_note_b') + '</div>';
    }
    function trackBadge(row) {
      var tr = row.trackRecord;
      if (!tr) return '';
      var p = function (v) { return v == null ? '—' : formatPct(v * 100); };
      return '<div class="focus-track ' + deltaClass(tr.excess == null ? tr.fwdRet : tr.excess) + '">' + t('track_badge_a') + tr.entryDate + '：' + p(tr.fwdRet) + ' <span class="muted">' + t('track_badge_b') + p(tr.excess) + '</span></div>';
    }
    function renderFocus(row) {
      const el = $("focusBody");
      if (!el) return;
      if (!row) { el.innerHTML = '<div class="empty">' + t('empty_focus') + '</div>'; return; }
      const model = mentionPriceModel(row);
      const px = row.price || {};
      const hasPx = px.last_close != null;
      const chg = px.change_pct;
      const pxHtml = hasPx
        ? '<div class="focus-px ' + deltaClass(chg) + '">' + formatNumber(px.last_close, 2) + ' ' + html(px.currency || '') + ' <span class="focus-chg">' + formatPct(chg) + '</span></div>'
        : '<div class="focus-px muted">暂无价格</div>';
      el.innerHTML =
        '<div class="focus-head"><div class="focus-id"><span class="focus-ticker">' + row.ticker + '</span><span class="focus-name muted">' + html(px.symbol || row.ticker) + ' · ' + html(row.primary_theme) + (row.fundamentals && row.fundamentals.foreignListed ? ' <span class="foreign-pill">' + t('foreign_short') + '</span>' : '') + '</span></div>' +
        pxHtml + '</div>' +
        trackBadge(row) +
        momentumBadges(row) +
        combinedChart(row, true) +
        statsPanel(model, row);
      attachComboHandlers();
    }
    function initGridSplitter() {
      const grid = document.querySelector(".dashboard-grid");
      const sp = $("gridSplitter");
      if (!grid || !sp) return;
      const saved = (function () { try { return JSON.parse(localStorage.getItem("aleabito.split") || "null"); } catch (e) { return null; } })();
      let lastMain = 0;
      const apply = (mainPx) => { lastMain = mainPx; grid.style.gridTemplateColumns = mainPx + "px 12px minmax(360px, 1fr)"; };
      if (saved && saved.main > 0) apply(saved.main);
      let dragging = false;
      sp.addEventListener("mousedown", (e) => { dragging = true; document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize"; e.preventDefault(); });
      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const rect = grid.getBoundingClientRect();
        if (rect.width < 80) return;
        let mainPx = e.clientX - rect.left;
        mainPx = Math.max(520, Math.min(rect.width - 372, mainPx));
        apply(mainPx);
      });
      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false; document.body.style.userSelect = ""; document.body.style.cursor = "";
        if (lastMain > 0) { try { localStorage.setItem("aleabito.split", JSON.stringify({ main: Math.round(lastMain) })); } catch (e) {} }
      });
      sp.addEventListener("dblclick", () => { grid.style.gridTemplateColumns = ""; lastMain = 0; try { localStorage.removeItem("aleabito.split"); } catch (e) {} });
    }
    function lineChart(points, field, ticker, mode) {
      if (!points || points.length < 2) {
        return '<div class="empty">暂无可绘制数据<br><span class="muted">价格数据可能缺失或 Yahoo symbol 无法解析。</span></div>';
      }
      const width = 520;
      const height = 190;
      const pad = 22;
      const values = points.map((point) => Number(point[field]));
      const path = makeLinePath(values, width, height, pad);
      const finite = values.filter((value) => Number.isFinite(value));
      const max = Math.max.apply(null, finite);
      const min = Math.min.apply(null, finite);
      const lineClass = mode === "price" && values[values.length - 1] < values[0] ? "spark-line spark-red" : "spark-line";
      return '<svg class="line-chart js-detail-chart" data-ticker="' + ticker + '" data-mode="' + mode + '" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<path d="M' + pad + ',' + (height - pad) + ' L' + (width - pad) + ',' + (height - pad) + ' M' + pad + ',' + pad + ' L' + pad + ',' + (height - pad) + '" fill="none" class="chart-axis"></path>' +
        '<path d="M' + pad + ',62 L' + (width - pad) + ',62 M' + pad + ',118 L' + (width - pad) + ',118" fill="none" class="grid-line"></path>' +
        '<path class="' + lineClass + '" d="' + path + '"></path>' +
        '<text class="tick-label" x="' + (pad + 5) + '" y="35">' + formatNumber(max, 2) + '</text>' +
        '<text class="tick-label" x="' + (pad + 5) + '" y="' + (height - 12) + '">' + formatNumber(min, 2) + '</text>' +
        '<g class="crosshair"><line class="cross-line" y1="' + pad + '" y2="' + (height - pad) + '" stroke="#edf3ff" stroke-width="1" opacity="0.55"></line><circle class="cross-dot" r="4" fill="#edf3ff"></circle></g>' +
      '</svg>';
    }

    function renderDetail() {
      const row = rowByTicker(activeTicker()) || DASHBOARD_DATA.rows[0];
      if (!row) {
        $("detailBody").innerHTML = '<div class="empty">暂无数据</div>';
        return;
      }
      const previewing = state.hoverTicker && state.hoverTicker !== state.pinnedTicker;
      const statusChip = previewing
        ? '<span class="detail-status">预览中 · 点击锁定</span>'
        : '<span class="detail-status pinned">已锁定</span>';
      const mentionPoints = row.mentionSeries.map((point) => ({ date: point.date, value: point.mentioned_posts }));
      const priceNote = row.price.status === "ok"
        ? html(row.price.symbol) + " · " + html(row.price.exchange || row.price.currency || "")
        : "暂无价格数据 · attempted " + html(row.price.symbol || row.ticker);
      const samples = row.examples && row.examples.length
        ? row.examples.map((sample) => '<article class="sample"><div class="sample-meta"><span>' + html(sample.created_at.slice(0, 10)) + ' · ' + html(sample.kind) + '</span><a href="' + html(sample.url) + '" target="_blank" rel="noreferrer">打开来源</a></div><div class="sample-summary">' + html(sample.cn_summary || "这条来源需要结合英文原文判断语境。") + '</div><details><summary>查看英文原文</summary><div class="source-text">' + html(sample.source_text || sample.text || "") + '</div></details></article>').join("")
        : '<div class="empty">暂无来源样本</div>';
      $("detailBody").innerHTML =
        '<div class="detail-title"><div><div class="detail-ticker">' + row.ticker + '</div><div class="card-sub">' + html(row.primary_theme) + ' · ' + html(row.research_priority) + ' ' + statusChip + '</div></div><div class="score-badge">' + formatNumber(row.serenity_score, 1) + '</div></div>' +
        '<div class="detail-metrics">' +
          '<div class="mini-metric"><div class="mini-label">' + windowDays() + 'D Mentions</div><div class="mini-value">' + formatNumber(row.mentioned_posts) + '</div></div>' +
          '<div class="mini-metric"><div class="mini-label">Composition</div><div class="mini-value"><span class="c-posts">' + row.post_mentions + '</span> / <span class="c-replies">' + row.reply_mentions + '</span> / <span class="c-quotes">' + row.quote_mentions + '</span></div></div>' +
          '<div class="mini-metric"><div class="mini-label">7D Momentum</div><div class="mini-value ' + deltaClass(row.velocity) + '">' + (row.velocity > 0 ? "+" : "") + formatNumber(row.velocity) + '</div></div>' +
          '<div class="mini-metric"><div class="mini-label">' + (isFullWindow() ? "3M Price" : windowDays() + "D Price") + '</div><div class="mini-value ' + deltaClass(row.price.change_pct) + '">' + formatPct(row.price.change_pct) + '</div></div>' +
        '</div>' +
        fundGrid(row.fundamentals) +
        '<div class="section-label"><span>最新来源样本</span><span class="muted">中文摘要 + 英文原文</span></div>' +
        '<div class="sample-list">' + samples + '</div>';
      renderFocus(row);
    }

    function renderMovers() {
      $("movers").innerHTML = DASHBOARD_DATA.topMovers.map((row) => {
        const priceClass = deltaClass(row.change_pct);
        const source = rowByTicker(row.ticker);
        return '<div class="mover"><div class="mover-top"><span class="ticker">' + row.ticker + '</span><span class="' + priceClass + '">' + formatPct(row.change_pct) + '</span></div>' + (source ? priceSpark(source) : '') + '<div class="muted">' + html(row.symbol) + '</div></div>';
      }).join("");
      attachPriceTooltipHandlers($("movers"));
    }

    function attachPriceTooltipHandlers(root) {
      (root || document).querySelectorAll(".js-price-chart").forEach((svg) => {
        svg.addEventListener("mousemove", (event) => {
          const row = rowByTicker(svg.dataset.ticker);
          const points = row && row.price.points ? row.price.points : [];
          if (!points.length) return;
          const rect = svg.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const index = Math.round(ratio * (points.length - 1));
          const point = points[index];
          const x = 4 + (index / Math.max(points.length - 1, 1)) * (128 - 8);
          const values = points.map((p) => Number(p.close));
          const min = Math.min.apply(null, values);
          const max = Math.max.apply(null, values);
          const y = 38 - 4 - ((point.close - min) / (max - min || 1)) * (38 - 8);
          const cross = svg.querySelector(".spark-crosshair");
          if (cross) {
            cross.querySelector(".cross-line").setAttribute("x1", x);
            cross.querySelector(".cross-line").setAttribute("x2", x);
            cross.querySelector(".cross-dot").setAttribute("cx", x);
            cross.querySelector(".cross-dot").setAttribute("cy", y);
            cross.classList.add("is-on");
          }
          showTooltip(event, '<strong>' + row.ticker + '</strong><br><span class="muted">' + point.date + '</span><br>Price: ' + formatNumber(point.close, 2) + ' ' + html(row.price.currency || '') + '<br>3M: ' + formatPct(row.price.change_pct));
        });
        svg.addEventListener("mouseleave", () => {
          const cross = svg.querySelector(".spark-crosshair");
          if (cross) cross.classList.remove("is-on");
          hideTooltip();
        });
      });
    }

    function attachDetailChartHandlers() {
      document.querySelectorAll(".js-detail-chart").forEach((svg) => {
        svg.addEventListener("mousemove", (event) => {
          const row = rowByTicker(svg.dataset.ticker);
          const points = svg.dataset.mode === "price"
            ? (row.price.points || [])
            : row.mentionSeries.map((point) => ({ date: point.date, close: point.mentioned_posts }));
          if (!points.length) return;
          const rect = svg.getBoundingClientRect();
          const width = 520;
          const height = 190;
          const pad = 22;
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const index = Math.round(ratio * (points.length - 1));
          const point = points[index];
          const values = points.map((p) => Number(p.close));
          const min = Math.min.apply(null, values);
          const max = Math.max.apply(null, values);
          const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
          const y = height - pad - ((point.close - min) / (max - min || 1)) * (height - pad * 2);
          const cross = svg.querySelector(".crosshair");
          cross.querySelector(".cross-line").setAttribute("x1", x);
          cross.querySelector(".cross-line").setAttribute("x2", x);
          cross.querySelector(".cross-dot").setAttribute("cx", x);
          cross.querySelector(".cross-dot").setAttribute("cy", y);
          cross.classList.add("is-on");
          const label = svg.dataset.mode === "price" ? "Price" : "Mention posts";
          const suffix = svg.dataset.mode === "price" ? " " + html(row.price.currency || "") : "";
          showTooltip(event, '<strong>' + row.ticker + '</strong><br><span class="muted">' + point.date + '</span><br>' + label + ': ' + formatNumber(point.close, 2) + suffix);
        });
        svg.addEventListener("mouseleave", () => {
          const cross = svg.querySelector(".crosshair");
          if (cross) cross.classList.remove("is-on");
          hideTooltip();
        });
      });
    }

    function renderAll() {
      renderTrackRecord();
      renderConcentration();
      renderLegend();
      renderCompositionChart();
      renderBubbleChart();
      renderDonutChart();
      renderTable();
      renderDetail();
      renderMovers();
    }

    function syncSearchClear() {
      const clear = $("searchClear");
      if (clear) clear.style.display = $("searchBox").value ? "flex" : "none";
    }

    function attachEvents() {
      const debouncedTable = debounce(renderTable, 140);
      $("searchBox").addEventListener("input", () => { syncSearchClear(); debouncedTable(); });
      ["themeFilter", "priorityFilter", "priceFilter", "limitSelect"].forEach((id) => {
        $(id).addEventListener("change", renderTable);
      });
      const searchClear = $("searchClear");
      if (searchClear) searchClear.addEventListener("click", () => {
        $("searchBox").value = "";
        syncSearchClear();
        $("searchBox").focus();
        renderTable();
      });
      $("resetFilters").addEventListener("click", () => {
        $("searchBox").value = "";
        $("themeFilter").value = "all";
        $("priorityFilter").value = "all";
        $("priceFilter").value = "all";
        $("limitSelect").value = "50";
        state.sortKey = "serenity_rank";
        state.sortDir = "asc";
        syncSearchClear();
        renderTable();
      });
      document.querySelectorAll("th[data-sort]").forEach((th) => {
        th.setAttribute("tabindex", "0");
        const applySort = () => {
          const key = th.dataset.sort;
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = key;
            state.sortDir = key === "serenity_rank" || key === "ticker" || key === "primary_theme" || key === "last_seen" ? "asc" : "desc";
          }
          renderTable();
        };
        th.addEventListener("click", applySort);
        th.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); applySort(); }
        });
      });
      ["topCompositionChart", "bubbleChart", "rankBody"].forEach((id) => {
        const el = $(id);
        if (el) el.addEventListener("mouseleave", clearHoverTicker);
      });
    }

    function setupReveal() {
      if (reducedMotion || !("IntersectionObserver" in window)) return;
      document.body.classList.add("anim-ready");
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-in");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
      document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    }

    initLang();
    renderMeta();
    initTheme();
    renderBriefs();
    initWindowBar();
    initGridSplitter();
    renderKpis();
    renderFilters();
    attachEvents();
    setupReveal();
    renderAll();
    applyLang();
    firstPaint = false;
    syncSearchClear();
  </script>
</body>
</html>`;
}

function buildHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Serenity 500 · AleaBito Research Dashboard</title>
  <style>
    :root {
      --bg: #f7f4ed;
      --panel: #fffdfa;
      --ink: #1f2422;
      --muted: #6f756f;
      --line: #d9d2c3;
      --line-strong: #b8ae9b;
      --green: #0f7b63;
      --green-soft: #dceee7;
      --red: #ba4b45;
      --red-soft: #f4ded9;
      --gold: #b7791f;
      --gold-soft: #f5ead0;
      --teal: #176f7a;
      --blue: #365f91;
      --radius: 8px;
      --shadow: 0 12px 34px rgba(51, 43, 28, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(255, 253, 250, 0.9), rgba(247, 244, 237, 0.92)),
        repeating-linear-gradient(90deg, rgba(31, 36, 34, 0.03), rgba(31, 36, 34, 0.03) 1px, transparent 1px, transparent 48px);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select {
      font: inherit;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .shell {
      max-width: 1500px;
      margin: 0 auto;
      padding: 28px 22px 46px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-end;
      border-bottom: 1px solid var(--line);
      padding-bottom: 18px;
    }

    .eyebrow {
      color: var(--gold);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    h1 {
      margin: 6px 0 8px;
      font-size: clamp(30px, 5vw, 56px);
      line-height: 0.95;
      font-weight: 900;
      letter-spacing: 0;
    }

    .subhead {
      max-width: 820px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.55;
    }

    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      min-width: 310px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 253, 250, 0.74);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 99px;
      background: var(--green);
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }

    .kpi {
      min-height: 100px;
      padding: 15px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .kpi-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .kpi-value {
      margin-top: 10px;
      font-size: 30px;
      line-height: 1;
      font-weight: 900;
    }

    .kpi-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.55fr);
      gap: 14px;
      align-items: start;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: rgba(255, 253, 250, 0.94);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
      min-height: 58px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .panel-sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1.1fr) repeat(4, minmax(120px, 0.7fr));
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      background: #fbf7ef;
    }

    .control {
      height: 38px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--ink);
      padding: 0 10px;
      min-width: 0;
    }

    .summary-charts {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 0.5fr);
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .bar-row {
      display: grid;
      grid-template-columns: 60px minmax(0, 1fr) 66px;
      gap: 9px;
      align-items: center;
      min-height: 24px;
      font-size: 12px;
    }

    .bar-label {
      font-weight: 900;
    }

    .bar-track {
      height: 9px;
      background: #ece5d7;
      border-radius: 999px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--green), var(--gold));
      border-radius: inherit;
    }

    .bar-value {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .theme-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .theme-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      border-bottom: 1px solid #eee7da;
      padding-bottom: 7px;
    }

    .theme-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }

    .theme-count {
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }

    .table-wrap {
      overflow: auto;
      max-height: 760px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1160px;
      font-size: 13px;
    }

    th, td {
      padding: 10px 10px;
      border-bottom: 1px solid #ebe4d6;
      text-align: left;
      vertical-align: middle;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #efe7d7;
      color: #464a45;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      user-select: none;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover {
      background: #f8f0df;
    }

    tbody tr.active {
      background: #e6f0ea;
      box-shadow: inset 3px 0 0 var(--green);
    }

    .rank {
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      color: var(--gold);
    }

    .ticker {
      font-weight: 950;
      letter-spacing: 0;
    }

    .theme {
      display: inline-flex;
      max-width: 230px;
      height: 24px;
      align-items: center;
      padding: 0 8px;
      border-radius: 999px;
      background: #eee8da;
      color: #4a4b44;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .priority-high { background: var(--green-soft); color: var(--green); }
    .priority-medium { background: var(--gold-soft); color: var(--gold); }
    .priority-low, .priority-unverified { background: #eee7da; color: var(--muted); }

    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .delta-up { color: var(--green); font-weight: 900; }
    .delta-down { color: var(--red); font-weight: 900; }
    .delta-flat { color: var(--muted); font-weight: 800; }

    .spark {
      width: 110px;
      height: 34px;
      display: block;
    }

    .spark-bg {
      fill: none;
      stroke: #e3dac9;
      stroke-width: 1;
    }

    .spark-line {
      fill: none;
      stroke: var(--green);
      stroke-width: 2.1;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .spark-red {
      stroke: var(--red);
    }

    .spark-muted {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .detail-body {
      padding: 16px;
    }

    .detail-title {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 12px;
    }

    .detail-ticker {
      font-size: 34px;
      line-height: 1;
      font-weight: 950;
    }

    .score-badge {
      min-width: 74px;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      display: grid;
      place-items: center;
      background: #f6ead4;
      font-weight: 950;
      font-variant-numeric: tabular-nums;
    }

    .detail-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 12px 0;
    }

    .mini-metric {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px;
      background: #fffaf0;
      min-height: 66px;
    }

    .mini-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .mini-value {
      margin-top: 6px;
      font-size: 18px;
      font-weight: 950;
      font-variant-numeric: tabular-nums;
    }

    .chart {
      width: 100%;
      height: 180px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fffaf0;
      margin-top: 10px;
    }

    .chart-title {
      margin-top: 16px;
      font-size: 12px;
      font-weight: 900;
      color: #4d504a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .example-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
      margin-top: 10px;
    }

    .example {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px;
      background: #fffaf0;
    }

    .example-meta {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 6px;
    }

    .example-text {
      font-size: 12px;
      line-height: 1.45;
      color: #373b36;
    }

    .movers {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 14px;
    }

    .mover {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px;
      background: #fffaf0;
      min-width: 0;
    }

    .mover-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      font-weight: 900;
    }

    .footer-note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .empty {
      padding: 26px;
      color: var(--muted);
      text-align: center;
      font-weight: 800;
    }

    @media (max-width: 1100px) {
      .topbar, .grid {
        display: block;
      }
      .meta-strip {
        justify-content: flex-start;
        margin-top: 14px;
      }
      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .side {
        margin-top: 14px;
      }
      .controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .summary-charts {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 620px) {
      .shell {
        padding: 18px 12px 34px;
      }
      .kpi-grid {
        grid-template-columns: 1fr;
      }
      .controls {
        grid-template-columns: 1fr;
      }
      .detail-metrics, .movers {
        grid-template-columns: 1fr;
      }
      h1 {
        font-size: 34px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar">
      <div>
        <div class="eyebrow">AleaBito 60D Equity Intelligence</div>
        <h1>Serenity 500</h1>
        <div class="subhead">基于 @aleabitoreddit 过去 60 天提及数据生成的研究榜单。排名代表注意力、近期加速和研究优先级，不代表买入建议。</div>
      </div>
      <div class="meta-strip" id="metaStrip"></div>
    </section>

    <section class="kpi-grid" id="kpiGrid"></section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Serenity 500 排行榜</h2>
            <div class="panel-sub">按综合关注度排序，包含 60 天 mention、7 天动量、主题和价格趋势。</div>
          </div>
          <span class="pill"><span class="dot"></span><span id="resultCount"></span></span>
        </div>
        <div class="controls">
          <input class="control" id="searchBox" placeholder="搜索 ticker / theme">
          <select class="control" id="themeFilter"></select>
          <select class="control" id="priorityFilter">
            <option value="all">所有优先级</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="unverified">Unverified</option>
          </select>
          <select class="control" id="priceFilter">
            <option value="all">所有价格状态</option>
            <option value="ok">有价格图</option>
            <option value="missing">暂无价格图</option>
            <option value="up">60D 上涨</option>
            <option value="down">60D 下跌</option>
          </select>
          <select class="control" id="limitSelect">
            <option value="50">Top 50</option>
            <option value="100">Top 100</option>
            <option value="277">全部</option>
          </select>
        </div>
        <div class="summary-charts">
          <div>
            <h2>Top 20 Attention Score</h2>
            <div class="bars" id="topBars"></div>
          </div>
          <div>
            <h2>Theme Mix</h2>
            <div class="theme-list" id="themeList"></div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th data-sort="serenity_rank">Rank</th>
                <th data-sort="ticker">Ticker</th>
                <th data-sort="serenity_score">Score</th>
                <th data-sort="primary_theme">Theme</th>
                <th data-sort="mentioned_posts">60D Mentions</th>
                <th data-sort="last7">7D</th>
                <th data-sort="velocity">7D Delta</th>
                <th data-sort="originalWeight">Original Mix</th>
                <th data-sort="price.change_pct">Price 3M</th>
                <th>Price Trend</th>
                <th data-sort="daysSinceLast">Recency</th>
              </tr>
            </thead>
            <tbody id="rankBody"></tbody>
          </table>
        </div>
      </div>

      <aside class="side">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Stock Detail</h2>
              <div class="panel-sub">单个 ticker 的 mention 曲线、价格曲线和最新原文样本。</div>
            </div>
          </div>
          <div class="detail-body" id="detailBody"></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Price Movers</h2>
              <div class="panel-sub">按 3 个月价格变化绝对值排序。</div>
            </div>
          </div>
          <div class="movers" id="movers"></div>
        </div>
      </aside>
    </section>

    <div class="footer-note" id="footerNote"></div>
  </main>

  <script>
    const DASHBOARD_DATA = ${json};
    const state = {
      sortKey: "serenity_rank",
      sortDir: "asc",
      selectedTicker: DASHBOARD_DATA.rows[0]?.ticker || null,
    };

    const $ = (id) => document.getElementById(id);

    function formatNumber(value, digits = 0) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value));
    }

    function formatPct(value, digits = 1) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
      const sign = value > 0 ? "+" : "";
      return sign + formatNumber(value, digits) + "%";
    }

    function getValue(row, key) {
      return key.split(".").reduce((acc, part) => acc == null ? undefined : acc[part], row);
    }

    function classForDelta(value) {
      if (!Number.isFinite(Number(value)) || Number(value) === 0) return "delta-flat";
      return Number(value) > 0 ? "delta-up" : "delta-down";
    }

    function priorityClass(priority) {
      return "priority-" + (priority || "unverified");
    }

    function svgSpark(path, changePct) {
      if (!path) return '<span class="spark-muted">暂无数据</span>';
      const lineClass = Number(changePct) < 0 ? "spark-line spark-red" : "spark-line";
      return '<svg class="spark" viewBox="0 0 110 34" aria-hidden="true"><path class="spark-bg" d="M3,17 L107,17"></path><path class="' + lineClass + '" d="' + path + '"></path></svg>';
    }

    function buildPath(points, field, width = 420, height = 180, pad = 18) {
      const values = points.map((point) => Number(point[field])).filter((value) => Number.isFinite(value));
      if (values.length < 2) return "";
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      return points.map((point, index) => {
        const value = Number(point[field]);
        const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        return (index === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
      }).join(" ");
    }

    function lineChart(points, field, colorClass = "") {
      const width = 420;
      const height = 180;
      const path = buildPath(points, field, width, height);
      if (!path) return '<div class="empty">暂无可绘制数据</div>';
      const values = points.map((point) => Number(point[field])).filter((value) => Number.isFinite(value));
      const max = Math.max(...values);
      const min = Math.min(...values);
      return '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<path d="M18,18 L18,162 L402,162" fill="none" stroke="#d8cfbd" stroke-width="1"/>' +
        '<path d="M18,54 L402,54 M18,108 L402,108" fill="none" stroke="#eee4d6" stroke-width="1"/>' +
        '<path class="spark-line ' + colorClass + '" d="' + path + '"/>' +
        '<text x="22" y="32" fill="#6f756f" font-size="11" font-weight="700">' + formatNumber(max, 1) + '</text>' +
        '<text x="22" y="154" fill="#6f756f" font-size="11" font-weight="700">' + formatNumber(min, 1) + '</text>' +
        '</svg>';
    }

    function filteredRows() {
      const query = $("searchBox").value.trim().toUpperCase();
      const theme = $("themeFilter").value;
      const priority = $("priorityFilter").value;
      const price = $("priceFilter").value;
      const limit = Number($("limitSelect").value);

      let rows = DASHBOARD_DATA.rows.filter((row) => {
        const haystack = [row.ticker, row.primary_theme, row.research_priority].join(" ").toUpperCase();
        if (query && !haystack.includes(query)) return false;
        if (theme !== "all" && row.primary_theme !== theme) return false;
        if (priority !== "all" && row.research_priority !== priority) return false;
        if (price === "ok" && row.price.status !== "ok") return false;
        if (price === "missing" && row.price.status === "ok") return false;
        if (price === "up" && !(Number(row.price.change_pct) > 0)) return false;
        if (price === "down" && !(Number(row.price.change_pct) < 0)) return false;
        return true;
      });

      rows = rows.sort((a, b) => {
        const av = getValue(a, state.sortKey);
        const bv = getValue(b, state.sortKey);
        const direction = state.sortDir === "asc" ? 1 : -1;
        if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * direction;
        return ((Number(av ?? -Infinity) || 0) - (Number(bv ?? -Infinity) || 0)) * direction;
      });

      return rows.slice(0, limit);
    }

    function renderMeta() {
      const { dataWindow, priceProvider } = DASHBOARD_DATA;
      $("metaStrip").innerHTML = [
        '<span class="pill"><span class="dot"></span>' + dataWindow.earliestDate + ' → ' + dataWindow.latestDate + '</span>',
        '<span class="pill">' + formatNumber(dataWindow.events) + ' events</span>',
        '<span class="pill">' + formatNumber(dataWindow.tickers) + ' tickers</span>',
        '<span class="pill">' + priceProvider.success + '/' + priceProvider.total + ' price charts</span>',
      ].join("");

      $("footerNote").innerHTML = '数据源：' +
        DASHBOARD_DATA.sourceFiles.summary + '、' +
        DASHBOARD_DATA.sourceFiles.daily + '、' +
        DASHBOARD_DATA.sourceFiles.events + '。价格趋势来自 ' +
        DASHBOARD_DATA.priceProvider.name + '，部分非美股或疑似误识别 ticker 可能没有价格图。高提及度只代表研究地图信号，不构成投资建议。';
    }

    function renderKpis() {
      const rows = DASHBOARD_DATA.rows;
      const high = rows.filter((row) => row.research_priority === "high").length;
      const priceOk = rows.filter((row) => row.price.status === "ok").length;
      const totalMentions = rows.reduce((sum, row) => sum + row.mentioned_posts, 0);
      const topTheme = DASHBOARD_DATA.themeStats[0];
      const hot = rows.slice().sort((a, b) => b.last7 - a.last7)[0];
      const kpis = [
        ["Universe", formatNumber(rows.length), "可排序研究标的"],
        ["60D Mentions", formatNumber(totalMentions), "去重后 ticker mention posts"],
        ["High Priority", formatNumber(high), "skill 标记的高优先级线索"],
        ["Top Theme", topTheme?.theme || "—", formatNumber(topTheme?.mentions || 0) + " mentions"],
        ["Hot 7D", hot?.ticker || "—", (hot ? formatNumber(hot.last7) : "—") + " mentions"],
        ["Price Coverage", formatNumber(priceOk) + "/" + formatNumber(rows.length), "Yahoo chart 拉取成功"],
      ];
      $("kpiGrid").style.gridTemplateColumns = "repeat(6, minmax(140px, 1fr))";
      $("kpiGrid").innerHTML = kpis.map(([label, value, note]) =>
        '<div class="kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div><div class="kpi-note">' + note + '</div></div>'
      ).join("");
    }

    function renderFilters() {
      const themes = ["all", ...DASHBOARD_DATA.themeStats.map((item) => item.theme)];
      $("themeFilter").innerHTML = themes.map((theme) => '<option value="' + theme + '">' + (theme === "all" ? "所有主题" : theme) + '</option>').join("");
      $("limitSelect").querySelector('option[value="277"]').value = String(DASHBOARD_DATA.rows.length);
    }

    function renderCharts(rows) {
      const top = rows.slice(0, 20);
      const maxScore = Math.max(...top.map((row) => row.serenity_score), 1);
      $("topBars").innerHTML = top.map((row) => {
        const width = Math.max(2, (row.serenity_score / maxScore) * 100);
        return '<div class="bar-row"><div class="bar-label">' + row.ticker + '</div><div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div><div class="bar-value">' + formatNumber(row.serenity_score, 1) + '</div></div>';
      }).join("");

      const maxTheme = Math.max(...DASHBOARD_DATA.themeStats.map((item) => item.mentions), 1);
      $("themeList").innerHTML = DASHBOARD_DATA.themeStats.map((item) => {
        const width = Math.max(3, (item.mentions / maxTheme) * 100);
        return '<div><div class="theme-item"><div class="theme-name">' + item.theme + '</div><div class="theme-count">' + formatNumber(item.mentions) + '</div></div><div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div></div>';
      }).join("");
    }

    function renderTable() {
      const rows = filteredRows();
      $("resultCount").textContent = rows.length + " rows";
      $("rankBody").innerHTML = rows.map((row) => {
        const active = row.ticker === state.selectedTicker ? "active" : "";
        const velocityClass = classForDelta(row.velocity);
        const priceClass = classForDelta(row.price.change_pct);
        const recency = row.daysSinceLast === null ? "—" : row.daysSinceLast === 0 ? "Today" : row.daysSinceLast + "d";
        return '<tr class="' + active + '" data-ticker="' + row.ticker + '">' +
          '<td class="rank">#' + row.serenity_rank + '</td>' +
          '<td><div class="ticker">' + row.ticker + '</div><div class="spark-muted">' + row.price.symbol + '</div></td>' +
          '<td class="num"><strong>' + formatNumber(row.serenity_score, 1) + '</strong></td>' +
          '<td><span class="theme ' + priorityClass(row.research_priority) + '">' + row.primary_theme + '</span></td>' +
          '<td class="num">' + formatNumber(row.mentioned_posts) + '</td>' +
          '<td class="num">' + formatNumber(row.last7) + '</td>' +
          '<td class="num ' + velocityClass + '">' + (row.velocity > 0 ? "+" : "") + formatNumber(row.velocity) + '</td>' +
          '<td class="num">' + formatPct(row.originalWeight * 100, 0) + '</td>' +
          '<td class="num ' + priceClass + '">' + formatPct(row.price.change_pct) + '</td>' +
          '<td>' + svgSpark(row.price.sparkPath, row.price.change_pct) + '</td>' +
          '<td class="num">' + recency + '</td>' +
        '</tr>';
      }).join("");

      document.querySelectorAll("#rankBody tr").forEach((tr) => {
        tr.addEventListener("click", () => {
          state.selectedTicker = tr.dataset.ticker;
          renderAll();
        });
      });

      renderCharts(rows);
    }

    function renderDetail() {
      const row = DASHBOARD_DATA.rows.find((item) => item.ticker === state.selectedTicker) || DASHBOARD_DATA.rows[0];
      if (!row) {
        $("detailBody").innerHTML = '<div class="empty">暂无数据</div>';
        return;
      }

      const mentionPoints = row.mentionSeries.map((point) => ({ date: point.date, value: point.mentioned_posts }));
      const priceColor = Number(row.price.change_pct) < 0 ? "spark-red" : "";
      const examples = row.examples.length ? row.examples.map((example) =>
        '<a class="example" href="' + example.url + '" target="_blank" rel="noreferrer">' +
          '<div class="example-meta">' + example.created_at.slice(0, 10) + ' · ' + example.kind + '</div>' +
          '<div class="example-text">' + example.text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char])) + '</div>' +
        '</a>'
      ).join("") : '<div class="empty">暂无样本</div>';

      $("detailBody").innerHTML =
        '<div class="detail-title"><div><div class="detail-ticker">' + row.ticker + '</div><div class="panel-sub">' + row.primary_theme + ' · ' + row.research_priority + '</div></div><div class="score-badge">' + formatNumber(row.serenity_score, 1) + '</div></div>' +
        '<div class="detail-metrics">' +
          '<div class="mini-metric"><div class="mini-label">60D Mentions</div><div class="mini-value">' + formatNumber(row.mentioned_posts) + '</div></div>' +
          '<div class="mini-metric"><div class="mini-label">7D Momentum</div><div class="mini-value ' + classForDelta(row.velocity) + '">' + (row.velocity > 0 ? "+" : "") + formatNumber(row.velocity) + '</div></div>' +
          '<div class="mini-metric"><div class="mini-label">Price 3M</div><div class="mini-value ' + classForDelta(row.price.change_pct) + '">' + formatPct(row.price.change_pct) + '</div></div>' +
          '<div class="mini-metric"><div class="mini-label">Last Close</div><div class="mini-value">' + (row.price.last_close ? formatNumber(row.price.last_close, 2) + " " + row.price.currency : "—") + '</div></div>' +
        '</div>' +
        '<div class="chart-title">Mention Trend</div>' +
        lineChart(mentionPoints, "value") +
        '<div class="chart-title">Price Trend · ' + (row.price.symbol || row.ticker) + '</div>' +
        lineChart(row.price.points || [], "close", priceColor) +
        '<div class="chart-title">Research Notes</div>' +
        '<div class="example"><div class="example-text">当前结论：研究地图。高 mention 表示 Serenity 关注和可追踪线索，不等于可投资结论；需要继续验证护城河、现金流、估值和安全边际。数据质量：' + row.qualityFlag + '。</div></div>' +
        '<div class="chart-title">Latest Source Samples</div>' +
        '<div class="example-list">' + examples + '</div>';
    }

    function renderMovers() {
      $("movers").innerHTML = DASHBOARD_DATA.topMovers.map((row) => {
        const cls = classForDelta(row.change_pct);
        return '<div class="mover"><div class="mover-top"><span>' + row.ticker + '</span><span class="' + cls + '">' + formatPct(row.change_pct) + '</span></div>' + svgSpark(row.sparkPath, row.change_pct) + '<div class="spark-muted">' + row.symbol + '</div></div>';
      }).join("");
    }

    function attachEvents() {
      ["searchBox", "themeFilter", "priorityFilter", "priceFilter", "limitSelect"].forEach((id) => {
        $(id).addEventListener("input", renderAll);
        $(id).addEventListener("change", renderAll);
      });

      document.querySelectorAll("th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = key;
            state.sortDir = key === "serenity_rank" || key === "ticker" || key === "primary_theme" ? "asc" : "desc";
          }
          renderAll();
        });
      });
    }

    function renderAll() {
      renderTable();
      renderDetail();
      renderMovers();
    }

    renderMeta();
    renderKpis();
    renderFilters();
    attachEvents();
    renderAll();
  </script>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
