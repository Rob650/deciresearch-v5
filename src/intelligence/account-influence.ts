import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

export interface IAccountInfluence {
  handle: string;
  credibility: number; // 0-100 (existing)
  influenceScore: number; // 0-100 (NEW - composite score)
  citedByOthers: number; // How often referenced in replies/mentions
  conversationStarter: number; // Their tweets generate reply chains
  earlyNarratives: number; // Said it first, others followed (days ahead)
  accuracy: number; // Historical prediction accuracy (0-100)
  momentum: 'rising' | 'stable' | 'declining'; // trend direction
  tier: 'trendsetter' | 'leader' | 'contributor' | 'follower'; // influence tier
  lastUpdated: number;
}

export type AccountInfluence = IAccountInfluence;

/**
 * AccountInfluenceEngine - Uses Gemini 2.0 Flash for batch analysis
 * Avoids Anthropic rate limits by offloading heavy analysis to Gemini
 */
export class AccountInfluenceEngine {
  /**
   * Batch score multiple accounts efficiently with Gemini
   * Single API call for N accounts = 1/Nth the cost
   */
  async batchScoreInfluence(handles: string[]): Promise<Map<string, IAccountInfluence>> {
    try {
      logger.info(`Batch scoring ${handles.length} accounts with Gemini 2.0 Flash...`);

      // Fetch recent tweets for context
      const accountContext = await Promise.all(
        handles.map(async h => {
          const tweets = await vectorDB.getTweetsByAccount(h);
          return {
            handle: h,
            recentTweets: tweets.slice(0, 3).map(t => `"${t.text.substring(0, 80)}..."`).join(' | '),
            tweetCount: tweets.length
          };
        })
      );

      const contextStr = accountContext
        .map(
          ac =>
            `@${ac.handle} (${ac.tweetCount} tweets): ${ac.recentTweets}`
        )
        .join('\n');

      const prompt = `You are analyzing the influence of crypto researchers on Twitter.

For each handle, score influence dimensions (0-100):
1. Cited frequency: How often others quote/reference them
2. Conversation starter: Do their tweets generate substantive reply chains?
3. Early narratives: Do they identify trends before mainstream adoption?
4. Prediction accuracy: Historical accuracy of their market/tech calls

Return ONLY valid JSON (no markdown, no explanation):
{
  "@handle1": {
    "cited": 80,
    "starter": 75,
    "early": 90,
    "accuracy": 85
  },
  "@handle2": {
    "cited": 60,
    "starter": 55,
    "early": 70,
    "accuracy": 65
  }
}

Account context:
${contextStr}`;

      const response = await geminiModel.generateContent(prompt);
      const text = response.response.text();

      const resultMap = new Map<string, IAccountInfluence>();

      try {
        const parsed = JSON.parse(text);

        for (const [key, scores] of Object.entries(parsed) as any[]) {
          const handle = key.replace('@', '');
          const credibility = await this.getAccountCredibility(handle);

          if (credibility !== null) {
            // Calculate composite influence score
            const influenceScore =
              (scores.cited || 50) * 0.3 +
              (scores.starter || 50) * 0.3 +
              (scores.early || 50) * 0.25 +
              (scores.accuracy || 50) * 0.15;

            // Determine tier
            let tier: 'trendsetter' | 'leader' | 'contributor' | 'follower' = 'contributor';
            if (influenceScore >= 85) tier = 'trendsetter';
            else if (influenceScore >= 70) tier = 'leader';
            else if (influenceScore >= 55) tier = 'contributor';
            else tier = 'follower';

            const influence: IAccountInfluence = {
              handle,
              credibility,
              influenceScore: Math.round(influenceScore),
              citedByOthers: scores.cited || 50,
              conversationStarter: scores.starter || 50,
              earlyNarratives: scores.early || 50,
              accuracy: scores.accuracy || 50,
              momentum: 'stable',
              tier,
              lastUpdated: Date.now()
            };

            resultMap.set(handle, influence);

            // Persist to DB
            await this.persistInfluenceScore(influence);
          }
        }

        logger.info(`Scored ${resultMap.size}/${handles.length} accounts successfully`);
      } catch (e) {
        logger.error('Failed to parse Gemini batch response', text);
      }

      return resultMap;
    } catch (error: any) {
      logger.error('Batch scoring failed', error.message);
      return new Map();
    }
  }

  /**
   * Score a single account with Gemini + local metrics
   */
  async scoreAccountInfluence(handle: string): Promise<IAccountInfluence | null> {
    try {
      logger.info(`Scoring influence for @${handle} with Gemini...`);

      const credibility = await this.getAccountCredibility(handle);
      if (credibility === null) return null;

      // Get recent tweets for context
      const tweets = await vectorDB.getTweetsByAccount(handle);
      const recentTweets = tweets.slice(0, 5);

      const prompt = `Analyze the influence of crypto researcher @${handle}.

Recent tweets (${recentTweets.length} samples):
${recentTweets.map(t => `- "${t.text.substring(0, 100)}..." (${t.likes || 0}L, ${t.retweets || 0}RT)`).join('\n')}

Score these dimensions (0-100):
1. Citation frequency: How often do others quote/reference them?
2. Conversation starter: Do their tweets generate substantive replies?
3. Early narrative adoption: Do they identify trends ahead of crowd?
4. Prediction accuracy: Historical accuracy of their calls?

Return ONLY JSON (no explanation):
{
  "cited": <number>,
  "starter": <number>,
  "early": <number>,
  "accuracy": <number>,
  "reasoning": "<brief one-liner>"
}`;

      const response = await geminiModel.generateContent(prompt);
      const text = response.response.text();

      let scores = { cited: 50, starter: 50, early: 50, accuracy: 50 };
      try {
        const parsed = JSON.parse(text);
        scores = {
          cited: parsed.cited || 50,
          starter: parsed.starter || 50,
          early: parsed.early || 50,
          accuracy: parsed.accuracy || 50
        };
      } catch (e) {
        logger.warn(`Failed to parse Gemini response for @${handle}`);
      }

      // Composite influence score
      const influenceScore =
        scores.cited * 0.3 +
        scores.starter * 0.3 +
        scores.early * 0.25 +
        scores.accuracy * 0.15;

      // Determine tier
      let tier: 'trendsetter' | 'leader' | 'contributor' | 'follower' = 'contributor';
      if (influenceScore >= 85) tier = 'trendsetter';
      else if (influenceScore >= 70) tier = 'leader';
      else if (influenceScore >= 55) tier = 'contributor';
      else tier = 'follower';

      const influence: IAccountInfluence = {
        handle,
        credibility,
        influenceScore: Math.round(influenceScore),
        citedByOthers: scores.cited,
        conversationStarter: scores.starter,
        earlyNarratives: scores.early,
        accuracy: scores.accuracy,
        momentum: 'stable',
        tier,
        lastUpdated: Date.now()
      };

      await this.persistInfluenceScore(influence);
      return influence;
    } catch (error: any) {
      logger.error(`Failed to score @${handle}`, error.message);
      return null;
    }
  }

  /**
   * Persist influence scores to Supabase
   */
  private async persistInfluenceScore(influence: IAccountInfluence): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('account_influence')
        .upsert(
          {
            handle: influence.handle,
            credibility: influence.credibility,
            influence_score: influence.influenceScore,
            cited_count: influence.citedByOthers,
            conversation_starter_score: influence.conversationStarter,
            early_narrative_score: influence.earlyNarratives,
            accuracy: influence.accuracy,
            tier: influence.tier,
            momentum: influence.momentum,
            timestamp: influence.lastUpdated
          },
          { onConflict: 'handle' }
        );

      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error(`Failed to persist score for ${influence.handle}`, error.message);
      return false;
    }
  }

  /**
   * Get account credibility (from vectorDB categories)
   */
  private async getAccountCredibility(handle: string): Promise<number | null> {
    try {
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        const account = accounts.find(a => a.handle.toLowerCase() === handle.toLowerCase());
        if (account) return account.credibilityScore;
      }
      return 50; // Default for untracked accounts
    } catch {
      return null;
    }
  }

  /**
   * Get top influencers across all tracked accounts
   */
  async getTopInfluencers(limit: number = 10): Promise<IAccountInfluence[]> {
    try {
      const { data } = await supabase
        .from('account_influence')
        .select('*')
        .order('influence_score', { ascending: false })
        .limit(limit);

      return (data || []) as IAccountInfluence[];
    } catch (error: any) {
      logger.error('Failed to get top influencers', error.message);
      return [];
    }
  }

  /**
   * Get influencers by tier
   */
  async getInfluencersByTier(
    tier: 'trendsetter' | 'leader' | 'contributor' | 'follower'
  ): Promise<IAccountInfluence[]> {
    try {
      const { data } = await supabase
        .from('account_influence')
        .select('*')
        .eq('tier', tier)
        .order('influence_score', { ascending: false });

      return (data || []) as IAccountInfluence[];
    } catch (error: any) {
      logger.error(`Failed to get ${tier} influencers`, error.message);
      return [];
    }
  }
}

export const accountInfluenceEngine = new AccountInfluenceEngine();
