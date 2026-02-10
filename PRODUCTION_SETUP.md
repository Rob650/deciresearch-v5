# DeciResearch v5 - Production Setup Guide

This guide walks you through deploying DeciResearch v5 to production.

---

## Prerequisites

- Node.js 18+
- Existing API keys for:
  - **Twitter API v2** (elevated access for streaming)
  - **Anthropic** (Claude API)
  - **OpenAI** (embeddings API)
  - **Supabase** (PostgreSQL + pgvector)

---

## Step 1: Supabase Setup (Database)

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create new project (free tier works fine)
3. Wait for provisioning (~2 min)
4. Copy: `Project URL` and `Anon Key` (from Settings > API)

### 1.2 Create Tables

In your Supabase project, go to **SQL Editor** and run:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Tracked accounts table
CREATE TABLE IF NOT EXISTS tracked_accounts (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  credibility_score REAL DEFAULT 50,
  follower_count INTEGER,
  engagement_rate REAL,
  accuracy_score REAL DEFAULT 50,
  tags TEXT[] DEFAULT '{}',
  added_at BIGINT,
  last_updated BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tweets table (with embeddings)
CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  tweet_id TEXT,
  handle TEXT NOT NULL,
  text TEXT,
  embedding vector(1536),
  timestamp BIGINT,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  sentiment TEXT,
  topics TEXT[] DEFAULT '{}',
  credibility_at_time REAL,
  stored_at BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Discovery candidates table
CREATE TABLE IF NOT EXISTS discovery_candidates (
  handle TEXT PRIMARY KEY,
  score REAL,
  category TEXT,
  reason TEXT,
  last_seen BIGINT,
  confirmation_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'suggested',
  updated_at BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Discovery runs log
CREATE TABLE IF NOT EXISTS discovery_runs (
  id BIGSERIAL PRIMARY KEY,
  found INTEGER,
  added INTEGER,
  approved INTEGER,
  timestamp BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_tweets_embedding ON tweets USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_tweets_handle ON tweets(handle);
CREATE INDEX idx_tweets_timestamp ON tweets(timestamp DESC);
CREATE INDEX idx_accounts_credibility ON tracked_accounts(credibility_score DESC);
CREATE INDEX idx_accounts_category ON tracked_accounts(category);
CREATE INDEX idx_discovery_status ON discovery_candidates(status);
```

---

## Step 2: Environment Setup

### 2.1 Copy .env Template
```bash
cd ~/deciresearch-v5
cp .env.example .env
```

### 2.2 Fill in API Keys

Edit `.env`:

```env
# Twitter API v2
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# LLM APIs
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_key

# Optional: CoinGecko (increases rate limit)
COINGECKO_API_KEY=your_key_here
```

### 2.3 Get Twitter API Keys

If you don't have them:
1. Go to [Twitter Developer Portal](https://developer.twitter.com)
2. Create app (if needed)
3. Go to Keys & Tokens
4. Generate new tokens (or use existing)
5. Make sure you have **v2 API access** (elevated)
6. Copy all 5 keys

### 2.4 Verify All Keys

```bash
# Quick test (doesn't make real API calls)
cat .env | grep -E "TWITTER|ANTHROPIC|OPENAI|SUPABASE"
# Should show all 9 keys filled
```

---

## Step 3: Install Dependencies

```bash
npm install
```

This installs:
- `@anthropic-ai/sdk` - Claude API
- `openai` - OpenAI embeddings
- `@supabase/supabase-js` - Database
- `twitter-api-v2` - Twitter API
- `node-cron` - Scheduling
- And more...

---

## Step 4: Build & Test

### 4.1 Compile TypeScript
```bash
npm run build
```

### 4.2 Test Dry Run
```bash
# Set dry-run mode to prevent actual tweets
export DRY_RUN=true
npm run dev
```

Watch logs:
- Should connect to Twitter API ✅
- Should initialize vector DB ✅
- Should start listener on 50 accounts ✅
- Should schedule cron jobs ✅
- Should NOT post to Twitter (dry-run mode) ✅

If you see errors:
- Check API keys in .env
- Check Supabase tables exist
- Check internet connection

### 4.3 Check Logs

Look for:
```
✓ DeciResearch v5 started
✓ Intelligence network started
✓ Discovery scheduler started
✓ Mention listener started
```

If you see warnings, it's usually OK (rate limiting, retry logic, etc.).

---

## Step 5: Go Live

Once dry-run looks good:

### 5.1 Remove Dry-Run
```bash
# Remove/comment out DRY_RUN=true from .env or remove the flag
npm run dev
```

### 5.2 Verify First Post

Wait for next scheduled time:
- 6am UTC
- 12pm UTC
- 6pm UTC
- 10pm UTC

Or manually trigger (in another terminal):
```bash
npm run cli dev
# Then after it starts, in another terminal:
npm run cli status
```

Check Twitter - should see research post from @deciresearch.

---

## Step 6: Production Deployment Options

### Option A: Local (Simple)
Run on your machine:
```bash
nohup npm run dev > deciresearch.log 2>&1 &
tail -f deciresearch.log
```

### Option B: VPS (Recommended)
1. SSH into VPS (DigitalOcean, Linode, etc.)
2. Install Node.js 18+
3. Clone repo
4. Add .env with keys
5. Run with PM2:

```bash
npm install -g pm2
pm2 start "npm run dev" --name deciresearch
pm2 save
pm2 startup
```

Monitor:
```bash
pm2 logs deciresearch
pm2 status
```

### Option C: Docker
Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
```

Build & run:
```bash
docker build -t deciresearch .
docker run -e TWITTER_API_KEY=... -e ANTHROPIC_API_KEY=... deciresearch
```

---

## Step 7: Monitoring

### Check Health
```bash
# CLI
npm run cli status
npm run cli metrics

# REST API (runs on port 3000)
curl http://localhost:3000/health
curl http://localhost:3000/dashboard
```

### View Logs
```bash
# If running with PM2
pm2 logs deciresearch

# If running locally
npm run dev 2>&1 | tee deciresearch.log
```

### Key Metrics to Watch
- **Network health**: `npm run cli status` shows account count + credibility
- **API usage**: Rate limit manager logs (stay under thresholds)
- **Tweet success**: Check @deciresearch Twitter timeline
- **Errors**: Any "ERROR" in logs = investigate

---

## Step 8: Maintenance

### Weekly
- Check network health: `npm run cli status`
- Review discovery suggestions: API at `/discovery`
- Monitor rate limits (should never hit)

### Monthly
- Update to latest dependencies: `npm update`
- Review and approve pending accounts
- Clean up old data (if needed)

### Troubleshooting

**Bot not posting?**
```bash
npm run cli status  # Check health
curl localhost:3000/health  # Check API
```

**Rate limit errors?**
- Wait (limits reset hourly)
- Check `src/shared/rate-limits.ts` thresholds
- Might need to tune Twitter polling interval

**Database errors?**
- Check Supabase tables exist
- Verify pgvector extension enabled
- Check network/firewall allows connections

**Memory leak?**
- Bot runs 24/7, check memory: `top` or `pm2 status`
- Clear old cache periodically

---

## Step 9: Configuration Tuning

All settings in `src/shared/config.ts`. Key ones:

```typescript
schedules: ['0 6,12,18,22 * * *']  // Post times (UTC)
maxTokensPerRun: 5                  // Tokens analyzed per run
maxLLMCallsPerHour: 10              // Anthropic limit
maxTweetsPerDay: 40                 // Twitter safety limit
```

Change and restart bot to apply.

---

## Step 10: Optional Enhancements

### Enable Real-Time Mention Replies
Already built! Mention handler runs automatically.

### Add Custom Watchlists
Edit account lists in `src/intelligence/listener.ts`

### Deploy Analytics Dashboard
Build Next.js frontend pointing to APIs:
- `GET /metrics` - detailed metrics
- `GET /discovery` - pending approvals
- `GET /health` - system status

---

## Success Checklist

- [ ] Supabase project created + tables set up
- [ ] All 9 API keys in .env
- [ ] npm install completed
- [ ] npm run build succeeds
- [ ] Dry-run test passes
- [ ] First live post detected on Twitter
- [ ] Network health shows 50+ accounts
- [ ] Mention listener catching replies
- [ ] Rate limits staying safe (<80% usage)
- [ ] Logs show no critical errors

---

## Support

**If something breaks:**
1. Check logs: `npm run cli status` or tail logs
2. Verify .env keys are correct
3. Check Supabase tables exist
4. Restart: `npm run dev`
5. Check rate limits (wait if needed)

**Common fixes:**
- Twitter API 429: Wait, limits reset hourly
- Supabase connection error: Check URL + key
- Out of memory: Restart bot (daily recycling recommended)

---

## You're Live!

DeciResearch is now posting intelligent market research to Twitter, learning from 50+ credible accounts, and growing its network automatically.

Monitor the first 24 hours closely. After that, it should run smoothly with occasional glances at status.

Enjoy the autonomous intelligence network! 🚀
