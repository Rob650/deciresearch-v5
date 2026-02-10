import { createClient } from '@supabase/supabase-js';
import { StoredTweet, TrackedAccount, KnowledgeEntry } from './types.js';
import { logger } from '../shared/logger.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

export class VectorDB {
  async init() {
    try {
      // Create tables if they don't exist
      await supabase.rpc('create_tables_if_not_exist');
      logger.info('Vector DB initialized');
    } catch (error: any) {
      logger.warn('Tables may already exist', error.message);
    }
  }

  async storeAccount(account: TrackedAccount) {
    try {
      const { error } = await supabase
        .from('tracked_accounts')
        .upsert({
          id: account.id,
          handle: account.handle,
          category: account.category,
          credibility_score: account.credibilityScore,
          follower_count: account.followerCount,
          engagement_rate: account.engagementRate,
          accuracy_score: account.accuracyScore,
          tags: account.tags,
          added_at: account.addedAt,
          last_updated: account.lastUpdated
        });

      if (error) throw error;
      logger.info(`Stored account: ${account.handle}`);
    } catch (error: any) {
      logger.error('Failed to store account', error.message);
    }
  }

  async storeTweet(tweet: StoredTweet) {
    try {
      const { error } = await supabase
        .from('tweets')
        .insert({
          id: tweet.id,
          tweet_id: tweet.tweetId,
          handle: tweet.handle,
          text: tweet.text,
          embedding: tweet.embedding,
          timestamp: tweet.timestamp,
          likes: tweet.likes,
          retweets: tweet.retweets,
          replies: tweet.replies,
          sentiment: tweet.sentiment,
          topics: tweet.topics,
          credibility_at_time: tweet.credibilityAtTime,
          stored_at: tweet.storedAt
        });

      if (error) throw error;
      logger.info(`Stored tweet from ${tweet.handle}`);
    } catch (error: any) {
      logger.error('Failed to store tweet', error.message);
    }
  }

  async semanticSearch(
    queryEmbedding: number[],
    limit: number = 10,
    category?: string
  ): Promise<StoredTweet[]> {
    try {
      let query = supabase
        .from('tweets')
        .select('*')
        .limit(limit)
        .order('similarity', { ascending: false });

      // Filter by category if provided (via account)
      if (category) {
        // This would require a join - simplified for now
      }

      // Note: Actual vector similarity search requires RPC or PostGIS
      // For now, returning by recency + engagement as proxy
      const { data, error } = await query.order('timestamp', {
        ascending: false
      });

      if (error) throw error;
      return (data || []) as StoredTweet[];
    } catch (error: any) {
      logger.error('Search failed', error.message);
      return [];
    }
  }

  async getAccountsByCategory(category: string): Promise<TrackedAccount[]> {
    try {
      const { data, error } = await supabase
        .from('tracked_accounts')
        .select('*')
        .eq('category', category)
        .order('credibility_score', { ascending: false });

      if (error) throw error;
      return (data || []) as TrackedAccount[];
    } catch (error: any) {
      logger.error('Failed to fetch accounts', error.message);
      return [];
    }
  }

  async getTopAccounts(limit: number = 5): Promise<TrackedAccount[]> {
    try {
      const { data, error } = await supabase
        .from('tracked_accounts')
        .select('*')
        .order('credibility_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as TrackedAccount[];
    } catch (error: any) {
      logger.error('Failed to fetch top accounts', error.message);
      return [];
    }
  }

  async getTweetsByAccount(handle: string): Promise<StoredTweet[]> {
    try {
      const { data, error } = await supabase
        .from('tweets')
        .select('*')
        .eq('handle', handle)
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as StoredTweet[];
    } catch (error: any) {
      logger.error(`Failed to fetch tweets from ${handle}`, error.message);
      return [];
    }
  }

  async getTweetsByTopic(topic: string): Promise<StoredTweet[]> {
    try {
      const { data, error } = await supabase
        .from('tweets')
        .select('*')
        .contains('topics', [topic])
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as StoredTweet[];
    } catch (error: any) {
      logger.error(`Failed to fetch tweets about ${topic}`, error.message);
      return [];
    }
  }

  async updateAccountCredibility(handle: string, newScore: number) {
    try {
      const { error } = await supabase
        .from('tracked_accounts')
        .update({
          credibility_score: newScore,
          last_updated: Date.now()
        })
        .eq('handle', handle);

      if (error) throw error;
      logger.info(`Updated credibility for ${handle}: ${newScore}`);
    } catch (error: any) {
      logger.error('Failed to update credibility', error.message);
    }
  }

  async getAccountStats(handle: string) {
    try {
      const { data, error } = await supabase
        .from('tweets')
        .select('sentiment, likes, retweets, replies')
        .eq('handle', handle);

      if (error) throw error;

      const tweets = (data || []) as StoredTweet[];
      const sentimentCounts = {
        bullish: tweets.filter(t => t.sentiment === 'bullish').length,
        bearish: tweets.filter(t => t.sentiment === 'bearish').length,
        neutral: tweets.filter(t => t.sentiment === 'neutral').length
      };

      const avgLikes =
        tweets.reduce((sum, t) => sum + t.likes, 0) / tweets.length || 0;
      const avgRetweets =
        tweets.reduce((sum, t) => sum + t.retweets, 0) / tweets.length || 0;

      return {
        totalTweets: tweets.length,
        sentimentCounts,
        avgLikes,
        avgRetweets,
        lastTweet: tweets[0]?.timestamp
      };
    } catch (error: any) {
      logger.error('Failed to get account stats', error.message);
      return null;
    }
  }
}

export const vectorDB = new VectorDB();
