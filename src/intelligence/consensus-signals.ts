import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

export interface ConsensusSignal {
  narrative: string;
  accountsAgreeing: string[]; // handles of agreeing accounts
  accountCount: number;
  avgCredibility: number;
  unusualConsensus: boolean; // true if > 5 accounts agree (unusual)
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'; // based on credibility scores
  firstMentioned: number; // timestamp
  lastMentioned: number; // timestamp
  momentum: 'decreasing' | 'stable' | 'increasing';
  mentionVelocity: number; // mentions per day
  sentiment: { bullish: number; bearish: number; neutral: number };
}

export class ConsensusSignals {
  async detectConsensus(query: string, timeWindowHours: number = 48): Promise<ConsensusSignal[]> {
    try {
      logger.info(`Detecting consensus signals for: ${query}`);

      // Get tweets matching query from timeframe
      const tweets = await vectorDB.getTweetsByTopic(query);
      const timeWindow = timeWindowHours * 60 * 60 * 1000;
      const cutoff = Date.now() - timeWindow;

      const recentTweets = tweets.filter(t => t.timestamp > cutoff);

      if (recentTweets.length === 0) {
        return [];
      }

      // Group by account to find independent agreement
      const accountMap = new Map<string, any[]>();
      for (const tweet of recentTweets) {
        if (!accountMap.has(tweet.handle)) {
          accountMap.set(tweet.handle, []);
        }
        accountMap.get(tweet.handle)!.push(tweet);
      }

      // Detect narratives (themes that multiple accounts mention independently)
      const narrativeMap = new Map<string, {
        accounts: string[];
        tweets: any[];
        credibilities: number[];
        firstTime: number;
        lastTime: number;
      }>();

      for (const [handle, tweets] of accountMap.entries()) {
        // Get account credibility
        const accountCredibility = await this.getAccountCredibility(handle);

        for (const tweet of tweets) {
          for (const theme of tweet.topics || []) {
            if (!narrativeMap.has(theme)) {
              narrativeMap.set(theme, {
                accounts: [],
                tweets: [],
                credibilities: [],
                firstTime: tweet.timestamp,
                lastTime: tweet.timestamp
              });
            }

            const entry = narrativeMap.get(theme)!;
            if (!entry.accounts.includes(handle)) {
              entry.accounts.push(handle);
              entry.credibilities.push(accountCredibility);
            }
            entry.tweets.push(tweet);
            entry.lastTime = Math.max(entry.lastTime, tweet.timestamp);
          }
        }
      }

      // Filter for consensus: need 5+ accounts (unusual)
      const signals: ConsensusSignal[] = [];

      for (const [narrative, data] of narrativeMap.entries()) {
        // Only flag if unusual consensus (5+ accounts is rare)
        if (data.accounts.length < 5) {
          continue;
        }

        const avgCredibility = data.credibilities.reduce((a, b) => a + b, 0) / data.credibilities.length;

        // Determine confidence based on avg credibility
        let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        if (avgCredibility >= 85) confidence = 'HIGH';
        else if (avgCredibility >= 70) confidence = 'MEDIUM';

        // Calculate momentum (mention velocity)
        const timeSpan = (data.lastTime - data.firstTime) / (1000 * 60 * 60); // hours
        const mentionVelocity = timeSpan > 0 ? data.tweets.length / timeSpan : 0;

        // Determine momentum direction
        const midpoint = data.firstTime + (data.lastTime - data.firstTime) / 2;
        const firstHalf = data.tweets.filter(t => t.timestamp <= midpoint).length;
        const secondHalf = data.tweets.filter(t => t.timestamp > midpoint).length;

        let momentum: 'decreasing' | 'stable' | 'increasing' = 'stable';
        if (secondHalf > firstHalf * 1.2) momentum = 'increasing';
        else if (secondHalf < firstHalf * 0.8) momentum = 'decreasing';

        // Calculate sentiment
        const bullish = data.tweets.filter(t => t.sentiment === 'bullish').length;
        const bearish = data.tweets.filter(t => t.sentiment === 'bearish').length;
        const neutral = data.tweets.filter(t => t.sentiment === 'neutral').length;

        const signal: ConsensusSignal = {
          narrative,
          accountsAgreeing: data.accounts,
          accountCount: data.accounts.length,
          avgCredibility,
          unusualConsensus: data.accounts.length >= 5,
          confidence,
          firstMentioned: data.firstTime,
          lastMentioned: data.lastTime,
          momentum,
          mentionVelocity,
          sentiment: {
            bullish: (bullish / data.tweets.length) * 100,
            bearish: (bearish / data.tweets.length) * 100,
            neutral: (neutral / data.tweets.length) * 100
          }
        };

        signals.push(signal);
      }

      // Sort by account count (consensus strength)
      return signals.sort((a, b) => b.accountCount - a.accountCount);
    } catch (error: any) {
      logger.error('Failed to detect consensus signals', error.message);
      return [];
    }
  }

  private async getAccountCredibility(handle: string): Promise<number> {
    try {
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        const account = accounts.find(a => a.handle.toLowerCase() === handle.toLowerCase());
        if (account) {
          return account.credibilityScore;
        }
      }
      return 50; // Default if not found
    } catch (error: any) {
      logger.warn(`Failed to get credibility for ${handle}`, error.message);
      return 50;
    }
  }

  async getTopConsensusSignals(limit: number = 5): Promise<ConsensusSignal[]> {
    try {
      // Get all topics from recent tweets
      const topics = new Set<string>();
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        for (const account of accounts) {
          const tweets = await vectorDB.getTweetsByAccount(account.handle);
          for (const tweet of tweets.slice(0, 5)) {
            // Last 5 tweets per account
            for (const topic of tweet.topics || []) {
              topics.add(topic);
            }
          }
        }
      }

      // Detect consensus for each topic
      const allSignals: ConsensusSignal[] = [];
      for (const topic of Array.from(topics)) {
        const signals = await this.detectConsensus(topic, 48);
        allSignals.push(...signals);
      }

      // Return top signals by account count and confidence
      return allSignals
        .sort((a, b) => {
          const credWeightA = a.accountCount * (a.confidence === 'HIGH' ? 2 : 1);
          const credWeightB = b.accountCount * (b.confidence === 'HIGH' ? 2 : 1);
          return credWeightB - credWeightA;
        })
        .slice(0, limit);
    } catch (error: any) {
      logger.error('Failed to get top consensus signals', error.message);
      return [];
    }
  }

  formatSignalForTweet(signal: ConsensusSignal): string {
    const emoji = signal.momentum === 'increasing' ? '🚀' : signal.confidence === 'HIGH' ? '📍' : '👀';
    const momentumStr = signal.momentum === 'increasing'
      ? 'accelerating'
      : signal.momentum === 'decreasing'
      ? 'cooling'
      : 'steady';

    return `${emoji} Consensus signal: ${signal.accountCount} credible accounts independently discussing "${signal.narrative}" (${signal.momentum}). ${signal.confidence} confidence. ${signal.sentiment.bullish.toFixed(0)}% bullish.`;
  }
}

export const consensusSignals = new ConsensusSignals();
