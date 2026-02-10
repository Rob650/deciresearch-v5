import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

export interface AccountInfluence {
  handle: string;
  credibility: number; // 0-100 (existing)
  influenceScore: number; // 0-100 (NEW)
  citedByOthers: number; // How often referenced in replies/mentions
  conversationStarter: number; // Their tweets generate reply chains
  earlyNarratives: number; // Said it first, others followed
  accuracy: number; // Historical prediction accuracy (0-100)
  tier: 'trendsetter' | 'leader' | 'contributor' | 'follower'; // influence tier
  lastUpdated: number;
}

export class AccountInfluence {
  async scoreAccountInfluence(handle: string): Promise<AccountInfluence | null> {
    try {
      logger.info(`Scoring influence for @${handle}`);

      // Get base credibility
      const baseCredibility = await this.getAccountCredibility(handle);
      if (baseCredibility === null) {
        return null;
      }

      // 1. Citation frequency (how often others mention/reply to them)
      const citedByOthers = await this.countCitations(handle);

      // 2. Conversation starter score (do their tweets get reply chains?)
      const conversationStarter = await this.scoreConversationStarter(handle);

      // 3. Early narratives (did they identify trends early?)
      const earlyNarratives = await this.scoreEarlyNarratives(handle);

      // 4. Accuracy score (how often were their takes correct in hindsight?)
      const accuracy = await this.calculateAccuracy(handle);

      // Calculate influence score (weighted combination)
      const influenceScore = Math.round(
        citedByOthers * 0.25 +
        conversationStarter * 0.25 +
        earlyNarratives * 0.25 +
        accuracy * 0.25
      );

      // Determine tier
      let tier: 'trendsetter' | 'leader' | 'contributor' | 'follower' = 'follower';
      if (influenceScore >= 80) tier = 'trendsetter';
      else if (influenceScore >= 65) tier = 'leader';
      else if (influenceScore >= 50) tier = 'contributor';

      const influence: AccountInfluence = {
        handle,
        credibility: baseCredibility,
        influenceScore,
        citedByOthers,
        conversationStarter,
        earlyNarratives,
        accuracy,
        tier,
        lastUpdated: Date.now()
      };

      logger.info(
        `@${handle}: influence ${influenceScore}/100 (${tier}), credibility ${baseCredibility}/100`
      );
      return influence;
    } catch (error: any) {
      logger.error(`Failed to score influence for @${handle}`, error.message);
      return null;
    }
  }

  private async countCitations(handle: string): Promise<number> {
    try {
      // Get all tweets that mention this account
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      let citationCount = 0;

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        for (const account of accounts) {
          if (account.handle.toLowerCase() === handle.toLowerCase()) continue;

          const tweets = await vectorDB.getTweetsByAccount(account.handle);
          const citingTweets = tweets.filter(
            t => t.text.toLowerCase().includes(`@${handle.toLowerCase()}`)
          );
          citationCount += citingTweets.length;
        }
      }

      // Normalize to 0-100 scale (assume 0-50 is normal range)
      return Math.min(100, (citationCount / 50) * 100);
    } catch (error: any) {
      logger.warn(`Failed to count citations for @${handle}`, error.message);
      return 0;
    }
  }

  private async scoreConversationStarter(handle: string): Promise<number> {
    try {
      const tweets = await vectorDB.getTweetsByAccount(handle);

      if (tweets.length === 0) return 0;

      // Score based on reply count (more replies = conversation starter)
      const avgReplies = tweets.reduce((sum, t) => sum + (t.replies || 0), 0) / tweets.length;
      const avgLikes = tweets.reduce((sum, t) => sum + (t.likes || 0), 0) / tweets.length;

      // Ratio of replies to likes indicates conversation
      const replyRatio = avgLikes > 0 ? (avgReplies / avgLikes) * 100 : 0;

      // Also consider total engagement
      const avgEngagement = tweets.reduce((sum, t) => {
        return sum + ((t.likes || 0) + (t.retweets || 0) + (t.replies || 0));
      }, 0) / tweets.length;

      // Normalize: good conversation starters get 30+ avg replies
      const score = Math.min(100, ((avgReplies / 30) * 100 + replyRatio) / 2);

      return Math.round(score);
    } catch (error: any) {
      logger.warn(`Failed to score conversation starter for @${handle}`, error.message);
      return 0;
    }
  }

  private async scoreEarlyNarratives(handle: string): Promise<number> {
    try {
      const tweets = await vectorDB.getTweetsByAccount(handle);

      if (tweets.length === 0) return 0;

      // Look for tweets that became major narratives later
      const now = Date.now();
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      // Get tweets from 2-4 weeks ago
      const oldTweets = tweets.filter(
        t => t.timestamp < oneWeekAgo && t.timestamp > oneWeekAgo - 14 * 24 * 60 * 60 * 1000
      );

      if (oldTweets.length === 0) return 50; // Default if not enough history

      // Check if those themes are still being discussed
      let earlyCalls = 0;
      for (const oldTweet of oldTweets) {
        for (const theme of oldTweet.topics || []) {
          // Check if theme is still hot
          // (In production, query if theme had >5 mentions last week)
          earlyCalls++;
        }
      }

      // Normalize: good early callers get 70%+ of their old themes continuing
      const score = Math.min(100, (earlyCalls / Math.max(1, oldTweets.length)) * 100);

      return Math.round(score);
    } catch (error: any) {
      logger.warn(`Failed to score early narratives for @${handle}`, error.message);
      return 0;
    }
  }

  private async calculateAccuracy(handle: string): Promise<number> {
    try {
      const tweets = await vectorDB.getTweetsByAccount(handle);

      if (tweets.length < 5) return 50; // Not enough data

      // Analyze bullish tweets from 30+ days ago
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const oldTweets = tweets.filter(t => t.timestamp < thirtyDaysAgo);

      if (oldTweets.length === 0) return 50; // No old data

      let correctCalls = 0;
      for (const tweet of oldTweets) {
        // If they said bullish and price went up, that's correct
        // (Simplified: use engagement + retweets as proxy for validation)
        if (tweet.sentiment === 'bullish' && (tweet.retweets || 0) > 10) {
          correctCalls++;
        }
      }

      const accuracy = (correctCalls / oldTweets.length) * 100;
      return Math.round(Math.min(100, accuracy));
    } catch (error: any) {
      logger.warn(`Failed to calculate accuracy for @${handle}`, error.message);
      return 50;
    }
  }

  private async getAccountCredibility(handle: string): Promise<number | null> {
    try {
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        const account = accounts.find(a => a.handle.toLowerCase() === handle.toLowerCase());
        if (account) {
          return account.credibilityScore;
        }
      }
      return null;
    } catch (error: any) {
      logger.warn(`Failed to get credibility for @${handle}`, error.message);
      return null;
    }
  }

  async getTrendsetters(limit: number = 5): Promise<AccountInfluence[]> {
    try {
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      const influences: AccountInfluence[] = [];

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        for (const account of accounts) {
          const influence = await this.scoreAccountInfluence(account.handle);
          if (influence && influence.tier === 'trendsetter') {
            influences.push(influence);
          }
        }
      }

      return influences.sort((a, b) => b.influenceScore - a.influenceScore).slice(0, limit);
    } catch (error: any) {
      logger.error('Failed to get trendsetters', error.message);
      return [];
    }
  }

  async weightInsight(handle: string, baseWeight: number = 1): Promise<number> {
    try {
      const influence = await this.scoreAccountInfluence(handle);
      if (!influence) return baseWeight;

      // Weight by influence tier
      const tierMultiplier: { [key: string]: number } = {
        trendsetter: 10,
        leader: 5,
        contributor: 2,
        follower: 1
      };

      return baseWeight * tierMultiplier[influence.tier];
    } catch (error: any) {
      logger.error(`Failed to weight insight from @${handle}`, error.message);
      return baseWeight;
    }
  }

  async citeMostInfluential(handles: string[], limit: number = 3): Promise<string[]> {
    try {
      // Score all handles and return top ones for citation
      const scored = await Promise.all(
        handles.map(async h => ({
          handle: h,
          influence: await this.scoreAccountInfluence(h)
        }))
      );

      return scored
        .filter(s => s.influence)
        .sort((a, b) => (b.influence?.influenceScore || 0) - (a.influence?.influenceScore || 0))
        .slice(0, limit)
        .map(s => s.handle);
    } catch (error: any) {
      logger.error('Failed to cite most influential', error.message);
      return handles.slice(0, limit);
    }
  }
}

export const accountInfluence = new AccountInfluence();
