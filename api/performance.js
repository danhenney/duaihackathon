import { fallbackCurrentPrice, fallbackEntryPrice } from "./_core.js";

export default function handler(request, response) {
  const symbol = request.body?.symbol;
  const entryPrice = Number(request.body?.entryPrice ?? fallbackEntryPrice(symbol));
  const currentPrice = Number(request.body?.currentPrice ?? fallbackCurrentPrice(symbol));
  const returnPct = Number.isFinite(entryPrice) && Number.isFinite(currentPrice) && entryPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : null;

  response.status(200).json({
    symbol,
    entryPrice,
    currentPrice,
    returnPct,
    priceSource: "seed_or_live_fallback",
    fallbackUsed: true
  });
}
