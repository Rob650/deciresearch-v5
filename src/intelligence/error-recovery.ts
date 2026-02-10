import { logger } from '../shared/logger.js';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterPercent: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterPercent: 10
};

export class ErrorRecovery {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    name: string,
    config: Partial<RetryConfig> = {}
  ): Promise<T | null> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    let lastError: Error | null = null;
    let delay = finalConfig.initialDelayMs;

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        const result = await fn();
        if (attempt > 1) {
          logger.info(`${name}: recovered on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < finalConfig.maxAttempts) {
          // Add jitter to prevent thundering herd
          const jitter = (Math.random() - 0.5) * (finalConfig.jitterPercent / 100) * delay;
          const actualDelay = Math.min(
            Math.max(delay + jitter, 100), // Min 100ms
            finalConfig.maxDelayMs
          );

          logger.warn(
            `${name} attempt ${attempt}/${finalConfig.maxAttempts} failed: ${lastError.message}. Retrying in ${actualDelay.toFixed(0)}ms`
          );

          await this.sleep(actualDelay);
          delay = Math.min(delay * finalConfig.backoffMultiplier, finalConfig.maxDelayMs);
        } else {
          logger.error(
            `${name}: failed after ${finalConfig.maxAttempts} attempts: ${lastError.message}`
          );
        }
      }
    }

    return null;
  }

  async executeBatch<T>(
    items: T[],
    fn: (item: T, index: number) => Promise<void>,
    batchName: string = 'batch',
    config: Partial<RetryConfig> = {}
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Error[];
  }> {
    let succeeded = 0;
    let failed = 0;
    const errors: Error[] = [];

    for (let i = 0; i < items.length; i++) {
      const result = await this.executeWithRetry(
        () => fn(items[i], i),
        `${batchName}[${i + 1}/${items.length}]`,
        config
      );

      if (result === null) {
        failed++;
      } else {
        succeeded++;
      }
    }

    if (failed > 0) {
      logger.warn(`${batchName}: ${succeeded} succeeded, ${failed} failed`);
    }

    return { succeeded, failed, errors };
  }

  // Circuit breaker pattern
  createCircuitBreaker(
    failureThreshold: number = 5,
    resetTimeoutMs: number = 60000
  ) {
    let failureCount = 0;
    let lastFailureTime = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';

    return {
      async execute<T>(
        fn: () => Promise<T>,
        name: string
      ): Promise<T | null> {
        if (state === 'open') {
          const timeSinceLastFailure = Date.now() - lastFailureTime;
          if (timeSinceLastFailure > resetTimeoutMs) {
            logger.info(`${name}: circuit breaker attempting recovery (half-open)`);
            state = 'half-open';
          } else {
            logger.warn(`${name}: circuit breaker open (${resetTimeoutMs - timeSinceLastFailure}ms remaining)`);
            return null;
          }
        }

        try {
          const result = await fn();
          if (state === 'half-open') {
            logger.info(`${name}: circuit breaker closed (recovered)`);
            state = 'closed';
            failureCount = 0;
          }
          return result;
        } catch (error) {
          failureCount++;
          lastFailureTime = Date.now();

          if (failureCount >= failureThreshold) {
            logger.error(`${name}: circuit breaker opened (${failureCount} failures)`);
            state = 'open';
          }

          throw error;
        }
      },

      reset() {
        state = 'closed';
        failureCount = 0;
        logger.info('Circuit breaker reset');
      },

      getState() {
        return { state, failureCount, timeSinceLastFailure: Date.now() - lastFailureTime };
      }
    };
  }

  // Timeout wrapper
  async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    name: string
  ): Promise<T | null> {
    return Promise.race([
      fn(),
      new Promise<null>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ]).catch((error) => {
      logger.error(`${name}: ${error.message}`);
      return null;
    });
  }

  // Exponential backoff without retry (for one-off operations)
  async waitWithBackoff(
    attempt: number,
    initialDelayMs: number = 1000,
    maxDelayMs: number = 30000
  ): Promise<void> {
    let delay = initialDelayMs * Math.pow(2, attempt - 1);
    delay = Math.min(delay, maxDelayMs);

    // Add jitter
    const jitter = Math.random() * (delay * 0.1);
    const actualDelay = delay + jitter;

    logger.info(`Backing off for ${actualDelay.toFixed(0)}ms (attempt ${attempt})`);
    await this.sleep(actualDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const errorRecovery = new ErrorRecovery();
