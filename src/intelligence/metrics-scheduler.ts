import { performanceTracker } from './performance-tracker.js';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../shared/logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

export class MetricsScheduler {
  private isRunning = false;

  async start() {
    if (this.isRunning) {
      logger.warn('Metrics scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Metrics scheduler started');

    // Update metrics every hour
    this.scheduleHourlyUpdates();

    // Daily analysis (at 23:00 UTC)
    this.scheduleDailyAnalysis();
  }

  async stop() {
    this.isRunning = false;
    logger.info('Metrics scheduler stopped');
  }

  private async scheduleHourlyUpdates() {
    while (this.isRunning) {
      try {
        await this.updateRecentTweets();
        // Run every 60 minutes
        await this.sleep(60 * 60 * 1000);
      } catch (error: any) {
        logger.error('Hourly update failed', error.message);
        await this.sleep(60 * 1000); // Retry after 1 min on error
      }
    }
  }

  private async scheduleDailyAnalysis() {
    while (this.isRunning) {
      try {
        const now = new Date();
        const target = new Date();
        target.setUTCHours(23, 0, 0, 0); // 23:00 UTC

        let delayMs = target.getTime() - now.getTime();
        if (delayMs <= 0) {
          // If past 23:00 UTC, schedule for tomorrow
          target.setDate(target.getDate() + 1);
          delayMs = target.getTime() - now.getTime();
        }

        logger.info(`Daily analysis scheduled in ${(delayMs / 1000 / 60).toFixed(0)} minutes`);
        await this.sleep(delayMs);

        if (this.isRunning) {
          await this.runDailyAnalysis();
        }
      } catch (error: any) {
        logger.error('Daily analysis scheduling failed', error.message);
        await this.sleep(60 * 60 * 1000); // Retry in 1 hour
      }
    }
  }

  private async updateRecentTweets() {
    try {
      // Get tweets posted in last 24 hours that need updating
      const { data: tweets } = await supabase
        .from('tweet_performance')
        .select('tweet_id')
        .gt('posted_at', Date.now() - 24 * 60 * 60 * 1000)
        .order('posted_at', { ascending: false })
        .limit(20); // Update last 20 tweets

      if (!tweets || tweets.length === 0) {
        logger.info('No recent tweets to update');
        return;
      }

      let updated = 0;
      for (const tweet of tweets) {
        const result = await performanceTracker.updateMetrics(tweet.tweet_id, 1);
        if (result) updated++;
      }

      logger.info(`Updated metrics for ${updated}/${tweets.length} recent tweets`);
    } catch (error: any) {
      logger.error('Failed to update recent tweets', error.message);
    }
  }

  private async runDailyAnalysis() {
    try {
      logger.info('Running daily performance analysis...');

      // Get performance patterns
      const patterns = await performanceTracker.getPerformancePatterns();
      logger.info(`Found ${patterns.length} performance patterns`);

      // Log top performers
      const topPatterns = patterns.slice(0, 3);
      for (const pattern of topPatterns) {
        logger.info(
          `Top: ${pattern.theme} (${pattern.format}) - ${(pattern.avgEngagement * 100).toFixed(1)}% engagement (${pattern.sampleSize} tweets)`
        );
      }

      // Get recommendations
      const recommendations = await performanceTracker.getRecommendations();
      logger.info('Performance recommendations:');
      for (const rec of recommendations) {
        logger.info(`  ${rec}`);
      }

      // Store analysis summary
      await this.storeAnalysisSummary(patterns, recommendations);

      logger.info('Daily analysis complete');
    } catch (error: any) {
      logger.error('Daily analysis failed', error.message);
    }
  }

  private async storeAnalysisSummary(
    patterns: any[],
    recommendations: string[]
  ): Promise<void> {
    try {
      const { error } = await supabase.from('performance_analysis').insert({
        date: new Date().toISOString().split('T')[0],
        patterns: patterns,
        recommendations: recommendations,
        timestamp: Date.now()
      });

      if (error) throw error;
      logger.info('Stored daily analysis summary');
    } catch (error: any) {
      logger.error('Failed to store analysis summary', error.message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      running: this.isRunning,
      updateFrequency: 'hourly',
      analysisTime: '23:00 UTC'
    };
  }
}

export const metricsScheduler = new MetricsScheduler();
