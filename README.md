# Receipts Hackathon Demo

Receipts tracks public investment calls from influencers, celebrities, and strategists, then calculates simple return since the call.

## Run

```powershell
npm start
```

Open `http://localhost:5177`.

## Deploy to Vercel

```powershell
npx vercel --prod --yes --token $env:VERCEL_TOKEN
```

## Optional API Keys

The demo works without keys by using seed data and public web search fallback. Later, add these to `.env` or your shell:

```powershell
$env:X_BEARER_TOKEN="..."
$env:TELEGRAM_API_ID="..."
$env:TELEGRAM_API_HASH="..."
$env:BRAVE_SEARCH_API_KEY="..."
```

The current build has clean extension points in `src/server.js` for X, Telegram, and paid search APIs.
