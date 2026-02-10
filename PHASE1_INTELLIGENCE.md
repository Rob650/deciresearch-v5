# Phase 1: Intelligence Network

## Overview

DeciResearch now has a **distributed intelligence network** that:
- **Monitors 50 credible accounts** across 4 categories
- **Embeds every tweet** into a vector database (pgvector)
- **Synthesizes insights** from the collective intelligence
- **Powers research tweets** with RAG-augmented context

## Architecture

```
TWITTER ACCOUNTS (50)
├── Narrative Detection (15)
├── Technical Depth (12)
├── Smart Money Tracking (13)
└── Market Structure (10)
        │
        ↓
  LISTENER (polls every 5 min)
        │
        ├→ Extract text, metadata
        ├→ Analyze sentiment (bullish/bearish/neutral)
        ├→ Extract topics
        └→ Generate embedding (OpenAI)
        │
        ↓
  VECTOR DATABASE (PostgreSQL + pgvector)
        │
        ├→ Store tweets with embeddings
        ├→ Store account credibility scores
        └→ Index for semantic search
        │
        ↓
  CLASSIFIER (continuous updates)
        │
        ├→ Score account credibility (0-100)
        ├→ Track engagement metrics
        ├→ Update accuracy scores
        └→ Assign category tags
        │
        ↓
  RAG ENGINE (query time)
        │
        ├→ Semantic search (find relevant tweets)
        ├→ Sentiment analysis (bullish/bearish ratio)
        ├→ Theme extraction (top narratives)
        ├→ Synthesis (what smart accounts think)
        └→ Context for tweet composition
        │
        ↓
  TWEET COMPOSER (every 6 hours)
        │
        ├→ Fetch market data
        ├→ Query RAG context
        ├→ Synthesize insights
        └→ Post to Twitter (sounds like original research)
```

## Modules

### 1. **types.ts** - Data Structures
```typescript
TrackedAccount {
  handle: string
  category: 'NARRATIVE' | 'TECHNICAL' | 'SMART_MONEY' | 'MARKET_STRUCTURE'
  credibilityScore: number (0-100)
  accuracyScore: number (0-100)
}

StoredTweet {
  tweetId: string
  handle: string
  text: string
  embedding: number[] // 1536-dim vector
  sentiment: 'bullish' | 'bearish' | 'neutral'
  topics: string[]
  credibilityAtTime: number
}

RAGContext {
  query: string
  relevantTweets: StoredTweet[]
  topAccounts: TrackedAccount[]
  sentiment: { bullish, bearish, neutral }
  themes: Theme[]
  summary: string
}
```

### 2. **vectordb.ts** - Storage & Search
- PostgreSQL + pgvector extension (via Supabase)
- Tables: `tracked_accounts`, `tweets`
- Methods:
  - `storeAccount()` - Save account metadata
  - `storeTweet()` - Save tweet + embedding
  - `semanticSearch()` - Find related tweets by vector similarity
  - `getAccountsByCategory()` - Filter by category
  - `getTweetsByTopic()` - Find tweets about a topic
  - `updateAccountCredibility()` - Update scores over time

### 3. **listener.ts** - Twitter Monitor
- Polls 50 tracked accounts every 5 minutes
- Extracts:
  - Tweet text
  - Metrics (likes, retweets, replies)
  - Sentiment (Claude Haiku)
  - Topics (Claude Haiku)
- Generates embeddings (TODO: use OpenAI API)
- Stores in PostgreSQL

### 4. **classifier.ts** - Account Scoring
- Fetches user data (followers, engagement, account age)
- Calculates credibility score (0-100) based on:
  - Verification status (+15)
  - Follower growth ratio (+10-20)
  - Tweet frequency (+5-10)
  - Engagement metrics (+15)
  - Category-specific bonuses
- Updates scores over time based on tweet performance
- Tags accounts by credibility level

### 5. **rag.ts** - Retrieval-Augmented Generation
- **queryContext(query, category)** - Get relevant context for any query
  - Searches vector DB for related tweets
  - Pulls top credible accounts
  - Analyzes sentiment distribution
  - Extracts key themes
  - Synthesizes summary
- **queryForTweet(tokenSymbol, narrative)** - Get context for token analysis
- **queryByCategory(category)** - Get insights from one category
- **getSmartMoneySentiment()** - Track smart money positions
- **getTechnicalInsights()** - Get technical analysis themes
- **getNarrativeContext()** - Understand ongoing narratives

### 6. **composer.ts** - Intelligence-Powered Tweet Writing
- **composeResearchTweet(tokens)** - Main entry point
  - Takes market data + RAG context
  - Composes tweet in DeciResearch voice
  - Sounds like original analysis (because it IS - synthesized)
- **composeTokenAnalysis(token)** - Deep dive on single token
  - Combines smart money sentiment + technical themes + narrative
  - Outputs 2-sentence analysis
- **composeReply(mention, context)** - Respond to questions
  - Queries vector DB for relevant knowledge
  - Synthesizes informed reply

## Data Flow

### Every 5 Minutes (Background)
```
→ Listener polls 50 accounts
→ Extract + analyze each tweet
→ Generate embedding
→ Store in PostgreSQL
→ Classifier updates credibility scores
```

### Every 6 Hours (Scheduled)
```
→ Fetch top tokens (CoinGecko/DEXScreener)
→ Score tokens (deterministic)
→ For each top token:
  → Query RAG: "What have smart accounts said?"
  → Get context: sentiment, themes, insights
→ Compose tweet:
  → Market data + RAG context = original analysis
  → Post to Twitter
```

### When Mentioned
```
→ Parse mention in replies
→ Query RAG for relevant context
→ Synthesize answer using vector DB
→ Reply in DeciResearch voice
```

## What You Get

**A research brain that compounds over time:**
- 50 credible accounts → your private intelligence network
- Every tweet they post → indexed and searchable
- Your tweets → backed by collective intelligence
- No citations needed → you're synthesizing at a higher level

**Example**: 
- Smart account posts about Solana MEV
- Bot embeds it
- You tweet about Solana ecosystem 3 days later
- RAG context pulls that insight + others
- Your tweet sounds authoritative (because it IS - synthesized from smart people)

## Setup Required

### 1. Create Supabase Project
```
1. Go to supabase.com
2. Create new project (free tier OK)
3. Copy URL and Key
4. Add to .env:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_anon_key
```

### 2. Create Database Tables
```sql
-- Run in Supabase SQL editor
CREATE TABLE tracked_accounts (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE,
  category TEXT,
  credibility_score REAL,
  follower_count INTEGER,
  engagement_rate REAL,
  accuracy_score REAL,
  tags TEXT[],
  added_at BIGINT,
  last_updated BIGINT
);

CREATE TABLE tweets (
  id TEXT PRIMARY KEY,
  tweet_id TEXT,
  handle TEXT,
  text TEXT,
  embedding vector(1536),
  timestamp BIGINT,
  likes INTEGER,
  retweets INTEGER,
  replies INTEGER,
  sentiment TEXT,
  topics TEXT[],
  credibility_at_time REAL,
  stored_at BIGINT
);

CREATE INDEX idx_tweets_embedding ON tweets USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_tweets_handle ON tweets(handle);
CREATE INDEX idx_accounts_credibility ON tracked_accounts(credibility_score DESC);
```

### 3. Add Environment Variables
```
SUPABASE_URL=your_url
SUPABASE_KEY=your_key
```

### 4. Run
```bash
npm install
npm run dev
```

## Roadmap

- [ ] Real OpenAI embeddings (currently dummy vectors)
- [ ] Tweet mention listener (catch @deciresearch tags)
- [ ] Automatic reply composer (answer mentions)
- [ ] Multi-chain data (Ethereum, Solana, Polygon, etc.)
- [ ] On-chain signal integration (whale buys, large transfers)
- [ ] Influence scoring (who influences whom)
- [ ] Trend prediction (what's hot in 24h?)
- [ ] Custom account watchlists per narrative

## Cost

- **Supabase**: Free tier or ~$25/month for larger DB
- **OpenAI Embeddings**: ~$0.02 per 1M tokens (~$2/month for 50 accounts)
- **Twitter API**: Free (under 500K tweets/month)
- **Total**: ~$27/month vs. $0.12/day for Phase 0

This is the difference between automated posting (Phase 0) and institutional-grade research infrastructure (Phase 1).
