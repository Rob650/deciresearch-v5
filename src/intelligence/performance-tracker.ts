import { TwitterApi } from 'twitter-api-v2';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../shared/logger.js';

const client = new TwitterApi({
  bearerToken: process.env.TWITTER_BEARER_TOKEN
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

export interface TweetPerformance {
  tweetId: string;
  content: string;
  themes: string[];
  postedAt: number;
  likes_1h: number;
  likes_24h: number;
  retweets_1h: number;
  retweets_24h: number;
  replies_1h: number;
  replies_24h: number;
  engagement_rate: number; // (likes + retweets + replies) / impressions
  impressions?: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  format: 'market_pulse' | 'token_analysis' | 'narrative' | 'insight';
}

export interface PerformancePattern {
  theme: string;
  format: string;
  avgLikes: number;
  avgRetweets: number;
  avgEngagement: number;
  sampleSize: number;
  trend: 'up' | 'down' | 'stable';
}

export class PerformanceTracker {
  async trackTweet(
    tweetId: string,
    content: string,
    themes: string[],
    sentiment: 'bullish' | 'bearish' | 'neutral',
    format: 'market_pulse' | 'token_analysis' | 'narrative' | 'insight'
  ): Promise<boolean> {
    try {
      // Store initial record
      const { error } = await supabase.from('tweet_performance').insert({
        tweet_id: tweetId,
        content,
        themes,
        posted_at: Date.now(),
        sentiment,
        format,
        likes_1h: 0,
        likes_24h: 0,
        retweets_1h: 0,
        retweets_24h: 0,
        replies_1h: 0,
        replies_24h: 0,
        engagement_rate: 0
      });

      if (error) throw error;
      logger.info(`Started tracking tweet ${tweetId}`);
      return true;
    } catch (error: any) {
      logger.error('Failed to track tweet', error.message);
      return false;
    }
  }

  async updateMetrics(tweetId: string, checkpointHours: number = 1): Promise<TweetPerformance | null> {
    try {
      // Fetch tweet metrics from Twitter
      const tweet = await client.v2.tweet(tweetId, {
        'tweet.fields': ['public_metrics', 'created_at']
      });

      if (!tweet.data) {
        logger.warn(`Tweet ${tweetId} not found`);
        return null;
      }

      const metrics = tweet.data.public_metrics || {};

      // Get stored record
      const { data: stored } = await supabase
        .from('tweet_performance')
        .select('*')
        .eq('tweet_id', tweetId)
        .single();

      if (!stored) {
        logger.warn(`No performance record for ${tweetId}`);
        return null;
      }

      // Calculate metrics
      const now = Date.now();
      const ageMs = now - stored.posted_at;
      const ageHours = ageMs / (1000 * 60 * 60);

      // Impressions = proxy using followers of account (rough estimate)
      // In production, use Twitter API analytics endpoint
      const impressions = Math.max(
        metrics.like_count || 0 * 50, // Rough: likes are ~2% of impressions
        1000 // Minimum estimate
      );

      const engagementRate = impressions > 0
        ? ((metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0)) / impressions
        : 0;

      let likes_1h = 0;
      let retweets_1h = 0;
      let replies_1h = 0;

      if (ageHours >= 1) {
        likes_1h = metrics.like_count || 0;
        retweets_1h = metrics.retweet_count || 0;
        replies_1h = metrics.reply_count || 0;
      }

      // Update record
      const { error } = await supabase
        .from('tweet_performance')
        .update({
          likes_1h,
          likes_24h: metrics.like_count,
          retweets_1h,
          retweets_24h: metrics.retweet_count,
          replies_1h,
          replies_24h: metrics.reply_count,
          impressions,
          engagement_rate: engagementRate,
          last_updated: now
        })
        .eq('tweet_id', tweetId);

      if (error) throw error;

      const performance: TweetPerformance = {
        tweetId,
        content: stored.content,
        themes: stored.themes,
        postedAt: stored.posted_at,
        likes_1h,
        likes_24h: metrics.like_count || 0,
        retweets_1h,
        retweets_24h: metrics.retweet_count || 0,
        replies_1h,
        replies_24h: metrics.reply_count || 0,
        impressions,
        engagement_rate: engagementRate,
        sentiment: stored.sentiment,
        format: stored.format
      };

      logger.info(`Updated metrics for ${tweetId}: ${likes_1h}L ${retweets_1h}RT in 1h`);
      return performance;
    } catch (error: any) {
      logger.error(`Failed to update metrics for ${tweetId}`, error.message);
      return null;
    }
  }

  async getPerformancePatterns(): Promise<PerformancePattern[]> {
    try {
      // Get all tweets from last 7 days with 24h metrics
      const { data: tweets } = await supabase
        .from('tweet_performance')
        .select('*')
        .gt('posted_at', Date.now() - 7 * 24 * 60 * 60 * 1000)
        .order('posted_at', { ascending: false });

      if (!tweets || tweets.length === 0) {
        return [];
      }

      // Group by theme + format
      const patterns = new Map<string, { likes: number[]; retweets: number[]; engagement: number[]; count: number }>();

      for (const tweet of tweets) {
        for (const theme of tweet.themes || []) {
          const key = `${theme}|${tweet.format}`;
          const current = patterns.get(key) || { likes: [], retweets: [], engagement: [], count: 0 };

          current.likes.push(tweet.likes_24h || 0);
          current.retweets.push(tweet.retweets_24h || 0);
          current.engagement.push(tweet.engagement_rate || 0);
          current.count++;

          patterns.set(key, current);
        }
      }

      // Calculate averages and trends
      const result: PerformancePattern[] = [];

      for (const [key, data] of patterns.entries()) {
        const [theme, format] = key.split('|');

        const avgLikes = data.likes.reduce((a, b) => a + b, 0) / data.count;
        const avgRetweets = data.retweets.reduce((a, b) => a + b, 0) / data.count;
        const avgEngagement = data.engagement.reduce((a, b) => a + b, 0) / data.count;

        // Simple trend: compare recent vs older
        const recent = data.likes.slice(0, Math.ceil(data.count / 2));
        const older = data.likes.slice(Math.ceil(data.count / 2));
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (recentAvg > olderAvg * 1.1) trend = 'up';
        else if (recentAvg < olderAvg * 0.9) trend = 'down';

        result.push({
          theme,
          format,
          avgLikes,
          avgRetweets,
          avgEngagement,
          sampleSize: data.count,
          trend
        });
      }

      // Sort by engagement
      return result.sort((a, b) => b.avgEngagement - a.avgEngagement);
    } catch (error: any) {
      logger.error('Failed to get performance patterns', error.message);
      return [];
    }
  }

  async getBestPerformingContent(limit: number = 5): Promise<TweetPerformance[]> {
    try {
      const { data: tweets } = await supabase
        .from('tweet_performance')
        .select('*')
        .gt('posted_at', Date.now() - 7 * 24 * 60 * 60 * 1000)
        .order('likes_24h', { ascending: false })
        .limit(limit);

      return (tweets || []) as TweetPerformance[];
    } catch (error: any) {
      logger.error('Failed to get best performing content', error.message);
      return [];
    }
  }

  async getThemeMetrics(theme: string): Promise<{
    theme: string;
    avgLikes: number;
    avgRetweets: number;
    avgEngagement: number;
    totalTweets: number;
    topPerformer: TweetPerformance | null;
  }> {
    try {
      const { data: tweets } = await supabase
        .from('tweet_performance')
        .select('*')
        .contains('themes', [theme])
        .gt('posted_at', Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (!tweets || tweets.length === 0) {
        return {
          theme,
          avgLikes: 0,
          avgRetweets: 0,
          avgEngagement: 0,
          totalTweets: 0,
          topPerformer: null
        };
      }

      const avgLikes = tweets.reduce((sum, t) => sum + (t.likes_24h || 0), 0) / tweets.length;
      const avgRetweets = tweets.reduce((sum, t) => sum + (t.retweets_24h || 0), 0) / tweets.length;
      const avgEngagement = tweets.reduce((sum, t) => sum + (t.engagement_rate || 0), 0) / tweets.length;

      const topPerformer = tweets.reduce((best, current) => {
        const bestScore = (best.likes_24h || 0) + (best.retweets_24h || 0) * 2;
        const currentScore = (current.likes_24h || 0) + (current.retweets_24h || 0) * 2;
        return currentScore > bestScore ? current : best;
      });

      return {
        theme,
        avgLikes,
        avgRetweets,
        avgEngagement,
        totalTweets: tweets.length,
        topPerformer: topPerformer as TweetPerformance
      };
    } catch (error: any) {
      logger.error(`Failed to get metrics for theme ${theme}`, error.message);
      return {
        theme,
        avgLikes: 0,
        avgRetweets: 0,
        avgEngagement: 0,
        totalTweets: 0,
        topPerformer: null
      };
    }
  }

  async getRecommendations(): Promise<string[]> {
    try {
      const patterns = await this.getPerformancePatterns();

      const recommendations: string[] = [];

      // Find highest performing themes
      const topThemes = patterns
        .filter(p => p.sampleSize >= 3) // Need sample size
        .sort((a, b) => b.avgEngagement - a.avgEngagement)
        .slice(0, 3);

      for (const pattern of topThemes) {
        recommendations.push(
          `📈 "${pattern.theme}" with "${pattern.format}" format gets ${(pattern.avgEngagement * 100).toFixed(1)}% engagement (${pattern.sampleSize} tweets). ${pattern.trend === 'up' ? 'Trending up.' : ''}`
        );
      }

      // Find underperforming themes
      const bottomThemes = patterns
        .filter(p => p.sampleSize >= 3)
        .sort((a, b) => a.avgEngagement - b.avgEngagement)
        .slice(0, 2);

      for (const pattern of bottomThemes) {
        recommendations.push(
          `📉 "${pattern.theme}" underperforming at ${(pattern.avgEngagement * 100).toFixed(1)}% engagement. Consider less frequent posts.`
        );
      }

      return recommendations;
    } catch (error: any) {
      logger.error('Failed to generate recommendations', error.message);
      return [];
    }
  }
}

export const performanceTracker = new PerformanceTracker();
