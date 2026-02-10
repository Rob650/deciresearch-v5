import { createClient } from '@supabase/supabase-js';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

export interface NarrativeSnapshot {
  topic: string;
  date: string;
  sentiment: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  topAccounts: string[];
  avgCredibility: number;
  mentionCount: number;
  timestamp: number;
}

export interface NarrativeShift {
  topic: string;
  shiftType: 'bullish_to_bearish' | 'bearish_to_bullish' | 'consolidation' | 'acceleration';
  previousSentiment: { bullish: number; bearish: number; neutral: number };
  currentSentiment: { bullish: number; bearish: number; neutral: number };
  sentimentChange: number; // percentage point change in bullish
  accountsFlipped: number; // how many accounts changed stance
  flipAccounts: string[];
  timePeriod: string; // "3d ago", "7d ago", etc
  severity: 'minor' | 'moderate' | 'major'; // based on sentiment magnitude
  confidence: number; // 0-100, based on credibility of flipped accounts
  firstDetected: number;
  alert: string; // formatted alert message
}

export class NarrativeShifts {
  async captureSnapshot(topic: string): Promise<NarrativeSnapshot | null> {
    try {
      const tweets = await vectorDB.getTweetsByTopic(topic);

      if (tweets.length === 0) {
        return null;
      }

      // Calculate sentiment
      const bullish = tweets.filter(t => t.sentiment === 'bullish').length;
      const bearish = tweets.filter(t => t.sentiment === 'bearish').length;
      const neutral = tweets.filter(t => t.sentiment === 'neutral').length;

      // Get top accounts
      const accountMap = new Map<string, number>();
      for (const tweet of tweets) {
        accountMap.set(tweet.handle, (accountMap.get(tweet.handle) || 0) + 1);
      }

      const topAccounts = Array.from(accountMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([handle]) => handle);

      // Calculate average credibility
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      let totalCredibility = 0;
      let accountCount = 0;

      for (const account of topAccounts) {
        for (const category of categories) {
          const accounts = await vectorDB.getAccountsByCategory(category);
          const found = accounts.find(a => a.handle.toLowerCase() === account.toLowerCase());
          if (found) {
            totalCredibility += found.credibilityScore;
            accountCount++;
            break;
          }
        }
      }

      const avgCredibility = accountCount > 0 ? totalCredibility / accountCount : 50;

      const snapshot: NarrativeSnapshot = {
        topic,
        date: new Date().toISOString().split('T')[0],
        sentiment: {
          bullish: (bullish / tweets.length) * 100,
          bearish: (bearish / tweets.length) * 100,
          neutral: (neutral / tweets.length) * 100
        },
        topAccounts,
        avgCredibility,
        mentionCount: tweets.length,
        timestamp: Date.now()
      };

      // Store snapshot
      await supabase.from('narrative_snapshots').insert({
        topic: snapshot.topic,
        date: snapshot.date,
        sentiment: snapshot.sentiment,
        top_accounts: snapshot.topAccounts,
        avg_credibility: snapshot.avgCredibility,
        mention_count: snapshot.mentionCount,
        timestamp: snapshot.timestamp
      });

      logger.info(`Captured snapshot for ${topic}: ${snapshot.sentiment.bullish.toFixed(0)}% bullish`);
      return snapshot;
    } catch (error: any) {
      logger.error(`Failed to capture snapshot for ${topic}`, error.message);
      return null;
    }
  }

  async detectShift(
    topic: string,
    daysLookback: number = 7
  ): Promise<NarrativeShift | null> {
    try {
      // Get current snapshot
      const currentSnapshot = await this.captureSnapshot(topic);
      if (!currentSnapshot) return null;

      // Get previous snapshot from daysLookback
      const { data: previousData } = await supabase
        .from('narrative_snapshots')
        .select('*')
        .eq('topic', topic)
        .lt('timestamp', Date.now() - daysLookback * 24 * 60 * 60 * 1000)
        .order('timestamp', { ascending: false })
        .limit(1);

      if (!previousData || previousData.length === 0) {
        return null; // No previous data to compare
      }

      const previousSnapshot = previousData[0] as any;
      const sentimentChange = currentSnapshot.sentiment.bullish - previousSnapshot.sentiment.bullish;
      const absoluteChange = Math.abs(sentimentChange);

      // Determine shift type
      let shiftType: 'bullish_to_bearish' | 'bearish_to_bullish' | 'consolidation' | 'acceleration' =
        'consolidation';

      if (sentimentChange < -20) {
        shiftType = 'bullish_to_bearish';
      } else if (sentimentChange > 20) {
        shiftType = 'bearish_to_bullish';
      } else if (sentimentChange > 10) {
        shiftType = 'acceleration';
      }

      // Detect account flips (accounts that changed sentiment)
      const tweets = await vectorDB.getTweetsByTopic(topic);
      const daysCutoff = Date.now() - daysLookback * 24 * 60 * 60 * 1000;
      const recentTweets = tweets.filter(t => t.timestamp > daysCutoff);

      const accountFlips = await this.detectAccountFlips(
        topic,
        daysLookback
      );

      // Determine severity
      let severity: 'minor' | 'moderate' | 'major' = 'minor';
      if (absoluteChange > 30) severity = 'major';
      else if (absoluteChange > 15) severity = 'moderate';

      // Calculate confidence (higher if credible accounts flipped)
      const flipCredibilities = await Promise.all(
        accountFlips.map(handle => this.getAccountCredibility(handle))
      );
      const avgFlipCredibility =
        flipCredibilities.length > 0
          ? flipCredibilities.reduce((a, b) => a + b, 0) / flipCredibilities.length
          : 50;
      const confidence = Math.min(100, (avgFlipCredibility / 100) * 100 * Math.sqrt(accountFlips.length));

      // Build alert message
      const alert = this.buildAlertMessage(
        topic,
        shiftType,
        sentimentChange,
        accountFlips.length,
        severity,
        recentTweets.length
      );

      const shift: NarrativeShift = {
        topic,
        shiftType,
        previousSentiment: previousSnapshot.sentiment,
        currentSentiment: currentSnapshot.sentiment,
        sentimentChange,
        accountsFlipped: accountFlips.length,
        flipAccounts: accountFlips,
        timePeriod: `${daysLookback}d ago`,
        severity,
        confidence: Math.round(confidence),
        firstDetected: Date.now(),
        alert
      };

      if (severity !== 'minor') {
        logger.warn(`NARRATIVE SHIFT: ${topic} - ${alert}`);
      }

      return shift;
    } catch (error: any) {
      logger.error(`Failed to detect shift for ${topic}`, error.message);
      return null;
    }
  }

  private async detectAccountFlips(topic: string, daysLookback: number): Promise<string[]> {
    try {
      const tweets = await vectorDB.getTweetsByTopic(topic);
      const cutoff = Date.now() - daysLookback * 24 * 60 * 60 * 1000;
      const midpoint = cutoff + (Date.now() - cutoff) / 2;

      // Get sentiment per account in each period
      const firstPeriod = new Map<string, string>();
      const secondPeriod = new Map<string, string>();

      for (const tweet of tweets) {
        if (tweet.timestamp <= cutoff) continue; // Before lookback period

        if (tweet.timestamp <= midpoint) {
          firstPeriod.set(tweet.handle, tweet.sentiment);
        } else {
          secondPeriod.set(tweet.handle, tweet.sentiment);
        }
      }

      // Find accounts that changed
      const flips: string[] = [];
      for (const [handle, firstSent] of firstPeriod) {
        const secondSent = secondPeriod.get(handle);
        if (secondSent && firstSent !== secondSent) {
          // Check if they had multiple tweets confirming the flip
          const accountTweets = tweets.filter(t => t.handle === handle && t.timestamp > cutoff);
          if (accountTweets.length >= 2) {
            flips.push(handle);
          }
        }
      }

      return flips;
    } catch (error: any) {
      logger.error('Failed to detect account flips', error.message);
      return [];
    }
  }

  private async getAccountCredibility(handle: string): Promise<number> {
    try {
      const categories = ['NARRATIVE', 'TECHNICAL', 'SMART_MONEY', 'MARKET_STRUCTURE'];
      for (const category of categories) {
        const accounts = await vectorDB.getAccountsByCategory(category);
        const account = accounts.find(a => a.handle.toLowerCase() === handle.toLowerCase());
        if (account) return account.credibilityScore;
      }
      return 50;
    } catch {
      return 50;
    }
  }

  private buildAlertMessage(
    topic: string,
    shiftType: string,
    sentimentChange: number,
    flipped: number,
    severity: string,
    mentionCount: number
  ): string {
    const emoji = severity === 'major' ? '🚨' : severity === 'moderate' ? '⚠️' : '👀';
    const direction = sentimentChange > 0 ? 'bullish' : 'bearish';
    const magnitude = Math.abs(sentimentChange).toFixed(0);

    return `${emoji} Narrative Alert: Network sentiment on "${topic}" shifting ${direction} (${magnitude}pp change). ${flipped} credible accounts changed stance this week. ${mentionCount} total mentions.`;
  }

  async getRecentShifts(limit: number = 5): Promise<NarrativeShift[]> {
    try {
      // Get all topics from recent activity
      const { data: snapshots } = await supabase
        .from('narrative_snapshots')
        .select('DISTINCT topic')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (!snapshots) return [];

      const topics = snapshots.map((s: any) => s.topic);
      const shifts: NarrativeShift[] = [];

      for (const topic of topics) {
        const shift = await this.detectShift(topic, 7);
        if (shift && shift.severity !== 'minor') {
          shifts.push(shift);
        }
      }

      return shifts.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
    } catch (error: any) {
      logger.error('Failed to get recent shifts', error.message);
      return [];
    }
  }

  async getMajorShifts(): Promise<NarrativeShift[]> {
    try {
      const shifts = await this.getRecentShifts(10);
      return shifts.filter(s => s.severity === 'major');
    } catch (error: any) {
      logger.error('Failed to get major shifts', error.message);
      return [];
    }
  }
}

export const narrativeShifts = new NarrativeShifts();
