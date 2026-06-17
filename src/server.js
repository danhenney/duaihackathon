import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assets, people, seedCalls, viralPostFallback } from "./data.js";
import { getStoredCalls, saveLiveSearchResult } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 5177);

function loadEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

const priceFallbacks = {
  BTC: { entry: 94200, current: 104200, currency: "USD" },
  ETH: { entry: 3060, current: 3820, currency: "USD" },
  HYPE: { entry: 31.5, current: 42.8, currency: "USD" },
  ZEC: { entry: 405, current: 512, currency: "USD" },
  NEAR: { entry: 2.32, current: 3.05, currency: "USD" },
  APT: { entry: 6.18, current: 7.04, currency: "USD" },
  WLD: { entry: 1.12, current: 1.36, currency: "USD" },
  RPI: { entry: 280, current: 812, currency: "GBp" },
  SIVE: { entry: 8.2, current: 11.7, currency: "SEK" },
  XFAB: { entry: 5.7, current: 7.9, currency: "EUR" },
  "000660.KS": { entry: 20000, current: 2382000, currency: "KRW" },
  SPX: { entry: 6880, current: 7023, currency: "USD" },
  NVDA: { entry: 212.08, current: 209.05, currency: "USD" },
  TSLA: { entry: 407.36, current: 184.2, currency: "USD" },
  WBD: { entry: 24.78, current: 10.92, currency: "USD" },
  "005930.KS": { entry: 71300, current: 79200, currency: "KRW" },
  "035420.KS": { entry: 218000, current: 204500, currency: "KRW" },
  "035720.KS": { entry: 121000, current: 48900, currency: "KRW" },
  "005380.KS": { entry: 102000, current: 238500, currency: "KRW" },
  CITRINDEX: { entry: 100, current: 200.57, currency: "index" },
  AI_INFRA: { entry: 100, current: 128.4, currency: "basket" }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function enrichCall(call) {
  const person = people.find((item) => item.id === call.personId);
  const asset = assets[call.symbol] || { name: call.symbol, type: "unknown" };
  const entry = Number(call.entryPrice);
  const current = Number(call.currentPrice);
  const canScore = ["seed_verified", "ai_detected"].includes(call.status);
  const returnPct = canScore && Number.isFinite(entry) && Number.isFinite(current) && entry > 0
    ? ((current - entry) / entry) * 100
    : null;

  return {
    ...call,
    person,
    asset,
    returnPct,
    confidence: call.status === "seed_verified" ? 0.92 : 0.72
  };
}

function normalizeQuery(query = "") {
  return query.trim().toLowerCase();
}

function matchesQuery(value, query) {
  return String(value || "").toLowerCase().includes(query);
}

function searchLocal(query) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const personMatches = people
    .filter((person) => [
      person.name,
      person.handle,
      person.category,
      person.country,
      person.bio
    ].some((value) => matchesQuery(value, q)))
    .map((person) => ({ kind: "person", score: person.featured ? 90 : 65, person }));

  const callMatches = seedCalls
    .map(enrichCall)
    .filter((call) => [
      call.symbol,
      call.asset.name,
      call.quote,
      call.person?.name,
      call.person?.handle
    ].some((value) => matchesQuery(value, q)))
    .map((call) => ({ kind: "call", score: call.viralScore || 50, call }));

  return [...personMatches, ...callMatches].sort((a, b) => b.score - a.score);
}

function normalizeModelSymbol(symbol = "") {
  const raw = String(symbol || "").trim().replace(/^\$/, "").toUpperCase();
  const aliases = {
    BITCOIN: "BTC",
    MICROSTRATEGY: "MSTR",
    NVIDIA: "NVDA",
    TESLA: "TSLA",
    HYPERLIQUID: "HYPE",
    ZCASH: "ZEC",
    "SK HYNIX": "000660.KS",
    "SK하이닉스": "000660.KS",
    하이닉스: "000660.KS",
    삼성전자: "005930.KS",
    "LG전자": "066570.KS"
  };
  return aliases[raw] || raw;
}

function extractSymbols(text = "") {
  const cashtags = [...text.matchAll(/\$([A-Z][A-Z0-9.]{1,12})/g)].map((match) => match[1]);
  const known = Object.keys(assets).filter((symbol) => {
    if (symbol.includes(".")) return text.toUpperCase().includes(symbol.toUpperCase());
    return new RegExp(`\\b${symbol}\\b`, "i").test(text);
  });
  const lower = text.toLowerCase();
  const aliases = {
    BTC: ["bitcoin", "btc", "sats", "satoshi"],
    ETH: ["ethereum", "ether", "eth"],
    HYPE: ["hyperliquid", "hype"],
    ZEC: ["zcash", "zec"],
    NEAR: ["near protocol", "near"],
    WLD: ["worldcoin", "wld"],
    NVDA: ["nvidia", "nvda", "blackwell", "rubin"],
    TSLA: ["tesla", "tsla"],
    SPX: ["s&p 500", "spx"],
    "000660.KS": ["sk hynix", "sk하이닉스", "하이닉스", "hynix", "hbm"],
    "005930.KS": ["samsung electronics", "삼성전자", "samsung", "hbm"],
    "066570.KS": ["lg electronics", "lg전자", "엘지전자"]
  };
  const aliasMatches = Object.entries(aliases)
    .filter(([, words]) => words.some((word) => lower.includes(word.toLowerCase())))
    .map(([symbol]) => symbol);
  return [...new Set([...cashtags, ...known, ...aliasMatches].map(normalizeModelSymbol))];
}
function classifyCall(text = "") {
  const bullishTerms = [
    "long",
    "bull",
    "bullish",
    "go up",
    "upside",
    "spring",
    "acquired",
    "buy",
    "own",
    "position",
    "보유",
    "매수",
    "긍정",
    "좋게"
  ];
  const lower = text.toLowerCase();
  return bullishTerms.some((term) => lower.includes(term.toLowerCase()))
    ? "bullish_call"
    : "mention_candidate";
}
function candidateToCalls(candidate) {
  const symbols = candidate.detectedAssets?.length ? candidate.detectedAssets : extractSymbols(candidate.snippet);
  const person = people.find((item) => item.handle?.toLowerCase() === candidate.authorHandle?.toLowerCase())
    || people.find((item) => item.name === candidate.authorHandle);

  return symbols.map((symbol) => {
    const asset = assets[symbol] || { name: symbol, type: "unknown" };
    const seed = seedCalls.find((call) => call.symbol === symbol && call.sourceUrl === candidate.sourceUrl);
    const livePrice = candidate.aiStatus === "ai_detected" ? candidate.prices?.[symbol] : null;

    return enrichCall({
      id: seed?.id || `live_${symbol}_${Math.abs(hashCode(candidate.sourceUrl + symbol))}`,
      personId: person?.id || "live_unknown",
      symbol,
      calledAt: candidate.publishedAt || new Date().toISOString().slice(0, 10),
      callType: classifyCall(candidate.snippet),
      quote: candidate.snippet,
      sourceUrl: candidate.sourceUrl,
      sourcePlatform: candidate.sourcePlatform,
      status: seed ? seed.status : (candidate.aiStatus || "live_candidate"),
      viralScore: candidate.viralScore || 50,
      entryPrice: seed?.entryPrice ?? livePrice?.entryPrice ?? null,
      currentPrice: seed?.currentPrice ?? livePrice?.currentPrice ?? null,
      currency: seed?.currency || livePrice?.currency || priceFallbacks[symbol]?.currency || (asset.type === "crypto" ? "USD" : ""),
      reason: candidate.reasoningKo,
      confidence: candidate.confidence
    });
  });
}

function hashCode(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function fallbackEntryPrice(symbol) {
  const call = seedCalls.find((item) => item.symbol === symbol);
  return call?.entryPrice ?? priceFallbacks[symbol]?.entry ?? null;
}

function fallbackCurrentPrice(symbol) {
  const call = seedCalls.find((item) => item.symbol === symbol);
  return call?.currentPrice ?? priceFallbacks[symbol]?.current ?? null;
}

function yahooSymbolFor(symbol) {
  const asset = assets[symbol];
  const explicit = {
    BTC: "BTC-USD",
    ETH: "ETH-USD",
    HYPE: "HYPE-USD",
    ZEC: "ZEC-USD",
    NEAR: "NEAR-USD",
    APT: "APT-USD",
    WLD: "WLD-USD",
    SPX: "^GSPC"
  };
  return asset?.yahoo || explicit[symbol] || symbol;
}

function chartParams(range = "all") {
  const map = {
    "1m": { range: "1mo", interval: "1d" },
    "6m": { range: "6mo", interval: "1d" },
    "1y": { range: "1y", interval: "1d" },
    all: { range: "max", interval: "1d" }
  };
  return map[range] || map.all;
}

function downsamplePoints(points, maxPoints = 900) {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % stride === 0);
}

function coinGeckoParams(range = "all") {
  const map = {
    "1m": "30",
    "6m": "180",
    "1y": "365",
    all: "max"
  };
  return map[range] || map.all;
}

async function fetchCoinGeckoChart(symbol, range = "all") {
  const asset = assets[symbol];
  if (!asset?.coingecko) throw new Error("CoinGecko id missing");
  const days = coinGeckoParams(range);
  const chartUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.coingecko)}/market_chart?vs_currency=usd&days=${days}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const upstream = await fetch(chartUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {})
      }
    });
    if (!upstream.ok) throw new Error(`CoinGecko chart failed: ${upstream.status}`);
    const payload = await upstream.json();
    const rawPrices = payload.prices || [];
    const stride = range === "all" ? Math.max(1, Math.ceil(rawPrices.length / 420)) : 1;
    const points = downsamplePoints(rawPrices
      .filter((_, index) => index % stride === 0)
      .map(([time, close]) => ({ time, close }))
      .filter((point) => Number.isFinite(Number(point.time)) && Number.isFinite(Number(point.close))), 900);
    const currentPrice = Number(points.at(-1)?.close);
    return {
      symbol,
      yahooSymbol: asset.coingecko,
      range,
      interval: "coingecko",
      currency: "USD",
      currentPrice,
      source: "CoinGecko",
      delayed: true,
      points
    };
  } finally {
    clearTimeout(timer);
  }
}

function rangeStartTime(range = "all") {
  const days = {
    "1m": 30,
    "6m": 180,
    "1y": 365
  }[range];
  return days ? Date.now() - days * 86400000 : 0;
}

async function fetchHyperliquidChart(symbol, range = "all") {
  if (symbol !== "HYPE") throw new Error("Hyperliquid fallback only supports HYPE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const body = JSON.stringify({
    type: "candleSnapshot",
    req: {
      coin: "HYPE",
      interval: "1d",
      startTime: rangeStartTime(range),
      endTime: Date.now()
    }
  });

  try {
    const upstream = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body
    });
    if (!upstream.ok) throw new Error(`Hyperliquid chart failed: ${upstream.status}`);
    const payload = await upstream.json();
    const points = downsamplePoints((Array.isArray(payload) ? payload : [])
      .map((candle) => ({ time: Number(candle.t), close: Number(candle.c) }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.close)), 900);
    if (!points.length) throw new Error("Hyperliquid chart returned no points");
    return {
      symbol,
      yahooSymbol: "HYPE",
      range,
      interval: "1d",
      currency: "USD",
      currentPrice: Number(points.at(-1)?.close),
      source: "Hyperliquid",
      delayed: false,
      points
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooChart(symbol, range = "all") {
  if (assets[symbol]?.type === "crypto") {
    try {
      return await fetchCoinGeckoChart(symbol, range);
    } catch (error) {
      if (symbol === "HYPE") return fetchHyperliquidChart(symbol, range);
      // Fall back to Yahoo symbols when CoinGecko is rate-limited or temporarily unavailable.
    }
  }
  const yahooSymbol = yahooSymbolFor(symbol);
  const params = chartParams(range);
  const period2 = Math.floor(Date.now() / 1000);
  const query = params.range === "max"
    ? `period1=0&period2=${period2}&interval=${params.interval}`
    : `range=${params.range}&interval=${params.interval}`;
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${query}&includePrePost=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const upstream = await fetch(chartUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 ReceiptsTrade/0.1"
      }
    });
    if (!upstream.ok) throw new Error(`Yahoo chart failed: ${upstream.status}`);
    const payload = await upstream.json();
    const result = payload.chart?.result?.[0];
    if (!result) throw new Error("Yahoo chart returned no result");

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = downsamplePoints(timestamps.map((time, index) => ({
      time: time * 1000,
      close: closes[index] == null ? null : Number(closes[index])
    })).filter((point) => point.close != null && Number.isFinite(point.close)), range === "all" ? 1200 : 900);
    const currency = result.meta?.currency || priceFallbacks[symbol]?.currency || "USD";
    const currentPrice = Number(result.meta?.regularMarketPrice ?? points.at(-1)?.close);

    return {
      symbol,
      yahooSymbol,
      range,
      interval: params.interval,
      currency,
      currentPrice,
      source: "Yahoo Finance",
      delayed: true,
      points
    };
  } finally {
    clearTimeout(timer);
  }
}

async function tryDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 ReceiptsHackathonBot/0.1"
      }
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseDuckDuckGo(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDuckDuckGo(html) {
  const blocks = html.split("result__body").slice(1, 8);
  return blocks.map((block) => {
    const href = decodeHtml((block.match(/class="result__a" href="([^"]+)"/)?.[1] || "").replace(/^\/l\/\?uddg=/, ""));
    const decodedHref = href.includes("uddg=")
      ? decodeURIComponent(new URLSearchParams(href.split("?")[1]).get("uddg") || href)
      : decodeURIComponent(href);
    const title = stripTags(block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/)?.[1] || "");
    const snippet = stripTags(block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] || "");
    return { title, url: decodedHref, snippet };
  }).filter((item) => item.url || item.snippet);
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function buildSearchQueries(query) {
  const raw = query.trim();
  const handle = raw.match(/@[\w_]+/)?.[0];
  const asset = raw.match(/\b[A-Z0-9.]{2,12}\b/)?.[0];
  const base = handle ? `site:x.com/${handle.slice(1)}/status` : "site:x.com";
  return [
    `${base} ${raw} "long" OR "bullish" OR "own"`,
    `${base} ${raw} "viral" OR "likes"`,
    asset ? `${base} "$${asset}"` : `${base} ${raw}`
  ];
}

function xBearerToken() {
  return process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
}

function xUsernameFromQuery(query) {
  const handle = query.match(/@[\w_]+/)?.[0]?.slice(1);
  if (handle) return handle;
  const lower = query.toLowerCase();
  const person = people.find((item) =>
    item.name.toLowerCase().includes(lower) ||
    lower.includes(item.name.toLowerCase()) ||
    item.handle?.toLowerCase().replace("@", "") === lower.replace("@", "")
  );
  return person?.handle?.replace("@", "") || "";
}

async function fetchXJson(url) {
  const token = xBearerToken();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`X API failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function tweetToCandidate(tweet, username) {
  const metrics = tweet.public_metrics || {};
  return {
    sourcePlatform: "X",
    sourceUrl: `https://x.com/${username}/status/${tweet.id}`,
    authorHandle: `@${username}`,
    publishedAt: tweet.created_at?.slice(0, 10) || null,
    snippet: tweet.text || "",
    detectedAssets: extractSymbols(tweet.text || ""),
    viralScore: 50 + Math.min(50, Math.round(((metrics.like_count || 0) + (metrics.retweet_count || 0) * 2) / 100))
  };
}

function xSearchLimit(mode = "standard") {
  return mode === "deep" ? 100 : mode === "fast" ? 25 : 50;
}

function investmentKeywordsFor(username = "", rawQuery = "") {
  const lower = `${username} ${rawQuery}`.toLowerCase();
  const common = [
    "buy", "bought", "long", "own", "owns", "position", "bullish", "upside",
    "accumulate", "treasury", "acquired", "holding", "portfolio", "target",
    "매수", "보유", "긍정", "좋게", "상승", "업사이드", "포트폴리오"
  ];
  const map = [
    { test: ["saylor", "michael saylor"], words: ["bitcoin", "btc", "mstr", "microstrategy", "treasury", "acquired", "sats"] },
    { test: ["jukan05", "jukan"], words: ["hynix", "samsung", "nvidia", "nvda", "hbm", "memory", "semiconductor", "tsmc", "foundry", "ai"] },
    { test: ["cryptohayes", "arthur hayes"], words: ["hype", "hyperliquid", "zec", "zcash", "near", "eth", "bitcoin", "crypto"] },
    { test: ["fundstrat", "tom lee"], words: ["spx", "s&p", "bitcoin", "btc", "stocks", "equities", "target"] },
    { test: ["citrini"], words: ["nvda", "ai", "semis", "nuclear", "power", "infrastructure", "trade"] },
    { test: ["aleabitoreddit"], words: ["rpi", "raspberry", "semiconductor", "long", "position"] }
  ];
  const matched = map.find((item) => item.test.some((needle) => lower.includes(needle)));
  return [...new Set([...(matched?.words || []), ...common])].slice(0, 28);
}

async function fetchXUserProfile(query) {
  const username = xUsernameFromQuery(query);
  if (!username || !xBearerToken()) return null;
  const userUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=username,name`;
  const userPayload = await fetchXJson(userUrl).catch(() => null);
  const userId = userPayload?.data?.id;
  if (!userId) return null;
  return { username: userPayload.data.username || username, name: userPayload.data.name, userId };
}

async function fetchXUserCandidates(query, mode = "standard") {
  const profile = await fetchXUserProfile(query);
  if (!profile) return [];
  const params = new URLSearchParams({
    max_results: String(xSearchLimit(mode)),
    exclude: "retweets",
    "tweet.fields": "created_at,public_metrics,entities,lang"
  });
  const tweetsUrl = `https://api.x.com/2/users/${encodeURIComponent(profile.userId)}/tweets?${params.toString()}`;
  const payload = await fetchXJson(tweetsUrl).catch(() => null);
  return (payload?.data || [])
    .map((tweet) => tweetToCandidate(tweet, profile.username))
    .filter((candidate) => candidate.detectedAssets.length);
}

async function fetchXKeywordCandidates(query, mode = "standard") {
  const profile = await fetchXUserProfile(query);
  if (!profile) return [];
  const keywords = investmentKeywordsFor(profile.username, query);
  const keywordQuery = keywords.map((word) => word.includes(" ") ? `"${word}"` : word).join(" OR ");
  const searchQuery = `from:${profile.username} (${keywordQuery}) -is:retweet`;
  const params = new URLSearchParams({
    query: searchQuery,
    max_results: String(xSearchLimit(mode)),
    "tweet.fields": "created_at,public_metrics,entities,lang"
  });
  const url = `https://api.x.com/2/tweets/search/recent?${params.toString()}`;
  const payload = await fetchXJson(url).catch(() => null);
  return (payload?.data || []).map((tweet) => tweetToCandidate(tweet, profile.username));
}

function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
}

function anthropicModel() {
  return process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
}

function parseJsonArray(text = "") {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function classifyCandidatesWithClaude(candidates) {
  if (!anthropicKey() || !candidates.length) return candidates;
  const selected = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.detectedAssets?.length && candidate.snippet?.replace(/https?:\/\/\S+/g, "").trim().length > 20)
    .slice(0, 12);
  if (!selected.length) return candidates;
  const input = selected.map(({ candidate, index }) => ({
    index,
    sourceUrl: candidate.sourceUrl,
    authorHandle: candidate.authorHandle,
    publishedAt: candidate.publishedAt,
    text: candidate.snippet,
    detectedAssets: candidate.detectedAssets
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey(),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: anthropicModel(),
        max_tokens: 3000,
        temperature: 0,
        messages: [{
          role: "user",
          content: `다음 X 포스트들이 특정 자산에 대한 공개 긍정 투자 의견인지 판별해줘. 단순 뉴스 공유, 농담, 링크만 있는 글, 매수/보유/상승 관점이 불명확한 글은 false로 둬. 반드시 JSON 배열만 반환해. 각 원소 형식: {"index":0,"isInvestmentOpinion":true,"sentiment":"positive","symbols":["BTC"],"reasoningKo":"왜 긍정 의견인지 한 문장","quote":"원문 핵심 문장 짧게","confidence":0.0}. symbols는 티커만 쓰고 한국 주식은 000660.KS 같은 야후 코드로 써.\n\n${JSON.stringify(input)}`
        }]
      })
    });
    if (!response.ok) return candidates;
    const payload = await response.json();
    const text = payload.content?.map((item) => item.text || "").join("\n") || "";
    const decisions = parseJsonArray(text);
    const byIndex = new Map(decisions.map((item) => [Number(item.index), item]));
    const byUrl = new Map(decisions.filter((item) => item.sourceUrl).map((item) => [item.sourceUrl, item]));
    return candidates.map((candidate, index) => {
      const decision = byIndex.get(index) || byUrl.get(candidate.sourceUrl);
      if (!decision?.isInvestmentOpinion || decision.sentiment !== "positive") return candidate;
      const symbols = (decision.symbols || []).map(normalizeModelSymbol).filter(Boolean);
      return {
        ...candidate,
        aiStatus: "ai_detected",
        detectedAssets: [...new Set((symbols.length ? symbols : candidate.detectedAssets).map(normalizeModelSymbol))],
        reasoningKo: decision.reasoningKo,
        quote: decision.quote || candidate.snippet,
        confidence: Number(decision.confidence) || 0.78
      };
    });
  } catch {
    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

const priceChartCache = new Map();

function nearestClose(points, date) {
  const target = new Date(date).getTime();
  if (!Number.isFinite(target) || !points?.length) return null;
  let best = null;
  for (const point of points) {
    const distance = Math.abs(point.time - target);
    if (!best || distance < best.distance) best = { point, distance };
  }
  return best && best.distance <= 21 * 86400000 ? best.point.close : null;
}

async function attachPricesToCandidates(candidates) {
  const scored = candidates.filter((candidate) => candidate.aiStatus === "ai_detected");
  const symbols = [...new Set(scored.flatMap((candidate) => candidate.detectedAssets || []))].slice(0, 8);
  await Promise.all(symbols.map(async (symbol) => {
    if (!priceChartCache.has(symbol)) {
      priceChartCache.set(symbol, fetchYahooChart(symbol, "all").catch(() => null));
    }
    await priceChartCache.get(symbol);
  }));
  return candidates.map((candidate) => {
    if (candidate.aiStatus !== "ai_detected") return candidate;
    const prices = {};
    for (const symbol of candidate.detectedAssets || []) {
      const chartPromise = priceChartCache.get(symbol);
      if (!chartPromise) continue;
      prices[symbol] = chartPromise;
    }
    return candidate;
  });
}

async function resolveCandidatePrices(candidates) {
  await attachPricesToCandidates(candidates);
  const withPrices = [];
  for (const candidate of candidates) {
    if (candidate.aiStatus !== "ai_detected") {
      withPrices.push(candidate);
      continue;
    }
    const prices = {};
    for (const symbol of candidate.detectedAssets || []) {
      const chart = await priceChartCache.get(symbol);
      const entryPrice = nearestClose(chart?.points, candidate.publishedAt);
      const currentPrice = Number(chart?.currentPrice);
      if (Number.isFinite(entryPrice) && Number.isFinite(currentPrice)) {
        prices[symbol] = { entryPrice, currentPrice, currency: chart.currency };
      }
    }
    withPrices.push({
      ...candidate,
      prices
    });
  }
  return withPrices;
}

async function liveSearch(query, options = {}) {
  const mode = options.mode || "standard";
  const q = normalizeQuery(query);
  const localCandidates = viralPostFallback.filter((candidate) => {
    const haystack = [
      candidate.authorHandle,
      candidate.snippet,
      candidate.detectedAssets?.join(" "),
      candidate.sourceUrl
    ].join(" ").toLowerCase();
    return !q || q.split(/\s+/).some((part) => haystack.includes(part.replace("@", "")));
  });

  const webQueries = buildSearchQueries(query);
  const [timelineCandidates, keywordCandidates, webResults] = await Promise.all([
    fetchXUserCandidates(query, mode),
    fetchXKeywordCandidates(query, mode),
    Promise.all(webQueries.map(tryDuckDuckGo)).then((items) => items.flat())
  ]);
  const webCandidates = webResults
    .filter((result) => result.url.includes("x.com") || result.url.includes("twitter.com"))
    .map((result) => {
      const handle = result.url.match(/(?:x|twitter)\.com\/([^/]+)\/status/)?.[1];
      const text = result.snippet || result.title;
      return {
        sourcePlatform: "X",
        sourceUrl: result.url,
        authorHandle: handle ? `@${handle}` : "",
        publishedAt: null,
        snippet: text,
        detectedAssets: extractSymbols(text),
        viralScore: 58
      };
    });

  const merged = [...timelineCandidates, ...keywordCandidates, ...localCandidates, ...webCandidates];
  const deduped = [...new Map(merged.map((item) => [item.sourceUrl, item])).values()]
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))
    .slice(0, mode === "deep" ? 24 : 16);

  const classified = await classifyCandidatesWithClaude(deduped);
  const priced = await resolveCandidatePrices(classified);
  const calls = priced.flatMap(candidateToCalls).filter((call) => call.status !== "live_candidate");
  return {
    mode,
    candidates: priced,
    calls,
    meta: {
      timelineCount: timelineCandidates.length,
      keywordCount: keywordCandidates.length,
      webCount: webCandidates.length,
      aiDetectedCount: priced.filter((item) => item.aiStatus === "ai_detected").length
    }
  };
}

async function fetchJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requestedPath));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/bootstrap") {
      const storedCalls = await getStoredCalls();
      const dedupedCalls = [...new Map([...seedCalls, ...storedCalls].map((call) => [call.id, call])).values()];
      const calls = dedupedCalls.map(enrichCall).sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0));
      await sendJson(response, { people, assets, calls });
      return;
    }

    if (url.pathname === "/api/search") {
      await sendJson(response, { results: searchLocal(url.searchParams.get("q") || "") });
      return;
    }

    if (url.pathname === "/api/chart") {
      const symbol = url.searchParams.get("symbol");
      const range = url.searchParams.get("range") || "all";
      if (!symbol) {
        await sendJson(response, { error: "symbol is required" }, 400);
        return;
      }
      try {
        await sendJson(response, await fetchYahooChart(symbol, range));
      } catch (error) {
        await sendJson(response, {
          error: error.message,
          symbol,
          range,
          source: "Yahoo Finance"
        }, 502);
      }
      return;
    }

    if (url.pathname === "/api/live-search" && request.method === "POST") {
      const body = await fetchJsonBody(request);
      const result = await liveSearch(body.query || "", { mode: body.mode || "standard" });
      const dbResult = await saveLiveSearchResult({
        query: body.query || "",
        candidates: result.candidates,
        calls: result.calls
      });
      await sendJson(response, {
        query: body.query || "",
        status: "completed",
        usedFallback: result.candidates.some((item) => viralPostFallback.includes(item)),
        db: dbResult,
        ...result
      });
      return;
    }

    if (url.pathname === "/api/performance" && request.method === "POST") {
      const body = await fetchJsonBody(request);
      const symbol = body.symbol;
      const entryPrice = Number(body.entryPrice ?? fallbackEntryPrice(symbol));
      const currentPrice = Number(body.currentPrice ?? fallbackCurrentPrice(symbol));
      const returnPct = Number.isFinite(entryPrice) && Number.isFinite(currentPrice) && entryPrice > 0
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : null;
      await sendJson(response, {
        symbol,
        entryPrice,
        currentPrice,
        returnPct,
        priceSource: "seed_or_live_fallback",
        fallbackUsed: true
      });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    await sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`Receipts running at http://localhost:${port}`);
});


