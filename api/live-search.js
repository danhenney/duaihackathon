import { liveSearch, viralPostFallback } from "./_core.js";
import { saveLiveSearchResult } from "../src/db.js";

export default async function handler(request, response) {
  const query = request.body?.query || "";
  const result = await liveSearch(query, { mode: request.body?.mode || "standard" });
  const dbResult = await saveLiveSearchResult({
    query,
    candidates: result.candidates,
    calls: result.calls
  });
  response.status(200).json({
    query,
    status: "completed",
    usedFallback: result.candidates.some((item) => viralPostFallback.includes(item)),
    db: dbResult,
    ...result
  });
}
