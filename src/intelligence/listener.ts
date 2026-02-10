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
    while (this.isRunning) {
      try {
        for (const handle of TRACKED_ACCOUNTS) {
          await this.fetchAndStoreTweets(handle);
        }
        // Poll every 5 minutes
        await this.sleep(5 * 60 * 1000);
      } catch (error: any) {
        logger.error('Polling error', error.message);
        await this.sleep(60 * 1000); // Retry after 1 minute on error
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
        // Extract sentiment and topics
        const sentiment = await this.analyzeSentiment(tweet.text);
        const topics = await this.extractTopics(tweet.text);

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

  private async analyzeSentiment(text: string): Promise<'bullish' | 'bearish' | 'neutral'> {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Classify sentiment as bullish, bearish, or neutral. Reply with one word only.\n\n"${text}"`
          }
        ]
      });

      const content =
        message.content[0].type === 'text' ? message.content[0].text.toLowerCase() : 'neutral';

      if (content.includes('bullish')) return 'bullish';
      if (content.includes('bearish')) return 'bearish';
      return 'neutral';
    } catch (error: any) {
      logger.warn('Sentiment analysis failed', error.message);
      return 'neutral';
    }
  }

  private async extractTopics(text: string): Promise<string[]> {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Extract 2-4 key topics from this tweet. Reply with comma-separated words only.\n\n"${text}"`
          }
        ]
      });

      const content = message.content[0].type === 'text' ? message.content[0].text : '';
      return content.split(',').map(t => t.trim().toLowerCase());
    } catch (error: any) {
      logger.warn('Topic extraction failed', error.message);
      return [];
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Simplified embedding - in production use OpenAI API
    // For now, return a dummy vector
    // Real implementation: const response = await openai.embeddings.create(...)
    return Array(1536).fill(0); // Dummy 1536-dim vector (OpenAI embedding size)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const twitterListener = new TwitterListener();
