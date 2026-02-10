# DeciResearch v5 - Day 1 MVP

Autonomous crypto intelligence bot posting alpha to Twitter @deciresearch

## Features

- Fetches top 50 tokens by volume from CoinGecko
- Tracks trending tokens from DEXScreener
- Deterministic scoring algorithm
- Claude Haiku analysis of top 5 tokens per run
- Automated Twitter posting 4x/day
- Rate limiting and safety filters

## Setup

1. Clone repo
2. `npm install`
3. Copy `.env.example` to `.env` and add API keys
4. `npm run dev`

## Architecture

- Data collection: CoinGecko + DEXScreener
- Storage: SQLite
- Analysis: Claude Haiku (max 10 calls/hour)
- Publishing: Twitter API (max 40 tweets/day)

## Schedule (UTC)

- 6:00 AM - Market briefing
- 12:00 PM - Midday update
- 6:00 PM - Alpha signal
- 10:00 PM - Evening roundup
