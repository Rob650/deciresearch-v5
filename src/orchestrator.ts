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
import { twitterListener } from './intelligence/listener.js';
import { classifier } from './intelligence/classifier.js';
import { intelligenceComposer } from './intelligence/composer.js';
import { vectorDB } from './intelligence/vectordb.js';
import { metricsScheduler } from './intelligence/metrics-scheduler.js';
import { discoveryScheduler } from './intelligence/discovery-scheduler.js';

async function runAnalysis() {
  logger.info('=== Starting analysis run (with intelligence) ===');

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

  // 3. Analyze top 5 with intelligence context
  for (const token of top5) {
    // Use intelligence composer (includes RAG context from smart accounts)
    token.analysis = await intelligenceComposer.composeTokenAnalysis(token);
    
    // Fallback to basic analysis if intelligence fails
    if (!token.analysis) {
      token.analysis = await analyzeToken(token);
    }
  }

  // 4. Save to database
  saveTokens(top5);

  // 5. Compose tweet with intelligence context
  const tweet = await intelligenceComposer.composeResearchTweet(top5);
  
  // Fallback if intelligence fails
  const finalTweet = tweet || composeMarketBrief(top5);
  
  await postTweet(finalTweet);

  logger.info('=== Analysis run complete ===');
}

async function startIntelligenceNetwork() {
  logger.info('Starting intelligence network...');
  
  // Initialize vector DB
  await vectorDB.init();
  
  // Start listening to tracked accounts
  twitterListener.start();
  
  // Classify accounts
  await classifier.classifyAccounts();
  
  // Start discovery scheduler (finds new accounts automatically)
  discoveryScheduler.start();
  
  // Start metrics scheduler (tracks tweet performance)
  metricsScheduler.start();
  
  // Update credibility scores periodically
  setInterval(async () => {
    await classifier.updateCredibilityScores();
  }, 6 * 60 * 60 * 1000); // Every 6 hours
  
  logger.info('Intelligence network started');
}

// Initialize intelligence network
startIntelligenceNetwork();

// Schedule: 6am, 12pm, 6pm, 10pm UTC
cron.schedule('0 6,12,18,22 * * *', runAnalysis);
logger.info('DeciResearch v5 started - scheduled for 6am, 12pm, 6pm, 10pm UTC');

// Run immediately on startup (for testing)
runAnalysis();
