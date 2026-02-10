# DeciResearch v5 - Autonomous Crypto Intelligence Bot

Post smart crypto analysis to Twitter 4x per day, automatically.

## Features

✨ **Core**
- Fetches top 50 tokens by volume (CoinGecko + DEXScreener)
- Deterministic scoring (volume, momentum, market cap)
- Claude Haiku analysis (2 sentences per token)
- Automated posting 4x/day (6am, 12pm, 6pm, 10pm UTC)

🛡️ **Safety & Reliability**
- Scam detector (filters honeypots, new contracts, suspicious holders)
- Tweet safety checks (banned phrases, uniqueness)
- Automatic retry with exponential backoff
- Circuit breaker pattern for failing services
- Rate limiting (10 LLM calls/hour, 40 tweets/day)

📊 **Monitoring & Control**
- REST API for metrics and health checks
- CLI tool for manual control
- Live ASCII dashboard
- Tweet performance analytics
- Real-time health metrics

⚙️ **Configuration**
- All settings configurable without code changes
- Environment-based secrets
- Per-run limits and thresholds
- Feature flags (validation, analytics, dry-run mode)

## Quick Start

### 1. Setup
```bash
# Clone and install
gh repo clone Rob650/deciresearch-v5
cd deciresearch-v5
npm install

# Add your API keys
cp .env.example .env
# Edit .env with your keys
```

### 2. Run
```bash
# Start the bot
npm run dev

# In another terminal, check status
npm run cli status
```

### 3. Monitor
```bash
# View dashboard
curl http://localhost:3000/dashboard

# Check metrics
curl http://localhost:3000/metrics

# Health check
curl http://localhost:3000/health
```

## CLI Commands

```bash
npm run cli status           # Live dashboard
npm run cli metrics         # Detailed metrics
npm run cli config          # Show configuration
npm run cli db:tokens 20    # Show last 20 tokens
npm run cli db:tweets 10    # Show last 10 tweets
npm run cli db:clear        # Clear database
```

## REST API (Port 3000)

```bash
GET /health      # Health status (returns 200 if healthy, 503 if degraded)
GET /metrics     # Full metrics JSON
GET /dashboard   # ASCII dashboard (text/plain)
GET /config      # Current configuration (keys redacted)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- Complete system design
- Module descriptions
- Data flow diagrams
- Database schema
- Rate limits and costs

## Configuration

Create `.env` from `.env.example`:
```env
ANTHROPIC_API_KEY=sk-ant-...
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
COINGECKO_API_KEY=...  # optional
```

## Cost & Performance

**Daily Cost**: ~$0.12/day (~$3.60/month)
- Claude Haiku: $0.002/call × 20 calls = $0.04/day
- Twitter API: Free (under 500K tweets/month)
- CoinGecko: Free

**Rate Limits**: Never exceeded
- 10 LLM calls/hour (20 used daily)
- 40 tweets/day (4 used daily)
- 15 min minimum between tweets

**Response Time**: < 5 minutes per cycle
- Data collection: ~1 sec
- Scoring: ~50 ms
- LLM analysis: ~4 min (5 calls × 20s wait)
- Posting: ~1 sec per tweet

## Safety Features

1. **Scam Detection**
   - Blocks tokens < 7 days old
   - Detects honeypots (volume/mcap ratio)
   - Flags extreme holder concentration
   - Rejects suspicious volatility patterns

2. **Twitter Safety**
   - Blocks banned phrases (NFA, guaranteed, buy now, moon, etc.)
   - Checks uniqueness before posting
   - Enforces 15-minute minimum spacing
   - Never posts duplicate content

3. **Operational Safety**
   - Automatic retry on failures
   - Circuit breaker for broken services
   - Health monitoring with alerts
   - Graceful degradation

## Schedule

Runs automatically 4x per day (UTC):
- **6:00 AM** - Early market briefing
- **12:00 PM** - Midday update
- **6:00 PM** - Evening alpha
- **10:00 PM** - Night roundup

Custom schedules available via config.

## Database

SQLite database stores:
- Analyzed tokens (symbol, price, volume, market cap, analysis, score)
- Posted tweets (content, ID, timestamp)
- Tweet analytics (likes, retweets, impressions, engagement)

Default location: `deciresearch.db`

## Troubleshooting

**Bot not posting?**
```bash
npm run cli status   # Check health
npm run cli metrics  # View latest activity
curl http://localhost:3000/health
```

**API keys missing?**
```bash
cat .env
# Verify all required keys are present and valid
```

**Database issues?**
```bash
npm run cli db:clear --confirm   # Start fresh
```

## Next Steps

- [ ] Add web dashboard (Next.js)
- [ ] Multi-exchange data (Uniswap, Raydium)
- [ ] Sentiment analysis from Twitter/Discord
- [ ] ML-based tweet optimization
- [ ] Webhook notifications
- [ ] Portfolio tracking
