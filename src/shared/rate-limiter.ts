import { logger } from './logger.js';

class RateLimiter {
  private callCount = 0;
  private resetTime = Date.now() + 3600000; // 1 hour
  private readonly MAX_CALLS_PER_HOUR = 10;
  private circuitOpen = false;

  async waitForSlot(): Promise<void> {
    if (this.circuitOpen) {
      logger.warn('Circuit breaker open, waiting 60s');
      await this.sleep(60000);
      this.circuitOpen = false;
    }

    if (Date.now() > this.resetTime) {
      this.callCount = 0;
      this.resetTime = Date.now() + 3600000;
    }

    if (this.callCount >= this.MAX_CALLS_PER_HOUR) {
      const waitTime = this.resetTime - Date.now();
      logger.warn(`Rate limit reached, waiting ${Math.round(waitTime/1000)}s`);
      await this.sleep(waitTime);
      this.callCount = 0;
      this.resetTime = Date.now() + 3600000;
    }

    this.callCount++;
    logger.info(`LLM call ${this.callCount}/${this.MAX_CALLS_PER_HOUR} this hour`);
  }

  openCircuit() {
    this.circuitOpen = true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const rateLimiter = new RateLimiter();
