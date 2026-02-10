import { logger } from './logger.js';

export interface BotConfig {
  // Scheduling
  schedules: string[]; // cron expressions (UTC)
  
  // Limits
  maxTokensPerRun: number;
  maxLLMCallsPerHour: number;
  maxTweetsPerDay: number;
  minTweetIntervalMinutes: number;
  
  // Thresholds
  minVolumeUSD: number; // minimum 24h volume to consider
  minLiquidityUSD: number;
  maxVolatilityPercent: number; // filter out too volatile tokens
  maxHolderConcentration: number; // max % for top holder
  
  // Features
  enableValidation: boolean;
  enableAnalytics: boolean;
  enableRetry: boolean;
  dryRun: boolean; // don't actually post tweets
  
  // API
  coingeckoApiKey?: string;
  anthropicApiKey?: string;
  twitterApiKey?: string;
  twitterApiSecret?: string;
  twitterAccessToken?: string;
  twitterAccessSecret?: string;
}

const DEFAULT_CONFIG: BotConfig = {
  schedules: ['0 6 * * *', '0 12 * * *', '0 18 * * *', '0 22 * * *'], // 6am, 12pm, 6pm, 10pm UTC
  
  maxTokensPerRun: 5,
  maxLLMCallsPerHour: 10,
  maxTweetsPerDay: 40,
  minTweetIntervalMinutes: 15,
  
  minVolumeUSD: 100000,
  minLiquidityUSD: 50000,
  maxVolatilityPercent: 150,
  maxHolderConcentration: 60,
  
  enableValidation: true,
  enableAnalytics: true,
  enableRetry: true,
  dryRun: false
};

export class Config {
  private config: BotConfig;

  constructor(overrides?: Partial<BotConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...overrides,
      // Load from environment if not provided
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      twitterApiKey: process.env.TWITTER_API_KEY,
      twitterApiSecret: process.env.TWITTER_API_SECRET,
      twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN,
      twitterAccessSecret: process.env.TWITTER_ACCESS_SECRET
    };

    this.validateConfig();
  }

  get(key: keyof BotConfig): any {
    return this.config[key];
  }

  set(key: keyof BotConfig, value: any) {
    logger.warn(`Config updated: ${key} = ${value}`);
    this.config[key] = value;
    this.validateConfig();
  }

  getAll(): BotConfig {
    return { ...this.config };
  }

  private validateConfig() {
    // Check required keys
    const required = ['anthropicApiKey', 'twitterApiKey', 'twitterApiSecret'];
    for (const key of required) {
      if (!this.config[key as keyof BotConfig]) {
        logger.warn(`Missing required config: ${key}`);
      }
    }

    // Validate bounds
    if (this.config.maxTokensPerRun < 1 || this.config.maxTokensPerRun > 50) {
      throw new Error('maxTokensPerRun must be between 1 and 50');
    }

    if (this.config.maxLLMCallsPerHour < 1 || this.config.maxLLMCallsPerHour > 100) {
      throw new Error('maxLLMCallsPerHour must be between 1 and 100');
    }

    if (this.config.schedules.length === 0) {
      throw new Error('At least one schedule must be defined');
    }

    logger.info('Config validated successfully');
  }

  logConfig() {
    const safe = { ...this.config };
    // Redact sensitive keys
    if (safe.anthropicApiKey) safe.anthropicApiKey = '***';
    if (safe.twitterApiKey) safe.twitterApiKey = '***';
    if (safe.twitterApiSecret) safe.twitterApiSecret = '***';
    if (safe.twitterAccessToken) safe.twitterAccessToken = '***';
    if (safe.twitterAccessSecret) safe.twitterAccessSecret = '***';
    if (safe.coingeckoApiKey) safe.coingeckoApiKey = '***';

    logger.info('Current config:', safe);
  }
}

export const config = new Config();
