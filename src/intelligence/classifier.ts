import { TwitterApi } from 'twitter-api-v2';
import { TrackedAccount } from './types.js';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

const client = new TwitterApi({
  bearerToken: process.env.TWITTER_BEARER_TOKEN
});

export class AccountClassifier {
  async classifyAccounts() {
    const accounts = [
      {
        handle: 'VitalikButerin',
        category: 'TECHNICAL' as const
      },
      {
        handle: 'hasufl',
        category: 'TECHNICAL' as const
      },
      {
        handle: 'Cobie',
        category: 'NARRATIVE' as const
      },
      {
        handle: 'lookonchain',
        category: 'SMART_MONEY' as const
      },
      {
        handle: 'MessariCrypto',
        category: 'MARKET_STRUCTURE' as const
      }
      // ... more accounts
    ];

    for (const acc of accounts) {
      try {
        const account = await this.scoreAccount(acc.handle, acc.category);
        if (account) {
          await vectorDB.storeAccount(account);
        }
      } catch (error: any) {
        logger.error(`Failed to classify @${acc.handle}`, error.message);
      }
    }
  }

  private async scoreAccount(handle: string, category: string): Promise<TrackedAccount | null> {
    try {
      // Fetch user data
      const user = await client.v2.userByUsername(handle, {
        'user.fields': [
          'public_metrics',
          'created_at',
          'description',
          'verified'
        ]
      });

      if (!user.data) return null;

      const metrics = user.data.public_metrics!;
      const followers = metrics.followers_count || 0;
      const following = metrics.following_count || 0;
      const tweets = metrics.tweet_count || 0;

      // Calculate credibility score
      let score = 50; // baseline

      // Verified accounts get boost
      if (user.data.verified) score += 15;

      // Follower growth (followers / following ratio)
      const followRatio = followers / Math.max(following, 1);
      if (followRatio > 10) score += 20;
      else if (followRatio > 2) score += 10;

      // Tweet frequency (more active = more credible in crypto)
      const accountAgeDays = (Date.now() - new Date(user.data.created_at!).getTime()) / (1000 * 60 * 60 * 24);
      const tweetsPerDay = tweets / Math.max(accountAgeDays, 1);
      if (tweetsPerDay > 5) score += 10;
      else if (tweetsPerDay > 1) score += 5;

      // Engagement (retweets + quote tweets)
      if (metrics.like_count && metrics.like_count > 1000000) score += 15;

      // Category-specific boosts
      if (category === 'TECHNICAL') {
        // Technical accounts should have less followers but higher engagement
        if (followers > 10000 && tweetsPerDay > 2) score += 10;
      } else if (category === 'SMART_MONEY') {
        // Smart money accounts should have decent followers
        if (followers > 50000) score += 10;
      } else if (category === 'NARRATIVE') {
        // Narrative accounts should be community leaders
        if (followers > 100000) score += 10;
      }

      // Cap score at 100
      score = Math.min(100, score);

      // Calculate engagement rate (rough estimate from public metrics)
      const engagementRate = metrics.like_count
        ? (metrics.like_count + (metrics.retweet_count || 0)) / (tweets * 100)
        : 0;

      const account: TrackedAccount = {
        id: user.data.id,
        handle: user.data.username!,
        category: category as any,
        credibilityScore: score,
        followerCount: followers,
        engagementRate: Math.min(1, engagementRate), // Cap at 100%
        accuracyScore: 50, // Will update over time by tracking them
        tags: [user.data.verified ? 'verified' : 'unverified'],
        addedAt: Date.now(),
        lastUpdated: Date.now()
      };

      logger.info(
        `Classified @${account.handle}: ${account.credibilityScore}/100 (${category})`
      );
      return account;
    } catch (error: any) {
      logger.error(`Classification failed for @${handle}`, error.message);
      return null;
    }
  }

  async updateCredibilityScores() {
    // Get all accounts
    const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];

    for (const category of categories) {
      const accounts = await vectorDB.getAccountsByCategory(category);

      for (const account of accounts) {
        try {
          // Get stats from stored tweets
          const stats = await vectorDB.getAccountStats(account.handle);
          if (!stats) continue;

          // Update credibility based on actual tweet performance
          let newScore = account.credibilityScore;

          // If bullish takes get more engagement, boost credibility
          if (stats.avgLikes > 1000) newScore += 5;
          if (stats.avgRetweets > 100) newScore += 5;

          // Cap at 100
          newScore = Math.min(100, newScore);

          if (newScore !== account.credibilityScore) {
            await vectorDB.updateAccountCredibility(account.handle, newScore);
          }
        } catch (error: any) {
          logger.error(
            `Failed to update credibility for @${account.handle}`,
            error.message
          );
        }
      }
    }

    logger.info('Credibility scores updated');
  }
}

export const classifier = new AccountClassifier();
