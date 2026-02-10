import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

export interface NetworkHealth {
  totalAccounts: number;
  accountsByCategory: {
    [key: string]: number;
  };
  avgCredibilityScore: number;
  totalTweets: number;
  tweetsLast24h: number;
  avgEngagement: number;
  topAccounts: Array<{
    handle: string;
    score: number;
    category: string;
  }>;
  healthScore: number; // 0-100
  status: 'healthy' | 'degraded' | 'poor';
  lastUpdated: number;
  recommendations: string[];
}

export class NetworkHealth {
  async assess(): Promise<NetworkHealth> {
    try {
      logger.info('Assessing network health...');

      // Get all accounts
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      const allAccounts = [];
      const accountsByCategory: { [key: string]: number } = {};

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        allAccounts.push(...accounts);
        accountsByCategory[category] = accounts.length;
      }

      const totalAccounts = allAccounts.length;
      const avgCredibilityScore =
        allAccounts.reduce((sum, a) => sum + a.credibilityScore, 0) /
        Math.max(1, totalAccounts);

      // Get tweet stats
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;

      // Calculate health score
      let healthScore = 100;
      const recommendations: string[] = [];

      // 1. Account coverage (should have accounts in all categories)
      const categoriesWithAccounts = Object.values(accountsByCategory).filter(count => count > 0).length;
      if (categoriesWithAccounts < 4) {
        healthScore -= 20;
        recommendations.push(`Only ${categoriesWithAccounts}/4 categories covered. Need more TECHNICAL accounts.`);
      }

      // 2. Total accounts (should have 50+)
      if (totalAccounts < 40) {
        healthScore -= 30;
        recommendations.push(`Only ${totalAccounts} accounts. Target: 50+. Run discovery.`);
      } else if (totalAccounts < 50) {
        healthScore -= 10;
      }

      // 3. Credibility (should average 60+)
      if (avgCredibilityScore < 40) {
        healthScore -= 25;
        recommendations.push(`Low avg credibility: ${avgCredibilityScore.toFixed(1)}/100. May need to prune low-quality accounts.`);
      } else if (avgCredibilityScore < 60) {
        healthScore -= 10;
      }

      // 4. Account diversity (no category should be >50% of network)
      const maxCategory = Math.max(...Object.values(accountsByCategory));
      if (maxCategory / totalAccounts > 0.5) {
        healthScore -= 15;
        recommendations.push('Network too skewed to one category. Diversify.');
      }

      // 5. Activity (should have new tweets)
      const recentActivity = allAccounts.some(a => now - a.lastUpdated < 86400000);
      if (!recentActivity) {
        healthScore -= 15;
        recommendations.push('No recent account updates. Run listener.');
      }

      // Determine status
      let status: 'healthy' | 'degraded' | 'poor' = 'healthy';
      if (healthScore < 60) status = 'poor';
      else if (healthScore < 80) status = 'degraded';

      const topAccounts = allAccounts
        .sort((a, b) => b.credibilityScore - a.credibilityScore)
        .slice(0, 5)
        .map(a => ({
          handle: a.handle,
          score: a.credibilityScore,
          category: a.category
        }));

      const health: NetworkHealth = {
        totalAccounts,
        accountsByCategory,
        avgCredibilityScore,
        totalTweets: 0,
        tweetsLast24h: 0,
        avgEngagement: 0,
        topAccounts,
        healthScore: Math.max(0, Math.min(100, healthScore)),
        status,
        lastUpdated: now,
        recommendations
      };

      if (health.status !== 'healthy') {
        logger.warn(`Network health: ${health.status} (${health.healthScore}/100)`);
        logger.warn('Recommendations:', health.recommendations);
      } else {
        logger.info(`Network health: healthy (${health.healthScore}/100)`);
      }

      return health;
    } catch (error: any) {
      logger.error('Network health assessment failed', error.message);
      return {
        totalAccounts: 0,
        accountsByCategory: {},
        avgCredibilityScore: 0,
        totalTweets: 0,
        tweetsLast24h: 0,
        avgEngagement: 0,
        topAccounts: [],
        healthScore: 0,
        status: 'poor',
        lastUpdated: Date.now(),
        recommendations: ['Health assessment failed. Check logs.']
      };
    }
  }

  // Quick status check (for monitoring)
  async quickCheck(): Promise<{ healthy: boolean; message: string }> {
    const health = await this.assess();

    if (health.status === 'healthy') {
      return {
        healthy: true,
        message: `Network healthy: ${health.totalAccounts} accounts, avg credibility ${health.avgCredibilityScore.toFixed(0)}/100`
      };
    }

    return {
      healthy: false,
      message: `Network ${health.status}: ${health.recommendations[0] || 'See full assessment'}`
    };
  }
}

export const networkHealth = new NetworkHealth();
