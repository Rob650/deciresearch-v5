import { TwitterApi } from 'twitter-api-v2';
import { logger } from '../shared/logger.js';
import { saveTweet, getTweetCount24h } from '../shared/db.js';
import { isSafe } from './safety.js';
import { performanceTracker } from '../intelligence/performance-tracker.js';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY!,
  appSecret: process.env.TWITTER_API_SECRET!,
  accessToken: process.env.TWITTER_ACCESS_TOKEN!,
  accessSecret: process.env.TWITTER_ACCESS_SECRET!,
});

const rwClient = client.readWrite;

export async function postTweet(
  content: string,
  themes: string[] = [],
  sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral',
  format: 'market_pulse' | 'token_analysis' | 'narrative' | 'insight' = 'market_pulse'
): Promise<boolean> {
  try {
    // Safety checks
    if (!isSafe(content)) {
      logger.error('Tweet failed safety check', content);
      return false;
    }

    const count24h = getTweetCount24h();
    if (count24h >= 40) {
      logger.warn('Daily tweet limit reached (40/day)');
      return false;
    }

    // Post to Twitter
    const tweet = await rwClient.v2.tweet(content);
    logger.info('Posted tweet', { id: tweet.data.id, count24h: count24h + 1 });
    
    // Save to DB
    saveTweet(content, tweet.data.id);
    
    // Start performance tracking
    await performanceTracker.trackTweet(
      tweet.data.id,
      content,
      themes,
      sentiment,
      format
    );
    
    return true;
  } catch (error: any) {
    logger.error('Failed to post tweet', error.message);
    return false;
  }
}
