# DeciResearch v5 - Autonomous Crypto Intelligence Bot

Post smart crypto analysis to Twitter 4x per day, automatically.

## Features

✨ **Core Market Research**
- Fetches top tokens by volume (CoinGecko + DEXScreener)
- Deterministic scoring (volume, momentum, market cap)
- Claude Haiku analysis (balanced takes on every token)
- Automated posting 4x/day (6am, 12pm, 6pm, 10pm UTC)
- Intelligence context: powered by 50+ credible accounts

🧠 **Self-Expanding Intelligence Network**
- Monitors 50+ tracked accounts 24/7
- Auto-discovers new credible accounts from network mentions
- LLM-powered categorization (TECHNICAL, NARRATIVE, SMART_MONEY, MARKET_STRUCTURE)
- Smart approval gating (2-run confirmation before adding)
- Semantic embeddings: every tweet searchable by meaning
- RAG synthesis: tweets backed by collective intelligence

💬 **Community Engagement**
- Mentions listener: catches @deciresearch tags
- Auto-reply engine: synthesizes answers from knowledge base
- Account nomination system: community crowdsources research
- Question answering: queries network for relevant context

🛡️ **Safety & Reliability**
- Scam detector (honeypots, new contracts, extreme volatility)
- Tweet safety checks (banned phrases, uniqueness, spacing)
- Error recovery: automatic retry with exponential backoff + circuit breaker
- Rate limiting: consolidated manager for all APIs
- Comprehensive logging with early warnings at 80% usage

📊 **Monitoring & Insights**
- Network health monitor (account distribution, credibility trends)
- Insights API: query what network knows about any topic
- REST API: `/health`, `/metrics`, `/dashboard`, `/discovery`
- CLI tool: `status`, `metrics`, `config`, `db:*`
- Real-time performance tracking

⚙️ **Configuration**
- All settings in code (no magic env vars beyond keys)
- Per-component config (rate limits, discovery thresholds, schedules)
- Feature flags (validation, analytics, dry-run)
- Production setup guide (Supabase, deployment, troubleshooting)

## Quick Start

### 1. Production Setup
**See [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md) for detailed deployment instructions** including:
- Supabase database setup (with pgvector)
- Environment variable configuration
- Dry-run testing
- VPS/Docker deployment options
- Monitoring & troubleshooting

### 2. Quick Start (Local Testing)
```bash
# Clone and install
gh repo clone Rob650/deciresearch-v5
cd deciresearch-v5
npm install

# Add your API keys
cp .env.example .env
# Edit .env with your Twitter, Anthropic, OpenAI, and Supabase keys
```

### 3. Test Run
```bash
# Start the bot (posts to Twitter on schedule)
npm run dev

# In another terminal, check status
npm run cli status
```

### 4. Monitor
```bash
# View live dashboard
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
