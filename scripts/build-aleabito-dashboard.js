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

  if (!noPrices) {
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
        cache.prices[ticker] = result;
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
    rows: summary,
  };

  const html = buildHtmlV2(dashboardData);
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

function buildHtmlV2(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
      --line: #25304d;
      --line-2: #333f60;
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
      --shadow: 0 28px 70px rgba(0, 0, 0, 0.32);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }

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
      background: linear-gradient(180deg, var(--cyan), var(--purple), var(--pink));
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
      grid-template-columns: minmax(0, 1.38fr) minmax(430px, 0.62fr);
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
        grid-template-columns: 1fr;
      }
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
        <div class="hero-copy">基于 @aleabitoreddit 自建号以来全部提及数据生成的研究地图。排名代表注意力、提及结构、近期动量和研究优先级，不代表买卖建议。</div>
      </div>
      <div class="meta-strip" id="metaStrip"></div>
    </section>

    <section class="window-bar reveal" aria-label="时间窗口选择">
      <div class="window-bar-title"><span class="accent"></span>时间窗口</div>
      <div class="window-presets" role="group" aria-label="预设时间窗口">
        <button type="button" class="window-preset" data-days="7">7D</button>
        <button type="button" class="window-preset" data-days="14">14D</button>
        <button type="button" class="window-preset" data-days="30">30D</button>
        <button type="button" class="window-preset" data-days="90">90D</button>
        <button type="button" class="window-preset" data-days="180">180D</button>
        <button type="button" class="window-preset" data-days="all">全部</button>
      </div>
      <div class="window-dates">
        <input type="date" id="winStart" aria-label="开始日期">
        <span class="sep">→</span>
        <input type="date" id="winEnd" aria-label="结束日期">
        <button type="button" class="window-reset" id="winReset">重置</button>
      </div>
      <div class="window-label" id="winLabel"></div>
    </section>

    <section class="kpi-grid" id="kpiGrid"></section>

    <section class="card reveal brief-card" id="briefCard" data-testid="brief-card">
      <div id="briefBody"></div>
    </section>

    <section class="dashboard-grid">
      <div class="main-stack">
        <section class="card reveal" data-testid="composition-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2>Top 30 Ticker · 提及构成分解</h2></div>
              <div class="card-sub">横向堆叠条显示主帖、回复和引用的构成。图例可点击开关。</div>
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
                <div class="title-row"><span class="accent"></span><h2>提及结构 · 主帖 vs 互动</h2></div>
                <div class="card-sub">气泡大小 = 原始提及次数，展示哪些 ticker 是主动 thesis，哪些更多来自互动讨论。</div>
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
                <div class="title-row"><span class="accent"></span><h2>提及类型分布</h2></div>
                <div class="card-sub">全样本聚合：主帖、回复、引用的占比。</div>
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
              <div class="title-row"><span class="accent"></span><h2>完整数据 · <span id="tableTickerCount"></span> 个 Ticker</h2></div>
              <div class="card-sub">搜索、排序和筛选会联动详情面板。鼠标悬停或点击行可快速查看单个 ticker。</div>
            </div>
            <span class="pill"><span class="dot"></span><span id="resultCount"></span></span>
          </div>
          <div class="controls">
            <div class="search-wrap"><input class="control search-input" id="searchBox" placeholder="搜索 ticker / theme / priority" aria-label="搜索 ticker、theme 或 priority"><button class="search-clear" id="searchClear" type="button" aria-label="清除搜索" style="display:none">×</button></div>
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
              <option value="up">3M 上涨</option>
              <option value="down">3M 下跌</option>
            </select>
            <select class="control" id="limitSelect">
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="all">全部</option>
            </select>
            <button class="control control-button" id="resetFilters" type="button">重置筛选</button>
          </div>
          <div class="table-wrap">
            <table aria-label="Ticker 完整数据表">
              <thead>
                <tr>
                  <th scope="col" data-sort="serenity_rank">#</th>
                  <th scope="col" data-sort="ticker">Ticker</th>
                  <th scope="col" data-sort="mentioned_posts">提及帖子</th>
                  <th scope="col" data-sort="raw_occurrences">原始次数</th>
                  <th scope="col" data-sort="post_mentions">主帖</th>
                  <th scope="col" data-sort="reply_mentions">回复</th>
                  <th scope="col" data-sort="quote_mentions">引用</th>
                  <th scope="col" data-sort="primary_theme">主题</th>
                  <th scope="col" data-sort="last7">7D</th>
                  <th scope="col" data-sort="price.change_pct">3M Price</th>
                  <th scope="col">价格趋势</th>
                  <th scope="col" data-sort="last_seen">最后提及</th>
                </tr>
              </thead>
              <tbody id="rankBody"></tbody>
            </table>
          </div>
        </section>
      </div>

      <aside class="side-stack">
        <section class="card reveal" data-testid="stock-detail-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2>Stock Detail</h2></div>
              <div class="card-sub">提及趋势、价格趋势、中文来源摘要和英文原文。</div>
            </div>
          </div>
          <div class="detail-body" id="detailBody"></div>
        </section>

        <section class="card reveal" data-testid="movers-card">
          <div class="card-head">
            <div>
              <div class="title-row"><span class="accent"></span><h2>Price Movers</h2></div>
              <div class="card-sub">按 3 个月价格变化绝对值排序。</div>
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
    const SERIES = [
      { key: "posts", label: "主帖 Posts", color: "#67d9f4", className: "c-posts" },
      { key: "replies", label: "回复 Replies", color: "#8274f6", className: "c-replies" },
      { key: "quotes", label: "引用 Quotes", color: "#ee79b8", className: "c-quotes" },
    ];
    const state = {
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
      const themeCards = digest.themes.map((t) => {
        const inner = t.body
          ? '<div class="brief-field-text">' + briefText(t.body) + '</div>'
          : briefField("她的观点", t.view)
            + briefField("小白解释", t.beginner)
            + briefField("第一性原理", t.firstPrinciples)
            + briefField("Buffett 判断", t.buffett)
            + briefField("当前结论", t.conclusion);
        const links = (t.links || []).length
          ? '<div class="brief-links">' + t.links.map((u, i) => '<a class="brief-link" href="' + html(u) + '" target="_blank" rel="noopener noreferrer">关键链接 ' + (i + 1) + '</a>').join("") + '</div>'
          : "";
        return '<details class="brief-theme"' + (t.n === 1 ? " open" : "") + '><summary><span class="brief-theme-n">' + t.n + '</span><span class="brief-theme-title">' + linkifyTickers(t.title) + '</span></summary><div class="brief-theme-body">' + inner + links + '</div></details>';
      }).join("");
      const picker = digests.length > 1
        ? '<select class="control brief-date" id="briefDateSelect" aria-label="选择简报日期">' + digests.map((d) => '<option value="' + html(d.date) + '"' + (d.date === digest.date ? " selected" : "") + '>' + html(d.date) + '</option>').join("") + '</select>'
        : '<span class="pill"><span class="dot"></span>' + html(digest.date) + '</span>';
      const metaBits = [
        digest.rangeStart && digest.rangeEnd ? '范围 ' + html(digest.rangeStart) + ' → ' + html(digest.rangeEnd) : '',
        digest.dedupCount != null ? '去重 ' + formatNumber(digest.dedupCount) + ' 条' : '',
        digest.source ? '来源 ' + html(digest.source) : '',
      ].filter(Boolean).join(' · ');
      host.innerHTML =
        '<div class="brief-head">' +
          '<div><div class="title-row"><span class="accent"></span><h2>每日研究简报</h2></div>' +
          '<div class="card-sub">' + html(digest.title) + (metaBits ? ' · ' + metaBits : '') + '</div></div>' +
          picker +
        '</div>' +
        (digest.summary ? '<div class="brief-summary"><div class="brief-summary-label">今天她重点看什么</div><div class="brief-summary-text">' + briefText(digest.summary) + '</div></div>' : '') +
        '<div class="brief-themes">' + themeCards + '</div>' +
        (digest.totalAnalysis ? '<div class="brief-total"><div class="brief-field-label">总分析</div><div class="brief-field-text">' + briefText(digest.totalAnalysis) + '</div></div>' : '') +
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
      $("footerNote").innerHTML = "数据源：" + DASHBOARD_DATA.sourceFiles.summary + "、" + DASHBOARD_DATA.sourceFiles.daily + "、" + DASHBOARD_DATA.sourceFiles.events + "。价格趋势来自 " + DASHBOARD_DATA.priceProvider.name + "。高提及度只代表研究地图信号，不构成投资建议。";
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
        ["Universe", formatNumber(rows.length), "可排序研究标的", rows.length],
        ["Mentions", formatNumber(totalMentions), windowDays() + " 天 ticker mention posts", totalMentions],
        ["High Priority", formatNumber(high), "skill 标记的高优先级线索", high],
        ["Top Theme", topTheme ? topTheme.theme : "—", topTheme ? formatNumber(topTheme.mentions) + " mentions" : "—", null],
        ["Hot 7D", hot ? hot.ticker : "—", hot ? formatNumber(hot.last7) + " mentions" : "—", null],
        ["Price Coverage", priceOk + "/" + rows.length, "Yahoo chart 拉取成功", null],
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
      $("themeFilter").innerHTML = themes.map((theme) => '<option value="' + html(theme) + '">' + (theme === "all" ? "所有主题" : html(theme)) + '</option>').join("");
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
        '<path d="M' + pad + ',' + (height - pad) + ' L' + (width - pad) + ',' + (height - pad) + ' M' + pad + ',' + pad + ' L' + pad + ',' + (height - pad) + '" fill="none" stroke="#293553"></path>' +
        '<path d="M' + pad + ',62 L' + (width - pad) + ',62 M' + pad + ',118 L' + (width - pad) + ',118" fill="none" stroke="rgba(78,91,130,0.32)"></path>' +
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
        '<div class="section-label"><span>Mention Trend</span><span class="muted">daily posts</span></div>' +
        lineChart(mentionPoints, "value", row.ticker, "mention") +
        '<div class="section-label"><span>Price Trend</span><span class="muted">' + priceNote + '</span></div>' +
        lineChart(row.price.points || [], "close", row.ticker, "price") +
        '<div class="section-label"><span>最新来源样本</span><span class="muted">中文摘要 + 英文原文</span></div>' +
        '<div class="sample-list">' + samples + '</div>';
      attachDetailChartHandlers();
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

    renderMeta();
    renderBriefs();
    initWindowBar();
    renderKpis();
    renderFilters();
    attachEvents();
    setupReveal();
    renderAll();
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
