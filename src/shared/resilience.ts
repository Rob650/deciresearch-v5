import { logger } from './logger.js';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 60000
};

export class RetryHandler {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    name: string,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T | null> {
    let lastError: Error | null = null;
    let delay = this.config.initialDelayMs;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        logger.info(`[${name}] Attempt ${attempt}/${this.config.maxAttempts}`);
        
        const promise = fn();
        const result = await Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout after ${this.config.timeoutMs}ms`)),
              this.config.timeoutMs
            )
          )
        ]);

        logger.info(`[${name}] ✓ Success on attempt ${attempt}`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.maxAttempts) {
          logger.warn(`[${name}] Attempt ${attempt} failed: ${lastError.message}`);
          if (onRetry) onRetry(attempt, lastError);

          const jitterMs = Math.random() * 100;
          const waitMs = Math.min(delay + jitterMs, this.config.maxDelayMs);
          
          logger.info(`[${name}] Retrying in ${waitMs.toFixed(0)}ms...`);
          await this.sleep(waitMs);
          delay *= this.config.backoffMultiplier;
        } else {
          logger.error(`[${name}] ✗ Failed after ${this.config.maxAttempts} attempts`, lastError.message);
        }
      }
    }

    return null;
  }

  async executeBatch<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    concurrency: number = 3,
    name: string = 'batch'
  ): Promise<{ succeeded: number; failed: number; errors: Error[] }> {
    const errors: Error[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process in chunks to respect concurrency
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const promises = chunk.map(async (item) => {
        const result = await this.executeWithRetry(
          () => fn(item),
          `${name}[${i + chunk.indexOf(item)}]`
        );
        
        if (result === null) {
          failed++;
        } else {
          succeeded++;
        }
      });

      try {
        await Promise.all(promises);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);
        failed++;
      }
    }

    logger.info(`[${name}] Batch complete: ${succeeded} succeeded, ${failed} failed`);
    return { succeeded, failed, errors };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const defaultRetryHandler = new RetryHandler();

// Convenience function for one-off retries
export async function withRetry<T>(
  fn: () => Promise<T>,
  name: string = 'operation'
): Promise<T | null> {
  return defaultRetryHandler.executeWithRetry(fn, name);
}

// Circuit breaker pattern
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private failureThreshold: number = 5,
    private resetTimeoutMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>, name: string): Promise<T | null> {
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure > this.resetTimeoutMs) {
        logger.info(`[${name}] Circuit breaker resetting (half-open)`);
        this.state = 'half-open';
      } else {
        logger.warn(`[${name}] Circuit breaker open, waiting...`);
        return null;
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        logger.info(`[${name}] Circuit breaker closed (recovered)`);
        this.state = 'closed';
        this.failureCount = 0;
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.failureThreshold) {
        logger.error(`[${name}] Circuit breaker opened after ${this.failureCount} failures`);
        this.state = 'open';
      }

      throw error;
    }
  }

  reset() {
    this.state = 'closed';
    this.failureCount = 0;
    logger.info('Circuit breaker reset manually');
  }
}
