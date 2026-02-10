#!/usr/bin/env node

import 'dotenv/config';
import { logger } from './shared/logger.js';
import { monitor } from './shared/monitor.js';
import { config } from './shared/config.js';
import Database from 'better-sqlite3';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  logger.info(`DeciResearch v5 CLI - Command: ${command}`);

  switch (command) {
    case 'status':
      showStatus();
      break;
    case 'metrics':
      showMetrics();
      break;
    case 'config':
      showConfig();
      break;
    case 'db:tokens':
      showTokens(parseInt(args[0]) || 10);
      break;
    case 'db:tweets':
      showTweets(parseInt(args[0]) || 10);
      break;
    case 'db:clear':
      clearDatabase();
      break;
    case 'help':
      showHelp();
      break;
    default:
      console.log(`Unknown command: ${command}`);
      showHelp();
  }
}

function showStatus() {
  console.log('\n' + monitor.getDashboard());
}

function showMetrics() {
  const health = monitor.getMetrics();
  const perf = monitor.getPerformanceMetrics();

  console.log('\n=== HEALTH METRICS ===');
  console.log(`Uptime: ${(health.uptime / (1000 * 60 * 60)).toFixed(1)}h`);
  console.log(`Success Rate: ${health.successRate.toFixed(1)}%`);
  console.log(`Tasks Completed: ${health.tasksCompleted}`);
  console.log(`Tasks Failed: ${health.tasksFailed}`);
  console.log(`Tokens Fetched: ${health.tokensFetched}`);
  console.log(`Tokens Analyzed: ${health.tokensAnalyzed}`);
  console.log(`Tweets Posted: ${health.tweetsPosted}`);
  console.log(`LLM Calls: ${health.llmCallsUsed}/10`);

  console.log('\n=== PERFORMANCE METRICS ===');
  console.log(`Fetch Latency: ${perf.avgFetchTime.toFixed(0)}ms avg, ${perf.p95FetchTime.toFixed(0)}ms p95`);
  console.log(`Analysis Latency: ${perf.avgAnalysisTime.toFixed(0)}ms avg, ${perf.p95AnalysisTime.toFixed(0)}ms p95`);
  console.log(`Post Latency: ${perf.avgPostTime.toFixed(0)}ms avg, ${perf.p95PostTime.toFixed(0)}ms p95`);
}

function showConfig() {
  console.log('\n=== CONFIGURATION ===');
  const cfg = config.getAll();
  console.log(`Max Tokens per Run: ${cfg.maxTokensPerRun}`);
  console.log(`Max LLM Calls/Hour: ${cfg.maxLLMCallsPerHour}`);
  console.log(`Max Tweets/Day: ${cfg.maxTweetsPerDay}`);
  console.log(`Min Tweet Interval: ${cfg.minTweetIntervalMinutes} minutes`);
  console.log(`Min Volume: $${cfg.minVolumeUSD}`);
  console.log(`Min Liquidity: $${cfg.minLiquidityUSD}`);
  console.log(`Max Volatility: ${cfg.maxVolatilityPercent}%`);
  console.log(`Max Holder Concentration: ${cfg.maxHolderConcentration}%`);
  console.log(`Validation: ${cfg.enableValidation ? 'enabled' : 'disabled'}`);
  console.log(`Analytics: ${cfg.enableAnalytics ? 'enabled' : 'disabled'}`);
  console.log(`Dry Run: ${cfg.dryRun ? 'enabled' : 'disabled'}`);
  console.log(`Schedules: ${cfg.schedules.join(', ')}`);
}

function showTokens(limit: number) {
  try {
    const db = new Database('deciresearch.db');
    const tokens = db
      .prepare('SELECT * FROM tokens ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];

    console.log(`\n=== TOKENS (latest ${limit}) ===`);
    console.table(
      tokens.map(t => ({
        symbol: t.symbol,
        price: t.price.toFixed(4),
        '24h%': t.priceChange24h.toFixed(1),
        volume: (t.volume24h / 1000000).toFixed(1) + 'M',
        mcap: (t.marketCap / 1000000).toFixed(1) + 'M',
        score: t.score?.toFixed(0)
      }))
    );
    db.close();
  } catch (error) {
    console.error('Error reading tokens:', (error as Error).message);
  }
}

function showTweets(limit: number) {
  try {
    const db = new Database('deciresearch.db');
    const tweets = db
      .prepare('SELECT * FROM tweets ORDER BY postedAt DESC LIMIT ?')
      .all(limit) as any[];

    console.log(`\n=== TWEETS (latest ${limit}) ===`);
    tweets.forEach((t, i) => {
      console.log(`\n${i + 1}. ${new Date(t.postedAt).toLocaleString()}`);
      console.log(`   ID: ${t.tweetId || '(not posted)'}`);
      console.log(`   Text: ${t.content.slice(0, 100)}...`);
    });
    db.close();
  } catch (error) {
    console.error('Error reading tweets:', (error as Error).message);
  }
}

function clearDatabase() {
  const confirm = process.argv.includes('--confirm');
  if (!confirm) {
    console.log('⚠️  This will delete all data. Run with --confirm to proceed');
    return;
  }

  try {
    const db = new Database('deciresearch.db');
    db.exec('DELETE FROM tokens; DELETE FROM tweets;');
    console.log('✓ Database cleared');
    db.close();
  } catch (error) {
    console.error('Error clearing database:', (error as Error).message);
  }
}

function showHelp() {
  console.log(`
DeciResearch v5 CLI

Commands:
  status               Show live dashboard
  metrics              Show detailed metrics
  config               Show current configuration
  db:tokens [n]        Show last n tokens (default: 10)
  db:tweets [n]        Show last n tweets (default: 10)
  db:clear             Clear database (use --confirm to proceed)
  help                 Show this help

Examples:
  npm run cli status
  npm run cli metrics
  npm run cli db:tokens 20
  npm run cli db:clear --confirm
  `);
}

main().catch(error => {
  logger.error('CLI error', (error as Error).message);
  process.exit(1);
});
