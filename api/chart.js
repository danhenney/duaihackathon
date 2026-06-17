import { fetchYahooChart } from "./_core.js";

export default async function handler(request, response) {
  const symbol = request.query.symbol;
  const range = request.query.range || "all";
  if (!symbol) {
    response.status(400).json({ error: "symbol is required" });
    return;
  }

  try {
    const chart = await fetchYahooChart(symbol, range);
    response.status(200).json(chart);
  } catch (error) {
    response.status(502).json({
      error: error.message,
      symbol,
      range,
      source: "Yahoo Finance"
    });
  }
}
