import { TwitterApi } from 'twitter-api-v2';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';
import { TrackedAccount } from './types.js';
import Anthropic from '@anthropic-ai/sdk';

const client = new TwitterApi({
  bearerToken: process.env.TWITTER_BEARER_TOKEN
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export interface DiscoveryCandidate {
  handle: string;
  score: number;
  category: string;
  reason: string;
  lastSeen: number;
  confirmationCount: number; // How many discovery cycles found this
  status: 'suggested' | 'approved' | 'rejected' | 'pruned';
}

const DISCOVERY_CONFIG = {
  scoreThreshold: 50, // High threshold - will tune down after testing
  maxNewAccountsPerCycle: 5, // Cap additions
  confirmationRunsNeeded: 2, // Must appear in 2+ cycles before auto-add
  decayDays: 30, // Remove if not seen in 30 days
  probationPeriod: 3 // New accounts on probation for 3 cycles
};

export class AccountDiscovery {
  private candidates: Map<string, DiscoveryCandidate> = new Map();
  private discoveryLog: any[] = [];

  async discoverAccountsFromNetwork(): Promise<DiscoveryCandidate[]> {
    try {
      logger.info('Starting smart account discovery...');

      // Get all tracked accounts
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      const trackedHandles = new Set<string>();

      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        accounts.forEach(a => trackedHandles.add(a.handle.toLowerCase()));
      }

      // Find accounts mentioned by tracked accounts
      const mentionedAccounts = await this.findMentionedAccounts(
        Array.from(trackedHandles)
      );

      // Score and filter
      const candidates = await this.scoreAccountCandidates(
        mentionedAccounts,
        trackedHandles
      );

      // Increment confirmation count for existing candidates
      for (const candidate of candidates) {
        const existing = this.candidates.get(candidate.handle);
        if (existing) {
          candidate.confirmationCount = existing.confirmationCount + 1;
        } else {
          candidate.confirmationCount = 1;
        }
        this.candidates.set(candidate.handle, candidate);
      }

      // Prune old candidates (not seen in 30 days)
      await this.pruneCandidates();

      // Log discovery run
      this.logDiscoveryRun(candidates);

      logger.info(`Discovery: ${candidates.length} candidates, ready for approval`);
      return candidates;
    } catch (error: any) {
      logger.error('Account discovery failed', error.message);
      return [];
    }
  }

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

                // Skip core network accounts
                if (coreAccounts.includes(username)) continue;

                // Skip if already tracked
                if (this.candidates.has(username) && 
                    this.candidates.get(username)?.status === 'approved') {
                  continue;
                }

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

  private async scoreAccountCandidates(
    candidates: Map<string, number>,
    trackedHandles: Set<string>
  ): Promise<DiscoveryCandidate[]> {
    const scored: DiscoveryCandidate[] = [];

    try {
      for (const [handle, mentions] of candidates.entries()) {
        try {
          // Skip if already tracked or rejected
          if (trackedHandles.has(handle.toLowerCase())) continue;
          const existing = this.candidates.get(handle);
          if (existing?.status === 'rejected') continue;

          // Fetch user data
          const user = await client.v2.userByUsername(handle, {
            'user.fields': ['public_metrics', 'verified', 'created_at']
          });

          if (!user.data) continue;

          // Calculate score
          let score = 0;
          let reasonParts = [];

          // 1. Mention frequency (0-30)
          const mentionScore = Math.min(30, mentions * 3);
          if (mentionScore > 0) {
            score += mentionScore;
            reasonParts.push(`${mentions} mentions (${mentionScore}pts)`);
          }

          // 2. Follower count (0-25)
          const followers = user.data.public_metrics?.followers_count || 0;
          let followerScore = 0;
          if (followers > 100000) followerScore = 25;
          else if (followers > 50000) followerScore = 20;
          else if (followers > 10000) followerScore = 15;
          else if (followers > 5000) followerScore = 10;
          if (followerScore > 0) {
            score += followerScore;
            reasonParts.push(`${followers} followers (${followerScore}pts)`);
          }

          // 3. Verification (0-15)
          if (user.data.verified) {
            score += 15;
            reasonParts.push('verified (+15pts)');
          }

          // 4. Account age (0-15)
          const accountAge =
            (Date.now() - new Date(user.data.created_at!).getTime()) /
            (1000 * 60 * 60 * 24);
          let ageScore = 0;
          if (accountAge > 365) ageScore = 15;
          else if (accountAge > 180) ageScore = 10;
          else if (accountAge > 30) ageScore = 5;
          if (ageScore > 0) {
            score += ageScore;
            reasonParts.push(`${Math.floor(accountAge)}d old (+${ageScore}pts)`);
          }

          // 5. Engagement (0-15)
          const engagement = user.data.public_metrics?.like_count || 0;
          let engScore = 0;
          if (engagement > 1000000) engScore = 15;
          else if (engagement > 100000) engScore = 10;
          else if (engagement > 10000) engScore = 5;
          if (engScore > 0) {
            score += engScore;
            reasonParts.push(`high engagement (+${engScore}pts)`);
          }

          if (score >= DISCOVERY_CONFIG.scoreThreshold) {
            // Categorize with LLM
            const category = await this.categorizeAccountLLM(handle);

            const candidate: DiscoveryCandidate = {
              handle,
              score,
              category: category || 'NARRATIVE',
              reason: reasonParts.join(' | '),
              lastSeen: Date.now(),
              confirmationCount: existing?.confirmationCount || 1,
              status: 'suggested'
            };

            scored.push(candidate);
          }
        } catch (error: any) {
          logger.warn(`Failed to score @${handle}`, error.message);
        }
      }

      // Cap additions per cycle
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, DISCOVERY_CONFIG.maxNewAccountsPerCycle);
    } catch (error: any) {
      logger.error('Failed to score candidates', error.message);
      return [];
    }
  }

  // Use LLM for accurate categorization
  private async categorizeAccountLLM(handle: string): Promise<string | null> {
    try {
      // Fetch recent tweets
      const tweets = await client.v2.userTimeline(handle, {
        max_results: 15
      });

      if (!tweets.data || tweets.data.length === 0) return null;

      const content = tweets.data.map(t => t.text).join('\n');

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Classify this account's focus into ONE category: TECHNICAL, NARRATIVE, SMART_MONEY, or MARKET_STRUCTURE.

Recent tweets:
${content}

Response with ONLY the category name.`
          }
        ]
      });

      const response = message.content[0].type === 'text' ? message.content[0].text.trim().toUpperCase() : null;
      
      if (['TECHNICAL', 'NARRATIVE', 'SMART_MONEY', 'MARKET_STRUCTURE'].includes(response || '')) {
        return response;
      }

      return null;
    } catch (error: any) {
      logger.warn(`LLM categorization failed for @${handle}`, error.message);
      return null;
    }
  }

  // Approve a suggested account (manual or auto after confirmations)
  async approveAccount(handle: string): Promise<boolean> {
    const candidate = this.candidates.get(handle);
    if (!candidate) return false;

    candidate.status = 'approved';
    logger.info(`Approved @${handle} as ${candidate.category}`);
    return true;
  }

  // Reject a suggested account
  rejectAccount(handle: string): void {
    const candidate = this.candidates.get(handle);
    if (candidate) {
      candidate.status = 'rejected';
      logger.info(`Rejected @${handle}`);
    }
  }

  // Auto-approve accounts that passed confirmation threshold
  async autoApproveConfirmed(): Promise<string[]> {
    const approved: string[] = [];

    for (const [handle, candidate] of this.candidates) {
      if (
        candidate.status === 'suggested' &&
        candidate.confirmationCount >= DISCOVERY_CONFIG.confirmationRunsNeeded
      ) {
        await this.approveAccount(handle);
        approved.push(handle);
      }
    }

    return approved;
  }

  // Remove accounts not seen recently
  private async pruneCandidates(): Promise<void> {
    const now = Date.now();
    const pruneThreshold = DISCOVERY_CONFIG.decayDays * 24 * 60 * 60 * 1000;

    for (const [handle, candidate] of this.candidates) {
      if (now - candidate.lastSeen > pruneThreshold) {
        candidate.status = 'pruned';
        logger.info(`Pruned @${handle} (not seen in ${DISCOVERY_CONFIG.decayDays} days)`);
      }
    }
  }

  // Get discovery status
  getDiscoverySummary() {
    const suggested = Array.from(this.candidates.values()).filter(c => c.status === 'suggested');
    const approved = Array.from(this.candidates.values()).filter(c => c.status === 'approved');
    const rejected = Array.from(this.candidates.values()).filter(c => c.status === 'rejected');

    return {
      suggested: suggested.length,
      suggestedList: suggested,
      approved: approved.length,
      rejected: rejected.length,
      recentLog: this.discoveryLog.slice(-10)
    };
  }

  private logDiscoveryRun(candidates: DiscoveryCandidate[]): void {
    this.discoveryLog.push({
      timestamp: Date.now(),
      found: candidates.length,
      candidates: candidates.map(c => ({
        handle: c.handle,
        score: c.score,
        category: c.category
      }))
    });

    logger.info(`Discovery logged: found ${candidates.length} candidates`);
  }
}

export const accountDiscovery = new AccountDiscovery();
