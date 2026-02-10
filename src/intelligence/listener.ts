import { TwitterApi } from 'twitter-api-v2';
import { StoredTweet, TrackedAccount } from './types.js';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';
import Anthropic from '@anthropic-ai/sdk';

const client = new TwitterApi({
  bearerToken: process.env.TWITTER_BEARER_TOKEN
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const TRACKED_ACCOUNTS = [
  // Narrative Detection (15)
  'santiagoroel',
  'Cobie',
  'HsakaTrades',
  'spencernoon',
  'egirlcapital',
  'shawmakesmagic',
  'blader',
  'apolynya',
  '0xSisyphus',
  'milesdeutscher',
  'Flip_Research',
  'Muurky_',
  'CryptoCobain',
  'DefiIgnas',
  'rektcapital',
  // Technical Depth (12)
  'VitalikButerin',
  'hasufl',
  'gakonst',
  'danrobinson',
  'hayden_adams',
  'StaniKulechov',
  'armaniferrante',
  'tier10k',
  'samczsun',
  'tayvano_',
  'aeyakovenko',
  'jstrry',
  // Smart Money Tracking (13)
  'GiganticRebirth',
  'DegenSpartan',
  'inversebrah',
  'Sisyphus_47',
  'lookonchain',
  '0xHamZ',
  'unusual_whales',
  'nansen_ai',
  'DuneAnalytics',
  'glassnode',
  'zachxbt',
  'CL207',
  'Route2FI',
  // Market Structure (10)
  '0xMert_',
  'Divine_economy',
  'Ryan_Watkins_',
  'MessariCrypto',
  'tokenterminal',
  'CryptoCred',
  'AltcoinPsycho',
  'SquishChaos',
  'CryptoHayes',
  'RossMiddleton_'
];

export class TwitterListener {
  private isRunning = false;

  async start() {
    if (this.isRunning) {
      logger.warn('Listener already running');
      return;
    }

    this.isRunning = true;
    logger.info('Twitter listener started, monitoring 50 accounts');

    // For now, periodically fetch recent tweets (streaming requires API upgrade)
    // In production, use Twitter API v2 streaming with elevated access
    this.pollTweets();
  }

  async stop() {
    this.isRunning = false;
    logger.info('Twitter listener stopped');
  }

  private async pollTweets() {
    const pollIntervalMs = 30 * 60 * 1000; // Poll every 30 minutes (conservative)
    const batchSize = 5; // Process 5 accounts at a time
    
    while (this.isRunning) {
      try {
        // Batch accounts to reduce rate limit hits
        for (let i = 0; i < TRACKED_ACCOUNTS.length; i += batchSize) {
          const batch = TRACKED_ACCOUNTS.slice(i, i + batchSize);
          await Promise.all(batch.map(h => this.fetchAndStoreTweets(h)));
          
          // Space out batches
          if (i + batchSize < TRACKED_ACCOUNTS.length) {
            await this.sleep(5 * 60 * 1000); // 5 min between batches
          }
        }
        
        // Wait before next full cycle
        logger.info(`Poll cycle complete. Next in ${(pollIntervalMs / 60 / 1000).toFixed(0)} minutes`);
        await this.sleep(pollIntervalMs);
      } catch (error: any) {
        logger.error('Polling error', error.message);
        await this.sleep(10 * 60 * 1000); // Backoff 10 minutes on error
      }
    }
  }

  private async fetchAndStoreTweets(handle: string) {
    try {
      const tweets = await client.v2.userTimeline(handle, {
        max_results: 10,
        'tweet.fields': ['created_at', 'public_metrics'],
        expansions: ['author_id']
      });

      for (const tweet of tweets.data || []) {
        // Batch sentiment + topics into one call (consolidate LLM usage)
        const { sentiment, topics } = await this.analyzeSentimentAndTopics(tweet.text);

        // Generate embedding (simplified - in production use OpenAI)
        const embedding = await this.generateEmbedding(tweet.text);

        const storedTweet: StoredTweet = {
          id: `${handle}-${tweet.id}`,
          tweetId: tweet.id,
          handle,
          text: tweet.text,
          embedding,
          timestamp: new Date(tweet.created_at!).getTime(),
          likes: tweet.public_metrics?.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || 0,
          replies: tweet.public_metrics?.reply_count || 0,
          sentiment,
          topics,
          credibilityAtTime: 0, // Will be set by classifier
          storedAt: Date.now()
        };

        await vectorDB.storeTweet(storedTweet);
      }

      logger.info(`Fetched ${tweets.data?.length || 0} tweets from @${handle}`);
    } catch (error: any) {
      logger.error(`Failed to fetch tweets from @${handle}`, error.message);
    }
  }

  private async analyzeSentimentAndTopics(
    text: string
  ): Promise<{ sentiment: 'bullish' | 'bearish' | 'neutral'; topics: string[] }> {
    try {
      // Batch both into one call to reduce API hits
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Analyze this tweet:
1. Sentiment: bullish, bearish, or neutral (1 word)
2. Topics: 2-4 key topics (comma-separated)

Tweet: "${text}"

Reply format:
SENTIMENT: [word]
TOPICS: [comma-separated]`
          }
        ]
      });

      const content = message.content[0].type === 'text' ? message.content[0].text : '';

      // Parse response
      const sentimentMatch = content.match(/SENTIMENT:\s*(\w+)/i);
      const topicsMatch = content.match(/TOPICS:\s*([^\n]+)/i);

      let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (sentimentMatch) {
        const s = sentimentMatch[1].toLowerCase();
        if (s.includes('bullish')) sentiment = 'bullish';
        else if (s.includes('bearish')) sentiment = 'bearish';
      }

      let topics: string[] = [];
      if (topicsMatch) {
        topics = topicsMatch[1]
          .split(',')
          .map(t => t.trim().toLowerCase())
          .filter(t => t.length > 0);
      }

      return { sentiment, topics };
    } catch (error: any) {
      logger.warn('Sentiment/topic analysis failed', error.message);
      return { sentiment: 'neutral', topics: [] };
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Use real OpenAI embeddings
    const { embeddingsService } = await import('./embeddings.js');
    return embeddingsService.embedText(text);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const twitterListener = new TwitterListener();
