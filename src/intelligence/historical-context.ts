import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

export interface HistoricalTrend {
  topic: string;
  periods: {
    timeRange: string; // "7d ago", "30d ago", "now"
    bullishPercent: number;
    bearishPercent: number;
    mentionCount: number;
    topThemes: string[];
  }[];
  trend: 'strengthening' | 'weakening' | 'stable';
  trendDescription: string;
}

export class HistoricalContext {
  async getTrendHistory(topic: string): Promise<HistoricalTrend | null> {
    try {
      logger.info(`Fetching historical context for: ${topic}`);

      // Get tweets from different time periods
      const now = Date.now();
      const _7daysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const _30daysAgo = now - 30 * 24 * 60 * 60 * 1000;

      // Current sentiment (last 7 days)
      const currentTweets = await vectorDB.getTweetsByTopic(topic);
      const currentPeriod = currentTweets.filter(t => t.timestamp > _7daysAgo);

      // 7-30 days ago
      const oldTweets = currentTweets.filter(
        t => t.timestamp > _30daysAgo && t.timestamp <= _7daysAgo
      );

      // 30+ days ago
      const veryOldTweets = currentTweets.filter(t => t.timestamp <= _30daysAgo);

      if (currentPeriod.length === 0) {
        logger.warn(`No recent data for topic: ${topic}`);
        return null;
      }

      // Calculate sentiment for each period
      const calculateSentiment = (tweets: any[]) => {
        if (tweets.length === 0) {
          return { bullish: 0, bearish: 0, neutral: 0, count: 0 };
        }

        const bullish = tweets.filter(t => t.sentiment === 'bullish').length;
        const bearish = tweets.filter(t => t.sentiment === 'bearish').length;
        const neutral = tweets.filter(t => t.sentiment === 'neutral').length;

        return {
          bullish: (bullish / tweets.length) * 100,
          bearish: (bearish / tweets.length) * 100,
          neutral: (neutral / tweets.length) * 100,
          count: tweets.length
        };
      };

      // Get top themes
      const extractThemes = (tweets: any[]): string[] => {
        const themeMap = new Map<string, number>();
        for (const tweet of tweets) {
          for (const theme of tweet.topics || []) {
            themeMap.set(theme, (themeMap.get(theme) || 0) + 1);
          }
        }
        return Array.from(themeMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([theme]) => theme);
      };

      const currentSentiment = calculateSentiment(currentPeriod);
      const oldSentiment = calculateSentiment(oldTweets);
      const veryOldSentiment = calculateSentiment(veryOldTweets);

      // Determine trend
      let trend: 'strengthening' | 'weakening' | 'stable' = 'stable';
      let trendDescription = '';

      if (currentSentiment.bullish > oldSentiment.bullish + 10) {
        trend = 'strengthening';
        trendDescription = `bullish momentum building (${oldSentiment.bullish.toFixed(0)}% → ${currentSentiment.bullish.toFixed(0)}%)`;
      } else if (currentSentiment.bullish < oldSentiment.bullish - 10) {
        trend = 'weakening';
        trendDescription = `sentiment cooling (${oldSentiment.bullish.toFixed(0)}% → ${currentSentiment.bullish.toFixed(0)}%)`;
      } else {
        trend = 'stable';
        trendDescription = `sentiment stable around ${currentSentiment.bullish.toFixed(0)}% bullish`;
      }

      const history: HistoricalTrend = {
        topic,
        periods: [
          {
            timeRange: '30+ days ago',
            bullishPercent: veryOldSentiment.bullish,
            bearishPercent: veryOldSentiment.bearish,
            mentionCount: veryOldTweets.length,
            topThemes: extractThemes(veryOldTweets)
          },
          {
            timeRange: '7-30 days ago',
            bullishPercent: oldSentiment.bullish,
            bearishPercent: oldSentiment.bearish,
            mentionCount: oldTweets.length,
            topThemes: extractThemes(oldTweets)
          },
          {
            timeRange: 'last 7 days',
            bullishPercent: currentSentiment.bullish,
            bearishPercent: currentSentiment.bearish,
            mentionCount: currentPeriod.length,
            topThemes: extractThemes(currentPeriod)
          }
        ],
        trend,
        trendDescription
      };

      return history;
    } catch (error: any) {
      logger.error('Failed to get trend history', error.message);
      return null;
    }
  }

  async getContextString(topic: string): Promise<string> {
    try {
      const history = await this.getTrendHistory(topic);

      if (!history) {
        return ''; // No historical data
      }

      const current = history.periods[2]; // Last 7 days
      const past = history.periods[0]; // 30+ days ago

      let contextStr = '';

      // Build context string for use in replies
      if (past.mentionCount > 0) {
        const bullishChange = current.bullishPercent - past.bullishPercent;
        const changeStr = bullishChange > 0
          ? `up ${bullishChange.toFixed(0)}pp`
          : bullishChange < 0
          ? `down ${Math.abs(bullishChange).toFixed(0)}pp`
          : 'stable';

        contextStr += `Network sentiment on ${topic}: ${current.bullishPercent.toFixed(0)}% bullish now (was ${past.bullishPercent.toFixed(0)}% a month ago, ${changeStr}). `;

        // Add trend note
        if (history.trend === 'strengthening') {
          contextStr += `Momentum building. `;
        } else if (history.trend === 'weakening') {
          contextStr += `Caution: sentiment cooling. `;
        }

        // Add theme evolution
        if (current.topThemes.length > 0 && past.topThemes.length > 0) {
          const sharedThemes = current.topThemes.filter(t => past.topThemes.includes(t));
          const newThemes = current.topThemes.filter(t => !past.topThemes.includes(t));

          if (newThemes.length > 0) {
            contextStr += `New focus: ${newThemes.join(', ')}. `;
          }
        }
      }

      return contextStr;
    } catch (error: any) {
      logger.error('Failed to generate context string', error.message);
      return '';
    }
  }

  async compareTopics(topic1: string, topic2: string): Promise<string> {
    try {
      const history1 = await this.getTrendHistory(topic1);
      const history2 = await this.getTrendHistory(topic2);

      if (!history1 || !history2) {
        return '';
      }

      const current1 = history1.periods[2];
      const current2 = history2.periods[2];

      const diff = current1.bullishPercent - current2.bullishPercent;

      if (Math.abs(diff) < 10) {
        return `${topic1} and ${topic2} have similar sentiment (${current1.bullishPercent.toFixed(0)}% vs ${current2.bullishPercent.toFixed(0)}% bullish).`;
      } else if (diff > 0) {
        return `${topic1} more bullish than ${topic2} (${current1.bullishPercent.toFixed(0)}% vs ${current2.bullishPercent.toFixed(0)}%).`;
      } else {
        return `${topic2} more bullish than ${topic1} (${current2.bullishPercent.toFixed(0)}% vs ${current1.bullishPercent.toFixed(0)}%).`;
      }
    } catch (error: any) {
      logger.error('Failed to compare topics', error.message);
      return '';
    }
  }

  // Get when a topic was last analyzed
  async getLastAnalyzedTime(topic: string): Promise<number | null> {
    try {
      const tweets = await vectorDB.getTweetsByTopic(topic);
      if (tweets.length === 0) return null;

      return Math.max(...tweets.map(t => t.timestamp));
    } catch (error: any) {
      logger.error('Failed to get last analyzed time', error.message);
      return null;
    }
  }

  // Get days since topic was last analyzed
  async getDaysSinceLastAnalysis(topic: string): Promise<number | null> {
    try {
      const lastTime = await this.getLastAnalyzedTime(topic);
      if (!lastTime) return null;

      const daysSince = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
      return daysSince;
    } catch (error: any) {
      logger.error('Failed to calculate days since analysis', error.message);
      return null;
    }
  }
}

export const historicalContext = new HistoricalContext();
