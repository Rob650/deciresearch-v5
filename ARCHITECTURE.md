# DeciResearch v5 - Architecture & Features

## System Overview

DeciResearch v5 is a production-grade crypto intelligence bot that automatically analyzes trending tokens and posts insights to Twitter 4x per day.

```
DATA COLLECTION          ANALYSIS              PUBLISHING
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│ CoinGecko       │────▶│ Scorer       │────▶│ Validator    │
│ DEXScreener     │     │ (no AI)      │     │              │
└─────────────────┘     └──────────────┘     └──────────────┘
                             │
                             ▼
                        ┌──────────────┐
                        │ Claude       │
                        │ Haiku LLM    │
                        │ (5 max/run)  │
                        └──────────────┘
                             │
                             ▼
                        ┌──────────────┐     ┌──────────────┐
                        │ Composer     │────▶│ Twitter API  │
                        │              │     │              │
                        └──────────────┘     └──────────────┘
                             │
                             ▼
                        ┌──────────────┐
                        │ Analytics    │
                        │ & Monitoring │
                        └──────────────┘
```

## Core Modules

### 1. Data Collection (`src/collectors/`)
- **coingecko.ts**: Fetches top 50 tokens by 24h volume
- **dexscreener.ts**: Fetches trending tokens from DEX pools

### 2. Analysis Pipeline (`src/analyzers/`)
- **scorer.ts**: Pure-math deterministic token scoring (0-100)
  - Volume score (0-30)
  - Price momentum (0-30)
  - Market cap score (0-20)
  - 7-day trend (0-20)
- **claude.ts**: Claude Haiku AI analysis (2 sentences per token)
- **enhanced.ts**: Rich metrics extraction (volatility, liquidity, age, concentration)

### 3. Validation Layer (`src/shared/validator.ts`)
Prevents posting about scams/shitcoins:
- ✗ Tokens < 7 days old
- ✗ 2x+ volume-to-market-cap ratio (pump signals)
- ✗ >150% volatility in 24h
- ✗ >50% holder concentration
- ✗ Extreme price moves (>200% in 24h)

### 4. Publishing (`src/publisher/`)
- **composer.ts**: Formats tweet text with data
- **poster.ts**: Posts to Twitter with safety checks
- **safety.ts**: Blocks banned phrases (nfa, guaranteed, to the moon, etc.)
- **analytics.ts**: Tracks tweet performance metrics

### 5. Infrastructure

#### Rate Limiting (`src/shared/rate-limiter.ts`)
- Hard cap: 10 LLM calls/hour
- 20-second wait between calls
- Circuit breaker on 429 errors

#### Resilience (`src/shared/resilience.ts`)
- Automatic retry with exponential backoff
- Circuit breaker pattern for failing services
- Batch processing with concurrency control

#### Monitoring (`src/shared/monitor.ts`)
- Real-time health metrics
- Performance tracking (latency percentiles)
- Live ASCII dashboard

#### Config (`src/shared/config.ts`)
All settings configurable without code changes:
```typescript
maxTokensPerRun: 5
maxLLMCallsPerHour: 10
maxTweetsPerDay: 40
minVolumeUSD: 100000
maxVolatilityPercent: 150
```

### 6. APIs & Control

#### REST API (`src/api.ts`) - Port 3000
```
GET /health      - Basic health check
GET /metrics     - Full metrics JSON
GET /dashboard   - ASCII dashboard (text/plain)
GET /config      - Current config (redacted)
```

#### CLI Tool (`src/cli.ts`)
```bash
npm run cli status           # Live dashboard
npm run cli metrics         # Detailed metrics
npm run cli config          # Show configuration
npm run cli db:tokens 20    # Last 20 tokens
npm run cli db:tweets 10    # Last 10 tweets
npm run cli db:clear        # Clear database
```

## Data Flow

1. **Collection** (0ms, no AI)
   - CoinGecko top 50 + DEXScreener trending
   - Filter by volume, liquidity, volatility

2. **Validation** (0ms, no AI)
   - Check for scams, honeypots, suspicious patterns
   - Assign safety score

3. **Scoring** (0ms, no AI)
   - Deterministic algorithm based on volume, momentum, market cap
   - Sort and pick top 5

4. **Analysis** (4-5 min total, AI)
   - Claude Haiku analyzes each token (2 sentences)
   - 20s wait between calls (rate limiting)
   - Max 5 LLM calls per run

5. **Publishing** (< 1 sec per tweet)
   - Compose tweet with data
   - Safety check (banned words, uniqueness, spam)
   - Post to Twitter
   - Record analytics

6. **Monitoring**
   - Track performance metrics
   - Monitor success rates
   - Alert on errors

## Scheduling

Runs automatically 4x per day (UTC):
- **6:00 AM** - Early market briefing
- **12:00 PM** - Midday update
- **6:00 PM** - Evening alpha
- **10:00 PM** - Night roundup

## Cost & Rate Limits

### API Costs
- **Claude Haiku**: ~$0.002 per call → ~$0.04/day (20 calls)
- **Twitter API v2**: Free tier (500K tweets/month limit)
- **CoinGecko**: Free tier (10-50 calls/min)
- **Total**: ~$1.20/month

### Rate Limits (Never Hit)
- LLM: 10 calls/hour → 20 calls/day used
- Twitter: 40 tweets/day max (4 runs × 1 tweet each)
- Posting: Min 15 minutes between tweets

## Safety Features

1. **Token Validation**: Scam detector blocks shitcoins
2. **Tweet Safety**: Banned phrases, uniqueness check
3. **Rate Limiting**: Never exceeds API quotas
4. **Error Handling**: Automatic retry with backoff
5. **Monitoring**: Real-time health dashboard
6. **Circuit Breaker**: Stops spamming failing services

## Database Schema

```sql
-- Tokens
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  price REAL,
  volume24h REAL,
  marketCap REAL,
  priceChange24h REAL,
  priceChange7d REAL,
  score REAL,
  analysis TEXT,
  timestamp INTEGER
);

-- Tweets
CREATE TABLE tweets (
  id INTEGER PRIMARY KEY,
  content TEXT,
  tweetId TEXT,
  postedAt INTEGER
);

-- Analytics
CREATE TABLE tweet_analytics (
  tweetId TEXT PRIMARY KEY,
  likes INTEGER,
  retweets INTEGER,
  replies INTEGER,
  impressions INTEGER,
  engagementRate REAL,
  lastUpdated INTEGER
);
```

## Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...          # Claude API
COINGECKO_API_KEY=cg_...              # Optional, increases rate limit
TWITTER_API_KEY=...                   # Twitter v2
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
TWITTER_BEARER_TOKEN=...
```

## Development

### Build
```bash
npm install
npm run build
```

### Run
```bash
npm run dev              # Start bot with cron scheduler
npm run cli status      # Check status
npm run cli metrics     # View metrics
```

### Monitor
```bash
curl http://localhost:3000/health
curl http://localhost:3000/metrics
curl http://localhost:3000/dashboard
```

## Next Steps

Potential enhancements:
- [ ] Web dashboard (Next.js)
- [ ] Multi-exchange data (Uniswap, Raydium)
- [ ] Sentiment analysis (social media)
- [ ] Portfolio tracking
- [ ] Webhook notifications
- [ ] Machine learning for tweet optimization
- [ ] A/B testing framework
