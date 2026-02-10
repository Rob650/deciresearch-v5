import Database from 'better-sqlite3';
import { logger } from '../shared/logger.js';

interface TweetMetrics {
  tweetId: string;
  content: string;
  postedAt: number;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  engagement: number; // (likes + retweets + replies) / impressions
}

const db = new Database('deciresearch.db');

// Create analytics table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS tweet_analytics (
    tweetId TEXT PRIMARY KEY,
    content TEXT,
    postedAt INTEGER,
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    engagementRate REAL DEFAULT 0,
    lastUpdated INTEGER
  );

  CREATE TABLE IF NOT EXISTS token_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweetId TEXT,
    symbol TEXT,
    FOREIGN KEY (tweetId) REFERENCES tweet_analytics(tweetId)
  );
`);

export function recordTweet(
  tweetId: string,
  content: string,
  symbols: string[] = []
) {
  try {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO tweet_analytics (tweetId, content, postedAt, lastUpdated)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(tweetId, content, now, now);

    // Record which tokens were mentioned
    if (symbols.length > 0) {
      const mentionStmt = db.prepare(`
        INSERT INTO token_mentions (tweetId, symbol)
        VALUES (?, ?)
      `);
      const insertMentions = db.transaction((symbols: string[]) => {
        for (const symbol of symbols) {
          mentionStmt.run(tweetId, symbol);
        }
      });
      insertMentions(symbols);
    }

    logger.info(`Recorded tweet ${tweetId} with ${symbols.length} tokens`);
  } catch (error: any) {
    logger.error('Failed to record tweet', error.message);
  }
}

export function updateMetrics(
  tweetId: string,
  metrics: Partial<TweetMetrics>
) {
  try {
    const updates: string[] = [];
    const values: any[] = [];

    if (metrics.likes !== undefined) {
      updates.push('likes = ?');
      values.push(metrics.likes);
    }
    if (metrics.retweets !== undefined) {
      updates.push('retweets = ?');
      values.push(metrics.retweets);
    }
    if (metrics.replies !== undefined) {
      updates.push('replies = ?');
      values.push(metrics.replies);
    }
    if (metrics.impressions !== undefined) {
      updates.push('impressions = ?');
      values.push(metrics.impressions);
    }

    if (updates.length === 0) return;

    // Calculate engagement rate
    if (metrics.impressions && metrics.impressions > 0) {
      const engagementScore =
        ((metrics.likes || 0) + (metrics.retweets || 0) + (metrics.replies || 0)) /
        metrics.impressions;
      updates.push('engagementRate = ?');
      values.push(engagementScore);
    }

    updates.push('lastUpdated = ?');
    values.push(Date.now());

    values.push(tweetId);

    const stmt = db.prepare(`
      UPDATE tweet_analytics
      SET ${updates.join(', ')}
      WHERE tweetId = ?
    `);
    stmt.run(...values);

    logger.info(`Updated metrics for tweet ${tweetId}`);
  } catch (error: any) {
    logger.error('Failed to update metrics', error.message);
  }
}

export function getTopPerformers(limit: number = 10): TweetMetrics[] {
  try {
    return db
      .prepare(
        `SELECT * FROM tweet_analytics
         ORDER BY engagementRate DESC, likes DESC
         LIMIT ?`
      )
      .all(limit) as TweetMetrics[];
  } catch (error: any) {
    logger.error('Failed to get top performers', error.message);
    return [];
  }
}

export function getTokenMentionStats(symbol: string): {
  totalMentions: number;
  avgEngagement: number;
  bestTweet: TweetMetrics | null;
} {
  try {
    const mentions = db
      .prepare(
        `SELECT ta.* FROM tweet_analytics ta
         JOIN token_mentions tm ON ta.tweetId = tm.tweetId
         WHERE tm.symbol = ?
         ORDER BY ta.engagementRate DESC`
      )
      .all(symbol) as TweetMetrics[];

    const avgEngagement =
      mentions.length > 0
        ? mentions.reduce((sum, t) => sum + t.engagement, 0) / mentions.length
        : 0;

    return {
      totalMentions: mentions.length,
      avgEngagement,
      bestTweet: mentions.length > 0 ? mentions[0] : null
    };
  } catch (error: any) {
    logger.error(`Failed to get stats for ${symbol}`, error.message);
    return { totalMentions: 0, avgEngagement: 0, bestTweet: null };
  }
}

export function getDailyStats(): {
  tweetsPosted: number;
  totalEngagement: number;
  avgEngagement: number;
} {
  try {
    const dayAgo = Date.now() - 86400000;
    const result = db
      .prepare(
        `SELECT COUNT(*) as count, 
                SUM(likes + retweets + replies) as totalEng,
                AVG(engagementRate) as avgEng
         FROM tweet_analytics
         WHERE postedAt > ?`
      )
      .get(dayAgo) as {
      count: number;
      totalEng: number;
      avgEng: number;
    };

    return {
      tweetsPosted: result.count || 0,
      totalEngagement: result.totalEng || 0,
      avgEngagement: result.avgEng || 0
    };
  } catch (error: any) {
    logger.error('Failed to get daily stats', error.message);
    return { tweetsPosted: 0, totalEngagement: 0, avgEngagement: 0 };
  }
}
