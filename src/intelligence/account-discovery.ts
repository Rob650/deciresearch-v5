import { TwitterApi } from 'twitter-api-v2';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';
import { TrackedAccount } from './types.js';

const client = new TwitterApi({
  bearerToken: process.env.TWITTER_BEARER_TOKEN
});

export class AccountDiscovery {
  // Auto-discover new accounts based on multiple signals
  async discoverAccountsFromNetwork(): Promise<string[]> {
    try {
      // Get all tracked accounts
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      const trackedHandles = new Set<string>();

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        accounts.forEach(a => trackedHandles.add(a.handle));
      }

      // Find accounts mentioned/retweeted by tracked accounts
      const mentionedAccounts = await this.findMentionedAccounts(
        Array.from(trackedHandles)
      );

      // Score and filter
      const candidates = await this.scoreAccountCandidates(mentionedAccounts);

      return candidates.slice(0, 20); // Return top 20 candidates
    } catch (error: any) {
      logger.error('Account discovery failed', error.message);
      return [];
    }
  }

  // Find accounts frequently mentioned by our core network
  private async findMentionedAccounts(
    coreAccounts: string[]
  ): Promise<Map<string, number>> {
    const mentionCounts = new Map<string, number>();

    try {
      for (const handle of coreAccounts) {
        try {
          // Get recent tweets from each account
          const tweets = await client.v2.userTimeline(handle, {
            max_results: 10,
            'tweet.fields': ['created_at']
          });

          // Extract mentions
          if (tweets.data) {
            for (const tweet of tweets.data) {
              const mentions = tweet.text.match(/@([a-zA-Z0-9_]+)/g) || [];
              for (const mention of mentions) {
                const username = mention.substring(1).toLowerCase();

                // Skip our tracked accounts
                if (coreAccounts.map(h => h.toLowerCase()).includes(username)) {
                  continue;
                }

                // Increment mention count
                const current = mentionCounts.get(username) || 0;
                mentionCounts.set(username, current + 1);
              }
            }
          }
        } catch (error: any) {
          logger.warn(`Failed to fetch tweets from ${handle}`, error.message);
        }
      }

      return mentionCounts;
    } catch (error: any) {
      logger.error('Failed to find mentioned accounts', error.message);
      return new Map();
    }
  }

  // Score accounts by credibility signals
  private async scoreAccountCandidates(
    candidates: Map<string, number>
  ): Promise<string[]> {
    const scored: { handle: string; score: number }[] = [];

    try {
      for (const [handle, mentions] of candidates.entries()) {
        try {
          // Fetch user data
          const user = await client.v2.userByUsername(handle, {
            'user.fields': ['public_metrics', 'verified', 'created_at']
          });

          if (!user.data) continue;

          // Calculate score
          let score = 0;

          // 1. Frequency of mentions in core network (0-30)
          const mentionScore = Math.min(30, mentions * 5);
          score += mentionScore;

          // 2. Follower count (0-25)
          const followers = user.data.public_metrics?.followers_count || 0;
          if (followers > 100000) score += 25;
          else if (followers > 50000) score += 20;
          else if (followers > 10000) score += 15;
          else if (followers > 5000) score += 10;
          else if (followers > 1000) score += 5;

          // 3. Verification (0-15)
          if (user.data.verified) score += 15;

          // 4. Account age (0-15)
          const accountAge = (Date.now() - new Date(user.data.created_at!).getTime()) / (1000 * 60 * 60 * 24);
          if (accountAge > 365) score += 15; // 1+ years
          else if (accountAge > 180) score += 10; // 6+ months
          else if (accountAge > 30) score += 5; // 1+ month

          // 5. Engagement (0-15)
          const engagement = user.data.public_metrics?.like_count || 0;
          if (engagement > 1000000) score += 15;
          else if (engagement > 100000) score += 10;
          else if (engagement > 10000) score += 5;

          if (score > 20) {
            // Minimum score to consider
            scored.push({ handle, score });
          }
        } catch (error: any) {
          logger.warn(`Failed to score @${handle}`, error.message);
        }
      }

      // Sort by score and return handles
      return scored.sort((a, b) => b.score - a.score).map(s => s.handle);
    } catch (error: any) {
      logger.error('Failed to score candidates', error.message);
      return [];
    }
  }

  // Detect topic experts (accounts consistently tweeting about specific topics)
  async discoverTopicExperts(topic: string): Promise<string[]> {
    try {
      logger.info(`Discovering experts on: ${topic}`);

      // Search for tweets about topic
      const tweets = await client.v2.search('recent', {
        query: `${topic} -is:retweet`,
        'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
        expansions: ['author_id'],
        max_results: 100
      });

      if (!tweets.data || !tweets.includes?.users) {
        return [];
      }

      // Score by engagement
      const authorScores = new Map<string, { handle: string; score: number }>();

      for (const tweet of tweets.data) {
        const user = tweets.includes.users?.find(u => u.id === tweet.author_id);
        if (!user) continue;

        const current = authorScores.get(user.id) || {
          handle: user.username,
          score: 0
        };

        // Add engagement score
        current.score +=
          (tweet.public_metrics?.like_count || 0) +
          (tweet.public_metrics?.retweet_count || 0) * 2;

        authorScores.set(user.id, current);
      }

      // Return top 10 experts
      return Array.from(authorScores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(a => a.handle);
    } catch (error: any) {
      logger.error(`Failed to discover topic experts for ${topic}`, error.message);
      return [];
    }
  }

  // Auto-categorize new accounts
  async categorizeAccount(handle: string): Promise<string | null> {
    try {
      // Fetch recent tweets
      const tweets = await client.v2.userTimeline(handle, {
        max_results: 20
      });

      if (!tweets.data || tweets.data.length === 0) {
        return null;
      }

      const content = tweets.data.map(t => t.text).join(' ').toLowerCase();

      // Simple categorization based on keywords
      if (
        content.includes('builder') ||
        content.includes('deploy') ||
        content.includes('smart contract') ||
        content.includes('code')
      ) {
        return 'TECHNICAL';
      }

      if (
        content.includes('narrative') ||
        content.includes('trend') ||
        content.includes('community') ||
        content.includes('adoption')
      ) {
        return 'NARRATIVE';
      }

      if (
        content.includes('whale') ||
        content.includes('accumulate') ||
        content.includes('position') ||
        content.includes('short')
      ) {
        return 'SMART_MONEY';
      }

      if (
        content.includes('market') ||
        content.includes('volume') ||
        content.includes('liquidity') ||
        content.includes('mcap')
      ) {
        return 'MARKET_STRUCTURE';
      }

      // Default to most likely category
      return 'NARRATIVE';
    } catch (error: any) {
      logger.error(`Failed to categorize @${handle}`, error.message);
      return null;
    }
  }
}

export const accountDiscovery = new AccountDiscovery();
