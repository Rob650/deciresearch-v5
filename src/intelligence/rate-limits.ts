import { logger } from '../shared/logger.js';

export interface RateLimitConfig {
  twitter: {
    tweetsPerHour: number;
    accountPollIntervalMs: number; // Min time between polls of same account
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
    tweetsPerHour: 450, // Twitter API rate: 450 per 15 min window
    accountPollIntervalMs: 10 * 60 * 1000 // Min 10 min between account polls
  },
  openai: {
    callsPerMinute: 3, // Conservative for embeddings
    tokensPerMinute: 90000
  },
  anthropic: {
    callsPerMinute: 5,
    callsPerHour: 10 // Our own limit from Phase 0
  }
};

export class RateLimitManager {
  private config: RateLimitConfig;
  private callTimestamps: Map<string, number[]> = new Map();
  private tokenUsage: Map<string, number> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      twitter: { ...DEFAULT_CONFIG.twitter, ...config.twitter },
      openai: { ...DEFAULT_CONFIG.openai, ...config.openai },
      anthropic: { ...DEFAULT_CONFIG.anthropic, ...config.anthropic }
    };
  }

  async checkTwitterLimit(service: string): Promise<boolean> {
    const key = `twitter:${service}`;
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000; // 1 hour window

    let calls = this.callTimestamps.get(key) || [];
    calls = calls.filter(t => t > windowStart);

    if (calls.length >= this.config.twitter.tweetsPerHour) {
      const oldestCall = Math.min(...calls);
      const waitMs = oldestCall + 60 * 60 * 1000 - now;
      logger.warn(
        `Twitter rate limit hit (${calls.length}/${this.config.twitter.tweetsPerHour}). Wait ${(waitMs / 1000).toFixed(0)}s`
      );
      return false;
    }

    calls.push(now);
    this.callTimestamps.set(key, calls);
    return true;
  }

  async waitForOpenAISlot(service: string): Promise<void> {
    const key = `openai:${service}`;
    const now = Date.now();
    const windowStart = now - 60 * 1000; // 1 minute window

    let calls = this.callTimestamps.get(key) || [];
    calls = calls.filter(t => t > windowStart);

    if (calls.length >= this.config.openai.callsPerMinute) {
      const oldestCall = Math.min(...calls);
      const waitMs = oldestCall + 60 * 1000 - now + 100; // 100ms buffer
      logger.info(`OpenAI rate limit: waiting ${(waitMs / 1000).toFixed(1)}s`);
      await this.sleep(waitMs);
    }

    calls.push(Date.now());
    this.callTimestamps.set(key, calls);
  }

  async waitForAnthropicSlot(): Promise<void> {
    const key = 'anthropic:all';
    const now = Date.now();
    const windowStart = now - 60 * 1000; // 1 minute window
    const hourStart = now - 60 * 60 * 1000; // 1 hour window

    let callsMin = this.callTimestamps.get(`${key}:min`) || [];
    let callsHour = this.callTimestamps.get(`${key}:hour`) || [];

    callsMin = callsMin.filter(t => t > windowStart);
    callsHour = callsHour.filter(t => t > hourStart);

    // Check minute limit
    if (callsMin.length >= this.config.anthropic.callsPerMinute) {
      const oldestCall = Math.min(...callsMin);
      const waitMs = oldestCall + 60 * 1000 - now + 100;
      logger.info(`Anthropic per-minute limit: waiting ${(waitMs / 1000).toFixed(1)}s`);
      await this.sleep(waitMs);
      callsMin = [];
    }

    // Check hour limit (our own constraint)
    if (callsHour.length >= this.config.anthropic.callsPerHour) {
      const oldestCall = Math.min(...callsHour);
      const waitMs = oldestCall + 60 * 60 * 1000 - now;
      logger.warn(
        `Anthropic hourly limit hit (${callsHour.length}/${this.config.anthropic.callsPerHour}). Wait ${(waitMs / 1000).toFixed(0)}s`
      );
      await this.sleep(waitMs);
      callsHour = [];
    }

    const now2 = Date.now();
    callsMin.push(now2);
    callsHour.push(now2);

    this.callTimestamps.set(`${key}:min`, callsMin);
    this.callTimestamps.set(`${key}:hour`, callsHour);
  }

  trackTokenUsage(service: string, tokens: number) {
    const key = `openai:${service}:tokens`;
    const current = this.tokenUsage.get(key) || 0;
    this.tokenUsage.set(key, current + tokens);

    const totalTokens = Array.from(this.tokenUsage.values()).reduce((a, b) => a + b, 0);
    const usage = ((totalTokens / this.config.openai.tokensPerMinute) * 100).toFixed(1);

    if (totalTokens > this.config.openai.tokensPerMinute * 0.9) {
      logger.warn(`OpenAI token usage high: ${usage}%`);
    }
  }

  // Get current status
  getStatus() {
    return {
      twitter: {
        configured: this.config.twitter.tweetsPerHour,
        pollInterval: this.config.twitter.accountPollIntervalMs
      },
      openai: {
        callsPerMin: this.config.openai.callsPerMinute,
        tokensPerMin: this.config.openai.tokensPerMinute
      },
      anthropic: {
        callsPerMin: this.config.anthropic.callsPerMinute,
        callsPerHour: this.config.anthropic.callsPerHour
      }
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const rateLimitManager = new RateLimitManager();
