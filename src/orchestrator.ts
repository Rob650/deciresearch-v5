import 'dotenv/config';
import cron from 'node-cron';
import { fetchTopTokens } from './collectors/coingecko.js';
import { fetchTrendingTokens } from './collectors/dexscreener.js';
import { scoreTokens } from './analyzers/scorer.js';
import { analyzeToken } from './analyzers/claude.js';
import { saveTokens } from './shared/db.js';
import { composeMarketBrief, composeAlphaSignal } from './publisher/composer.js';
import { postTweet } from './publisher/poster.js';
import { logger } from './shared/logger.js';

async function runAnalysis() {
  logger.info('=== Starting analysis run ===');

  // 1. Collect data (no LLM)
  const cgTokens = await fetchTopTokens();
  const dexTokens = await fetchTrendingTokens();
  const allTokens = [...cgTokens, ...dexTokens];

  if (allTokens.length === 0) {
    logger.error('No tokens fetched, aborting');
    return;
  }

  // 2. Score tokens (no LLM)
  const scored = scoreTokens(allTokens);
  const top5 = scored.slice(0, 5);
  logger.info('Top 5 tokens by score:', top5.map(t => `${t.symbol} (${t.score})`));

  // 3. Analyze top 5 with LLM (5 calls max)
  for (const token of top5) {
    token.analysis = await analyzeToken(token);
  }

  // 4. Save to database
  saveTokens(top5);

  // 5. Compose and post tweet
  const tweet = composeMarketBrief(top5);
  await postTweet(tweet);

  logger.info('=== Analysis run complete ===');
}

// Schedule: 6am, 12pm, 6pm, 10pm UTC
cron.schedule('0 6,12,18,22 * * *', runAnalysis);
logger.info('DeciResearch v5 started - scheduled for 6am, 12pm, 6pm, 10pm UTC');

// Run immediately on startup (for testing)
runAnalysis();
