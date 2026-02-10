import { logger } from './logger.js';

export interface RateLimitConfig {
  twitter: {
    tweetsPerHour: number;
    repliesPerHour: number;
    accountPollIntervalMs: number;
  };
  openai: {
    callsPerMinute: number;
    tokensPerMinute: number;
  };
  anthropic: {
    callsPerMinute: number;
    callsPerHour: number;
  };
}

const DEFAULT_CONFIG: RateLimitConfig = {
  twitter: {
    tweetsPerHour: 100, // Conservative: 450 available, we use 4/day
    repliesPerHour: 50,
    accountPollIntervalMs: 5 * 60 * 1000 // 5 minutes
  },
  openai: {
    callsPerMinute: 3, // Conservative
    tokensPerMinute: 90000
  },
  anthropic: {
    callsPerMinute: 5,
    callsPerHour: 10
  }
};

export class RateLimitManager {
  private config: RateLimitConfig;
  private callTimestamps: Map<string, number[]> = new Map();
  private tokenUsage: Map<string, number> = new Map();
  private lastAlertTime: Map<string, number> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      twitter: { ...DEFAULT_CONFIG.twitter, ...config.twitter },
      openai: { ...DEFAULT_CONFIG.openai, ...config.openai },
      anthropic: { ...DEFAULT_CONFIG.anthropic, ...config.anthropic }
    };
  }

  // Twitter rate limit checks
  async canTweet(): Promise<boolean> {
    return this.checkLimit('twitter:tweets', this.config.twitter.tweetsPerHour, 3600000);
  }

  async canReply(): Promise<boolean> {
    return this.checkLimit('twitter:replies', this.config.twitter.repliesPerHour, 3600000);
  }

  recordTweet() {
    this.recordCall('twitter:tweets');
  }

  recordReply() {
    this.recordCall('twitter:replies');
  }

  // OpenAI rate limit waits
  async waitForOpenAISlot(): Promise<void> {
    await this.waitForSlot('openai:calls', this.config.openai.callsPerMinute, 60000);
  }

  recordOpenAICall(estimatedTokens: number = 100) {
    this.recordCall('openai:calls');
    const key = 'openai:tokens';
    const current = this.tokenUsage.get(key) || 0;
    this.tokenUsage.set(key, current + estimatedTokens);

    // Alert if usage high
    const usage = (current / this.config.openai.tokensPerMinute) * 100;
    if (usage > 80 && !this.shouldAlert('openai:tokens')) {
      logger.warn(`OpenAI token usage: ${usage.toFixed(0)}% (${current}/${this.config.openai.tokensPerMinute})`);
    }
  }

  // Anthropic rate limit waits
  async waitForAnthropicSlot(): Promise<void> {
    // Check both per-minute and per-hour limits
    const canProceedMin = await this.checkLimit(
      'anthropic:calls:min',
      this.config.anthropic.callsPerMinute,
      60000
    );

    if (!canProceedMin) {
      const waitTime = this.getWaitTime('anthropic:calls:min', 60000);
      logger.info(`Anthropic per-minute limit: waiting ${(waitTime / 1000).toFixed(1)}s`);
      await this.sleep(waitTime);
    }

    const canProceedHour = await this.checkLimit(
      'anthropic:calls:hour',
      this.config.anthropic.callsPerHour,
      3600000
    );

    if (!canProceedHour) {
      const waitTime = this.getWaitTime('anthropic:calls:hour', 3600000);
      logger.warn(
        `Anthropic hourly limit: waiting ${(waitTime / 1000).toFixed(0)}s`
      );
      await this.sleep(waitTime);
    }
  }

  recordAnthropicCall() {
    this.recordCall('anthropic:calls:min');
    this.recordCall('anthropic:calls:hour');
  }

  // Generic limit check
  private async checkLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - windowMs;

    let calls = this.callTimestamps.get(key) || [];
    calls = calls.filter(t => t > windowStart);

    if (calls.length >= limit) {
      if (!this.shouldAlert(key)) {
        const oldestCall = Math.min(...calls);
        const waitTime = oldestCall + windowMs - now;
        logger.warn(
          `Rate limit for ${key}: ${calls.length}/${limit}. Wait ${(waitTime / 1000).toFixed(0)}s`
        );
      }
      return false;
    }

    return true;
  }

  private getWaitTime(key: string, windowMs: number): number {
    const calls = this.callTimestamps.get(key) || [];
    if (calls.length === 0) return 0;

    const oldestCall = Math.min(...calls);
    return Math.max(0, oldestCall + windowMs - Date.now() + 100);
  }

  private recordCall(key: string) {
    let calls = this.callTimestamps.get(key) || [];
    calls.push(Date.now());
    this.callTimestamps.set(key, calls);
  }

  private shouldAlert(key: string): boolean {
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert > 60000) {
      // Alert once per minute max
      this.lastAlertTime.set(key, Date.now());
      return false;
    }
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get status
  getStatus() {
    const now = Date.now();
    const status: any = {
      twitter: {
        tweetsPerHour: this.config.twitter.tweetsPerHour,
        repliesPerHour: this.config.twitter.repliesPerHour
      },
      openai: {
        callsPerMin: this.config.openai.callsPerMinute,
        tokensPerMin: this.config.openai.tokensPerMinute,
        usage: {
          tokens: this.tokenUsage.get('openai:tokens') || 0
        }
      },
      anthropic: {
        callsPerMin: this.config.anthropic.callsPerMinute,
        callsPerHour: this.config.anthropic.callsPerHour
      }
    };

    // Calculate usage percentages
    const twitterCalls = (this.callTimestamps.get('twitter:tweets') || [])
      .filter(t => now - t < 3600000).length;
    status.twitter.currentTweets = twitterCalls;
    status.twitter.usage = `${twitterCalls}/${this.config.twitter.tweetsPerHour}`;

    const anthropicCalls = (this.callTimestamps.get('anthropic:calls:hour') || [])
      .filter(t => now - t < 3600000).length;
    status.anthropic.currentCalls = anthropicCalls;
    status.anthropic.usage = `${anthropicCalls}/${this.config.anthropic.callsPerHour}`;

    return status;
  }

  // Reset counters (for testing)
  reset() {
    this.callTimestamps.clear();
    this.tokenUsage.clear();
    this.lastAlertTime.clear();
    logger.info('Rate limit counters reset');
  }
}

export const rateLimitManager = new RateLimitManager();
