import { ingestTrackedX } from "./_core.js";
import { saveLiveSearchResult } from "../src/db.js";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.authorization || "";
  const headerSecret = request.headers["x-cron-secret"] || "";
  const querySecret = request.query?.secret || "";
  return auth === `Bearer ${secret}` || headerSecret === secret || querySecret === secret;
}

function parseHandles(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.startsWith("@") ? item : `@${item}`);
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(request)) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const query = request.query || {};
  const body = request.method === "POST" ? (request.body || {}) : {};
  const handles = parseHandles(body.handles || query.handles || "");
  const limit = Math.max(1, Math.min(12, Number(body.limit || query.limit || 8)));
  const mode = body.mode || query.mode || "standard";
  const dryRun = String(body.dryRun ?? query.dryRun ?? "false") === "true";

  const ingested = await ingestTrackedX({ handles, limit, mode });
  const saved = dryRun
    ? { savedCalls: 0, savedCandidates: 0, dryRun: true }
    : await saveLiveSearchResult({
      query: handles.length ? handles.join(",") : "tracked-x",
      candidates: ingested.candidates,
      calls: ingested.calls
    });

  response.status(200).json({
    ok: true,
    dryRun,
    saved,
    meta: ingested.meta,
    handles: ingested.handles,
    calls: ingested.calls.map((call) => ({
      id: call.id,
      personId: call.personId,
      symbol: call.symbol,
      calledAt: call.calledAt,
      sourceUrl: call.sourceUrl,
      status: call.status,
      confidence: call.confidence
    }))
  });
}
