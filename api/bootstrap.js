import { assets, people, seedCalls, enrichCalls } from "./_core.js";
import { getStoredCalls } from "../src/db.js";

export default async function handler(_request, response) {
  const storedCalls = await getStoredCalls();
  const dedupedCalls = [...new Map([...seedCalls, ...storedCalls].map((call) => [call.id, call])).values()];
  const calls = (await enrichCalls(dedupedCalls)).sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0));
  response.status(200).json({ people, assets, calls });
}
