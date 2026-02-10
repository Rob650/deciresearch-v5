# DeciResearch v5 - Development Guide

## Project Structure

```
src/
├── collectors/          # Data sources
│   ├── coingecko.ts    # Top 50 tokens by volume
│   └── dexscreener.ts  # Trending tokens
├── analyzers/          # Token analysis
│   ├── scorer.ts       # Deterministic scoring (0-100)
│   ├── claude.ts       # LLM analysis
│   └── enhanced.ts     # Rich metrics extraction
├── publisher/          # Tweet publishing
│   ├── composer.ts     # Tweet formatting
│   ├── poster.ts       # Twitter API integration
│   ├── safety.ts       # Safety checks
│   └── analytics.ts    # Performance tracking
├── shared/             # Shared utilities
│   ├── types.ts        # TypeScript interfaces
│   ├── db.ts           # SQLite database
│   ├── logger.ts       # Logging
│   ├── config.ts       # Configuration
│   ├── rate-limiter.ts # API rate limiting
│   ├── validator.ts    # Token validation
│   ├── resilience.ts   # Retry & circuit breaker
│   └── monitor.ts      # Health monitoring
├── api.ts              # REST API server
├── cli.ts              # CLI tool
├── orchestrator.ts     # Main loop & cron scheduler
├── package.json
├── tsconfig.json
├── README.md
├── ARCHITECTURE.md
└── DEVELOPMENT.md      # You are here
```

## Development Workflow

### 1. Setup Dev Environment
```bash
npm install
npm run build    # Compile TypeScript
```

### 2. Run Locally
```bash
npm run dev      # Start bot (will run first analysis immediately)
npm run cli status  # Check status in another terminal
```

### 3. Watch & Rebuild
```bash
# In separate terminal
npx tsc --watch
```

## Adding New Features

### Add a New Data Collector

1. Create `src/collectors/newexchange.ts`:
```typescript
import axios from 'axios';
import { Token } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export async function fetchTokensFromNewExchange(): Promise<Token[]> {
  try {
    const response = await axios.get('https://api.example.com/tokens');
    const tokens: Token[] = response.data.map((item: any) => ({
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      price: item.price,
      volume24h: item.volume,
      marketCap: item.marketCap,
      priceChange24h: item.change24h,
      priceChange7d: item.change7d,
      timestamp: Date.now()
    }));
    logger.info(`Fetched ${tokens.length} from NewExchange`);
    return tokens;
  } catch (error: any) {
    logger.error('NewExchange fetch failed', error.message);
    return [];
  }
}
```

2. Import in `src/orchestrator.ts`:
```typescript
import { fetchTokensFromNewExchange } from './collectors/newexchange.js';

// In runAnalysis():
const newExchangeTokens = await fetchTokensFromNewExchange();
const allTokens = [...cgTokens, ...dexTokens, ...newExchangeTokens];
```

### Add a New Analysis Metric

1. Extend `Token` interface in `src/shared/types.ts`:
```typescript
export interface Token {
  // ... existing fields
  communityScore?: number;  // New field
  githubActivity?: number;
}
```

2. Add extraction function in `src/analyzers/enhanced.ts`:
```typescript
export function extractCommunityMetrics(token: Token): number {
  // Fetch from Twitter, Discord, etc.
  return score; // 0-100
}
```

3. Use in scorer:
```typescript
// In src/analyzers/scorer.ts
const communityBonus = token.communityScore ? token.communityScore * 0.1 : 0;
score += communityBonus;
```

### Add Custom Tweet Format

1. Create function in `src/publisher/composer.ts`:
```typescript
export function composeCustomFormat(tokens: Token[]): string {
  // Your custom logic
  const tweet = `Your custom format here...`;
  return tweet.slice(0, 280);
}
```

2. Use in `src/orchestrator.ts`:
```typescript
import { composeCustomFormat } from './publisher/composer.js';

// In runAnalysis():
const tweet = composeCustomFormat(top5);
await postTweet(tweet);
```

### Add Safety Rule

1. Update `src/publisher/safety.ts`:
```typescript
const BANNED_PHRASES = [
  // ... existing
  'your new phrase',
  'another phrase'
];

export function isSafe(text: string): boolean {
  const lower = text.toLowerCase();
  
  // Custom checks
  if (hasExcessiveCaps(text)) return false;  // New check
  
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return false;
  }
  return true;
}

function hasExcessiveCaps(text: string): boolean {
  const caps = (text.match(/[A-Z]/g) || []).length;
  return caps / text.length > 0.5;  // More than 50% caps
}
```

## Extending the API

### Add New Endpoint

1. Update `src/api.ts`:
```typescript
private handlePerformance(res: http.ServerResponse) {
  const data = {
    topPerformers: getTokenMentionStats(),
    trending: getTrendingPatterns(),
    timestamp: Date.now()
  };
  this.sendJson(res, { success: true, data, timestamp: Date.now() });
}

// In request handler:
if (pathname === '/performance') {
  this.handlePerformance(res);
}
```

### Add CLI Command

1. Update `src/cli.ts`:
```typescript
case 'analyze-token':
  analyzeTokenCommand(args[0]);
  break;

function analyzeTokenCommand(symbol: string) {
  // Your logic
  console.log(`Analyzing ${symbol}...`);
}
```

## Configuration Options

Edit config in `src/shared/config.ts`:

```typescript
const DEFAULT_CONFIG: BotConfig = {
  // Scheduling
  schedules: ['0 6 * * *', '0 12 * * *'],  // Change run times
  
  // Limits
  maxTokensPerRun: 5,      // Analyze more/fewer
  maxLLMCallsPerHour: 20,  // Increase if needed
  maxTweetsPerDay: 50,     // Post more
  minTweetIntervalMinutes: 5,  // Post faster
  
  // Thresholds
  minVolumeUSD: 50000,     // Lower = more tokens
  maxVolatilityPercent: 200,  // Higher = riskier
  maxHolderConcentration: 70, // Higher = more centralized
  
  // Features
  enableValidation: true,
  enableAnalytics: true,
  dryRun: false  // Test mode without posting
};
```

## Testing

### Manual Testing

1. **Dry run** (no tweets posted):
```typescript
// In config
dryRun: true

npm run dev
npm run cli db:tweets  # Check nothing posted
```

2. **Test single token**:
```typescript
// In orchestrator.ts, test analyzeToken directly
import { analyzeToken } from './analyzers/claude.js';

const testToken = { /* ... */ };
const analysis = await analyzeToken(testToken);
console.log(analysis);
```

3. **Test validation**:
```typescript
import { validateToken } from './shared/validator.js';

const result = validateToken(token);
console.log(result); // { isValid, score, risks, warnings }
```

### Integration Testing

```bash
# Full run with monitoring
npm run dev &
PID=$!
sleep 30
npm run cli metrics
npm run cli db:tokens
kill $PID
```

## Performance Optimization

### Reduce Latency

```typescript
// In rate-limiter.ts, reduce wait time
const sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
await sleep(5000);  // Was 20000, now 5000
```

### Increase Throughput

```typescript
// In orchestrator.ts
const allTokens = [...cgTokens, ...dexTokens];
const top10 = scoreTokens(allTokens).slice(0, 10);  // Analyze more

for (const token of top10) {  // 10 tokens
  token.analysis = await analyzeToken(token);
}
```

### Memory Usage

```typescript
// In db.ts, add cleanup
export function cleanup() {
  db.exec('DELETE FROM tokens WHERE timestamp < ?', [Date.now() - 7*86400000]);
}

// Call periodically
setInterval(cleanup, 24 * 3600 * 1000);  // Daily
```

## Debugging

### Enable Verbose Logging

```typescript
// In src/shared/logger.ts
export const logger = {
  info: (msg: string, data?: any) => {
    if (process.env.DEBUG) {
      console.log(`[INFO] ${msg}`, JSON.stringify(data, null, 2));
    }
  }
};

// Run with
DEBUG=1 npm run dev
```

### Monitor API Calls

```bash
# Watch network traffic
npm run dev 2>&1 | grep -E "Fetched|Posted|Error"
```

### Check Database

```bash
# Browse SQLite
npm run cli db:tokens 100
npm run cli db:tweets 50

# Or use sqlite CLI
sqlite3 deciresearch.db "SELECT * FROM tokens LIMIT 5;"
```

## Code Style

- Use TypeScript strict mode
- ESLint/Prettier config in tsconfig.json
- Async/await over promises
- Error handling with try/catch
- Log all operations and errors
- Comment complex logic

## Deployment

### Production Checklist

- [ ] Add all API keys to `.env`
- [ ] Set `dryRun: false` in config
- [ ] Test with `npm run dev` first
- [ ] Check `npm run cli status` shows healthy
- [ ] Monitor first 24h actively
- [ ] Set up alerts for errors
- [ ] Review tweets manually initially

### Running 24/7

```bash
# Using PM2
npm install -g pm2
pm2 start "npm run dev" --name deciresearch
pm2 logs deciresearch
pm2 restart deciresearch
```

### Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
```

Build and run:
```bash
docker build -t deciresearch .
docker run -e ANTHROPIC_API_KEY=... -e TWITTER_API_KEY=... deciresearch
```

## Useful Commands

```bash
# Build & test
npm run build
npm run dev

# Monitor
npm run cli status
npm run cli metrics
npm run cli config

# Database
npm run cli db:tokens 20
npm run cli db:tweets 10
npm run cli db:clear --confirm

# API
curl http://localhost:3000/health
curl http://localhost:3000/dashboard
```

## Common Issues & Solutions

### "Rate limit exceeded"
- Reduce `maxTokensPerRun`
- Increase `sleep` between LLM calls
- Check `maxLLMCallsPerHour` setting

### "No tweets posted"
- Check `dryRun` is false
- Verify Twitter API keys are valid
- Check `getTweetCount24h()` < `maxTweetsPerDay`

### "Database locked"
- Ensure only one instance running
- Check for hanging processes: `ps aux | grep orchestrator`
- Clear database: `npm run cli db:clear --confirm`

### "Claude API errors"
- Verify `ANTHROPIC_API_KEY` is valid
- Check API quota usage
- Review error logs: `npm run cli status`
