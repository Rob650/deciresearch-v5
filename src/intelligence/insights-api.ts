import { ragEngine } from './rag.js';
import { vectorDB } from './vectordb.js';
import { networkHealth } from './network-health.js';
import { accountInfluence } from './account-influence.js';
import { logger } from '../shared/logger.js';
import { RAGContext, TrackedAccount } from './types.js';

export interface Insight {
  query: string;
  sentiment: {
    bullish: number;
    bearish: number;
    neutral: number;
    bullishPercent: number;
  };
  topThemes: Array<{
    theme: string;
    mentions: number;
    credibility: number;
  }>;
  topAccounts: TrackedAccount[];
  topInfluencers: Array<{
    handle: string;
    influenceScore: number;
    tier: string;
    momentum: string;
  }>;
  summary: string;
  confidence: number; // 0-100 based on data volume
  timestamp: number;
}

export class InsightsAPI {
  async getInsight(query: string): Promise<Insight> {
    try {
      logger.info(`Generating insight for: ${query}`);

      // Query RAG engine
      const ragContext = await ragEngine.queryContext(query);

      // Calculate sentiment percentages
      const totalSentiment =
        ragContext.sentiment.bullish +
        ragContext.sentiment.bearish +
        ragContext.sentiment.neutral;

      const bullishPercent =
        totalSentiment > 0
          ? (ragContext.sentiment.bullish / totalSentiment) * 100
          : 0;

      // Calculate confidence (based on data volume)
      let confidence = Math.min(100, (ragContext.relevantTweets.length / 20) * 100);

      if (ragContext.relevantTweets.length === 0) {
        confidence = 0;
        logger.warn(`Low confidence insight for: ${query}`);
      }

      // Get top influencers by account influence score
      const topInfluencersList = await this.getTopInfluencers(
        ragContext.topAccounts.map(a => a.handle),
        5
      );

      const insight: Insight = {
        query,
        sentiment: {
          bullish: ragContext.sentiment.bullish,
          bearish: ragContext.sentiment.bearish,
          neutral: ragContext.sentiment.neutral,
          bullishPercent: Math.round(bullishPercent)
        },
        topThemes: ragContext.themes,
        topAccounts: ragContext.topAccounts,
        topInfluencers: topInfluencersList,
        summary: ragContext.summary,
        confidence: Math.round(confidence),
        timestamp: Date.now()
      };

      return insight;
    } catch (error: any) {
      logger.error('Failed to generate insight', error.message);
      return {
        query,
        sentiment: {
          bullish: 0,
          bearish: 0,
          neutral: 0,
          bullishPercent: 0
        },
        topThemes: [],
        topAccounts: [],
        topInfluencers: [],
        summary: 'Unable to generate insight. Try again later.',
        confidence: 0,
        timestamp: Date.now()
      };
    }
  }

  async compareTopics(topic1: string, topic2: string): Promise<{
    topic1: Insight;
    topic2: Insight;
    comparison: string;
  }> {
    try {
      const insight1 = await this.getInsight(topic1);
      const insight2 = await this.getInsight(topic2);

      let comparison = '';
      if (insight1.sentiment.bullishPercent > insight2.sentiment.bullishPercent + 10) {
        comparison = `${topic1} is more bullish (${insight1.sentiment.bullishPercent}% vs ${insight2.sentiment.bullishPercent}%)`;
      } else if (insight2.sentiment.bullishPercent > insight1.sentiment.bullishPercent + 10) {
        comparison = `${topic2} is more bullish (${insight2.sentiment.bullishPercent}% vs ${insight1.sentiment.bullishPercent}%)`;
      } else {
        comparison = `${topic1} and ${topic2} have similar sentiment`;
      }

      return {
        topic1: insight1,
        topic2: insight2,
        comparison
      };
    } catch (error: any) {
      logger.error('Failed to compare topics', error.message);
      throw error;
    }
  }

  async getTrendingTopics(limit: number = 5): Promise<string[]> {
    try {
      // Get top themes from vector DB
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      const themeMap = new Map<string, number>();

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        // In a real implementation, would aggregate tweet topics
        // For now, return top narrative themes
      }

      // Return placeholder
      return [
        'AI agents',
        'DeFi innovation',
        'Layer 2 scaling',
        'On-chain activity',
        'Regulatory updates'
      ].slice(0, limit);
    } catch (error: any) {
      logger.error('Failed to get trending topics', error.message);
      return [];
    }
  }

  async getNetworkOpinion(topic: string): Promise<{
    consensus: 'bullish' | 'bearish' | 'mixed';
    strength: number; // 0-100
    insight: Insight;
  }> {
    try {
      const insight = await this.getInsight(topic);

      // Determine consensus
      let consensus: 'bullish' | 'bearish' | 'mixed' = 'mixed';
      let strength = 0;

      if (insight.sentiment.bullishPercent > 60) {
        consensus = 'bullish';
        strength = insight.sentiment.bullishPercent - 50;
      } else if (insight.sentiment.bullishPercent < 40) {
        consensus = 'bearish';
        strength = 50 - insight.sentiment.bullishPercent;
      } else {
        strength = Math.abs(insight.sentiment.bullishPercent - 50);
      }

      return {
        consensus,
        strength: Math.round(strength),
        insight
      };
    } catch (error: any) {
      logger.error('Failed to get network opinion', error.message);
      throw error;
    }
  }

  async getAccountOpinionOnTopic(
    handle: string,
    topic: string
  ): Promise<{ opinion: string; analysis: string }> {
    try {
      // Get tweets from specific account about topic
      const tweets = await vectorDB.getTweetsByAccount(handle);
      const relevant = tweets.filter(t =>
        t.text.toLowerCase().includes(topic.toLowerCase())
      );

      if (relevant.length === 0) {
        return {
          opinion: 'no opinion',
          analysis: `@${handle} has not tweeted about ${topic}`
        };
      }

      // Aggregate sentiment
      const bullish = relevant.filter(t => t.sentiment === 'bullish').length;
      const bearish = relevant.filter(t => t.sentiment === 'bearish').length;

      let opinion = 'neutral';
      if (bullish > bearish) opinion = 'bullish';
      else if (bearish > bullish) opinion = 'bearish';

      return {
        opinion,
        analysis: `@${handle}: ${bullish} bullish, ${bearish} bearish tweets about ${topic}`
      };
    } catch (error: any) {
      logger.error(`Failed to get opinion from @${handle}`, error.message);
      return {
        opinion: 'unknown',
        analysis: 'Unable to retrieve opinion'
      };
    }
  }

  private async getTopInfluencers(
    handles: string[],
    limit: number = 5
  ): Promise<
    Array<{
      handle: string;
      influenceScore: number;
      tier: string;
      momentum: string;
    }>
  > {
    try {
      const influencers = await accountInfluence.rankByInfluence(handles);
      return influencers
        .slice(0, limit)
        .map(inf => ({
          handle: inf.handle,
          influenceScore: inf.influenceScore,
          tier: inf.tier,
          momentum: inf.momentum
        }));
    } catch (error: any) {
      logger.warn('Failed to get top influencers', error.message);
      return [];
    }
  }

  async getNetworkHealth(): Promise<any> {
    return networkHealth.assess();
  }
}

export const insightsAPI = new InsightsAPI();
