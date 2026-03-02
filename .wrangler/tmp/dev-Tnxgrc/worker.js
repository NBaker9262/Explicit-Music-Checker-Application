var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// cloudflare/worker.js
function parseAllowedOrigins(rawAllowedOrigin) {
  const value = String(rawAllowedOrigin || "*").trim();
  if (!value) return ["*"];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
__name(parseAllowedOrigins, "parseAllowedOrigins");
function buildCorsHeaders(request, rawAllowedOrigin) {
  const allowedOrigins = parseAllowedOrigins(rawAllowedOrigin);
  const requestOrigin = request.headers.get("Origin") || "";
  let origin = "*";
  if (!allowedOrigins.includes("*")) {
    origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
  };
}
__name(buildCorsHeaders, "buildCorsHeaders");
function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}
__name(withCors, "withCors");
function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    }
  });
}
__name(json, "json");
var ALLOWED_STATUSES = ["pending", "approved", "rejected"];
var ALLOWED_ROLES = ["guest", "student", "staff", "organizer", "admin"];
var ALLOWED_CONFIDENCE = ["clean", "explicit", "unknown"];
var ALLOWED_DANCE_MOMENTS = ["anytime", "grand_entrance", "warmup", "peak_hour", "slow_dance", "last_dance"];
var ALLOWED_VIBE_TAGS = ["throwback", "hiphop", "pop", "latin", "afrobeats", "country", "rnb", "edm", "line_dance", "singalong"];
var MODERATION_PRESETS = [
  "clean_version_verified",
  "duplicate_request_merged",
  "explicit_lyrics",
  "violence",
  "hate_speech",
  "sexual_content",
  "policy_violation",
  "other"
];
var ROLE_WEIGHTS = { guest: 4, student: 8, staff: 14, organizer: 22, admin: 30 };
var MOMENT_WEIGHTS = { anytime: 3, grand_entrance: 14, warmup: 6, peak_hour: 18, slow_dance: 8, last_dance: 20 };
var MODERATION_TERMS = ["explicit", "uncensored", "dirty", "parental advisory", "violence", "gun", "drug", "sex"];
var LYRICS_OVH_BASE_URL = "https://api.lyrics.ovh/v1";
var LRCLIB_BASE_URL = "https://lrclib.net/api/get";
var OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";
var SOUND_CLOUD_TRACKS_BASE_URL = "https://api.soundcloud.com/tracks";
var SOUND_CLOUD_SEARCH_V2_URL = "https://api-v2.soundcloud.com/search/tracks";
var SOUND_CLOUD_OAUTH_TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
var SOUND_CLOUD_OAUTH_TOKEN_FALLBACK_URL = "https://api.soundcloud.com/oauth2/token";
var SOUND_CLOUD_PUBLIC_SEARCH_PAGE_URL = "https://soundcloud.com/search/sounds";
var LYRICS_MODERATION_HINT_TERMS = {
  suggestive: ["sex", "sexy", "kiss", "touch", "bed", "naked", "body", "freak", "hook up", "make love", "twerk"],
  alcohol: ["alcohol", "drink", "drunk", "whiskey", "vodka", "tequila", "beer", "wine", "shots", "bar", "bottle", "liquor"],
  drugs: ["drug", "drugs", "weed", "marijuana", "cocaine", "crack", "meth", "heroin", "xanax", "molly", "ecstasy", "lean", "pills"],
  violence: ["gun", "guns", "shoot", "murder", "kill", "blood", "knife", "fight", "dead", "die"]
};
var LOCAL_PROFANITY_TERMS = ["fuck", "fucking", "shit", "bitch", "motherfucker", "asshole", "dick", "pussy", "nigga", "nigger", "cunt"];
var DEFAULT_SAFE_TRACK_EXCEPTIONS = ["titanium"];
var NIGHTLY_BENCHMARK_SONG_POOL = [
  { name: "Titanium", artist: "David Guetta", explicit: false },
  { name: "Happy", artist: "Pharrell Williams", explicit: false },
  { name: "Uptown Funk", artist: "Mark Ronson", explicit: false },
  { name: "Firework", artist: "Katy Perry", explicit: false },
  { name: "Shut Up and Dance", artist: "Walk the Moon", explicit: false },
  { name: "Best Day of My Life", artist: "American Authors", explicit: false },
  { name: "Can't Stop the Feeling", artist: "Justin Timberlake", explicit: false },
  { name: "Treasure", artist: "Bruno Mars", explicit: false },
  { name: "Levitating", artist: "Dua Lipa", explicit: false },
  { name: "Peaches", artist: "Justin Bieber", explicit: false },
  { name: "Wild Thoughts", artist: "DJ Khaled", explicit: false },
  { name: "Talk Dirty", artist: "Jason Derulo", explicit: false },
  { name: "S&M", artist: "Rihanna", explicit: false },
  { name: "Gold Digger", artist: "Kanye West", explicit: false },
  { name: "Blurred Lines", artist: "Robin Thicke", explicit: false },
  { name: "Cake By The Ocean", artist: "DNCE", explicit: false },
  { name: "WAP", artist: "Cardi B", explicit: true },
  { name: "Anaconda", artist: "Nicki Minaj", explicit: true },
  { name: "Mask Off", artist: "Future", explicit: true },
  { name: "No Role Modelz", artist: "J. Cole", explicit: true },
  { name: "Get Low", artist: "Lil Jon", explicit: true },
  { name: "Back That Azz Up", artist: "Juvenile", explicit: true },
  { name: "Pound Town", artist: "Sexyy Red", explicit: true },
  { name: "Super Gremlin", artist: "Kodak Black", explicit: true }
];
var REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1e3;
var rateLimitSchemaReady = false;
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
__name(clampNumber, "clampNumber");
function sanitizeText(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
__name(sanitizeText, "sanitizeText");
function getClientIp(request) {
  const cfIp = sanitizeText(request.headers.get("CF-Connecting-IP") || "", 80);
  if (cfIp) return cfIp;
  const forwardedFor = sanitizeText(request.headers.get("X-Forwarded-For") || "", 200);
  if (!forwardedFor) return "unknown";
  const first = forwardedFor.split(",")[0] || "";
  const parsed = sanitizeText(first, 80);
  return parsed || "unknown";
}
__name(getClientIp, "getClientIp");
function parseIsoDateMs(value) {
  const raw = sanitizeText(value, 50);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
__name(parseIsoDateMs, "parseIsoDateMs");
async function ensureRateLimitTable(env) {
  if (rateLimitSchemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS request_rate_limits (
      ip_address TEXT PRIMARY KEY,
      last_request_at TEXT NOT NULL
    )`
  ).run();
  rateLimitSchemaReady = true;
}
__name(ensureRateLimitTable, "ensureRateLimitTable");
async function checkAndConsumeRateLimit(env, ipAddress) {
  const key = sanitizeText(ipAddress || "unknown", 80) || "unknown";
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  await ensureRateLimitTable(env);
  const existing = await env.DB.prepare(
    "SELECT last_request_at FROM request_rate_limits WHERE ip_address = ?"
  ).bind(key).first();
  const lastMs = parseIsoDateMs(existing?.last_request_at);
  if (lastMs !== null) {
    const elapsed = nowMs - lastMs;
    if (elapsed < REQUEST_LIMIT_WINDOW_MS) {
      const waitMs = REQUEST_LIMIT_WINDOW_MS - elapsed;
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1e3));
      const nextAllowedAt = new Date(lastMs + REQUEST_LIMIT_WINDOW_MS).toISOString();
      return { allowed: false, retryAfterSec, nextAllowedAt };
    }
  }
  await env.DB.prepare(
    `INSERT INTO request_rate_limits (ip_address, last_request_at)
     VALUES (?, ?)
     ON CONFLICT(ip_address) DO UPDATE SET last_request_at = excluded.last_request_at`
  ).bind(key, nowIso).run();
  return {
    allowed: true,
    retryAfterSec: Math.ceil(REQUEST_LIMIT_WINDOW_MS / 1e3),
    nextAllowedAt: new Date(nowMs + REQUEST_LIMIT_WINDOW_MS).toISOString()
  };
}
__name(checkAndConsumeRateLimit, "checkAndConsumeRateLimit");
function normalizeRole(role) {
  const normalized = sanitizeText(role, 20).toLowerCase();
  return ALLOWED_ROLES.includes(normalized) ? normalized : "guest";
}
__name(normalizeRole, "normalizeRole");
function normalizeStatus(status) {
  const normalized = sanitizeText(status, 20).toLowerCase();
  return ALLOWED_STATUSES.includes(normalized) ? normalized : null;
}
__name(normalizeStatus, "normalizeStatus");
function normalizeModerationReason(reason) {
  const normalized = sanitizeText(reason, 64).toLowerCase();
  if (!normalized) return "";
  return MODERATION_PRESETS.includes(normalized) ? normalized : null;
}
__name(normalizeModerationReason, "normalizeModerationReason");
function normalizeIsoDate(dateValue) {
  const raw = sanitizeText(dateValue, 20);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = /* @__PURE__ */ new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return raw;
}
__name(normalizeIsoDate, "normalizeIsoDate");
function deriveContentConfidence(explicitFlag) {
  if (explicitFlag === "explicit") return "explicit";
  if (explicitFlag === "clean") return "clean";
  if (explicitFlag === "unknown") return "unknown";
  if (explicitFlag === true || explicitFlag === 1) return "explicit";
  if (explicitFlag === false || explicitFlag === 0) return "clean";
  return "unknown";
}
__name(deriveContentConfidence, "deriveContentConfidence");
function calculateModerationScore({ trackName, artists, contentConfidence }) {
  const confidence = deriveContentConfidence(contentConfidence);
  let score = confidence === "clean" ? 92 : confidence === "explicit" ? 8 : 62;
  const haystack = `${sanitizeText(trackName, 200)} ${(artists || []).join(" ")}`.toLowerCase();
  MODERATION_TERMS.forEach((term) => {
    if (haystack.includes(term)) score -= 12;
  });
  return clampNumber(score, 0, 100);
}
__name(calculateModerationScore, "calculateModerationScore");
function splitTextByLength(text, maxChunkLength = 240) {
  const safeText = sanitizeText(text, 3e4);
  if (!safeText) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < safeText.length && chunks.length < 8) {
    chunks.push(safeText.slice(cursor, cursor + maxChunkLength));
    cursor += maxChunkLength;
  }
  return chunks;
}
__name(splitTextByLength, "splitTextByLength");
function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegex, "escapeRegex");
function countKeywordHits(text, keywords) {
  const haystack = sanitizeText(text, 3e4).toLowerCase();
  if (!haystack) return 0;
  let count = 0;
  (keywords || []).forEach((keyword) => {
    const token = sanitizeText(keyword, 60).toLowerCase();
    if (!token) return;
    if (token.includes(" ")) {
      const occurrences = haystack.split(token).length - 1;
      count += Math.max(0, occurrences);
      return;
    }
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, "gi");
    const matches = haystack.match(regex);
    count += matches ? matches.length : 0;
  });
  return count;
}
__name(countKeywordHits, "countKeywordHits");
function normalizeArtistForLyrics(artist) {
  return sanitizeText(String(artist || "").split(",")[0].split("&")[0].split(" feat")[0], 120);
}
__name(normalizeArtistForLyrics, "normalizeArtistForLyrics");
function normalizeTitleForLyrics(title) {
  const safeTitle = sanitizeText(title, 200);
  return sanitizeText(
    safeTitle.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").replace(/-+\s*(remaster|radio edit|clean|explicit).*/i, "").trim(),
    200
  );
}
__name(normalizeTitleForLyrics, "normalizeTitleForLyrics");
function normalizeTrackExceptionKey(value) {
  const normalized = sanitizeText(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " "), 200);
  return normalized.replace(/\s+/g, " ").trim();
}
__name(normalizeTrackExceptionKey, "normalizeTrackExceptionKey");
function getSafeTrackExceptionSet(env) {
  const raw = sanitizeText(env?.SAFE_TRACK_EXCEPTIONS || "", 2e3);
  const entries = raw ? raw.split(",").map((entry) => normalizeTrackExceptionKey(entry)).filter(Boolean) : [];
  DEFAULT_SAFE_TRACK_EXCEPTIONS.forEach((entry) => {
    const key = normalizeTrackExceptionKey(entry);
    if (key && !entries.includes(key)) entries.push(key);
  });
  return new Set(entries);
}
__name(getSafeTrackExceptionSet, "getSafeTrackExceptionSet");
function isSafeTrackException(trackName, env) {
  const key = normalizeTrackExceptionKey(trackName);
  if (!key) return false;
  const exceptions = getSafeTrackExceptionSet(env);
  return exceptions.has(key);
}
__name(isSafeTrackException, "isSafeTrackException");
async function fetchJsonWithTimeout(url, timeoutMs = 4e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}
__name(fetchJsonWithTimeout, "fetchJsonWithTimeout");
async function postJsonWithTimeout(url, payload, headers = {}, timeoutMs = 4e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}
__name(postJsonWithTimeout, "postJsonWithTimeout");
async function fetchLyricsFromLyricsOvh(artistName, trackName) {
  const artist = normalizeArtistForLyrics(artistName);
  const title = normalizeTitleForLyrics(trackName);
  if (!artist || !title) return "";
  const url = `${LYRICS_OVH_BASE_URL}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const result = await fetchJsonWithTimeout(url, 3500);
  if (!result.ok) return "";
  const lyrics = sanitizeText(result.data?.lyrics || "", 3e4);
  return lyrics;
}
__name(fetchLyricsFromLyricsOvh, "fetchLyricsFromLyricsOvh");
async function fetchLyricsFromLrcLib(artistName, trackName) {
  const artist = normalizeArtistForLyrics(artistName);
  const title = normalizeTitleForLyrics(trackName);
  if (!artist || !title) return "";
  const params = new URLSearchParams();
  params.set("artist_name", artist);
  params.set("track_name", title);
  const url = `${LRCLIB_BASE_URL}?${params.toString()}`;
  const result = await fetchJsonWithTimeout(url, 3500);
  if (!result.ok) return "";
  const lyrics = sanitizeText(result.data?.plainLyrics || result.data?.syncedLyrics || "", 3e4);
  return lyrics;
}
__name(fetchLyricsFromLrcLib, "fetchLyricsFromLrcLib");
async function fetchLyricsForModeration(trackName, artists) {
  const artistCandidates = [];
  (artists || []).forEach((artist) => {
    const normalized = normalizeArtistForLyrics(artist);
    if (!normalized || artistCandidates.includes(normalized)) return;
    artistCandidates.push(normalized);
  });
  if (!artistCandidates.length) return { lyrics: "", provider: "" };
  const primaryArtist = artistCandidates[0];
  const titleCandidates = [];
  const rawTitle = sanitizeText(trackName, 200);
  const normalizedTitle = normalizeTitleForLyrics(rawTitle);
  if (rawTitle) titleCandidates.push(rawTitle);
  if (normalizedTitle && normalizedTitle !== rawTitle) titleCandidates.push(normalizedTitle);
  for (const title of titleCandidates.slice(0, 2)) {
    const lyricsFromOvh = await fetchLyricsFromLyricsOvh(primaryArtist, title);
    if (lyricsFromOvh) return { lyrics: lyricsFromOvh, provider: "lyrics.ovh" };
    const lyricsFromLrcLib = await fetchLyricsFromLrcLib(primaryArtist, title);
    if (lyricsFromLrcLib) return { lyrics: lyricsFromLrcLib, provider: "lrclib" };
  }
  return { lyrics: "", provider: "" };
}
__name(fetchLyricsForModeration, "fetchLyricsForModeration");
function normalizeOpenAiCategoryMap(rawCategories) {
  const map = {};
  if (!rawCategories || typeof rawCategories !== "object") return map;
  Object.entries(rawCategories).forEach(([key, value]) => {
    if (value === true) map[sanitizeText(key, 64)] = true;
  });
  return map;
}
__name(normalizeOpenAiCategoryMap, "normalizeOpenAiCategoryMap");
function hasOpenAiCategory(categoryMap, categoryPrefix) {
  const safePrefix = sanitizeText(categoryPrefix, 64).toLowerCase();
  if (!safePrefix) return false;
  return Object.keys(categoryMap || {}).some((key) => {
    const normalized = sanitizeText(key, 64).toLowerCase();
    return normalized === safePrefix || normalized.startsWith(`${safePrefix}/`);
  });
}
__name(hasOpenAiCategory, "hasOpenAiCategory");
function listOpenAiCategories(categoryMap) {
  return Object.keys(categoryMap || {}).map((key) => sanitizeText(key, 64)).filter(Boolean).sort();
}
__name(listOpenAiCategories, "listOpenAiCategories");
async function checkContentWithOpenAiModeration(lyricsText, env) {
  const apiKey = sanitizeText(env?.OPENAI_API_KEY || "", 300);
  if (!apiKey) {
    return { available: false, flagged: false, categories: {}, failed: false };
  }
  const chunks = splitTextByLength(lyricsText, 1200).slice(0, 2);
  if (!chunks.length) {
    return { available: true, flagged: false, categories: {}, failed: false };
  }
  let anyFlagged = false;
  let anySuccess = false;
  const mergedCategories = {};
  for (const chunk of chunks) {
    const result = await postJsonWithTimeout(
      OPENAI_MODERATIONS_URL,
      { model: "omni-moderation-latest", input: chunk },
      { Authorization: `Bearer ${apiKey}` },
      3200
    );
    if (!result.ok) continue;
    const moderation = result.data?.results?.[0];
    if (!moderation || typeof moderation !== "object") continue;
    anySuccess = true;
    if (moderation.flagged === true) anyFlagged = true;
    const chunkCategories = normalizeOpenAiCategoryMap(moderation.categories);
    Object.keys(chunkCategories).forEach((key) => {
      mergedCategories[key] = true;
    });
  }
  return {
    available: true,
    flagged: anyFlagged,
    categories: mergedCategories,
    failed: !anySuccess
  };
}
__name(checkContentWithOpenAiModeration, "checkContentWithOpenAiModeration");
function countLocalProfanityHits(lyricsText) {
  return LOCAL_PROFANITY_TERMS.reduce((total, term) => total + countKeywordHits(lyricsText, [term]), 0);
}
__name(countLocalProfanityHits, "countLocalProfanityHits");
async function analyzeLyricsModeration(trackName, artists, env) {
  const lyricsResult = await fetchLyricsForModeration(trackName, artists);
  const lyrics = lyricsResult.lyrics;
  if (!lyrics) {
    return {
      foundLyrics: false,
      provider: "",
      profanityDetected: false,
      profanityHits: 0,
      openAiAvailable: Boolean(sanitizeText(env?.OPENAI_API_KEY || "", 300)),
      openAiFailed: false,
      openAiFlagged: false,
      openAiCategories: [],
      suggestiveHits: 0,
      alcoholHits: 0,
      drugHits: 0,
      violenceHits: 0,
      riskScore: 0,
      riskLevel: "unknown"
    };
  }
  const suggestiveHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.suggestive);
  const alcoholHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.alcohol);
  const drugHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.drugs);
  const violenceHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.violence);
  const profanityHits = countLocalProfanityHits(lyrics);
  const localProfanityDetected = profanityHits > 0;
  const openAiResult = await checkContentWithOpenAiModeration(lyrics, env);
  const openAiCategories = listOpenAiCategories(openAiResult.categories);
  const openAiSexual = hasOpenAiCategory(openAiResult.categories, "sexual");
  const openAiViolence = hasOpenAiCategory(openAiResult.categories, "violence");
  const openAiHate = hasOpenAiCategory(openAiResult.categories, "hate");
  const openAiIllicit = hasOpenAiCategory(openAiResult.categories, "illicit");
  const openAiHarassment = hasOpenAiCategory(openAiResult.categories, "harassment");
  const profanityDetected = localProfanityDetected;
  const profanityScore = Math.min(40, profanityHits * 10);
  const openAiScore = clampNumber(
    (openAiResult.flagged ? 18 : 0) + (openAiSexual ? 16 : 0) + (openAiViolence ? 18 : 0) + (openAiHate ? 22 : 0) + (openAiIllicit ? 14 : 0) + (openAiHarassment ? 10 : 0),
    0,
    65
  );
  const themeScore = Math.min(40, suggestiveHits * 3 + alcoholHits * 2 + drugHits * 6 + violenceHits * 5);
  const riskScore = clampNumber(profanityScore + themeScore + openAiScore, 0, 100);
  const riskLevel = riskScore >= 76 ? "high" : riskScore >= 34 ? "medium" : "low";
  return {
    foundLyrics: true,
    provider: lyricsResult.provider,
    profanityDetected,
    profanityHits,
    openAiAvailable: openAiResult.available,
    openAiFailed: openAiResult.failed,
    openAiFlagged: openAiResult.flagged,
    openAiCategories,
    suggestiveHits,
    alcoholHits,
    drugHits,
    violenceHits,
    riskScore,
    riskLevel
  };
}
__name(analyzeLyricsModeration, "analyzeLyricsModeration");
function chooseModerationReasonFromLyrics(lyricsAnalysis) {
  if (!lyricsAnalysis?.foundLyrics) return "";
  const openAiCategories = lyricsAnalysis.openAiCategories || [];
  if (openAiCategories.some((entry) => String(entry).startsWith("hate"))) return "hate_speech";
  if (openAiCategories.some((entry) => String(entry).startsWith("violence"))) return "violence";
  if (openAiCategories.some((entry) => String(entry).startsWith("sexual"))) return "sexual_content";
  if (openAiCategories.some((entry) => String(entry).startsWith("illicit"))) return "policy_violation";
  if ((lyricsAnalysis.profanityHits || 0) >= 2) return "explicit_lyrics";
  if (lyricsAnalysis.profanityDetected) return "other";
  if (lyricsAnalysis.drugHits > 0 || lyricsAnalysis.alcoholHits > 0) return "policy_violation";
  if (lyricsAnalysis.violenceHits > 0) return "violence";
  if (lyricsAnalysis.suggestiveHits > 0) return "sexual_content";
  return "";
}
__name(chooseModerationReasonFromLyrics, "chooseModerationReasonFromLyrics");
function buildLyricsReviewNote(baseScore, combinedScore, lyricsAnalysis, fallbackMessage) {
  if (!lyricsAnalysis?.foundLyrics) return fallbackMessage;
  const parts = [];
  parts.push(`Lyrics provider: ${lyricsAnalysis.provider || "unknown"}`);
  parts.push(`risk=${lyricsAnalysis.riskLevel}/${lyricsAnalysis.riskScore}`);
  if (lyricsAnalysis.openAiAvailable) {
    parts.push(lyricsAnalysis.openAiFailed ? "openai=failed" : "openai=ok");
  } else {
    parts.push("openai=disabled");
  }
  if ((lyricsAnalysis.openAiCategories || []).length) {
    parts.push(`openai_categories:${lyricsAnalysis.openAiCategories.join(",")}`);
  }
  if (lyricsAnalysis.openAiFlagged) parts.push("openai_flagged");
  if (lyricsAnalysis.profanityDetected) parts.push(`profanity:${lyricsAnalysis.profanityHits || 1}`);
  if (lyricsAnalysis.suggestiveHits > 0) parts.push(`suggestive:${lyricsAnalysis.suggestiveHits}`);
  if (lyricsAnalysis.alcoholHits > 0) parts.push(`alcohol:${lyricsAnalysis.alcoholHits}`);
  if (lyricsAnalysis.drugHits > 0) parts.push(`drugs:${lyricsAnalysis.drugHits}`);
  if (lyricsAnalysis.violenceHits > 0) parts.push(`violence:${lyricsAnalysis.violenceHits}`);
  parts.push(`score ${baseScore} -> ${combinedScore}`);
  return parts.join(" | ");
}
__name(buildLyricsReviewNote, "buildLyricsReviewNote");
async function getAutoModerationDecision({ trackName, artists, contentConfidence, env }) {
  const confidence = deriveContentConfidence(contentConfidence);
  const baseModerationScore = calculateModerationScore({ trackName, artists, contentConfidence: confidence });
  const lyricsAnalysis = env?.DISABLE_LYRICS_MODERATION === "1" ? {
    foundLyrics: false,
    provider: "",
    profanityDetected: false,
    profanityHits: 0,
    openAiAvailable: false,
    openAiFailed: false,
    openAiFlagged: false,
    openAiCategories: [],
    suggestiveHits: 0,
    alcoholHits: 0,
    drugHits: 0,
    violenceHits: 0,
    riskScore: 0,
    riskLevel: "unknown"
  } : await analyzeLyricsModeration(trackName, artists, env);
  const combinedScore = clampNumber(baseModerationScore - Math.round((lyricsAnalysis.riskScore || 0) * 0.65), 0, 100);
  const preferredReason = chooseModerationReasonFromLyrics(lyricsAnalysis) || (confidence === "explicit" ? "explicit_lyrics" : "policy_violation");
  const trackExceptionMatched = isSafeTrackException(trackName, env);
  const openAiBackstopMissing = Boolean(
    lyricsAnalysis.foundLyrics && lyricsAnalysis.openAiAvailable && lyricsAnalysis.openAiFailed && !lyricsAnalysis.openAiFlagged
  );
  const strongProfanitySignal = (Number(lyricsAnalysis.profanityHits) || 0) >= 5;
  const rejectScoreThreshold = openAiBackstopMissing ? 22 : 32;
  if (trackExceptionMatched && confidence !== "explicit") {
    const boostedScore = Math.max(combinedScore, 78);
    return {
      status: "approved",
      moderationReason: "clean_version_verified",
      reviewNote: buildLyricsReviewNote(
        baseModerationScore,
        boostedScore,
        lyricsAnalysis,
        `Safe-song exception matched for "${sanitizeText(trackName, 120)}".`
      ),
      moderationScore: boostedScore
    };
  }
  if (confidence === "explicit" || lyricsAnalysis.riskLevel === "high" || strongProfanitySignal || combinedScore < rejectScoreThreshold) {
    return {
      status: "rejected",
      moderationReason: preferredReason,
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-marked explicit by moderation (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }
  if (openAiBackstopMissing && (lyricsAnalysis.profanityDetected || lyricsAnalysis.riskLevel !== "low")) {
    return {
      status: "pending",
      moderationReason: "",
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `OpenAI fallback unavailable; manual review (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }
  if (lyricsAnalysis.riskLevel === "medium" || lyricsAnalysis.profanityDetected) {
    return {
      status: "pending",
      moderationReason: "",
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }
  if (confidence === "clean" && combinedScore >= 70) {
    return {
      status: "approved",
      moderationReason: "",
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-approved to queue (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }
  return {
    status: "pending",
    moderationReason: "",
    reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
    moderationScore: combinedScore
  };
}
__name(getAutoModerationDecision, "getAutoModerationDecision");
function normalizeDanceMoment(value) {
  const normalized = sanitizeText(value, 32).toLowerCase();
  if (!normalized) return "anytime";
  return ALLOWED_DANCE_MOMENTS.includes(normalized) ? normalized : "anytime";
}
__name(normalizeDanceMoment, "normalizeDanceMoment");
function normalizeEnergyLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return clampNumber(Math.round(numeric), 1, 5);
}
__name(normalizeEnergyLevel, "normalizeEnergyLevel");
function normalizeVibeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  tags.forEach((tag) => {
    const entry = sanitizeText(tag, 32).toLowerCase();
    if (!ALLOWED_VIBE_TAGS.includes(entry) || seen.has(entry)) return;
    seen.add(entry);
    normalized.push(entry);
  });
  return normalized.slice(0, 5);
}
__name(normalizeVibeTags, "normalizeVibeTags");
function parseArtists(rawArtists) {
  try {
    const parsed = JSON.parse(rawArtists || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((artist) => sanitizeText(artist, 120)).filter(Boolean);
  } catch {
    return [];
  }
}
__name(parseArtists, "parseArtists");
function parseRequesters(rawJson) {
  try {
    const parsed = JSON.parse(rawJson || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const name = sanitizeText(entry.name || "", 80);
      if (!name) return null;
      return {
        name,
        role: normalizeRole(entry.role),
        customMessage: sanitizeText(entry.customMessage || "", 500),
        submittedAt: sanitizeText(entry.submittedAt || "", 40),
        dedicationMessage: sanitizeText(entry.dedicationMessage || "", 140)
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}
__name(parseRequesters, "parseRequesters");
function parseVibeTags(rawTags) {
  try {
    return normalizeVibeTags(JSON.parse(rawTags || "[]"));
  } catch {
    return [];
  }
}
__name(parseVibeTags, "parseVibeTags");
function getPriorityTier(priorityScore) {
  if (priorityScore >= 72) return "high";
  if (priorityScore >= 42) return "medium";
  return "low";
}
__name(getPriorityTier, "getPriorityTier");
function calculatePriorityScore({ voteCount, requesterRoles, eventDate, contentConfidence, danceMoment, energyLevel }) {
  const safeVoteCount = Math.max(1, Number(voteCount) || 1);
  const voteScore = clampNumber(safeVoteCount * 6, 0, 40);
  const roleScore = (requesterRoles || []).reduce((maxScore, role) => {
    const weight = ROLE_WEIGHTS[normalizeRole(role)] || 0;
    return Math.max(maxScore, weight);
  }, ROLE_WEIGHTS.guest);
  let eventScore = 0;
  const normalizedDate = normalizeIsoDate(eventDate);
  if (normalizedDate) {
    const now = /* @__PURE__ */ new Date();
    const eventAt = /* @__PURE__ */ new Date(`${normalizedDate}T00:00:00.000Z`);
    const daysUntil = Math.ceil((eventAt.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24));
    if (daysUntil <= 1) eventScore = 22;
    else if (daysUntil <= 3) eventScore = 17;
    else if (daysUntil <= 7) eventScore = 12;
    else if (daysUntil <= 14) eventScore = 8;
    else if (daysUntil <= 30) eventScore = 4;
    if (daysUntil < 0) eventScore = 0;
  }
  const confidence = deriveContentConfidence(contentConfidence);
  const confidenceScore = confidence === "clean" ? 6 : confidence === "explicit" ? -10 : 0;
  const momentScore = MOMENT_WEIGHTS[normalizeDanceMoment(danceMoment)] || MOMENT_WEIGHTS.anytime;
  const normalizedEnergy = normalizeEnergyLevel(energyLevel);
  const energyScore = (normalizedEnergy - 3) * 4;
  return clampNumber(Math.round(voteScore + roleScore + eventScore + confidenceScore + momentScore + energyScore), 0, 100);
}
__name(calculatePriorityScore, "calculatePriorityScore");
function parseSetOrder(value) {
  if (value === null || value === void 0 || value === "") return { valid: true, value: null };
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 9999) return { valid: false, value: null };
  return { valid: true, value: numeric };
}
__name(parseSetOrder, "parseSetOrder");
function normalizeRequesterDisplayName(value) {
  return sanitizeText(String(value || "").replace(/\s+/g, " "), 80).trim();
}
__name(normalizeRequesterDisplayName, "normalizeRequesterDisplayName");
function normalizeRequesterMetricKey(value) {
  return normalizeRequesterDisplayName(value).toLowerCase();
}
__name(normalizeRequesterMetricKey, "normalizeRequesterMetricKey");
function recordRequesterMetric(requesterStats, { name, status, submittedAt }) {
  const displayName = normalizeRequesterDisplayName(name);
  const key = normalizeRequesterMetricKey(displayName);
  if (!key) return;
  const existing = requesterStats.get(key) || {
    name: displayName,
    requestCount: 0,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    lastRequestedAt: ""
  };
  existing.requestCount += 1;
  if (status === "approved") existing.approvedCount += 1;
  else if (status === "pending") existing.pendingCount += 1;
  else if (status === "rejected") existing.rejectedCount += 1;
  const submittedMs = parseIsoDateMs(submittedAt);
  const existingLastMs = parseIsoDateMs(existing.lastRequestedAt);
  if (submittedMs !== null && (existingLastMs === null || submittedMs >= existingLastMs)) {
    existing.lastRequestedAt = new Date(submittedMs).toISOString();
    existing.name = displayName || existing.name;
  } else if (!existing.name && displayName) {
    existing.name = displayName;
  }
  requesterStats.set(key, existing);
}
__name(recordRequesterMetric, "recordRequesterMetric");
function normalizeSpotifySearchType(rawType) {
  const value = sanitizeText(rawType, 20).toLowerCase();
  if (value === "track" || value === "album" || value === "artist") return value;
  return "all";
}
__name(normalizeSpotifySearchType, "normalizeSpotifySearchType");
function normalizeRequestRow(row) {
  const requesters = parseRequesters(row.requesters_json);
  const requesterName = sanitizeText(row.requester_name || "", 80);
  const requesterRole = normalizeRole(row.requester_role || "guest");
  if (!requesters.length && requesterName) {
    requesters.push({
      name: requesterName,
      role: requesterRole,
      customMessage: sanitizeText(row.custom_message || "", 500),
      submittedAt: sanitizeText(row.submitted_at || "", 40),
      dedicationMessage: sanitizeText(row.dedication_message || "", 140)
    });
  }
  const voteCount = Math.max(1, Number(row.vote_count) || requesters.length || 1);
  const contentConfidence = deriveContentConfidence(row.content_confidence);
  const danceMoment = normalizeDanceMoment(row.dance_moment);
  const energyLevel = normalizeEnergyLevel(row.energy_level);
  const requesterRoles = requesters.map((entry) => entry.role);
  const priorityScore = Number.isFinite(Number(row.priority_score)) ? Number(row.priority_score) : calculatePriorityScore({ voteCount, requesterRoles, eventDate: row.event_date, contentConfidence, danceMoment, energyLevel });
  const parsedSetOrder = parseSetOrder(row.set_order);
  return {
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    artists: parseArtists(row.artists),
    albumName: row.album_name || "",
    albumImage: row.album_image || "",
    spotifyUrl: row.spotify_url || "",
    requesterName,
    requesterRole,
    requesters,
    customMessage: row.custom_message || "",
    dedicationMessage: row.dedication_message || "",
    eventDate: row.event_date || null,
    explicit: row.explicit_flag === null || row.explicit_flag === void 0 ? null : Boolean(Number(row.explicit_flag)),
    contentConfidence,
    danceMoment,
    energyLevel,
    vibeTags: parseVibeTags(row.vibe_tags),
    moderationReason: row.moderation_reason || "",
    voteCount,
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    status: row.status,
    reviewNote: row.review_note || "",
    djNotes: row.dj_notes || "",
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || null
  };
}
__name(normalizeRequestRow, "normalizeRequestRow");
function projectPublicQueueItem(item) {
  return {
    id: item.id,
    trackId: item.trackId,
    trackName: item.trackName,
    artists: item.artists,
    albumName: item.albumName,
    albumImage: item.albumImage,
    spotifyUrl: item.spotifyUrl,
    dedicationMessage: item.dedicationMessage,
    contentConfidence: item.contentConfidence,
    danceMoment: item.danceMoment,
    energyLevel: item.energyLevel,
    vibeTags: item.vibeTags,
    voteCount: item.voteCount,
    priorityScore: item.priorityScore,
    priorityTier: item.priorityTier,
    setOrder: item.setOrder,
    status: item.status
  };
}
__name(projectPublicQueueItem, "projectPublicQueueItem");
function buildDuplicateConflictPayloadFromRow(row) {
  const parsedSetOrder = parseSetOrder(row?.set_order);
  return {
    id: Number(row?.id || 0),
    trackId: sanitizeText(row?.track_id || "", 64),
    trackName: sanitizeText(row?.track_name || "", 200),
    status: normalizeStatus(row?.status) || "pending",
    voteCount: Math.max(1, Number(row?.vote_count) || 1),
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null
  };
}
__name(buildDuplicateConflictPayloadFromRow, "buildDuplicateConflictPayloadFromRow");
function getAdminCredentials(env) {
  const username = sanitizeText(env.ADMIN_USERNAME || "", 80);
  const password = sanitizeText(env.ADMIN_PASSWORD || "", 120);
  if (!username || !password) return null;
  return { username, password };
}
__name(getAdminCredentials, "getAdminCredentials");
function decodeBase64(value) {
  try {
    return atob(value);
  } catch {
    return "";
  }
}
__name(decodeBase64, "decodeBase64");
function parseAuthorizationHeader(rawHeader) {
  const header = String(rawHeader || "").trim();
  if (!header) return { type: "", value: "" };
  const parts = header.split(/\s+/, 2);
  if (parts.length !== 2) return { type: "", value: "" };
  return { type: parts[0].toLowerCase(), value: parts[1] };
}
__name(parseAuthorizationHeader, "parseAuthorizationHeader");
function isAdminAuthorized(request, env) {
  const credentials = getAdminCredentials(env);
  if (!credentials) return false;
  const parsed = parseAuthorizationHeader(request.headers.get("Authorization"));
  const expectedToken = btoa(`${credentials.username}:${credentials.password}`);
  if (parsed.type === "basic") {
    const decoded = decodeBase64(parsed.value);
    return decoded === `${credentials.username}:${credentials.password}`;
  }
  if (parsed.type === "bearer") {
    return parsed.value === expectedToken;
  }
  return false;
}
__name(isAdminAuthorized, "isAdminAuthorized");
function unauthorizedResponse() {
  return json(
    { error: "DJ authorization required", hint: "Use DJ login first and send Authorization header." },
    401,
    { "WWW-Authenticate": 'Basic realm="Dance Admin"' }
  );
}
__name(unauthorizedResponse, "unauthorizedResponse");
function adminCredentialsMissingResponse() {
  return json({ error: "DJ credentials are not configured on this Worker." }, 500);
}
__name(adminCredentialsMissingResponse, "adminCredentialsMissingResponse");
function buildCreatePayload(body) {
  const trackId = sanitizeText(body.trackId, 64);
  const trackName = sanitizeText(body.trackName, 200);
  const artists = Array.isArray(body.artists) ? body.artists.map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 8) : [];
  const requesterName = sanitizeText(body.requesterName, 80);
  const requesterRole = normalizeRole(body.requesterRole);
  const customMessage = sanitizeText(body.customMessage, 500);
  const dedicationMessage = sanitizeText(body.dedicationMessage, 140);
  const eventDate = normalizeIsoDate(body.eventDate);
  const explicitFlag = typeof body.explicit === "boolean" ? body.explicit : null;
  const contentConfidence = deriveContentConfidence(explicitFlag);
  const danceMoment = normalizeDanceMoment(body.danceMoment);
  const energyLevel = normalizeEnergyLevel(body.energyLevel);
  const vibeTags = normalizeVibeTags(body.vibeTags);
  return {
    trackId,
    trackName,
    artists,
    albumName: sanitizeText(body.albumName, 200),
    albumImage: sanitizeText(body.albumImage, 400),
    spotifyUrl: sanitizeText(body.spotifyUrl, 400),
    requesterName,
    requesterRole,
    customMessage,
    dedicationMessage,
    eventDate,
    explicitFlag,
    contentConfidence,
    danceMoment,
    energyLevel,
    vibeTags
  };
}
__name(buildCreatePayload, "buildCreatePayload");
function buildRequesterEntry({ requesterName, requesterRole, customMessage, dedicationMessage, submittedAt }) {
  return {
    name: requesterName,
    role: requesterRole,
    customMessage: customMessage || "",
    dedicationMessage: dedicationMessage || "",
    submittedAt
  };
}
__name(buildRequesterEntry, "buildRequesterEntry");
async function getMaxActiveSetOrder(env) {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(set_order), 0) AS max_order FROM requests WHERE status != 'rejected'").first();
  return Number(row?.max_order || 0);
}
__name(getMaxActiveSetOrder, "getMaxActiveSetOrder");
async function renumberActiveQueue(env) {
  const rows = await env.DB.prepare(
    `SELECT id FROM requests
     WHERE status != 'rejected'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      id ASC`
  ).all();
  const ids = (rows.results || []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return;
  }
  await env.DB.batch(
    ids.map(
      (id, index) => env.DB.prepare("UPDATE requests SET set_order = ? WHERE id = ?").bind(index + 1, id)
    )
  );
}
__name(renumberActiveQueue, "renumberActiveQueue");
async function reorderActiveQueue(env, itemId, beforeId) {
  const rows = await env.DB.prepare(
    `SELECT id FROM requests
     WHERE status != 'rejected'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      id ASC`
  ).all();
  const ids = (rows.results || []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.includes(itemId)) {
    return { ok: false, error: "Item is not in the active queue" };
  }
  if (beforeId !== null && !ids.includes(beforeId)) {
    return { ok: false, error: "Target position item not found in active queue" };
  }
  const nextIds = ids.filter((id) => id !== itemId);
  if (beforeId === null) {
    nextIds.push(itemId);
  } else {
    const insertIndex = nextIds.indexOf(beforeId);
    nextIds.splice(insertIndex, 0, itemId);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.batch(
    nextIds.map(
      (id, index) => env.DB.prepare("UPDATE requests SET set_order = ?, updated_at = ? WHERE id = ?").bind(index + 1, now, id)
    )
  );
  return { ok: true };
}
__name(reorderActiveQueue, "reorderActiveQueue");
async function runAdminControlAction(env, action) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const normalizedAction = sanitizeText(action, 64).toLowerCase();
  if (normalizedAction === "play_next_approved") {
    const nextApproved = await env.DB.prepare(
      `SELECT id FROM requests
       WHERE status = 'approved'
       ORDER BY
        CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
        set_order ASC,
        id ASC
       LIMIT 1`
    ).first();
    if (!nextApproved) {
      return { updatedCount: 0, action: normalizedAction };
    }
    await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(nextApproved.id).run();
    await renumberActiveQueue(env);
    return { updatedCount: 1, action: normalizedAction, playedItemId: Number(nextApproved.id) };
  }
  if (normalizedAction === "clear_all") {
    const result = await env.DB.prepare("DELETE FROM requests").run();
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }
  if (normalizedAction === "clear_approved") {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'approved'").run();
    await renumberActiveQueue(env);
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }
  if (normalizedAction === "clear_pending") {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'pending'").run();
    await renumberActiveQueue(env);
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }
  if (normalizedAction === "clear_denied") {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'rejected'").run();
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }
  if (normalizedAction === "renumber_active") {
    await renumberActiveQueue(env);
    return { updatedCount: 0, action: normalizedAction };
  }
  return { updatedCount: 0, action: normalizedAction, error: "Unsupported control action" };
}
__name(runAdminControlAction, "runAdminControlAction");
function buildAnalyticsFromRows(rows) {
  const statusBreakdown = { pending: 0, approved: 0, rejected: 0 };
  const danceMomentBreakdown = /* @__PURE__ */ new Map();
  const vibeTagBreakdown = /* @__PURE__ */ new Map();
  const artistVotes = /* @__PURE__ */ new Map();
  const trackVotes = /* @__PURE__ */ new Map();
  const moderationReasonBreakdown = /* @__PURE__ */ new Map();
  const requesterStats = /* @__PURE__ */ new Map();
  let totalVotes = 0;
  let approvedVotes = 0;
  let weightedPrioritySum = 0;
  let weightedEnergySum = 0;
  let pendingHighPriority = 0;
  rows.forEach((row) => {
    const item = normalizeRequestRow(row);
    const votes = item.voteCount;
    totalVotes += votes;
    statusBreakdown[item.status] = (statusBreakdown[item.status] || 0) + votes;
    weightedPrioritySum += item.priorityScore * votes;
    weightedEnergySum += item.energyLevel * votes;
    if (item.status === "approved") approvedVotes += votes;
    if (item.status === "pending" && item.priorityTier === "high") pendingHighPriority += votes;
    item.artists.forEach((artist) => artistVotes.set(artist, (artistVotes.get(artist) || 0) + votes));
    danceMomentBreakdown.set(item.danceMoment, (danceMomentBreakdown.get(item.danceMoment) || 0) + votes);
    item.vibeTags.forEach((tag) => vibeTagBreakdown.set(tag, (vibeTagBreakdown.get(tag) || 0) + votes));
    const trackKey = item.trackId || item.trackName;
    const existingTrack = trackVotes.get(trackKey) || { trackId: item.trackId, trackName: item.trackName, votes: 0, status: item.status };
    existingTrack.votes += votes;
    existingTrack.status = item.status;
    trackVotes.set(trackKey, existingTrack);
    if (item.status === "rejected" && item.moderationReason) {
      moderationReasonBreakdown.set(item.moderationReason, (moderationReasonBreakdown.get(item.moderationReason) || 0) + votes);
    }
    const requesterEntries = Array.isArray(item.requesters) && item.requesters.length ? item.requesters : [{ name: item.requesterName, submittedAt: item.submittedAt }];
    requesterEntries.forEach((entry) => {
      recordRequesterMetric(requesterStats, {
        name: entry?.name || item.requesterName,
        status: item.status,
        submittedAt: entry?.submittedAt || item.submittedAt
      });
    });
  });
  const topRequestedArtists = [...artistVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([artist, votes]) => ({ artist, votes }));
  const topRequestedTracks = [...trackVotes.values()].sort((a, b) => b.votes - a.votes).slice(0, 10);
  const danceMoments = [...danceMomentBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([danceMoment, votes]) => ({ danceMoment, votes }));
  const vibeTags = [...vibeTagBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([tag, votes]) => ({ tag, votes }));
  const moderationReasons = [...moderationReasonBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  const topRequesters = [...requesterStats.values()].sort((left, right) => {
    if (right.requestCount !== left.requestCount) return right.requestCount - left.requestCount;
    const leftTs = parseIsoDateMs(left.lastRequestedAt) || 0;
    const rightTs = parseIsoDateMs(right.lastRequestedAt) || 0;
    if (rightTs !== leftTs) return rightTs - leftTs;
    return String(left.name || "").localeCompare(String(right.name || ""));
  }).slice(0, 20);
  const approvalRate = totalVotes > 0 ? Number((approvedVotes / totalVotes * 100).toFixed(1)) : 0;
  const averagePriorityScore = totalVotes > 0 ? Number((weightedPrioritySum / totalVotes).toFixed(1)) : 0;
  const averageEnergyLevel = totalVotes > 0 ? Number((weightedEnergySum / totalVotes).toFixed(1)) : 0;
  return {
    totals: {
      requests: rows.length,
      votes: totalVotes,
      approvedVotes,
      approvalRate,
      averagePriorityScore,
      averageEnergyLevel,
      pendingHighPriority
    },
    statusBreakdown,
    topRequestedArtists,
    topRequestedTracks,
    topRequesters,
    danceMoments,
    vibeTags,
    moderationReasons
  };
}
__name(buildAnalyticsFromRows, "buildAnalyticsFromRows");
async function handleGetPublicQueue(request, env) {
  const url = new URL(request.url);
  const status = sanitizeText(url.searchParams.get("status"), 20).toLowerCase();
  const limit = clampNumber(Number(url.searchParams.get("limit")) || 24, 1, 60);
  if (status && status !== "approved") {
    return json({ error: "Public queue only supports approved tracks." }, 400);
  }
  const result = await env.DB.prepare(
    `SELECT * FROM requests
     WHERE status = 'approved'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      priority_score DESC,
      vote_count DESC,
      id DESC
     LIMIT ?`
  ).bind(limit).all();
  const items = (result.results || []).map(normalizeRequestRow).map(projectPublicQueueItem);
  return json({ items });
}
__name(handleGetPublicQueue, "handleGetPublicQueue");
async function handleGetPublicFeed(env) {
  const approvedResult = await env.DB.prepare(
    `SELECT * FROM requests
     WHERE status = 'approved'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      priority_score DESC,
      vote_count DESC,
      id DESC
     LIMIT 20`
  ).all();
  const allRows = await env.DB.prepare("SELECT * FROM requests").all();
  const analytics = buildAnalyticsFromRows(allRows.results || []);
  const upNext = (approvedResult.results || []).map(normalizeRequestRow).map(projectPublicQueueItem);
  return json({
    upNext,
    summary: {
      pendingVotes: Number(analytics.statusBreakdown.pending || 0),
      approvedVotes: Number(analytics.statusBreakdown.approved || 0),
      rejectedVotes: Number(analytics.statusBreakdown.rejected || 0),
      averageEnergyLevel: analytics.totals.averageEnergyLevel,
      approvalRate: analytics.totals.approvalRate
    },
    trendingArtists: analytics.topRequestedArtists.slice(0, 6),
    trendingMoments: analytics.danceMoments.slice(0, 6),
    trendingVibes: analytics.vibeTags.slice(0, 8)
  });
}
__name(handleGetPublicFeed, "handleGetPublicFeed");
async function handleCreateRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const payload = buildCreatePayload(body || {});
  if (!payload.trackId || !payload.trackName || !payload.artists.length || !payload.requesterName) {
    return json({ error: "Missing required fields" }, 400);
  }
  const existing = await env.DB.prepare(
    "SELECT * FROM requests WHERE track_id = ? AND status != 'rejected' ORDER BY id DESC LIMIT 1"
  ).bind(payload.trackId).first();
  if (existing) {
    return json({
      error: "This song is already in queue/review and cannot be requested again right now.",
      code: "duplicate_active",
      existing: buildDuplicateConflictPayloadFromRow(existing)
    }, 409);
  }
  const isDjAuthorizedRequest = isAdminAuthorized(request, env);
  const isEvalBypassRequest = request.headers.get("X-Eval-Bypass") === "1" && isDjAuthorizedRequest;
  const shouldBypassRateLimit = isDjAuthorizedRequest || isEvalBypassRequest;
  let limitResult = { allowed: true, retryAfterSec: Math.ceil(REQUEST_LIMIT_WINDOW_MS / 1e3), nextAllowedAt: "" };
  if (!shouldBypassRateLimit) {
    const clientIp = getClientIp(request);
    limitResult = await checkAndConsumeRateLimit(env, clientIp);
    if (!limitResult.allowed) {
      return json({
        error: "You can request one song every 10 minutes from this device/network.",
        retryAfterSec: limitResult.retryAfterSec,
        nextAllowedAt: limitResult.nextAllowedAt
      }, 429, { "Retry-After": String(limitResult.retryAfterSec) });
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const requesters = [buildRequesterEntry({
    requesterName: payload.requesterName,
    requesterRole: payload.requesterRole,
    customMessage: payload.customMessage,
    dedicationMessage: payload.dedicationMessage,
    submittedAt: now
  })];
  const priorityScore = calculatePriorityScore({
    voteCount: 1,
    requesterRoles: [payload.requesterRole],
    eventDate: payload.eventDate,
    contentConfidence: payload.contentConfidence,
    danceMoment: payload.danceMoment,
    energyLevel: payload.energyLevel
  });
  const autoDecision = await getAutoModerationDecision({
    trackName: payload.trackName,
    artists: payload.artists,
    contentConfidence: payload.contentConfidence,
    env
  });
  const nextSetOrder = autoDecision.status === "rejected" ? null : await getMaxActiveSetOrder(env) + 1;
  const insert = await env.DB.prepare(
    `INSERT INTO requests
      (track_id, track_name, artists, album_name, album_image, spotify_url,
       requester_name, requester_role, custom_message, dedication_message,
       event_date, explicit_flag, content_confidence, dance_moment, energy_level, vibe_tags,
       vote_count, requesters_json, priority_score, status, review_note, moderation_reason, dj_notes, set_order, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).bind(
    payload.trackId,
    payload.trackName,
    JSON.stringify(payload.artists),
    payload.albumName,
    payload.albumImage,
    payload.spotifyUrl,
    payload.requesterName,
    payload.requesterRole,
    payload.customMessage,
    payload.dedicationMessage,
    payload.eventDate,
    payload.explicitFlag === null ? null : payload.explicitFlag ? 1 : 0,
    payload.contentConfidence,
    payload.danceMoment,
    payload.energyLevel,
    JSON.stringify(payload.vibeTags),
    1,
    JSON.stringify(requesters),
    priorityScore,
    autoDecision.status,
    autoDecision.reviewNote,
    autoDecision.moderationReason,
    nextSetOrder,
    now
  ).run();
  const created = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(insert.meta.last_row_id).first();
  return json({
    ...normalizeRequestRow(created),
    retryAfterSec: limitResult.retryAfterSec,
    nextAllowedAt: limitResult.nextAllowedAt || new Date(Date.now() + REQUEST_LIMIT_WINDOW_MS).toISOString()
  }, 201);
}
__name(handleCreateRequest, "handleCreateRequest");
async function handleAdminLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const credentials = getAdminCredentials(env);
  if (!credentials) return adminCredentialsMissingResponse();
  const username = sanitizeText(body.username, 80);
  const password = sanitizeText(body.password, 120);
  if (username !== credentials.username || password !== credentials.password) {
    return json({ error: "Invalid DJ credentials" }, 401);
  }
  return json({ ok: true, username: credentials.username, tokenType: "Basic", token: btoa(`${credentials.username}:${credentials.password}`) });
}
__name(handleAdminLogin, "handleAdminLogin");
async function handleAdminSession(request, env) {
  const credentials = getAdminCredentials(env);
  if (!credentials) return adminCredentialsMissingResponse();
  if (!isAdminAuthorized(request, env)) return unauthorizedResponse();
  return json({ ok: true, username: credentials.username });
}
__name(handleAdminSession, "handleAdminSession");
async function handleAdminGetQueue(request, env) {
  const url = new URL(request.url);
  const status = sanitizeText(url.searchParams.get("status"), 20).toLowerCase();
  const confidence = sanitizeText(url.searchParams.get("confidence"), 20).toLowerCase();
  const danceMoment = sanitizeText(url.searchParams.get("danceMoment"), 32).toLowerCase();
  const search = sanitizeText(url.searchParams.get("q"), 80).toLowerCase();
  if (status && !ALLOWED_STATUSES.includes(status)) return json({ error: "Invalid status filter" }, 400);
  if (confidence && !ALLOWED_CONFIDENCE.includes(confidence)) return json({ error: "Invalid confidence filter" }, 400);
  if (danceMoment && !ALLOWED_DANCE_MOMENTS.includes(danceMoment)) return json({ error: "Invalid dance moment filter" }, 400);
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (confidence) {
    clauses.push("content_confidence = ?");
    params.push(confidence);
  }
  if (danceMoment) {
    clauses.push("dance_moment = ?");
    params.push(danceMoment);
  }
  if (search) {
    const wildcard = `%${search}%`;
    clauses.push("(LOWER(track_name) LIKE ? OR LOWER(artists) LIKE ? OR LOWER(requester_name) LIKE ?)");
    params.push(wildcard, wildcard, wildcard);
  }
  let query = "SELECT * FROM requests";
  if (clauses.length) query += ` WHERE ${clauses.join(" AND ")}`;
  query += ` ORDER BY
    CASE WHEN status = 'rejected' THEN 1 ELSE 0 END,
    CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
    set_order ASC,
    id ASC`;
  const stmt = env.DB.prepare(query);
  const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
  return json({ items: (result.results || []).map(normalizeRequestRow) });
}
__name(handleAdminGetQueue, "handleAdminGetQueue");
async function handleAdminUpdateQueue(request, env, rawId) {
  const itemId = Number(rawId);
  if (!Number.isInteger(itemId) || itemId <= 0) return json({ error: "Invalid queue item id" }, 400);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const existing = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(itemId).first();
  if (!existing) return json({ error: "Queue item not found" }, 404);
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasReviewNote = Object.prototype.hasOwnProperty.call(body, "reviewNote");
  const hasModerationReason = Object.prototype.hasOwnProperty.call(body, "moderationReason");
  const hasDanceMoment = Object.prototype.hasOwnProperty.call(body, "danceMoment");
  const hasEnergyLevel = Object.prototype.hasOwnProperty.call(body, "energyLevel");
  const hasDjNotes = Object.prototype.hasOwnProperty.call(body, "djNotes");
  const hasSetOrder = Object.prototype.hasOwnProperty.call(body, "setOrder");
  if (!hasStatus && !hasReviewNote && !hasModerationReason && !hasDanceMoment && !hasEnergyLevel && !hasDjNotes && !hasSetOrder) {
    return json({ error: "No DJ updates were provided" }, 400);
  }
  const status = hasStatus ? normalizeStatus(body.status) : normalizeStatus(existing.status);
  if (!status) return json({ error: "Invalid status value" }, 400);
  const moderationReason = hasModerationReason ? normalizeModerationReason(body.moderationReason) : sanitizeText(existing.moderation_reason || "", 64);
  if (moderationReason === null) return json({ error: "Invalid moderation reason preset" }, 400);
  let resolvedModerationReason = moderationReason || "";
  if (status === "rejected" && !resolvedModerationReason) resolvedModerationReason = sanitizeText(existing.moderation_reason || "", 64);
  if (status === "rejected" && !resolvedModerationReason) return json({ error: "Choose a moderation preset when rejecting a track" }, 400);
  if (status !== "rejected" && !hasModerationReason) resolvedModerationReason = "";
  const reviewNote = hasReviewNote ? sanitizeText(body.reviewNote, 500) : sanitizeText(existing.review_note || "", 500);
  const danceMoment = hasDanceMoment ? normalizeDanceMoment(body.danceMoment) : normalizeDanceMoment(existing.dance_moment);
  const energyLevel = hasEnergyLevel ? normalizeEnergyLevel(body.energyLevel) : normalizeEnergyLevel(existing.energy_level);
  const djNotes = hasDjNotes ? sanitizeText(body.djNotes, 500) : sanitizeText(existing.dj_notes || "", 500);
  const previousStatus = normalizeStatus(existing.status) || "pending";
  const parsedSetOrder = hasSetOrder ? parseSetOrder(body.setOrder) : parseSetOrder(existing.set_order);
  if (!parsedSetOrder.valid) return json({ error: "Invalid set order value" }, 400);
  let resolvedSetOrder = parsedSetOrder.value;
  if (status === "rejected") {
    resolvedSetOrder = null;
  } else {
    const maxOrder = await getMaxActiveSetOrder(env);
    if (previousStatus === "rejected") {
      resolvedSetOrder = resolvedSetOrder === null ? maxOrder + 1 : resolvedSetOrder;
    } else if (resolvedSetOrder === null) {
      const existingSetOrder = parseSetOrder(existing.set_order);
      resolvedSetOrder = existingSetOrder.valid ? existingSetOrder.value : maxOrder + 1;
    }
  }
  const requesters = parseRequesters(existing.requesters_json);
  const requesterRoles = requesters.length ? requesters.map((entry) => entry.role) : [normalizeRole(existing.requester_role)];
  const voteCount = Math.max(1, Number(existing.vote_count) || 1);
  const priorityScore = calculatePriorityScore({
    voteCount,
    requesterRoles,
    eventDate: existing.event_date,
    contentConfidence: existing.content_confidence,
    danceMoment,
    energyLevel
  });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `UPDATE requests
     SET status = ?, review_note = ?, moderation_reason = ?, dance_moment = ?, energy_level = ?, dj_notes = ?, set_order = ?, priority_score = ?, updated_at = ?
     WHERE id = ?`
  ).bind(status, reviewNote, resolvedModerationReason, danceMoment, energyLevel, djNotes, resolvedSetOrder, priorityScore, now, itemId).run();
  await renumberActiveQueue(env);
  const updated = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(itemId).first();
  return json(normalizeRequestRow(updated));
}
__name(handleAdminUpdateQueue, "handleAdminUpdateQueue");
async function handleAdminBulkAction(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const action = sanitizeText(body.action, 64).toLowerCase();
  const limit = clampNumber(Number(body.limit) || 8, 1, 40);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (action === "approve_clean_high_priority") {
    const found = await env.DB.prepare(
      `SELECT id FROM requests
       WHERE status = 'pending' AND content_confidence = 'clean' AND priority_score >= 55
       ORDER BY priority_score DESC, vote_count DESC, id DESC
       LIMIT ?`
    ).bind(limit).all();
    const ids = (found.results || []).map((entry) => entry.id);
    if (!ids.length) return json({ updatedCount: 0, updatedIds: [] });
    await env.DB.batch(ids.map(
      (id) => env.DB.prepare(`UPDATE requests SET status = 'approved', moderation_reason = '', review_note = ?, updated_at = ? WHERE id = ?`).bind("Bulk-approved clean/high-priority request.", now, id)
    ));
    return json({ updatedCount: ids.length, updatedIds: ids });
  }
  if (action === "reject_explicit") {
    const found = await env.DB.prepare(
      `SELECT id FROM requests
       WHERE status = 'pending' AND content_confidence = 'explicit'
       ORDER BY priority_score DESC, vote_count DESC, id DESC
       LIMIT ?`
    ).bind(limit).all();
    const ids = (found.results || []).map((entry) => entry.id);
    if (!ids.length) return json({ updatedCount: 0, updatedIds: [] });
    await env.DB.batch(ids.map(
      (id) => env.DB.prepare(`UPDATE requests SET status = 'rejected', moderation_reason = 'explicit_lyrics', review_note = ?, updated_at = ? WHERE id = ?`).bind("Bulk-rejected explicit track.", now, id)
    ));
    return json({ updatedCount: ids.length, updatedIds: ids });
  }
  return json({ error: "Unsupported bulk action" }, 400);
}
__name(handleAdminBulkAction, "handleAdminBulkAction");
async function handleAdminReorder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const itemId = Number(body.itemId);
  const beforeId = body.beforeId === null || body.beforeId === void 0 ? null : Number(body.beforeId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return json({ error: "Invalid item id" }, 400);
  }
  if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId <= 0)) {
    return json({ error: "Invalid before id" }, 400);
  }
  const result = await reorderActiveQueue(env, itemId, beforeId);
  if (!result.ok) {
    return json({ error: result.error || "Unable to reorder queue" }, 400);
  }
  return json({ ok: true });
}
__name(handleAdminReorder, "handleAdminReorder");
async function handleAdminControl(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  const action = sanitizeText(body.action, 64).toLowerCase();
  if (!action) {
    return json({ error: "Control action is required" }, 400);
  }
  const result = await runAdminControlAction(env, action);
  if (result.error) {
    return json({ error: result.error }, 400);
  }
  return json(result);
}
__name(handleAdminControl, "handleAdminControl");
async function handleGetAdminAnalytics(env) {
  const result = await env.DB.prepare("SELECT * FROM requests").all();
  return json(buildAnalyticsFromRows(result.results || []));
}
__name(handleGetAdminAnalytics, "handleGetAdminAnalytics");
function normalizeSoundCloudMatchText(value) {
  const lowered = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return sanitizeText(lowered, 280).replace(/\s+/g, " ").trim();
}
__name(normalizeSoundCloudMatchText, "normalizeSoundCloudMatchText");
function tokenizeSoundCloudMatchText(value) {
  const normalized = normalizeSoundCloudMatchText(value);
  return normalized ? normalized.split(" ") : [];
}
__name(tokenizeSoundCloudMatchText, "tokenizeSoundCloudMatchText");
function computeSoundCloudMatchScore({ trackName, artists, candidateTitle, candidateArtist }) {
  const titleNorm = normalizeSoundCloudMatchText(trackName);
  const candidateTitleNorm = normalizeSoundCloudMatchText(candidateTitle);
  const primaryArtistNorm = normalizeSoundCloudMatchText((artists || [])[0] || "");
  const candidateArtistNorm = normalizeSoundCloudMatchText(candidateArtist);
  const titleTokens = tokenizeSoundCloudMatchText(trackName);
  const candidateTitleTokens = new Set(tokenizeSoundCloudMatchText(candidateTitle));
  const artistTokens = tokenizeSoundCloudMatchText((artists || []).join(" "));
  const candidateArtistTokens = new Set(tokenizeSoundCloudMatchText(candidateArtist));
  let score = 0;
  if (titleNorm && candidateTitleNorm) {
    if (candidateTitleNorm === titleNorm) score += 100;
    if (candidateTitleNorm.startsWith(titleNorm)) score += 50;
    if (candidateTitleNorm.includes(titleNorm)) score += 28;
    if (titleNorm.includes(candidateTitleNorm)) score += 14;
  }
  if (primaryArtistNorm && candidateArtistNorm) {
    if (candidateArtistNorm === primaryArtistNorm) score += 32;
    else if (candidateArtistNorm.includes(primaryArtistNorm)) score += 20;
    else if (primaryArtistNorm.includes(candidateArtistNorm)) score += 10;
  }
  titleTokens.forEach((token) => {
    if (candidateTitleTokens.has(token)) score += 4;
  });
  artistTokens.forEach((token) => {
    if (candidateArtistTokens.has(token)) score += 3;
  });
  return score;
}
__name(computeSoundCloudMatchScore, "computeSoundCloudMatchScore");
function mapSoundCloudTrack(track, { trackName, artists }) {
  const id = Number(track?.id || 0);
  const title = sanitizeText(track?.title || "", 220);
  const artist = sanitizeText(track?.user?.username || track?.publisher_metadata?.artist || "", 120);
  const permalinkUrl = sanitizeText(track?.permalink_url || "", 400);
  if (!id || !title || !permalinkUrl) return null;
  const durationMs = Math.max(0, Number(track?.duration || track?.full_duration || 0));
  const artworkUrl = sanitizeText(track?.artwork_url || track?.user?.avatar_url || "", 400);
  return {
    id,
    title,
    artist,
    durationMs,
    artworkUrl,
    permalinkUrl,
    apiTrackUrl: `https://api.soundcloud.com/tracks/${id}`,
    matchScore: computeSoundCloudMatchScore({
      trackName,
      artists,
      candidateTitle: title,
      candidateArtist: artist
    })
  };
}
__name(mapSoundCloudTrack, "mapSoundCloudTrack");
function buildSoundCloudWidgetSrc(apiTrackUrl) {
  const params = new URLSearchParams({
    url: apiTrackUrl,
    auto_play: "true",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    visual: "false"
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}
__name(buildSoundCloudWidgetSrc, "buildSoundCloudWidgetSrc");
function buildSoundCloudSearchQuery(trackName, artists) {
  const parts = [sanitizeText(trackName, 220), ...(artists || []).map((artist) => sanitizeText(artist, 120))].filter(Boolean).slice(0, 3);
  return sanitizeText(parts.join(" "), 320);
}
__name(buildSoundCloudSearchQuery, "buildSoundCloudSearchQuery");
async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
__name(parseJsonSafe, "parseJsonSafe");
function sanitizeSoundCloudErrorDetail(value) {
  return sanitizeText(String(value || ""), 220);
}
__name(sanitizeSoundCloudErrorDetail, "sanitizeSoundCloudErrorDetail");
async function requestSoundCloudClientToken(clientId, clientSecret) {
  const tokenUrls = [SOUND_CLOUD_OAUTH_TOKEN_URL, SOUND_CLOUD_OAUTH_TOKEN_FALLBACK_URL];
  let lastStatus = 500;
  let lastDetail = "";
  for (const tokenUrl of tokenUrls) {
    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: "grant_type=client_credentials"
      });
      if (response.ok) {
        const tokenPayload = await parseJsonSafe(response);
        const accessToken = sanitizeText(tokenPayload?.access_token || "", 500);
        if (accessToken) return { token: accessToken, status: 200, detail: "" };
      }
      lastStatus = Number(response.status) || 500;
      const body = await parseJsonSafe(response);
      lastDetail = sanitizeSoundCloudErrorDetail(body?.error_description || body?.error || body?.message || "");
    } catch (error) {
      lastStatus = 502;
      const diagnostic = sanitizeSoundCloudErrorDetail(error?.message || error?.cause?.message || String(error || ""));
      lastDetail = diagnostic || "token_request_failed";
    }
  }
  return {
    token: "",
    status: lastStatus,
    detail: lastDetail || "unable_to_retrieve_access_token"
  };
}
__name(requestSoundCloudClientToken, "requestSoundCloudClientToken");
async function fetchSoundCloudTracks({ query, clientId, accessToken }) {
  const tracksUrl = new URL(SOUND_CLOUD_TRACKS_BASE_URL);
  tracksUrl.searchParams.set("q", query);
  tracksUrl.searchParams.set("limit", "30");
  tracksUrl.searchParams.set("linked_partitioning", "1");
  if (clientId) tracksUrl.searchParams.set("client_id", clientId);
  const searchV2Url = new URL(SOUND_CLOUD_SEARCH_V2_URL);
  searchV2Url.searchParams.set("q", query);
  searchV2Url.searchParams.set("limit", "30");
  searchV2Url.searchParams.set("offset", "0");
  searchV2Url.searchParams.set("linked_partitioning", "1");
  if (clientId) searchV2Url.searchParams.set("client_id", clientId);
  const requestAttempts = [];
  if (accessToken) {
    requestAttempts.push({ label: "tracks_bearer", url: tracksUrl.toString(), authHeader: `Bearer ${accessToken}` });
    requestAttempts.push({ label: "tracks_oauth", url: tracksUrl.toString(), authHeader: `OAuth ${accessToken}` });
    requestAttempts.push({ label: "search_v2_bearer", url: searchV2Url.toString(), authHeader: `Bearer ${accessToken}` });
    requestAttempts.push({ label: "search_v2_oauth", url: searchV2Url.toString(), authHeader: `OAuth ${accessToken}` });
  }
  if (clientId) {
    requestAttempts.push({ label: "tracks_client_id", url: tracksUrl.toString(), authHeader: "" });
    requestAttempts.push({ label: "search_v2_client_id", url: searchV2Url.toString(), authHeader: "" });
  }
  if (!requestAttempts.length) {
    return { ok: false, status: 500, detail: "no_auth_credentials", collection: [] };
  }
  let lastStatus = 500;
  let lastDetail = "";
  let lastEndpoint = "";
  for (const attempt of requestAttempts) {
    const requestUrl = attempt.url;
    const headers = { Accept: "application/json" };
    if (attempt.authHeader) headers.Authorization = attempt.authHeader;
    try {
      const response = await fetch(requestUrl, { headers });
      if (response.ok) {
        const body2 = await parseJsonSafe(response);
        const collection = Array.isArray(body2) ? body2 : Array.isArray(body2?.collection) ? body2.collection : [];
        return { ok: true, status: response.status, detail: "", collection };
      }
      lastEndpoint = attempt.label || "unknown";
      lastStatus = Number(response.status) || 500;
      const body = await parseJsonSafe(response);
      lastDetail = sanitizeSoundCloudErrorDetail(body?.error_description || body?.error || body?.message || "");
    } catch (error) {
      lastEndpoint = attempt.label || "unknown";
      lastStatus = 502;
      const diagnostic = sanitizeSoundCloudErrorDetail(error?.message || error?.cause?.message || String(error || ""));
      lastDetail = diagnostic || "search_request_failed";
    }
  }
  return {
    ok: false,
    status: lastStatus,
    detail: sanitizeSoundCloudErrorDetail(`${lastDetail || "search_request_failed"}${lastEndpoint ? ` @ ${lastEndpoint}` : ""}`),
    collection: []
  };
}
__name(fetchSoundCloudTracks, "fetchSoundCloudTracks");
async function fetchSoundCloudPublicClientId(query) {
  const searchUrl = new URL(SOUND_CLOUD_PUBLIC_SEARCH_PAGE_URL);
  searchUrl.searchParams.set("q", query);
  try {
    const response = await fetch(searchUrl.toString(), { headers: { Accept: "text/html" } });
    if (!response.ok) return "";
    const html = await response.text();
    const match = html.match(/\"hydratable\":\"apiClient\",\"data\":\{\"id\":\"([A-Za-z0-9]+)\"/);
    return sanitizeText(match?.[1] || "", 120);
  } catch {
    return "";
  }
}
__name(fetchSoundCloudPublicClientId, "fetchSoundCloudPublicClientId");
async function handleAdminSoundCloudResolve(request, env) {
  const clientId = sanitizeText(env.SOUNDCLOUD_CLIENT_ID || "", 180);
  const clientSecret = sanitizeText(env.SOUNDCLOUD_CLIENT_SECRET || "", 220);
  if (!clientId) {
    return json({ error: "SoundCloud client id is not configured.", code: "soundcloud_not_configured", status: 500, detail: "missing_client_id", candidates: [] }, 500);
  }
  const url = new URL(request.url);
  const trackName = sanitizeText(url.searchParams.get("trackName") || "", 220);
  const artists = url.searchParams.getAll("artist").map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 6);
  const query = buildSoundCloudSearchQuery(trackName, artists);
  if (!query) return json({ error: "Track name is required.", code: "invalid_query", candidates: [] }, 400);
  let accessToken = "";
  if (clientSecret) {
    const tokenResult = await requestSoundCloudClientToken(clientId, clientSecret);
    if (!tokenResult.token) {
      return json({
        error: "Unable to get SoundCloud OAuth access token.",
        code: "soundcloud_token_failed",
        status: tokenResult.status || 500,
        detail: tokenResult.detail || "token_failed",
        query,
        candidates: []
      }, tokenResult.status || 500);
    }
    accessToken = tokenResult.token;
  }
  const searchResult = await fetchSoundCloudTracks({ query, clientId, accessToken });
  let effectiveSearchResult = searchResult;
  if (!effectiveSearchResult.ok && (effectiveSearchResult.status === 401 || effectiveSearchResult.status === 403)) {
    const publicClientId = await fetchSoundCloudPublicClientId(query);
    if (publicClientId && publicClientId !== clientId) {
      effectiveSearchResult = await fetchSoundCloudTracks({ query, clientId: publicClientId, accessToken: "" });
    }
  }
  if (!effectiveSearchResult.ok) {
    return json({
      error: "SoundCloud search request failed.",
      code: "soundcloud_search_failed",
      status: effectiveSearchResult.status || 500,
      detail: effectiveSearchResult.detail || "search_failed",
      query,
      candidates: []
    }, effectiveSearchResult.status || 500);
  }
  const collection = effectiveSearchResult.collection;
  const candidates = collection.map((track) => mapSoundCloudTrack(track, { trackName, artists })).filter(Boolean).sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    return right.durationMs - left.durationMs;
  }).slice(0, 5);
  if (!candidates.length) {
    return json({ error: "No SoundCloud match found for this queue track.", code: "soundcloud_not_found", status: 404, detail: "", query, candidates: [] }, 404);
  }
  const match = candidates[0];
  return json({
    query,
    match: {
      id: match.id,
      title: match.title,
      artist: match.artist,
      durationMs: match.durationMs,
      artworkUrl: match.artworkUrl,
      permalinkUrl: match.permalinkUrl,
      apiTrackUrl: match.apiTrackUrl
    },
    widgetSrc: buildSoundCloudWidgetSrc(match.permalinkUrl || match.apiTrackUrl),
    candidates: candidates.map((entry) => ({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      durationMs: entry.durationMs,
      artworkUrl: entry.artworkUrl,
      permalinkUrl: entry.permalinkUrl,
      apiTrackUrl: entry.apiTrackUrl
    }))
  });
}
__name(handleAdminSoundCloudResolve, "handleAdminSoundCloudResolve");
async function getSpotifyAccessToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return { error: json({ error: "Spotify credentials are not configured" }, 500), token: "" };
  }
  const auth = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!tokenResponse.ok) {
    return { error: json({ error: "Unable to retrieve Spotify token" }, tokenResponse.status), token: "" };
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return { error: json({ error: "Spotify token missing in response" }, 500), token: "" };
  }
  return { error: null, token: tokenData.access_token };
}
__name(getSpotifyAccessToken, "getSpotifyAccessToken");
async function handleSpotifySearch(request, env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return json({ error: "Search query is required" }, 400);
  const type = normalizeSpotifySearchType(url.searchParams.get("type"));
  const spotifyType = type === "all" ? "track,album,artist" : type;
  const limit = clampNumber(Number(url.searchParams.get("limit")) || 24, 1, 50);
  const offset = clampNumber(Number(url.searchParams.get("offset")) || 0, 0, 950);
  const tokenResult = await getSpotifyAccessToken(env);
  if (tokenResult.error) return tokenResult.error;
  const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${spotifyType}&limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${tokenResult.token}` }
  });
  if (!searchResponse.ok) return json({ error: "Spotify search request failed" }, searchResponse.status);
  const searchData = await searchResponse.json();
  const tracks = (searchData.tracks?.items || []).map((track) => ({
    kind: "track",
    id: track.id,
    name: track.name,
    artists: (track.artists || []).map((artist) => artist.name),
    albumName: track.album?.name || "",
    albumImage: track.album?.images?.[0]?.url || "",
    explicit: typeof track.explicit === "boolean" ? track.explicit : null,
    confidence: deriveContentConfidence(track.explicit),
    spotifyUrl: track.external_urls?.spotify || "",
    previewUrl: track.preview_url || ""
  }));
  const albums = (searchData.albums?.items || []).map((album) => ({
    kind: "album",
    id: album.id,
    name: album.name,
    artists: (album.artists || []).map((artist) => artist.name),
    albumName: album.name || "",
    albumImage: album.images?.[0]?.url || "",
    explicit: null,
    confidence: "unknown",
    spotifyUrl: album.external_urls?.spotify || "",
    previewUrl: "",
    releaseDate: album.release_date || "",
    totalTracks: Number(album.total_tracks || 0)
  }));
  const artists = (searchData.artists?.items || []).map((artist) => ({
    kind: "artist",
    id: artist.id,
    name: artist.name,
    artists: [artist.name],
    albumName: "",
    albumImage: artist.images?.[0]?.url || "",
    explicit: null,
    confidence: "unknown",
    spotifyUrl: artist.external_urls?.spotify || "",
    previewUrl: "",
    followers: Number(artist.followers?.total || 0)
  }));
  const trackTotal = Number(searchData.tracks?.total || 0);
  const albumTotal = Number(searchData.albums?.total || 0);
  const artistTotal = Number(searchData.artists?.total || 0);
  const trackHasMore = type !== "album" && type !== "artist" && offset + limit < trackTotal;
  const albumHasMore = type !== "track" && type !== "artist" && offset + limit < albumTotal;
  const artistHasMore = type !== "track" && type !== "album" && offset + limit < artistTotal;
  let items = [];
  if (type === "track") items = tracks;
  else if (type === "album") items = albums;
  else if (type === "artist") items = artists;
  else items = [...tracks, ...albums, ...artists];
  return json({
    items,
    tracks,
    albums,
    artists,
    page: {
      type,
      limit,
      offset,
      trackTotal,
      albumTotal,
      artistTotal,
      trackHasMore,
      albumHasMore,
      artistHasMore,
      hasMore: trackHasMore || albumHasMore || artistHasMore
    }
  });
}
__name(handleSpotifySearch, "handleSpotifySearch");
async function handleSpotifyAlbumTracks(request, env, rawAlbumId) {
  const albumId = sanitizeText(rawAlbumId, 100);
  if (!albumId) return json({ error: "Album id is required" }, 400);
  const tokenResult = await getSpotifyAccessToken(env);
  if (tokenResult.error) return tokenResult.error;
  const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`, {
    headers: { Authorization: `Bearer ${tokenResult.token}` }
  });
  if (!albumResponse.ok) return json({ error: "Unable to load album" }, albumResponse.status);
  const album = await albumResponse.json();
  const albumInfo = {
    id: album.id,
    name: album.name || "",
    artists: (album.artists || []).map((artist) => artist.name),
    image: album.images?.[0]?.url || "",
    spotifyUrl: album.external_urls?.spotify || "",
    releaseDate: album.release_date || "",
    totalTracks: Number(album.total_tracks || 0)
  };
  const tracks = [];
  let nextUrl = `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}/tracks?limit=50&offset=0`;
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${tokenResult.token}` }
    });
    if (!response.ok) return json({ error: "Unable to load album tracks" }, response.status);
    const page = await response.json();
    (page.items || []).forEach((track) => {
      tracks.push({
        kind: "track",
        id: track.id || `${albumId}:${track.track_number}`,
        name: track.name || "",
        artists: (track.artists || []).map((artist) => artist.name),
        albumName: albumInfo.name,
        albumImage: albumInfo.image,
        explicit: typeof track.explicit === "boolean" ? track.explicit : null,
        confidence: deriveContentConfidence(track.explicit),
        spotifyUrl: track.external_urls?.spotify || "",
        previewUrl: track.preview_url || "",
        trackNumber: Number(track.track_number || 0)
      });
    });
    nextUrl = page.next || "";
  }
  return json({ album: albumInfo, items: tracks });
}
__name(handleSpotifyAlbumTracks, "handleSpotifyAlbumTracks");
function requireAdmin(request, env) {
  if (!getAdminCredentials(env)) return adminCredentialsMissingResponse();
  if (!isAdminAuthorized(request, env)) return unauthorizedResponse();
  return null;
}
__name(requireAdmin, "requireAdmin");
function getPacificDateParts(dateValue = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const map = {};
  formatter.formatToParts(dateValue).forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  return {
    year: Number(map.year || 0),
    month: Number(map.month || 0),
    day: Number(map.day || 0),
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
    second: Number(map.second || 0)
  };
}
__name(getPacificDateParts, "getPacificDateParts");
function createNightlyDateKey(dateValue = /* @__PURE__ */ new Date()) {
  const pacific = getPacificDateParts(dateValue);
  const year = String(pacific.year).padStart(4, "0");
  const month = String(pacific.month).padStart(2, "0");
  const day = String(pacific.day).padStart(2, "0");
  return `${year}${month}${day}`;
}
__name(createNightlyDateKey, "createNightlyDateKey");
function shouldRunNightlyBenchmark(dateValue, env) {
  if (String(env?.ENABLE_NIGHTLY_BENCHMARK || "") !== "1") return false;
  if (String(env?.DISABLE_NIGHTLY_BENCHMARK || "") === "1") return false;
  const pacific = getPacificDateParts(dateValue);
  return pacific.hour === 3;
}
__name(shouldRunNightlyBenchmark, "shouldRunNightlyBenchmark");
function seededShuffle(list, seedText) {
  const items = [...list];
  let seed = 0;
  String(seedText || "").split("").forEach((char) => {
    seed = seed * 31 + char.charCodeAt(0) >>> 0;
  });
  if (!seed) seed = 123456789;
  const next = /* @__PURE__ */ __name(() => {
    seed = 1664525 * seed + 1013904223 >>> 0;
    return seed / 4294967296;
  }, "next");
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    const temp = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = temp;
  }
  return items;
}
__name(seededShuffle, "seededShuffle");
async function ensureNightlyBenchmarkTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS nightly_benchmark_runs (
      run_key TEXT PRIMARY KEY,
      run_at TEXT NOT NULL,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      approved_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      cleaned_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )`
  ).run();
}
__name(ensureNightlyBenchmarkTable, "ensureNightlyBenchmarkTable");
async function runNightlyBenchmark(env, scheduledAt = /* @__PURE__ */ new Date()) {
  const runAt = scheduledAt instanceof Date ? scheduledAt : new Date(String(scheduledAt || ""));
  if (!shouldRunNightlyBenchmark(runAt, env)) {
    return { skipped: true, reason: "outside_3am_pacific_window" };
  }
  await ensureNightlyBenchmarkTable(env);
  const runKey = createNightlyDateKey(runAt);
  const existing = await env.DB.prepare("SELECT run_key FROM nightly_benchmark_runs WHERE run_key = ?").bind(runKey).first();
  if (existing?.run_key) {
    return { skipped: true, reason: "already_ran_today", runKey };
  }
  const playlist = seededShuffle(NIGHTLY_BENCHMARK_SONG_POOL, runKey).slice(0, 12);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let insertedCount = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  for (let index = 0; index < playlist.length; index += 1) {
    const song = playlist[index];
    const trackId = `nightly-eval-${runKey}-${index + 1}`;
    const artists = [song.artist];
    const contentConfidence = deriveContentConfidence(song.explicit);
    const autoDecision = await getAutoModerationDecision({
      trackName: song.name,
      artists,
      contentConfidence,
      env
    });
    const requesters = [buildRequesterEntry({
      requesterName: "Nightly Benchmark Bot",
      requesterRole: "admin",
      customMessage: "nightly_benchmark_autogen",
      dedicationMessage: "",
      submittedAt: nowIso
    })];
    const priorityScore = calculatePriorityScore({
      voteCount: 1,
      requesterRoles: ["admin"],
      eventDate: null,
      contentConfidence,
      danceMoment: "anytime",
      energyLevel: 3
    });
    const nextSetOrder = autoDecision.status === "rejected" ? null : await getMaxActiveSetOrder(env) + 1;
    await env.DB.prepare(
      `INSERT INTO requests
        (track_id, track_name, artists, album_name, album_image, spotify_url,
         requester_name, requester_role, custom_message, dedication_message,
         event_date, explicit_flag, content_confidence, dance_moment, energy_level, vibe_tags,
         vote_count, requesters_json, priority_score, status, review_note, moderation_reason, dj_notes, set_order, submitted_at)
       VALUES (?, ?, ?, '', '', '', ?, ?, ?, '', NULL, ?, ?, 'anytime', 3, '[]', 1, ?, ?, ?, ?, ?, '', ?, ?)`
    ).bind(
      trackId,
      song.name,
      JSON.stringify(artists),
      "Nightly Benchmark Bot",
      "admin",
      "nightly_benchmark_autogen",
      song.explicit ? 1 : 0,
      contentConfidence,
      JSON.stringify(requesters),
      priorityScore,
      autoDecision.status,
      autoDecision.reviewNote,
      autoDecision.moderationReason,
      nextSetOrder,
      nowIso
    ).run();
    insertedCount += 1;
    if (autoDecision.status === "approved") approvedCount += 1;
    else if (autoDecision.status === "pending") pendingCount += 1;
    else rejectedCount += 1;
  }
  await renumberActiveQueue(env);
  const cleanupResult = await env.DB.prepare(
    "DELETE FROM requests WHERE track_id LIKE ? AND custom_message = 'nightly_benchmark_autogen'"
  ).bind(`nightly-eval-${runKey}-%`).run();
  await renumberActiveQueue(env);
  const cleanedCount = Number(cleanupResult.meta?.changes || 0);
  const notes = `seed=${runKey}; inserted=${insertedCount}; cleaned=${cleanedCount}`;
  await env.DB.prepare(
    `INSERT INTO nightly_benchmark_runs
      (run_key, run_at, inserted_count, approved_count, pending_count, rejected_count, cleaned_count, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(runKey, nowIso, insertedCount, approvedCount, pendingCount, rejectedCount, cleanedCount, notes).run();
  return {
    skipped: false,
    runKey,
    insertedCount,
    approvedCount,
    pendingCount,
    rejectedCount,
    cleanedCount
  };
}
__name(runNightlyBenchmark, "runNightlyBenchmark");
var worker_default = {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env.ALLOWED_ORIGIN || "*");
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), corsHeaders);
    }
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        return withCors(json({ ok: true, service: "music-queue-api" }), corsHeaders);
      }
      const routePath = url.pathname.startsWith("/api/dj/") ? `/api/admin/${url.pathname.slice("/api/dj/".length)}` : url.pathname;
      if (request.method === "POST" && routePath === "/api/admin/login") {
        return withCors(await handleAdminLogin(request, env), corsHeaders);
      }
      if (request.method === "GET" && routePath === "/api/admin/session") {
        return withCors(await handleAdminSession(request, env), corsHeaders);
      }
      if (request.method === "GET" && routePath === "/api/admin/queue") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminGetQueue(request, env), corsHeaders);
      }
      if (request.method === "PATCH" && routePath.startsWith("/api/admin/queue/")) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = routePath.split("/").pop();
        return withCors(await handleAdminUpdateQueue(request, env, id), corsHeaders);
      }
      if (request.method === "POST" && routePath === "/api/admin/bulk") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminBulkAction(request, env), corsHeaders);
      }
      if (request.method === "POST" && routePath === "/api/admin/reorder") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminReorder(request, env), corsHeaders);
      }
      if (request.method === "POST" && routePath === "/api/admin/control") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminControl(request, env), corsHeaders);
      }
      if (request.method === "GET" && routePath === "/api/admin/analytics") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetAdminAnalytics(env), corsHeaders);
      }
      if (request.method === "GET" && routePath === "/api/admin/soundcloud/resolve") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminSoundCloudResolve(request, env), corsHeaders);
      }
      if (request.method === "GET" && url.pathname === "/api/public/queue") {
        return withCors(await handleGetPublicQueue(request, env), corsHeaders);
      }
      if (request.method === "GET" && url.pathname === "/api/public/feed") {
        return withCors(await handleGetPublicFeed(env), corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/public/request") {
        return withCors(await handleCreateRequest(request, env), corsHeaders);
      }
      if (request.method === "GET" && (url.pathname === "/api/public/spotify/search" || url.pathname === "/api/spotify/search")) {
        return withCors(await handleSpotifySearch(request, env), corsHeaders);
      }
      if (request.method === "GET" && (url.pathname.startsWith("/api/public/spotify/album/") || url.pathname.startsWith("/api/spotify/album/")) && url.pathname.endsWith("/tracks")) {
        const parts = url.pathname.split("/");
        const albumId = parts[parts.length - 2] || "";
        return withCors(await handleSpotifyAlbumTracks(request, env, albumId), corsHeaders);
      }
      if (request.method === "POST" && url.pathname === "/api/queue") {
        return withCors(await handleCreateRequest(request, env), corsHeaders);
      }
      if (request.method === "GET" && url.pathname === "/api/queue") {
        if (isAdminAuthorized(request, env)) {
          return withCors(await handleAdminGetQueue(request, env), corsHeaders);
        }
        return withCors(await handleGetPublicQueue(request, env), corsHeaders);
      }
      if (request.method === "PATCH" && url.pathname.startsWith("/api/queue/")) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = url.pathname.split("/").pop();
        return withCors(await handleAdminUpdateQueue(request, env, id), corsHeaders);
      }
      if (request.method === "GET" && url.pathname === "/api/analytics") {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetAdminAnalytics(env), corsHeaders);
      }
      return withCors(json({ error: "Not found" }, 404), corsHeaders);
    } catch (error) {
      const message = String(error?.message || "Unhandled error");
      const isMigrationError = /no such column|no such table/i.test(message);
      const response = isMigrationError ? json({ error: "Database schema is outdated. Run D1 migrations and retry." }, 500) : json({ error: message }, 500);
      return withCors(response, corsHeaders);
    }
  },
  async scheduled(controller, env, context) {
    const scheduledAt = controller?.scheduledTime ? new Date(controller.scheduledTime) : /* @__PURE__ */ new Date();
    context.waitUntil(runNightlyBenchmark(env, scheduledAt));
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-Mmaisl/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Mmaisl/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
